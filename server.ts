/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import express from "express";
import path from "path";
import { createServer as createViteServer } from "vite";
import { MongoClient } from "mongodb";
import dotenv from "dotenv";
import http from "http";
import { WebSocketServer, WebSocket } from "ws";
import { Server as SocketIOServer } from "socket.io";

dotenv.config();

const app = express();
const PORT = 3000;

// Wrap express with HTTP server for WebSockets
const server = http.createServer(app);
const wss = new WebSocketServer({ noServer: true });

// Handle WebSocket server errors
wss.on("error", (error) => {
  console.error("WebSocket server error:", error);
});

// Explicitly handle HTTP upgrades to prevent collisions with other development middleware (e.g. Vite)
server.on("upgrade", (request, socket, head) => {
  const url = request.url || "";
  // Check if the upgrade request is for our telemetry endpoint
  if (url.startsWith("/ws/telemetry")) {
    wss.handleUpgrade(request, socket, head, (ws) => {
      wss.emit("connection", ws, request);
    });
  } else {
    // If it's another upgrade (e.g., Vite HMR), do not destroy the socket and let it bubble/be handled by other handlers
  }
});

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// In-memory data store fallbacks
let memoryTelemetry: any[] = [];

interface CraneStats {
  craneId: string;
  operatingHours: number;
  totalPackets: number;
  maxMainWeight: number;
  maxAuxWeight: number;
  lastActiveTimestamp: string | null;
  lastState: string;
}

let craneStatsMemory: Record<string, CraneStats> = {};

// Keep track of connected WS clients
const clients = new Set<WebSocket>();

// Initialize Socket.io Server
const io = new SocketIOServer(server, {
  cors: {
    origin: "*",
    methods: ["GET", "POST"]
  },
  path: "/socket.io"
});

io.on("connection", (socket) => {
  console.log(`Socket.io client connected: ${socket.id}`);
  
  // Send initial history
  getTelemetry().then((history) => {
    socket.emit("initial_history", history);
  }).catch((err) => {
    console.error("Failed to load initial history for socket:", err);
  });

  // Send initial stats on connection
  socket.emit("initial_stats", Object.values(craneStatsMemory));

  socket.on("disconnect", () => {
    console.log(`Socket.io client disconnected: ${socket.id}`);
  });
});

wss.on("connection", (ws) => {
  clients.add(ws);
  console.log(`WebSocket client connected. Total clients: ${clients.size}`);
  
  // Send initial stats on connection
  ws.send(JSON.stringify({
    type: "INITIAL_STATS",
    stats: Object.values(craneStatsMemory)
  }));

  ws.on("error", (err) => {
    console.error("WebSocket client connection error:", err);
  });

  ws.on("close", () => {
    clients.delete(ws);
    console.log(`WebSocket client disconnected. Total clients: ${clients.size}`);
  });
});

// Broadcast helper
function broadcast(data: any) {
  const payload = JSON.stringify(data);
  for (const client of clients) {
    if (client.readyState === WebSocket.OPEN) {
      client.send(payload);
    }
  }
}

// MongoDB Configuration
const mongoUri = process.env.MONGODB_URI || "";
let mongoClient: MongoClient | null = null;
let isMongoConnected = false;
let dbName = "Local In-Memory Database";

async function connectMongo() {
  if (!mongoUri || mongoUri.includes("MY_MONGODB_URI") || mongoUri.includes("username:password")) {
    console.log("No valid MONGODB_URI detected in environment variables. Falling back to robust in-memory store.");
    return;
  }
  try {
    console.log("Attempting to connect to MongoDB...");
    mongoClient = new MongoClient(mongoUri, { connectTimeoutMS: 5000 });
    await mongoClient.connect();
    isMongoConnected = true;
    dbName = mongoClient.db().databaseName || "crane_telemetry";
    console.log(`Successfully connected to MongoDB! Database name: ${dbName}`);
    
    // Load historical stats
    await loadStats();
  } catch (err) {
    console.error("Failed to connect to MongoDB, falling back to in-memory store. Error:", err);
    isMongoConnected = false;
  }
}

