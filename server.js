const express = require("express");
const http = require("http");
const { Server } = require("socket.io");

const TikTokConnector = require("tiktok-live-connector");
const TikTokLiveClient =
  TikTokConnector.WebcastPushConnection || TikTokConnector.TikTokLiveConnection;

if (!TikTokLiveClient) {
  console.error(
    "❌ Tidak menemukan WebcastPushConnection atau TikTokLiveConnection di paket tiktok-live-connector.\n" +
      "   Cek versi yang ter-install dengan: npm list tiktok-live-connector",
  );
  process.exit(1);
}

const IS_V2 = !!TikTokConnector.TikTokLiveConnection;
console.log(
  `ℹ️  tiktok-live-connector terdeteksi versi: ${IS_V2 ? "v2.x (TikTokLiveConnection)" : "v1.x (WebcastPushConnection)"}`,
);

function getUser(data) {
  return data.user || data;
}

const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: "*" } });

const PORT = 3000;
const TIKTOK_USERNAME = "satella.i";

const CHAT_HISTORY_LIMIT = 50;

app.use(express.static("public"));

let chatHistory = [];

function createTikTokClient() {
  return new TikTokLiveClient(TIKTOK_USERNAME, {});
}

let tiktok = createTikTokClient();

app.get("/restart", async (req, res) => {
  console.log("🔄 RESTARTING...");

  try {
    tiktok.disconnect();
    console.log("🔌 TikTok disconnected");
  } catch (e) {}

  setTimeout(async () => {
    tiktok = createTikTokClient();
    registerTikTokEvents();
    try {
      await tiktok.connect();
      console.log("✅ TikTok Reconnected");
    } catch (err) {
      console.log("❌ TikTok Reconnect Error:", err.message);
    }
  }, 1500);

  res.send("OK — TikTok sedang reconnect...");
});

app.get("/status", (req, res) => {
  res.json({
    username: TIKTOK_USERNAME,
    chatCount: chatHistory.length,
  });
});

// Buat ngetes tampilan overlay tanpa perlu live tt.
// Buka di browser http://localhost:3000/test-chat?msg=aduhGantengnya&name=masSatella
app.get("/test-chat", (req, res) => {
  const chatData = {
    type: "chat",
    username: (req.query.name || "test_user").toLowerCase(),
    nickname: req.query.name || "Test User",
    avatar: "https://github.com/github.png",
    message: req.query.msg || "Ini contoh pesan chat untuk testing!",
    timestamp: Date.now(),
  };
  chatHistory.push(chatData);
  if (chatHistory.length > CHAT_HISTORY_LIMIT) chatHistory.shift();
  io.emit("chat", chatData);
  res.send("OK — chat dummy terkirim ke overlay");
});

// Buka di browser http://localhost:3000/test-gift?name=MasGatot&gift=Rose&count=5
app.get("/test-gift", (req, res) => {
  const giftData = {
    type: "gift",
    username: (req.query.name || "test_user").toLowerCase(),
    nickname: req.query.name || "Test User",
    avatar: "https://github.com/github.png",
    giftName: req.query.gift || "Rose",
    giftIcon: "",
    repeatCount: parseInt(req.query.count, 10) || 1,
    diamondCount: 1,
    timestamp: Date.now(),
  };
  io.emit("gift", giftData);
  res.send("OK — gift dummy terkirim ke overlay");
});

// Buka di browser http://localhost:3000/test-follow?name=MasRusdi
app.get("/test-follow", (req, res) => {
  const followData = {
    type: "follow",
    username: (req.query.name || "test_user").toLowerCase(),
    nickname: req.query.name || "Test User",
    avatar: "https://github.com/github.png",
  };
  io.emit("follow", followData);
  res.send("OK — follow dummy terkirim ke overlay");
});

// Buka di browser http://localhost:3000/test-like?count=15&total=1200
app.get("/test-like", (req, res) => {
  const likeData = {
    type: "like",
    username: (req.query.name || "test_user").toLowerCase(),
    nickname: req.query.name || "Test User",
    likeCount: parseInt(req.query.count, 10) || 1,
    totalLikeCount: parseInt(req.query.total, 10) || undefined,
  };
  io.emit("like", likeData);
  res.send("OK — like dummy terkirim ke overlay");
});

io.on("connection", (socket) => {
  console.log("Overlay connected");
  // kirim history chat yang udah ada supaya overlay baru tidak kosong melompong
  socket.emit("chat-history", chatHistory);
});

function registerTikTokEvents() {
  // chat
  tiktok.on("chat", (data) => {
    try {
      const user = getUser(data);
      const message = data.comment?.trim();
      const username = user.uniqueId;
      if (!message || !username) return;

      const chatData = {
        type: "chat",
        username,
        nickname: user.nickname || username,
        avatar: user.profilePictureUrl || "",
        message,
        timestamp: Date.now(),
      };

      chatHistory.push(chatData);
      if (chatHistory.length > CHAT_HISTORY_LIMIT) chatHistory.shift();

      io.emit("chat", chatData);
      console.log(`💬 ${chatData.nickname}: ${message}`);
    } catch (err) {
      console.log(err);
    }
  });

  tiktok.on("gift", (data) => {
    try {
      const user = getUser(data);

      const gift = data.gift || data;
      const giftName = gift.name || data.giftName || "Gift";
      const giftIcon = gift.image?.url || data.giftPictureUrl || "";
      const giftType = gift.type ?? data.giftType;

      const isStreakable = giftType === 1;
      const comboFinished =
        data.streaking !== undefined
          ? data.streaking === false
          : data.repeatEnd === true;
      if (isStreakable && !comboFinished) return;

      const giftData = {
        type: "gift",
        username: user.uniqueId,
        nickname: user.nickname || user.uniqueId,
        avatar: user.profilePictureUrl || "",
        giftName,
        giftIcon,
        repeatCount: data.repeatCount || 1,
        diamondCount: gift.diamondCount || data.diamondCount || 0,
        timestamp: Date.now(),
      };

      io.emit("gift", giftData);
      console.log(
        `🎁 ${giftData.nickname} mengirim ${giftData.giftName} x${giftData.repeatCount}`,
      );
    } catch (err) {
      console.log(err);
    }
  });

  tiktok.on("like", (data) => {
    try {
      const user = getUser(data);
      io.emit("like", {
        type: "like",
        username: user.uniqueId,
        nickname: user.nickname || user.uniqueId,
        likeCount: data.likeCount,
        totalLikeCount: data.totalLikeCount,
      });
    } catch (err) {
      console.log(err);
    }
  });

  tiktok.on("follow", (data) => {
    try {
      const user = getUser(data);
      io.emit("follow", {
        type: "follow",
        username: user.uniqueId,
        nickname: user.nickname || user.uniqueId,
        avatar: user.profilePictureUrl || "",
      });
    } catch (err) {
      console.log(err);
    }
  });
}

async function start() {
  try {
    await tiktok.connect();
    console.log("✅ TikTok Connected");
    registerTikTokEvents();
  } catch (err) {
    console.log("❌ TIKTOK ERROR:", err);
  }
}

start();

server.listen(PORT, () => {
  console.log(`\n🎵 Server running at http://localhost:${PORT}\n`);
});
