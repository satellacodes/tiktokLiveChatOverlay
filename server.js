import express from "express";
import { createServer } from "http";
import { Server } from "socket.io";
import {
  TikTokLiveConnection,
  SignConfig,
  WebcastEvent,
} from "tiktok-live-connector";

//INGAT SEBELUM RUNNNING GANTI, TIKTOK_USERNAME, EULER_API_KEY, MODERATORS sesuai dengan tiktok mu.
//UNTUK EULER_API_KEY bukalah website eulerstream.com dan buatlah apikey sign API Account di eulerstream baru lalu salin disini. JIKA KAMU MELEWATI TAHAP INI MAKA SEMUA OVERLAY INI AKAN SIA SIA

//config
const PORT = 3000;
const TIKTOK_USERNAME = ""; // ganti dengan tiktok yang akan streaming
const EULER_API_KEY = ""; //ambil apikey sign API Account  yang sudah anda buat di eulerstream

const MODERATORS = ["", "", ""].map((x) => x.toLowerCase()); //tambahkan 1 atau lebih moderatormu
const CHAT_HISTORY_LIMIT = 60;

const DEBUG = process.env.DEBUG === "1";
const log = (...a) => DEBUG && console.log(...a);
const info = (...a) => console.log(...a);

//app
const app = express();
const server = createServer(app);
const io = new Server(server, {
  cors: { origin: "*" },
  pingInterval: 5000,
  pingTimeout: 10000,
  perMessageDeflate: true,
});

app.use(express.static("public"));

let chatHistory = [];
let totalLikes = 0;
function resolveUser(data) {
  const u = data.user || data;
  const username = u.displayId || u.uniqueId || String(u.id || "unknown");
  const nickname = u.nickname || username;
  const avatar = u.avatarThumb?.urlList?.[0] || u.profilePictureUrl || "";
  const isMod =
    MODERATORS.includes(username.toLowerCase()) || u.userAttr?.isAdmin === true;
  const isFan = u.isSubscribe === true || u.userAttr?.isSubscribe === true;
  return { username, nickname, avatar, isMod, isFan };
}

function pushHistory(item) {
  chatHistory.push(item);
  if (chatHistory.length > CHAT_HISTORY_LIMIT) chatHistory.shift();
}

function emitLike() {
  io.emit("like", { type: "like", totalLikeCount: totalLikes });
  log(`❤️  like total: ${totalLikes}`);
}

//route testing
app.get("/restart", async (_req, res) => {
  info("🔄 RESTARTING...");
  try {
    tiktok.disconnect();
  } catch (_) {}
  chatHistory = [];
  totalLikes = 0;
  io.emit("chat-history", []);
  io.emit("like", { type: "like", totalLikeCount: 0 });
  setTimeout(async () => {
    tiktok = createClient();
    registerEvents();
    try {
      await tiktok.connect();
      info("✅ TikTok Reconnected");
    } catch (e) {
      info("❌ Reconnect Error:", e.message);
    }
  }, 1500);
  res.send("OK — reconnecting...");
});

app.get("/status", (_req, res) => {
  res.json({
    username: TIKTOK_USERNAME,
    history: chatHistory.length,
    totalLikes,
  });
});

app.get("/test-chat", (req, res) => {
  const d = {
    type: "chat",
    username: req.query.name || "test_user",
    nickname: req.query.name || "Test User",
    avatar: "https://github.com/github.png",
    message: req.query.msg || "Halo ini testing chat! 😄",
    isMod: req.query.mod === "1",
    isFan: req.query.fan === "1",
    timestamp: Date.now(),
  };
  pushHistory(d);
  io.emit("chat", d);
  res.send("OK");
});

app.get("/test-gift", (req, res) => {
  io.emit("gift", {
    type: "gift",
    username: req.query.name || "test_gifter",
    nickname: req.query.name || "Test Gifter",
    avatar: "https://github.com/github.png",
    giftName: req.query.gift || "Rose",
    giftIcon: "",
    repeatCount: parseInt(req.query.count, 10) || 1,
    diamondCount: parseInt(req.query.diamonds, 10) || 1,
    timestamp: Date.now(),
  });
  res.send("OK");
});