async function loadStats() {
  if (isMongoConnected && mongoClient) {
    try {
      const db = mongoClient.db();
      const statsDocs = await db.collection("crane_stats").find({}).toArray();
      for (const doc of statsDocs) {
        craneStatsMemory[doc.craneId] = {
          craneId: doc.craneId,
          operatingHours: Number(doc.operatingHours || 0),
          totalPackets: Number(doc.totalPackets || 0),
          maxMainWeight: Number(doc.maxMainWeight || 0),
          maxAuxWeight: Number(doc.maxAuxWeight || 0),
          lastActiveTimestamp: doc.lastActiveTimestamp || null,
          lastState: doc.lastState || "IDLE",
        };
      }
      console.log(`Loaded ${statsDocs.length} crane stats from MongoDB.`);
    } catch (err) {
      console.error("Failed to load crane stats from MongoDB:", err);
    }
  }
}

connectMongo().catch((err) => {
  console.error("Unhandled error in connectMongo initialization:", err);
});

// Process new packet, calculate state and hours
async function processTelemetryAndStats(data: any) {
  const craneId = String(
    data.craneId ?? 
    data.crane_id ?? 
    data.nodeId ?? 
    data.node_id ?? 
    data.id ?? 
    data.device ?? 
    data.deviceId ?? 
    "ESP32_NODE"
  ).trim();
  const ct = Number(data.ct ?? data.CT ?? data.trolley ?? 0);
  const lt = Number(data.lt ?? data.LT ?? data.gantry ?? 0);
  const mh = Number(data.mh ?? data.MH ?? data.mainHoist ?? 0);
  const ah = Number(data.ah ?? data.AH ?? data.auxHoist ?? 0);
  
  // Parse weights - prioritise mainWeight/auxWeight, falling back to legacy fields if necessary
  const mainWeight = Number(data.mainWeight ?? data.mainHoistWeight ?? data.main_weight ?? data.weight ?? data.MAIN_WT ?? data.mainWt ?? 0);
  const auxWeight = Number(data.auxWeight ?? data.auxHoistWeight ?? data.aux_weight ?? data.AUX_WT ?? data.auxWt ?? 0);

  const serverTimestamp = new Date().toISOString();
  const deviceTimestamp = (data.deviceTimestamp !== undefined && data.deviceTimestamp !== null)
    ? String(data.deviceTimestamp)
    : null;

  // Use serverTimestamp if original payload timestamp is missing
  const timestamp = data.timestamp || serverTimestamp;

  // 1. Calculate crane state based on weight and coordinates
  let state = "IDLE";
  if (mainWeight > 73000.0 || auxWeight > 73000.0) {
    state = "OVERLOAD";
  } else if (mainWeight > 50.0 || auxWeight > 50.0 || ct > 0 || lt > 0 || mh > 0 || ah > 0) {
    state = "OPERATING";
  }

  // Get or init stats
  if (!craneStatsMemory[craneId]) {
    craneStatsMemory[craneId] = {
      craneId,
      operatingHours: 0,
      totalPackets: 0,
      maxMainWeight: 0,
      maxAuxWeight: 0,
      lastActiveTimestamp: null,
      lastState: "IDLE",
    };
  }

  const stats = craneStatsMemory[craneId];

  // 2. Compute operating hours
  if ((state === "OPERATING" || state === "OVERLOAD") && stats.lastActiveTimestamp) {
    const prevTime = new Date(stats.lastActiveTimestamp).getTime();
    const currTime = new Date(timestamp).getTime();
    const diffMs = currTime - prevTime;

    // Continuous update threshold: if interval is less than 5 minutes (300,000 ms)
    if (diffMs > 0 && diffMs < 5 * 60 * 1000) {
      const hoursDiff = diffMs / (1000 * 60 * 60);
      stats.operatingHours = Number((stats.operatingHours + hoursDiff).toFixed(6));
    }
  }

  // Record active timestamps for continuous runtime accumulation
  if (state === "OPERATING" || state === "OVERLOAD") {
    stats.lastActiveTimestamp = timestamp;
  } else {
    stats.lastActiveTimestamp = null;
  }

  // Update cumulative totals
  stats.totalPackets += 1;
  stats.maxMainWeight = Number(Math.max(stats.maxMainWeight, mainWeight).toFixed(2));
  stats.maxAuxWeight = Number(Math.max(stats.maxAuxWeight, auxWeight).toFixed(2));
  stats.lastState = state;

  // Persist updated metrics to MongoDB
  if (isMongoConnected && mongoClient) {
    try {
      const db = mongoClient.db();
      await db.collection("crane_stats").updateOne(
        { craneId },
        { $set: stats },
        { upsert: true }
      );
    } catch (err) {
      console.error(`Failed to save crane stats for ${craneId} to MongoDB:`, err);
    }
  }

  // Create a copy of incoming data and remove potential duplicate weight/timestamp mappings
  const dataCopy = { ...data };
  delete dataCopy.mainWeight;
  delete dataCopy.auxWeight;
  delete dataCopy.mainHoistWeight;
  delete dataCopy.auxHoistWeight;

  // Combine data into final telemetry record
  const telemetryItem = {
    ...dataCopy,
    craneId,
    ct,
    lt,
    mh,
    ah,
    mainWeight,
    auxWeight,
    deviceTimestamp,
    serverTimestamp,
    state,
    operatingHours: Number(stats.operatingHours.toFixed(4)),
    timestamp
  };

  let savedItem: any;
  if (isMongoConnected && mongoClient) {
    try {
      const db = mongoClient.db();
      const result = await db.collection("telemetry").insertOne(telemetryItem);
      savedItem = { ...telemetryItem, _id: result.insertedId.toString() };
    } catch (err) {
      console.error("MongoDB telemetry insert failed, storing in memory instead:", err);
      memoryTelemetry.unshift(telemetryItem);
      if (memoryTelemetry.length > 3000) {
        memoryTelemetry = memoryTelemetry.slice(0, 3000);
      }
      savedItem = telemetryItem;
    }
  } else {
    memoryTelemetry.unshift(telemetryItem);
    if (memoryTelemetry.length > 3000) {
      memoryTelemetry = memoryTelemetry.slice(0, 3000);
    }
    savedItem = telemetryItem;
  }

  // Broadcast to all active clients (WebSockets)
  broadcast({
    type: "TELEMETRY_UPDATE",
    data: savedItem,
    stats: Object.values(craneStatsMemory)
  });

  // Also broadcast via Socket.io
  io.emit("telemetry_update", {
    data: savedItem,
    stats: Object.values(craneStatsMemory)
  });

  return savedItem;
}

