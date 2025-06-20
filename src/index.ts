/**
 * Send Discord notification for new Reddit post
 */
async function sendDiscordNotification(
  post: RedditPost,
  env: Env,
): Promise<void> {
  const webhookUrl = env.DISCORD_WEBHOOK_URL;

  if (!webhookUrl) {
    console.log("No Discord webhook URL configured, skipping notification");
    return;
  }

  try {
    const redditUrl = `https://reddit.com${post.permalink}`;
    const postDate = new Date(post.created_utc * 1000);

    // Truncate description if too long
    const description = post.selftext
      ? post.selftext.length > 300
        ? `${post.selftext.substring(0, 300)}...`
        : post.selftext
      : "Click the link to view this post on Reddit!";

    interface DiscordEmbed {
      author: {
        name: string;
        url: string;
        icon_url: string;
      };
      title: string;
      url: string;
      description: string;
      color: number;
      fields: {
        name: string;
        value: string;
        inline: boolean;
      }[];
      thumbnail: {
        url: string;
      };
      footer: {
        text: string;
        icon_url: string;
      };
      timestamp: string;
      image?: {
        url: string;
      };
    }

    const discordMessage: {
      username: string;
      avatar_url: string;
      content: string;
      embeds: DiscordEmbed[];
    } = {
      username: "Guinness Scanner",
      avatar_url:
        "https://logoeps.com/wp-content/uploads/2013/03/guinness-vector-logo.png",
      content: "🍺 **New post in r/guinness!**",
      embeds: [
        {
          author: {
            name: `u/${post.author}`,
            url: `https://reddit.com/u/${post.author}`,
            icon_url:
              "https://www.redditstatic.com/desktop2x/img/favicon/android-icon-192x192.png",
          },
          title: post.title,
          url: redditUrl,
          description: description,
          color: 0x000000, // Guinness black color
          fields: [
            {
              name: "📊 Score",
              value: `${post.score} points`,
              inline: true,
            },
            {
              name: "🕒 Posted",
              value: `<t:${post.created_utc}:R>`, // Discord timestamp format for "relative time"
              inline: true,
            },
            {
              name: "🔗 Subreddit",
              value: "r/guinness",
              inline: true,
            },
          ],
          thumbnail: {
            url: "https://styles.redditmedia.com/t5_2qh2w/styles/communityIcon_6kzk4e2pke831.png", // r/guinness subreddit icon
          },
          footer: {
            text: "Sláinte! 🍻",
            icon_url:
              "https://logoeps.com/wp-content/uploads/2013/03/guinness-vector-logo.png",
          },
          timestamp: postDate.toISOString(),
        },
      ],
    };

    // If the post has an image URL, add it to the embed
    if (
      post.url &&
      (post.url.includes(".jpg") ||
        post.url.includes(".png") ||
        post.url.includes(".gif") ||
        post.url.includes("imgur") ||
        post.url.includes("i.redd.it"))
    ) {
      discordMessage.embeds[0].image = { url: post.url };
    }

    console.log(`📨 Sending Discord notification for: ${post.title}`);

    const response = await fetch(webhookUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(discordMessage),
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error(
        `❌ Discord webhook failed: ${response.status} ${response.statusText}`,
      );
      console.error("Discord error response:", errorText);
    } else {
      console.log(
        `✅ Discord notification sent successfully for: ${post.title}`,
      );
    }
  } catch (error) {
    console.error("❌ Error sending Discord notification:", error);
  }
}

/**
 * Welcome to Cloudflare Workers!
 *
 * This is a template for a Scheduled Worker: a Worker that can run on a
 * configurable interval:
 * https://developers.cloudflare.com/workers/platform/triggers/cron-triggers/
 *
 * - Run `npm run dev` in your terminal to start a development server
 * - Run `curl "http://localhost:8787/__scheduled?cron=*+*+*+*+*"` to see your Worker in action
 * - Run `npm run deploy` to publish your Worker
 *
 * Bind resources to your Worker in `wrangler.jsonc`. After adding bindings, a type definition for the
 * `Env` object can be regenerated with `npm run cf-typegen`.
 *
 * Learn more at https://developers.cloudflare.com/workers/
 */