app.get("/test-join", (req, res) => {
  io.emit("join", {
    type: "join",
    username: req.query.name || "test_user",
    nickname: req.query.name || "Test User",
    avatar: "https://github.com/github.png",
    isFan: req.query.fan === "1",
    timestamp: Date.now(),
  });
  res.send("OK");
});

app.get("/test-follow", (req, res) => {
  io.emit("follow", {
    type: "follow",
    username: req.query.name || "test_user",
    nickname: req.query.name || "Test User",
    avatar: "https://github.com/github.png",
    timestamp: Date.now(),
  });
  res.send("OK");
});

app.get("/test-like", (req, res) => {
  const add = parseInt(req.query.add, 10) || 100;
  const set = parseInt(req.query.total, 10);
  if (!isNaN(set)) totalLikes = set;
  else totalLikes += add;
  emitLike();
  res.send(`OK — totalLikes: ${totalLikes}`);
});

app.get("/test-share", (req, res) => {
  io.emit("share", {
    type: "share",
    username: req.query.name || "test_user",
    nickname: req.query.name || "Test User",
    avatar: "https://github.com/github.png",
    timestamp: Date.now(),
  });
  res.send("OK");
});

app.get("/test-repost", (req, res) => {
  io.emit("repost", {
    type: "repost",
    username: req.query.name || "test_user",
    nickname: req.query.name || "Test User",
    avatar: "https://github.com/github.png",
    timestamp: Date.now(),
  });
  res.send("OK");
});

io.on("connection", (socket) => {
  log("🖥️  Overlay connected");
  socket.emit("chat-history", chatHistory);
  if (totalLikes > 0) {
    socket.emit("like", { type: "like", totalLikeCount: totalLikes });
  }
});

//client
SignConfig.apiKey = EULER_API_KEY;

function createClient() {
  return new TikTokLiveConnection(TIKTOK_USERNAME, {
    processInitialData: false,
    enableExtendedGiftInfo: true,
  });
}

let tiktok = createClient();