function filterMemoryTelemetry(date?: string, limit?: number) {
  let items = [...memoryTelemetry];
  if (date) {
    items = items.filter(item => item.timestamp && item.timestamp.startsWith(date));
  }
  if (limit) {
    items = items.slice(0, limit);
  }
  return items;
}

async function getTelemetry(date?: string, limit?: number) {
  if (isMongoConnected && mongoClient) {
    try {
      const db = mongoClient.db();
      const query: any = {};
      if (date) {
        query.timestamp = { $regex: `^${date}` };
      }
      
      let cursor = db.collection("telemetry")
        .find(query)
        .sort({ timestamp: -1 });
      
      if (limit) {
        cursor = cursor.limit(limit);
      } else if (!date) {
        // Fallback default limit if no date filter is present
        cursor = cursor.limit(1000);
      }
      
      const items = await cursor.toArray();
      return items.map(item => ({
        ...item,
        _id: item._id.toString()
      }));
    } catch (err) {
      console.error("MongoDB fetch failed, returning in-memory fallback:", err);
      return filterMemoryTelemetry(date, limit);
    }
  } else {
    return filterMemoryTelemetry(date, limit);
  }
}

async function clearTelemetry() {
  craneStatsMemory = {};
  let success = false;
  if (isMongoConnected && mongoClient) {
    try {
      const db = mongoClient.db();
      await db.collection("telemetry").deleteMany({});
      await db.collection("crane_stats").deleteMany({});
      success = true;
    } catch (err) {
      console.error("MongoDB delete failed:", err);
      success = false;
    }
  } else {
    memoryTelemetry = [];
    success = true;
  }

  if (success) {
    io.emit("telemetry_cleared");
    broadcast({ type: "TELEMETRY_CLEARED" });
  }
  return success;
}

// ==========================================
// API ROUTES
// ==========================================