interface Env {
  REDDIT_CLIENT_ID: string;
  REDDIT_CLIENT_SECRET: string;
  REDDIT_KV: KVNamespace; // KV binding matches wrangler.jsonc
  DISCORD_WEBHOOK_URL?: string; // Optional Discord webhook URL
}

interface RedditPost {
  id: string;
  title: string;
  permalink: string;
  created_utc: number;
  author: string;
  url: string;
  selftext?: string;
  score: number;
}

interface StoredPost {
  post_id: string;
  title: string;
  permalink: string;
  created_utc: number;
  author: string;
  url: string;
  selftext?: string;
  score: number;
  stored_at: number; // timestamp when stored
}

export default {
  async scheduled(event, env, ctx): Promise<void> {
    console.log("🔁 Cron triggered:", event.cron);
    try {
      const reddit = new RedditAPI(
        env.REDDIT_CLIENT_ID,
        env.REDDIT_CLIENT_SECRET,
      );

      // Fetch the latest posts from the Guinness subreddit
      const posts = await reddit.getPosts();

      console.log(`📥 Fetched ${posts.length} posts:`);

      // Fetch posts from KV store
      const storedPosts = await getPostsFromKV(env.REDDIT_KV);

      console.log(`📦 Found ${storedPosts.length} stored posts in KV.`);

      // Filter out posts that are already stored
      const newPosts = posts.filter(
        (post) =>
          !storedPosts.some((storedPost) => storedPost.post_id === post.id),
      );

      console.log(`🆕 Found ${newPosts.length} new posts to store.`);

      for (const post of newPosts) {
        console.log(`📝 ${post.title}`);
        console.log(`🔗 https://reddit.com${post.permalink}`);

        // Store the new post in KV
        await storePostInKV(post, env.REDDIT_KV);

        // Send Discord notification for new post
        await sendDiscordNotification(post, env);
      }

      // Optional: Clean up old posts (older than 30 days)
      await cleanupOldPosts(env.REDDIT_KV);
    } catch (error) {
      console.error("🚨 Error fetching Reddit posts:", error);
    }
  },
} satisfies ExportedHandler<Env>;

/**
 * Retrieve all stored posts from KV store
 */
async function getPostsFromKV(kv: KVNamespace): Promise<StoredPost[]> {
  console.log("Fetching posts from KV store...");

  try {
    // List all keys with the "post:" prefix
    const listResult = await kv.list({ prefix: "post:" });
    const posts: StoredPost[] = [];

    // Fetch each post data
    for (const key of listResult.keys) {
      const postData = await kv.get(key.name, "json");
      if (postData) {
        posts.push(postData as StoredPost);
      }
    }

    console.log(`Retrieved ${posts.length} posts from KV store.`);
    return posts;
  } catch (error) {
    console.error("Error fetching posts from KV:", error);
    return [];
  }
}

/**
 * Store a Reddit post in KV store
 */
async function storePostInKV(post: RedditPost, kv: KVNamespace): Promise<void> {
  console.log(`Storing post in KV: ${post.title}`);

  const storedPost: StoredPost = {
    post_id: post.id,
    title: post.title,
    permalink: post.permalink,
    created_utc: post.created_utc,
    author: post.author,
    url: post.url,
    selftext: post.selftext,
    score: post.score,
    stored_at: Date.now(),
  };

  try {
    // Store with key "post:{post_id}"
    await kv.put(`post:${post.id}`, JSON.stringify(storedPost));
    console.log(`✅ Successfully stored post: ${post.id}`);
  } catch (error) {
    console.error(`❌ Failed to store post ${post.id}:`, error);
  }
}

/**
 * Clean up posts older than specified days (default: 30 days)
 */