function registerEvents() {
  tiktok.on(WebcastEvent.CHAT, (data) => {
    try {
      const { username, nickname, avatar, isMod, isFan } = resolveUser(data);
      const message = (data.content || data.comment || "").trim();
      if (!message) return;
      const d = {
        type: "chat",
        username,
        nickname,
        avatar,
        message,
        isMod,
        isFan,
        timestamp: Date.now(),
      };
      pushHistory(d);
      io.emit("chat", d);
      log(
        `💬 ${isMod ? "[MOD] " : ""}${isFan ? "[FAN] " : ""}${nickname}: ${message}`,
      );
    } catch (e) {
      log("CHAT ERR:", e.message);
    }
  });

  tiktok.on(WebcastEvent.GIFT, (data) => {
    try {
      const { username, nickname, avatar } = resolveUser(data);
      const giftName =
        data.extendedGiftInfo?.name ||
        data.giftDetails?.giftName ||
        data.giftName ||
        data.common?.describe?.split(" gifted ")?.[1]?.split(" × ")?.[0] ||
        "Gift";
      const giftIcon =
        data.extendedGiftInfo?.icon?.urlList?.[0] ||
        data.giftDetails?.giftImage?.urlList?.[0] ||
        data.giftPictureUrl ||
        "";
      const diamondCount =
        data.extendedGiftInfo?.diamond_count ??
        data.giftDetails?.diamondCount ??
        data.diamondCount ??
        0;
      const giftType = data.giftDetails?.giftType ?? data.giftType;
      if (giftType === 1 && !data.repeatEnd) return;
      const d = {
        type: "gift",
        username,
        nickname,
        avatar,
        giftName,
        giftIcon,
        repeatCount: data.repeatCount || 1,
        diamondCount,
        timestamp: Date.now(),
      };
      io.emit("gift", d);
      log(
        `🎁 ${nickname} → ${giftName} x${d.repeatCount} (${d.diamondCount}💎 each)`,
      );
    } catch (e) {
      log("GIFT ERR:", e.message);
    }
  });

  tiktok.on(WebcastEvent.MEMBER, (data) => {
    try {
      const { username, nickname, avatar, isFan } = resolveUser(data);
      io.emit("join", {
        type: "join",
        username,
        nickname,
        avatar,
        isFan,
        timestamp: Date.now(),
      });
      log(`👋 ${isFan ? "[FAN] " : ""}${nickname} join`);
    } catch (e) {
      log("MEMBER ERR:", e.message);
    }
  });

  tiktok.on(WebcastEvent.FOLLOW, (data) => {
    try {
      const { username, nickname, avatar } = resolveUser(data);
      io.emit("follow", {
        type: "follow",
        username,
        nickname,
        avatar,
        timestamp: Date.now(),
      });
      log(`➕ ${nickname} follow`);
    } catch (e) {
      log("FOLLOW ERR:", e.message);
    }
  });

  tiktok.on(WebcastEvent.ROOM_USER, (data) => {
    try {
      const serverTotal =
        data.viewerCount?.totalLikeCount ?? // v 2.3.0beta1
        data.totalLikeCount ?? //
        data.likeCount ?? //
        data.total ?? // v
        null;

      if (serverTotal !== null && Number(serverTotal) > totalLikes) {
        totalLikes = Number(serverTotal);
        emitLike();
      }

      log("ROOM_USER raw:", JSON.stringify(data).slice(0, 200));
    } catch (e) {
      log("ROOM_USER ERR:", e.message);
    }
  });

  tiktok.on(WebcastEvent.LIKE, (data) => {
    try {
      log("LIKE raw:", JSON.stringify(data).slice(0, 200));

      const serverTotal = data.totalLikeCount ?? data.likeCount ?? null;

      if (serverTotal !== null && Number(serverTotal) > totalLikes) {
        totalLikes = Number(serverTotal);
      } else {
        const increment = Number(data.count || data.likeCount || 1);
        totalLikes += increment;
      }

      emitLike();
    } catch (e) {
      log("LIKE ERR:", e.message);
    }
  });

  tiktok.on(WebcastEvent.SHARE, (data) => {
    try {
      const { username, nickname, avatar } = resolveUser(data);
      io.emit("share", {
        type: "share",
        username,
        nickname,
        avatar,
        timestamp: Date.now(),
      });
      log(`🔗 ${nickname} share`);
    } catch (e) {
      log("SHARE ERR:", e.message);
    }
  });

  tiktok.on(WebcastEvent.SOCIAL, (data) => {
    const action = JSON.stringify(data).toLowerCase();
    if (action.includes("repost") || action.includes("republish")) {
      const { username, nickname, avatar } = resolveUser(data);
      io.emit("repost", { username, nickname, avatar });
    }
  });

  tiktok.on("disconnected", () => {
    info("⚠️  Disconnected — retry dalam 30 detik...");
    setTimeout(async () => {
      try {
        tiktok = createClient();
        registerEvents();
        await tiktok.connect();
        info("✅ Auto-reconnect berhasil");
      } catch (e) {
        info("❌ Auto-reconnect gagal:", e.message);
      }
    }, 30_000);
  });

  tiktok.on("error", (err) => {
    info("⚠️  TikTok error:", err?.message || err);
  });
}

async function start() {
  if (!EULER_API_KEY || EULER_API_KEY === "GANTI_DENGAN_API_KEY_KAMU") {
    info("❌ EULER_API_KEY belum diisi!");
    process.exit(1);
  }

  registerEvents();

  try {
    await tiktok.connect();
    info("✅ TikTok Connected");
  } catch (e) {
    info("❌ TIKTOK ERROR:", e.message);
    info("   Server tetap jalan — coba /restart saat live dimulai");
  }
}

start();

server.listen(PORT, () => {
  info(`\n🎵 Server: http://localhost:${PORT}`);
  info(`   Debug, jalankan dengan DEBUG=1 untuk log detail\n`);
  info(
    `   Tips debug like: buka http://localhost:${PORT}/test-like?total=1234\n`,
  );
});