// GET /api/config - Returns connection details, dynamic REST, and WebSocket URL
app.get("/api/config", (req, res) => {
  let hostUrl = process.env.APP_URL || "";
  const hostHeader = req.headers.host || `localhost:${PORT}`;
  
  if (!hostUrl) {
    const protocol = req.secure || req.headers["x-forwarded-proto"] === "https" ? "https" : "http";
    hostUrl = `${protocol}://${hostHeader}`;
  }
  hostUrl = hostUrl.replace(/\/+$/, "");

  // Formulate secure WebSocket URL depending on protocol
  const wsProtocol = req.secure || req.headers["x-forwarded-proto"] === "https" ? "wss" : "ws";
  const wsUrl = `${wsProtocol}://${hostHeader}`;

  res.json({
    mongodbConnected: isMongoConnected,
    databaseName: dbName,
    serverUrl: `${hostUrl}/api/crane`,
    wsUrl: wsUrl
  });
});

// GET /api/crane - Fetch latest telemetry records
app.get("/api/crane", async (req, res) => {
  try {
    const date = req.query.date as string | undefined;
    const limit = req.query.limit ? parseInt(req.query.limit as string, 10) : undefined;
    const telemetry = await getTelemetry(date, limit);
    res.json(telemetry);
  } catch (error: any) {
    res.status(500).json({ error: error.message || "Failed to fetch telemetry" });
  }
});

// GET /api/crane/stats - Fetch aggregated stats & operating hours for each crane
app.get("/api/crane/stats", (req, res) => {
  res.json(Object.values(craneStatsMemory));
});

// POST /api/crane - Endpoint for ESP32 & Receiver LoRa Ingestion
app.post("/api/crane", async (req, res) => {
  try {
    const data = req.body;
    console.log("LoRa-ESP32 Ingestion payload received:", data);

    // Validate deviceTimestamp: if present, must be a valid ISO-8601 string
    if (data.deviceTimestamp !== undefined && data.deviceTimestamp !== null) {
      if (typeof data.deviceTimestamp !== "string") {
        return res.status(400).json({ error: "deviceTimestamp must be a string" });
      }
      const parsedDate = Date.parse(data.deviceTimestamp);
      if (isNaN(parsedDate)) {
        return res.status(400).json({ error: "deviceTimestamp must be a valid ISO-8601 string" });
      }
    }
    
    const saved = await processTelemetryAndStats(data);
    res.status(201).json({ success: true, data: saved });
  } catch (error: any) {
    res.status(500).json({ error: error.message || "Failed to save telemetry" });
  }
});

// DELETE /api/crane/clear - Reset and clear stats & database logs
app.delete("/api/crane/clear", async (req, res) => {
  try {
    const cleared = await clearTelemetry();
    res.json({ success: cleared });
  } catch (error: any) {
    res.status(500).json({ error: error.message || "Failed to clear telemetry data" });
  }
});

// ==========================================
// VITE DEV SERVER / PRODUCTION SERVING
// ==========================================
async function startApp() {
  // Use the wrapped HTTP server instead of express app. Listen immediately to open port 3000
  server.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running at http://0.0.0.0:${PORT} with WebSocket Server active.`);
  });

  if (process.env.NODE_ENV !== "production") {
    try {
      const vite = await createViteServer({
        server: { middlewareMode: true },
        appType: "spa",
      });
      app.use((req, res, next) => {
        if (req.url && (req.url.startsWith("/socket.io") || req.url.startsWith("/ws/telemetry"))) {
          return;
        }
        vite.middlewares(req, res, next);
      });
      console.log("Vite development middleware integrated successfully.");
    } catch (viteErr) {
      console.error("Vite server initialization failed, falling back to static index.html delivery:", viteErr);
      
      // Serve raw index.html from workspace root if Vite dev server fails
      app.get("/", (req, res) => {
        res.sendFile(path.join(process.cwd(), "index.html"));
      });
    }
  } else {
    try {
      const distPath = path.join(process.cwd(), "dist");
      app.use(express.static(distPath));
      app.get("*", (req, res) => {
        res.sendFile(path.join(distPath, "index.html"));
      });
    } catch (err) {
      console.error("Failed to register static route handlers:", err);
    }
  }
}

startApp().catch((err) => {
  console.error("Fatal error starting application pipeline:", err);
});