async function cleanupOldPosts(
  kv: KVNamespace,
  maxAgeDays = 30,
): Promise<void> {
  console.log(`🧹 Cleaning up posts older than ${maxAgeDays} days...`);

  const maxAgeMs = maxAgeDays * 24 * 60 * 60 * 1000;
  const cutoffTime = Date.now() - maxAgeMs;

  try {
    const listResult = await kv.list({ prefix: "post:" });
    let deletedCount = 0;

    for (const key of listResult.keys) {
      const postData = (await kv.get(key.name, "json")) as StoredPost | null;

      if (postData && postData.stored_at < cutoffTime) {
        await kv.delete(key.name);
        deletedCount++;
        console.log(`🗑️ Deleted old post: ${postData.title}`);
      }
    }

    console.log(`🧹 Cleanup complete. Deleted ${deletedCount} old posts.`);
  } catch (error) {
    console.error("Error during cleanup:", error);
  }
}

/**
 * Optional: Get a specific post by ID
 */
async function getPostById(
  kv: KVNamespace,
  postId: string,
): Promise<StoredPost | null> {
  try {
    const postData = await kv.get(`post:${postId}`, "json");
    return postData as StoredPost | null;
  } catch (error) {
    console.error(`Error fetching post ${postId}:`, error);
    return null;
  }
}

/**
 * Optional: Get recent posts (limit by count)
 */
async function getRecentPosts(
  kv: KVNamespace,
  limit = 5,
): Promise<StoredPost[]> {
  try {
    const listResult = await kv.list({ prefix: "post:" });
    const posts: StoredPost[] = [];

    for (const key of listResult.keys) {
      const postData = await kv.get(key.name, "json");
      if (postData) {
        posts.push(postData as StoredPost);
      }
    }

    // Sort by stored_at timestamp (most recent first) and limit
    return posts.sort((a, b) => b.stored_at - a.stored_at).slice(0, limit);
  } catch (error) {
    console.error("Error fetching recent posts:", error);
    return [];
  }
}

class RedditAPI {
  private readonly USER_AGENT = "CreamyBot/1.0 (by /u/dazftw)";
  private accessToken: string | null = null;

  constructor(
    private readonly clientId: string,
    private readonly clientSecret: string,
    private readonly limit: number = 5,
  ) {}

  private async getAccessToken(): Promise<string> {
    if (this.accessToken) {
      console.log("Using cached Reddit access token.");
      return this.accessToken;
    }

    const credentials = btoa(`${this.clientId}:${this.clientSecret}`);
    console.log("Requesting new Reddit access token...");
    const res = await fetch("https://www.reddit.com/api/v1/access_token", {
      method: "POST",
      headers: {
        Authorization: `Basic ${credentials}`,
        "Content-Type": "application/x-www-form-urlencoded",
        "User-Agent": this.USER_AGENT,
      },
      body: "grant_type=client_credentials",
    });

    if (!res.ok) {
      console.error(`Failed to fetch token: ${res.status} ${res.statusText}`);
      const errorText = await res.text();
      console.error("Token fetch response:", errorText);
      throw new Error(`Failed to fetch token: ${res.status}`);
    }

    const json = (await res.json()) as { access_token: string };
    this.accessToken = json.access_token;
    console.log("Reddit access token obtained.");
    return this.accessToken;
  }

  private async fetchWithAuth(url: string) {
    const token = await this.getAccessToken();
    console.log(`Fetching URL with auth: ${url}`);
    const res = await fetch(url, {
      headers: {
        Authorization: `Bearer ${token}`,
        "User-Agent": this.USER_AGENT,
      },
    });
    if (!res.ok) {
      console.error(
        `Failed to fetch URL: ${url} - Status: ${res.status} ${res.statusText}`,
      );
      const errorText = await res.text();
      console.error("Fetch response:", errorText);
    }
    return res;
  }

  async getPosts(): Promise<RedditPost[]> {
    try {
      const url = `https://oauth.reddit.com/r/guinness/new?limit=${this.limit}`;
      const res = await this.fetchWithAuth(url);

      if (!res.ok) {
        throw new Error(`Failed to fetch posts: ${res.status}`);
      }

      const json = (await res.json()) as {
        data: { children: Array<{ data: RedditPost }> };
      };
      console.log(`Fetched ${json.data.children.length} posts from Reddit.`);
      return json.data.children.map((c) => c.data);
    } catch (error) {
      console.error("Error in getPosts:", error);
      throw error;
    }
  }
}
