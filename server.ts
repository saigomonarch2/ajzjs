import express from "express";
import path from "path";
import cors from "cors";
import yts from "yt-search";
import { initializeApp } from 'firebase/app';
import { getFirestore, collection, query, where, getDocs } from 'firebase/firestore';
import fs from 'fs';

// Initialize Firebase for server-side validation
const firebaseConfig = JSON.parse(fs.readFileSync(path.join(process.cwd(), 'firebase-applet-config.json'), 'utf-8'));
const firebaseApp = initializeApp(firebaseConfig);
const db = getFirestore(firebaseApp, firebaseConfig.firestoreDatabaseId);

async function startServer() {
  const app = express();
  const PORT = 3000;

  app.use(cors());
  app.use(express.json());

  // API Key Validation Middleware
  const validateApiKey = async (req: express.Request, res: express.Response, next: express.NextFunction) => {
    const apiKey = req.headers['x-api-key'] as string;
    if (!apiKey) {
      return res.status(401).json({ error: "API key is required in x-api-key header" });
    }

    try {
      const q = query(collection(db, 'apiKeys'), where('key', '==', apiKey));
      const snapshot = await getDocs(q);
      if (snapshot.empty) {
        return res.status(403).json({ error: "Invalid API key" });
      }
      next();
    } catch (error) {
      console.error("API Key validation error:", error);
      res.status(500).json({ error: "Internal server error during validation" });
    }
  };

  // External API Routes (Protected by API Key)
  app.get("/api/v1/search", validateApiKey, async (req, res) => {
    const query = req.query.q as string;
    if (!query) return res.status(400).json({ error: "Query is required" });

    try {
      const r = await yts(query);
      const videos = r.videos.slice(0, 20).map(v => ({
        id: v.videoId,
        title: v.title,
        thumbnail: v.thumbnail,
        duration: v.timestamp,
        author: v.author.name,
        url: v.url
      }));
      res.json({
        success: true,
        data: videos
      });
    } catch (error) {
      res.status(500).json({ error: "Failed to search YouTube" });
    }
  });

  app.get("/api/v1/song/:videoId", validateApiKey, async (req, res) => {
    const videoId = req.params.videoId;
    try {
      const r = await yts({ videoId });
      if (!r) return res.status(404).json({ error: "Song not found" });
      
      res.json({
        success: true,
        data: {
          id: r.videoId,
          title: r.title,
          thumbnail: r.thumbnail,
          duration: r.timestamp,
          author: r.author.name,
          streamUrl: `https://www.youtube.com/watch?v=${r.videoId}`
        }
      });
    } catch (error) {
      res.status(500).json({ error: "Failed to fetch song details" });
    }
  });

  // Internal API Routes (Used by the web app)
  app.get("/api/search", async (req, res) => {
    const query = req.query.q as string;
    if (!query) return res.status(400).json({ error: "Query is required" });

    try {
      const r = await yts(query);
      const videos = r.videos.slice(0, 20).map(v => ({
        id: v.videoId,
        title: v.title,
        thumbnail: v.thumbnail,
        duration: v.timestamp,
        author: v.author.name,
        url: v.url
      }));
      res.json(videos);
    } catch (error) {
      console.error("Search error:", error);
      res.status(500).json({ error: "Failed to search YouTube" });
    }
  });

  app.get("/api/playlist", async (req, res) => {
    const url = req.query.url as string;
    if (!url) return res.status(400).json({ error: "Playlist URL is required" });

    try {
      // Extract playlist ID from URL
      const playlistIdMatch = url.match(/[&?]list=([^&]+)/);
      let playlistId = playlistIdMatch ? playlistIdMatch[1] : url.trim();

      // Basic validation: YouTube playlist IDs are usually 18, 24, or 34 characters
      // but can vary. They often start with PL, UU, LL, RD, etc.
      if (!playlistId || playlistId.length < 10) {
        return res.status(400).json({ error: "Invalid YouTube playlist URL or ID. Please make sure it contains a 'list=' parameter." });
      }

      // Handle Mix playlists (RD...)
      if (playlistId.startsWith('RD')) {
        return res.status(400).json({ 
          error: "YouTube 'Mix' playlists are dynamic and generated specifically for your session. They cannot be imported by third-party apps. Please try a standard playlist (usually starts with 'PL')." 
        });
      }

      console.log(`Fetching playlist: ${playlistId}`);
      
      const r = await yts({ listId: playlistId });
      
      if (!r || !r.videos || r.videos.length === 0) {
        return res.status(400).json({ 
          error: "No videos found in this playlist. It might be empty, private, or restricted by YouTube." 
        });
      }

      const playlist = {
        id: r.listId || playlistId,
        title: r.title || "Untitled Playlist",
        author: r.author?.name || "Unknown Author",
        songs: r.videos.map(v => ({
          id: v.videoId,
          title: v.title,
          thumbnail: v.thumbnail,
          duration: v.timestamp,
          author: v.author?.name || "Unknown Author"
        }))
      };
      res.json(playlist);
    } catch (error: any) {
      console.error("Playlist error details:", error);
      const message = error?.message || "";
      
      if (message.includes("unviewable") || message.includes("not found")) {
        return res.status(400).json({ 
          error: "This playlist is unviewable. This usually means it's set to 'Private' on YouTube. Please make sure the playlist is 'Public' or 'Unlisted' before importing." 
        });
      }
      
      res.status(500).json({ error: "An unexpected error occurred while fetching the playlist. Please try again later." });
    }
  });

  app.get("/api/song/:videoId", async (req, res) => {
    const videoId = req.params.videoId;
    try {
      const r = await yts({ videoId });
      if (!r) return res.status(404).json({ error: "Song not found" });
      
      res.json({
        id: r.videoId,
        title: r.title,
        thumbnail: r.thumbnail,
        duration: r.timestamp,
        author: r.author.name
      });
    } catch (error) {
      console.error("Song fetch error:", error);
      res.status(500).json({ error: "Failed to fetch song details" });
    }
  });

  // Vite middleware for development
  if (process.env.NODE_ENV !== "production") {
    const { createServer: createViteServer } = await import("vite");
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), 'dist');
    app.use(express.static(distPath));
    app.get('*', (req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });
}

startServer();
