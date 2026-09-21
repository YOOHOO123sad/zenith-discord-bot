
require("dotenv").config();
const {
    Client,
    GatewayIntentBits,
    EmbedBuilder,
    ActionRowBuilder,
    ButtonBuilder,
    ButtonStyle,
    ModalBuilder,
    TextInputBuilder,
    TextInputStyle,
    PermissionsBitField,
    ChannelType,
    StringSelectMenuBuilder,
    AttachmentBuilder,
MessageFlags,
SlashCommandBuilder,
REST,
Routes
} = require("discord.js");
const fs = require("fs");
const path = require("path");
const apiClient = require("./src/services/apiClient");

function normalizeMinecraftUUID(uuid) {
  if (!uuid) return null;

  // Remove hyphens if present
  const clean = uuid.replace(/[-]/g, '');

  // Validate: must be 32 hex characters
  if (!/^[0-9a-f]{32}$/i.test(clean)) {
    return null;
  }

  // Convert to lowercase for canonical format
  const lower = clean.toLowerCase();

  // Format as canonical UUID: 8-4-4-4-12
  return lower.substring(0, 8) + '-' +
         lower.substring(8, 12) + '-' +
         lower.substring(12, 16) + '-' +
         lower.substring(16, 20) + '-' +
         lower.substring(20, 32);
}

function fetchMinecraftUUID(username) {
  return new Promise((resolve, reject) => {
    const https = require('https');
    const options = {
      hostname: 'api.mojang.com',
      path: `/users/profiles/minecraft/${encodeURIComponent(username)}`,
      method: 'GET',
    };

    const req = https.request(options, (res) => {
      let data = '';
      res.on('data', (chunk) => {
        data += chunk;
      });
      res.on('end', () => {
        if (res.statusCode === 200) {
          try {
            const parsed = JSON.parse(data);
            const uuid = normalizeMinecraftUUID(parsed.id);
            if (uuid) {
              resolve(uuid);
            } else {
              resolve(null); // Invalid UUID format
            }
          } catch (e) {
            reject(new Error('Invalid JSON response from Mojang API'));
          }
        } else if (res.statusCode === 204) {
          resolve(null); // No content means user not found
        } else {
          reject(new Error(`Mojang API returned status ${res.statusCode}`));
        }
      });
    });

    req.on('error', (e) => {
      reject(e);
    });

    req.setTimeout(5000, () => {
      req.destroy();
      reject(new Error('Request to Mojang API timed out'));
    });

    req.end();
  });
}
function getMinecraftRenderUrl(identifier) {
  if (!identifier) return "";

  return `https://skinrender.dev/render/${encodeURIComponent(
    identifier
  )}/body?yaw=35&pitch=12&fov=0&bg=transparent&fit=true&zoom=1.15`;
}

const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMembers,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent
    ]
});

let channelStates = new Map();
let activeTests = new Map();
let verifiedUsers = new Map();
let pendingTierPick = new Map();
let channelModes = new Map();
let testCooldowns = new Map();
let playerMessages = new Map();
let finishedUsersData = new Map();
let pendingVerifications = new Map();
// ========================================
// Tester Stats
// ========================================
let testerStats = new Map();
let rankedQueues = new Map();
let rankedMatches = new Map();

function loadTesterStats() {
    const file = path.join(__dirname, "testerStats.json");

    if (!fs.existsSync(file)) {
        testerStats = new Map();
        return;
    }

    try {
        const data = JSON.parse(
            fs.readFileSync(file, "utf8")
        );

        testerStats = new Map(
            Object.entries(data || {})
        );

        console.log(
            `โหลด Tester Stats แล้ว: ${testerStats.size} คน`
        );

    } catch (err) {

        console.error(
            "❌ โหลด testerStats.json ไม่สำเร็จ:",
            err
        );

        testerStats = new Map();
    }
}

function saveTesterStats() {
    const file =
        path.join(__dirname, "testerStats.json");

    fs.writeFileSync(
        file,
        JSON.stringify(
            Object.fromEntries(testerStats),
            null,
            2
        ),
        "utf8"
    );
}

function recordTesterStats(
    testerId,
    playerId,
    tier,
    mode
) {

    let stats =
        testerStats.get(testerId);

    if (!stats) {

        stats = {
            totalTests: 0,
            playersTested: [],
            tiersGiven: {},
            modes: {}
        };
    }

    // จำนวน Test
    stats.totalTests++;

    // ผู้เล่นที่เคยเทส แบบไม่ซ้ำ
    if (!stats.playersTested.includes(playerId)) {

        stats.playersTested.push(playerId);
    }

    // Tier ที่แจก
    stats.tiersGiven[tier] =
        (stats.tiersGiven[tier] || 0) + 1;

    // Mode
    const modeName =
        mode || "ไม่ระบุ";

    stats.modes[modeName] =
        (stats.modes[modeName] || 0) + 1;

    testerStats.set(
        testerId,
        stats
    );

    saveTesterStats();

    console.log(
        `Tester Stats: ${testerId} | Tests: ${stats.totalTests}`
    );
}
// ========================================
// อัปเดตข้อมูลผู้เล่นใน Discord ทันที
// ========================================
async function updatePlayerInfoMessage(guild, discordId) {

    try {

        const player = verifiedUsers.get(discordId);

        if (!player) {
            console.log(`ไม่พบข้อมูลผู้เล่น ${discordId}`);
            return;
        }

        const messageId = playerMessages.get(discordId);

        if (!messageId) {
            console.log(`ไม่พบ Message ID ของผู้เล่น ${discordId}`);
            return;
        }
        const channelId =
            player.tester === true
                ? TESTER_INFO_CHANNEL_ID
                : PLAYER_INFO_CHANNEL_ID;

        const channel =
            await guild.channels.fetch(channelId).catch(() => null);

        if (!channel) {
            console.log(`ไม่พบห้องข้อมูลผู้เล่น ${channelId}`);
            return;
        }

        const message =
            await channel.messages.fetch(messageId).catch(() => null);

        if (!message) {
            console.log(`ไม่พบ Message ${messageId}`);
            return;
        }

        if (!message.embeds || !message.embeds.length) {
            console.log("Message ไม่มี Embed");
            return;
        }

        const embed =
            EmbedBuilder.from(message.embeds[0]);

        const oldFields =
            message.embeds[0].fields || [];

        const newFields =
            oldFields.map(field => {

                if (field.name === "Tier") {
                    return {
                        ...field,
                        value: player.tier || "-"
                    };
                }

                if (field.name === "Points") {
                    return {
                        ...field,
                        value: String(player.points ?? 0)
                    };
                }

                return field;
            });

        embed.setFields(newFields);

        await message.edit({
            embeds: [embed]
        });

        console.log(
            `อัปเดต Tier/Points ใน Discord แล้ว: ${discordId}`
        );

    } catch (err) {

        console.error(
            "อัปเดตข้อมูลผู้เล่นใน Discord ไม่สำเร็จ:",
            err
        );

    }
}
const GUILD_ID = "1494920203618746449";
const VERIFY_REQUEST_CHANNEL_ID = "1537032656120979538";
const maxQueue = 20;
const testerRoleName = "Tester";
const RESULTS_CHANNEL_ID = "1523206765246681108";
const TESTER_DUTY_NOTIFY_CHANNEL_ID = "1536352503011082404";
const PLAYER_INFO_CHANNEL_ID = "1525323748172107927";
const TESTER_INFO_CHANNEL_ID = "1527323732815642915";
const QUEUE_NOTIFY_CHANNEL_ID = "1527297424773615838";
const TESTER_VERIFY_CHANNEL_ID = "1527321769570992270";
const adminRoleName = "Admin";
const resultsChannelName = "🥇test-result";
const playerInfoChannelName = "ข้อมูลผู้เล่น";
const tierOptions = ["HT1", "LT1", "HT2", "LT2", "HT3", "LT3", "HT4", "LT4", "HT5", "LT5"];
const modeOptions = ["CPVP", "SPVP", "MACEPVP", "AXEPVP", "UHC", "MACEROCKET", "SMP", "DIAPOT", "NETHPOT"];
const cooldownDays = 3;
const cooldownMs = cooldownDays * 24 * 60 * 60 * 1000;
const RANKED_RESULT_CHANNEL_ID = "1549722352198230088";

const rankedTierOrder = [
    "LT3",
    "HT3",
    "LT2",
    "HT2",
    "LT1",
    "HT1"
];

const rankedFirstTo = {
    LT3: 5,
    HT3: 6,
    LT2: 7,
    HT2: 8,
    LT1: 10,
    HT1: 10
};

const rankedTierUp = {
    LT3: "HT3",
    HT3: "LT2",
    LT2: "HT2",
    HT2: "LT1",
    LT1: "HT1",
    HT1: "HT1"
};

const rankedTierDown = {
    LT3: "LT3",
    HT3: "LT3",
    LT2: "HT3",
    HT2: "LT2",
    LT1: "HT2",
    HT1: "LT1"
};
const tierPoints = {
    HT1: 10,
    LT1: 9,
    HT2: 8,
    LT2: 7,
    HT3: 6,
    LT3: 5,
    HT4: 4,
    LT4: 3,
    HT5: 2,
    LT5: 1
};
const mainMessages = new Map();
const rankRoles = [
    { name: "Combat Grandmaster", minPoints: 400 },
    { name: "Combat Master", minPoints: 250 },
    { name: "Combat Ace", minPoints: 150 },
    { name: "Combat Specialist", minPoints: 60 },
    { name: "Combat Cadet", minPoints: 20 },
    { name: "Combat Rookie", minPoints: 0 }
];
function getState(channelId) {

    if (!channelStates.has(channelId)) {

        channelStates.set(channelId, {
            queue: [],
            onlineTesters: new Set(),
            finishedUsers: [],
            currentTesting: null,
            mainMessageId: mainMessages.get(channelId) || null
        });

    }

    const state = channelStates.get(channelId);

    // ========================================
    // โหลด Finished Users กลับจากไฟล์
    // ========================================

    state.finishedUsers = [];

    for (const [key, data] of finishedUsersData.entries()) {

        if (!key.startsWith(`${channelId}:`)) {
            continue;
        }

        if (!data || !data.userId || !data.time) {
            continue;
        }

        state.finishedUsers.push({
            userId: data.userId,
            time: data.time
        });
    }

    return state;
}
// ========================================
// Queue Call Timeout — 5 นาที
// ========================================
const QUEUE_CALL_TIMEOUT_MS = 5 * 60 * 1000;
const queueCallTimers = new Map();

function clearQueueCallTimer(queueChannelId) {
    const timer = queueCallTimers.get(queueChannelId);

    if (timer) {
        clearTimeout(timer);
        queueCallTimers.delete(queueChannelId);
    }
}

function startQueueCallTimer(queueChannelId, userId) {
    clearQueueCallTimer(queueChannelId);

    const timer = setTimeout(async () => {
        queueCallTimers.delete(queueChannelId);

        try {
            const state = channelStates.get(queueChannelId);

            if (!state || !state.currentTesting) {
                return;
            }

            // ถ้าไม่ใช่ผู้เล่นคนที่ถูกเรียกแล้ว ไม่ต้องทำอะไร
            if (state.currentTesting.userId !== userId) {
                return;
            }

            // ถ้าเริ่มเทสไปแล้ว แสดงว่าผู้เล่นเข้าห้องแล้ว
            const roomId = state.currentTesting.channelId;

            if (roomId && activeTests.has(roomId)) {
                return;
            }

            const guild = client.guilds.cache.find(
                g => g.channels.cache.has(queueChannelId)
            );

            if (!guild) {
                return;
            }

            const queueChannel =
                guild.channels.cache.get(queueChannelId);

            const skippedUserId =
                state.currentTesting.userId;

            // ========================================
            // ล้าง Current Testing
            // ========================================
            state.currentTesting = null;

            // ========================================
            // ลบห้อง Test ถ้ายังมีอยู่
            // ========================================
            if (roomId) {

                const testRoom =
                    guild.channels.cache.get(roomId);

                if (testRoom) {
                    await testRoom.delete(
                        "ผู้เล่นไม่เข้าห้อง Test ภายใน 5 นาที"
                    ).catch(() => {});
                }

                activeTests.delete(roomId);
            }

            // ========================================
            // แจ้งผู้เล่นว่าถูกข้าม
            // ========================================
            const member =
                await guild.members
                    .fetch(skippedUserId)
                    .catch(() => null);

            if (member) {

                await member.send(
                    "**หมดเวลาการเรียกคิว**\n\n" +
                    "คุณไม่ได้เข้าห้อง Test ภายใน **5 นาที**\n" +
                    "ระบบจึงข้ามคิวของคุณอัตโนมัติ\n\n" +
                    "หากต้องการทดสอบ สามารถเข้าคิวใหม่ได้"
                ).catch(() => {});
            }

            // ========================================
            // แจ้งในห้อง Queue
            // ========================================
            if (queueChannel) {

                await queueChannel.send({
                    content:
                        `<@${skippedUserId}> ไม่เข้าห้อง Test ภายใน **5 นาที** จึงถูกข้ามคิวอัตโนมัติ`
                }).catch(() => {});

                // อัปเดต Queue Embed
                if (state.mainMessageId) {

                    const mainMessage =
                        await queueChannel.messages
                            .fetch(state.mainMessageId)
                            .catch(() => null);

                    if (mainMessage) {

                        await mainMessage.edit({
                            embeds: [
                                buildEmbed(queueChannelId)
                            ],
                            components:
                                buildButtons(queueChannelId)
                        }).catch(() => {});
                    }
                }
            }

            console.log(
                `ข้ามคิว ${skippedUserId} เนื่องจากไม่เข้าห้องภายใน 5 นาที`
            );

        } catch (err) {

            console.error(
                "Queue Timeout Error:",
                err
            );
        }

    }, QUEUE_CALL_TIMEOUT_MS);

    queueCallTimers.set(
        queueChannelId,
        timer
    );
}
function getStateByRoom(roomChannelId) {

    console.log("===== GET STATE BY ROOM =====");
    console.log("Room Channel ID:", roomChannelId);

    // หาใน activeTests ก่อน
    const active = activeTests.get(roomChannelId);

    if (active) {

        console.log("FOUND IN activeTests");
        console.log(active);

        const state = getState(active.queueChannelId);

        // ซิงก์ currentTesting
        if (!state.currentTesting) {
            state.currentTesting = {
                userId: active.userId,
                testerId: active.testerId,
                detail: active.detail,
                mode: active.mode,
                channelId: roomChannelId
            };
        }

        return {
            queueChannelId: active.queueChannelId,
            state
        };
    }

    // ถ้าไม่เจอใน activeTests ให้ค้นจาก channelStates
    for (const [queueChannelId, state] of channelStates.entries()) {

        console.log(
            "Checking Queue:",
            queueChannelId,
            "currentTesting:",
            state.currentTesting
        );

        if (!state.currentTesting) continue;

        if (state.currentTesting.channelId === roomChannelId) {

            console.log("FOUND BY CHANNEL ID");

            return {
                queueChannelId,
                state
            };
        }

const expectedRoomName =
    `${state.currentTesting.userId}-${state.currentTesting.mode.toLowerCase()}-test`;

if (
    roomChannel &&
    roomChannel.name === expectedRoomName
) {
    state.currentTesting.channelId = roomChannelId;

    console.log(
        "FOUND BY ROOM NAME:",
        expectedRoomName
    );

    return {
        queueChannelId,
        state
      };
     }
   }

    console.log("❌ NOT FOUND");

    return null;
}

function saveVerifiedUsers() {
    const obj = Object.fromEntries(verifiedUsers);

    console.log("Saving to =", path.resolve("verified.json"));
    console.log("=== SAVE VERIFIED ===");
    console.log("Current directory:", process.cwd());
    console.log("Writing file:", path.resolve("verified.json"));
    console.log(obj);

    fs.writeFileSync(
        "verified.json",
        JSON.stringify(obj, null, 2)
    );

    console.log("verified.json saved");
}

function loadChannelModes() {
    if (fs.existsSync("channelModes.json")) {
        const data = JSON.parse(fs.readFileSync("channelModes.json", "utf8"));
        channelModes = new Map(Object.entries(data));
    }
}

function saveChannelModes() {
    const obj = Object.fromEntries(channelModes);
    fs.writeFileSync("channelModes.json", JSON.stringify(obj, null, 2));
}

function loadCooldowns() {
    if (fs.existsSync("cooldowns.json")) {
        const data = JSON.parse(fs.readFileSync("cooldowns.json", "utf8"));
        testCooldowns = new Map(Object.entries(data));
    }
}

function saveCooldowns() {
    const obj = Object.fromEntries(testCooldowns);
    fs.writeFileSync("cooldowns.json", JSON.stringify(obj, null, 2));
}

function loadPlayerMessages() {
    if (fs.existsSync("playerMessages.json")) {
        const data = JSON.parse(fs.readFileSync("playerMessages.json", "utf8"));
        playerMessages = new Map(Object.entries(data));
    }
}

function savePlayerMessages() {
    const obj = Object.fromEntries(playerMessages);
    fs.writeFileSync(
        "playerMessages.json",
        JSON.stringify(obj, null, 2)
    );
}
function loadFinishedUsers() {
    if (!fs.existsSync("finishedUsers.json")) {
        finishedUsersData = new Map();
        return;
    }

    try {
        const data = JSON.parse(
            fs.readFileSync("finishedUsers.json", "utf8")
        );

        finishedUsersData = new Map(
            Object.entries(data)
        );

        console.log(
            "Loaded finishedUsers:",
            finishedUsersData.size
        );

    } catch (err) {

        console.error(
            "❌ โหลด finishedUsers.json ไม่สำเร็จ:",
            err
        );

        finishedUsersData = new Map();
    }
}

function saveFinishedUsers() {
    const obj = Object.fromEntries(
        finishedUsersData
    );

    fs.writeFileSync(
        "finishedUsers.json",
        JSON.stringify(obj, null, 2)
    );

    console.log(
        "บันทึก finishedUsers.json แล้ว"
    );
}
    function loadMainMessages() {
    if (!fs.existsSync("mainMessages.json")) return;

    const data = JSON.parse(
        fs.readFileSync("mainMessages.json", "utf8")
    );

    for (const channelId of Object.keys(data)) {
        const state = getState(channelId);
        state.mainMessageId = data[channelId];
    }
}
function saveMainMessages() {
    const data = {};

    for (const [channelId, state] of channelStates.entries()) {
        if (state.mainMessageId) {
            data[channelId] = state.mainMessageId;
        }
    }

    fs.writeFileSync(
        "mainMessages.json",
        JSON.stringify(data, null, 2)
    );
}

function formatRemaining(ms) {
    const totalMinutes = Math.ceil(ms / 60000);
    const days = Math.floor(totalMinutes / 1440);
    const hours = Math.floor((totalMinutes % 1440) / 60);
    const minutes = totalMinutes % 60;
    return days + " วัน " + hours + " ชั่วโมง " + minutes + " นาที";
}
// ========================================
// Auto ลบผู้เล่นออกจาก "เทสเสร็จแล้ว"
// เมื่อ Cooldown ครบ 3 วัน
// ========================================
async function cleanupExpiredFinishedUsers() {
    const now = Date.now();
    let changed = false;

    // ----------------------------------------
    // 1. ลบข้อมูลที่หมดอายุจาก finishedUsersData
    // ----------------------------------------
    for (const [key, data] of finishedUsersData.entries()) {

        if (!data || !data.time) {
            continue;
        }

        const elapsed = now - Number(data.time);

if (elapsed >= cooldownMs) {

    console.log(
        `⏰ Cooldown หมดแล้ว: ${key}`
    );

    // ========================================
    // key = queueChannelId:userId
    // ========================================
    const separatorIndex = key.indexOf(":");

    if (separatorIndex !== -1) {

        const queueChannelId =
            key.substring(0, separatorIndex);

        const userId =
            key.substring(separatorIndex + 1);

        // หาโหมดของห้องนี้
        const mode =
            channelModes.get(queueChannelId);

        if (mode) {

            // ลบ Cooldown เฉพาะ
            // ผู้เล่นคนนี้ + โหมดนี้
            const cooldownKey =
                `${userId}:${mode}`;

            if (testCooldowns.has(cooldownKey)) {

                testCooldowns.delete(
                    cooldownKey
                );

                console.log(
                    `🟢 ลบ Cooldown แล้ว: ${cooldownKey}`
                );
            }
        }
    }

    // ========================================
    // ลบเฉพาะคนนี้ออกจาก finishedUsersData
    // ========================================
    finishedUsersData.delete(key);

    changed = true;
}
    }

    // ----------------------------------------
    // 2. ลบเฉพาะคนที่หมดเวลาออกจาก State
    // ----------------------------------------
    for (const [channelId, state] of channelStates.entries()) {

        if (!state.finishedUsers || state.finishedUsers.length === 0) {
            continue;
        }

        const oldLength = state.finishedUsers.length;

        state.finishedUsers = state.finishedUsers.filter(user => {

            if (!user || !user.time) {
                return true;
            }

            const elapsed = now - Number(user.time);

            // ยังไม่ครบ 3 วัน → เก็บไว้
            if (elapsed < cooldownMs) {
                return true;
            }

            // ครบ 3 วัน → ลบเฉพาะคนนี้
            console.log(
                `🗑️ ลบ <@${user.userId}> ออกจาก "เทสเสร็จแล้ว" ห้อง ${channelId}`
            );

            return false;
        });

        if (state.finishedUsers.length !== oldLength) {
            changed = true;

            // ----------------------------------------
            // อัปเดต Embed ของห้องนั้นทันที
            // ----------------------------------------
            if (state.mainMessageId) {

                const queueChannel =
                    client.channels.cache.get(channelId);

                if (queueChannel) {

                    const message =
                        await queueChannel.messages
                            .fetch(state.mainMessageId)
                            .catch(() => null);

                    if (message) {

                        await message.edit({
                            embeds: [
                                buildEmbed(channelId)
                            ],
                            components:
                                buildButtons(channelId)
                        }).catch(err => {
                            console.error(
                                `❌ อัปเดต Embed หลังหมด Cooldown ไม่สำเร็จ (${channelId}):`,
                                err
                            );
                        });
                    }
                }
            }
        }
    }

    // ----------------------------------------
    // 3. บันทึกไฟล์เมื่อมีการเปลี่ยนแปลงเท่านั้น
    // ----------------------------------------
    if (changed) {
        saveFinishedUsers();

        console.log(
            "✅ cleanupExpiredFinishedUsers ทำงานเสร็จแล้ว"
        );
    }
}

loadVerifiedUsers();
loadMainMessages();
loadChannelModes();
loadCooldowns();
loadPlayerMessages();
loadFinishedUsers();

// ตรวจผู้เล่นที่หมด Cooldown ทุก 1 นาที
setInterval(() => {
    cleanupExpiredFinishedUsers().catch(err => {
        console.error(
            "❌ Auto cleanup cooldown error:",
            err
        );
    });
}, 60 * 1000);

// ตรวจทันทีตอนบอทเปิด
setTimeout(() => {
    cleanupExpiredFinishedUsers().catch(err => {
        console.error(
            "❌ Initial cooldown cleanup error:",
            err
        );
    });
}, 5000);

function loadVerifiedUsers() {
    console.log("Loading verified.json...");

    if (!fs.existsSync("verified.json")) {
        console.log("verified.json not found");
        return;
    }

    const raw = fs.readFileSync("verified.json", "utf8");

    console.log(raw);

    const data = JSON.parse(raw);

    verifiedUsers = new Map(Object.entries(data));

    console.log("Loaded IDs:", [...verifiedUsers.keys()]);
}
async function updateCombatRank(discordId) {

    try {

        // ========================================
        // ดึงข้อมูลผู้เล่น
        // ========================================

        const player =
            verifiedUsers.get(discordId);

        if (!player) {

            console.log(
                `ไม่พบข้อมูลผู้เล่น ${discordId}`
            );

            return;
        }


        // ========================================
        // ดึง Guild
        // ========================================

        const guild =
            await client.guilds
                .fetch(GUILD_ID)
                .catch(() => null);

        if (!guild) {

            console.log(
                "ไม่พบบอทอยู่ในเซิร์ฟเวอร์"
            );

            return;
        }


        // ========================================
        // ดึงสมาชิก Discord
        // ========================================

        const member =
            await guild.members
                .fetch(discordId)
                .catch(() => null);

        if (!member) {

            console.log(
                `ไม่พบสมาชิก Discord: ${discordId}`
            );

            return;
        }


        // ========================================
        // คำนวณ Points
        // ========================================

        const points =
            Math.max(
                0,
                Number(player.points) || 0
            );


        // ========================================
        // หา Rank
        // สำคัญ: เรียงจากคะแนนสูง -> ต่ำ
        // ========================================

        const rank =
            [...rankRoles]
                .sort(
                    (a, b) =>
                        b.minPoints - a.minPoints
                )
                .find(
                    role =>
                        points >= role.minPoints
                );


        if (!rank) {

            console.log(
                `ไม่พบ Rank สำหรับ ${points} points`
            );

            return;
        }


        // ========================================
        // Debug
        // ========================================

        console.log(
            "===== COMBAT RANK ====="
        );

        console.log(
            "Player:",
            player.gameName || discordId
        );

        console.log(
            "Points:",
            points
        );

        console.log(
            "Rank:",
            rank.name
        );

        console.log(
            "======================="
        );


        // ========================================
        // ลบ Rank เก่าทั้งหมด
        // ========================================

        for (const roleInfo of rankRoles) {

            const role =
                guild.roles.cache.find(
                    r =>
                        r.name ===
                        roleInfo.name
                );

            if (
                role &&
                member.roles.cache.has(role.id)
            ) {

                await member.roles
                    .remove(role)
                    .catch(error => {

                        console.error(
                            `ลบยศ ${role.name} ไม่สำเร็จ:`,
                            error.message
                        );

                    });

            }

        }


        // ========================================
        // หา Role ใหม่
        // ========================================

        const newRole =
            guild.roles.cache.find(
                r =>
                    r.name === rank.name
            );

        if (!newRole) {

            console.log(
                `ไม่พบ Role: ${rank.name}`
            );

            return;
        }


        // ========================================
        // เพิ่ม Role ใหม่
        // ========================================

        if (
            !member.roles.cache.has(
                newRole.id
            )
        ) {

            await member.roles
                .add(newRole)
                .catch(error => {

                    console.error(
                        `เพิ่มยศ ${rank.name} ไม่สำเร็จ:`,
                        error.message
                    );

                });

        }


        // ========================================
        // สำเร็จ
        // ========================================

        console.log(
            `🏆 ${player.gameName || discordId} มี ${points} points → ได้รับยศ ${rank.name}`
        );

    } catch (error) {

        console.error(
            "updateCombatRank Error:",
            error
        );

    }
}

async function removeCombatRanks(discordId) {

    try {

        const guild =
            await client.guilds
                .fetch(GUILD_ID)
                .catch(() => null);

        if (!guild) return;

        const member =
            await guild.members
                .fetch(discordId)
                .catch(() => null);

        if (!member) return;

        for (const roleInfo of rankRoles) {

            const role =
                guild.roles.cache.find(
                    r => r.name === roleInfo.name
                );

            if (
                role &&
                member.roles.cache.has(role.id)
            ) {

                await member.roles
                    .remove(role)
                    .catch(err => {

                        console.error(
                            `ลบยศ ${role.name} ไม่สำเร็จ:`,
                            err.message
                        );

                    });

            }

        }

        console.log(
            `ลบ Combat Rank ของ ${discordId} แล้ว`
        );

    } catch (error) {

        console.error(
            "removeCombatRanks Error:",
            error
        );

    }
}
console.log("Current directory =", process.cwd());
console.log("verified.json path =", path.resolve("verified.json"));
function buildVerifyEmbed() {
    return new EmbedBuilder()
        .setColor(0x3498db)
        .setTitle("ยืนยันตัวตน")
        .setDescription("กดปุ่มด้านล่างเพื่อยืนยันตัวตนก่อนจองคิวทดสอบ\nยืนยันครั้งเดียวเท่านั้น ไม่ต้องยืนยันซ้ำ");
}
function buildVerifyButton() {
    return new ActionRowBuilder().addComponents(
        new ButtonBuilder()
            .setCustomId("verify_identity")
            .setLabel("ยืนยันตัวตน")
            .setStyle(ButtonStyle.Primary)
            
    );
}

function buildEmbed(channelId) {
    const state = getState(channelId);
    const mode = channelModes.get(channelId);

    const testerText = state.onlineTesters.size > 0
        ? Array.from(state.onlineTesters).map((id) => "<@" + id + ">").join(", ")
        : "ไม่มี";
    const testingText = state.currentTesting
        ? "<@" + state.currentTesting.userId + "> — " + state.currentTesting.detail + (state.currentTesting.channelId ? "\nห้อง: <#" + state.currentTesting.channelId + ">" : "")
        : "ไม่มีใครกำลังทดสอบ";
    const finishedText =
    state.finishedUsers.length > 0
        ? state.finishedUsers
            .map(user => {
                const remain = cooldownMs - (Date.now() - user.time);

                if (remain <= 0)
                    return `<@${user.userId}>`;

                return `<@${user.userId}> (รอ ${formatRemaining(remain)})`;
            })
            .join("\n")
        : "ยังไม่มี";

    const hasTester = state.onlineTesters.size > 0;

const embedColor = hasTester ? 0x00FF00 : 0xFF0000;

return new EmbedBuilder()
    .setColor(embedColor)
    .setTitle(
        `${hasTester ? "🟢" : "🔴"} PVP${mode ? " — " + mode : ""}`
    )
        .addFields(
            { name: "Tester ออนไลน์ (" + state.onlineTesters.size + ")", value: testerText },
            { name: "เทสเสร็จแล้ว", value: finishedText },
            { name: "กำลังทดสอบ", value: testingText },
        );
}

function buildButtons(channelId) {
    const state = getState(channelId);

    // จองได้เมื่อมี Tester เข้าเวร
    // และยังไม่มีคนกำลังทดสอบ
    const queueDisabled =
        state.onlineTesters.size === 0 ||
        state.currentTesting !== null;

    const doneDisabled =
        state.currentTesting === null;

    const row1 = new ActionRowBuilder().addComponents(
        new ButtonBuilder()
            .setCustomId("join_queue")
            .setLabel(queueDisabled ? "ปิดรับคิว" : "จองคิว")
            .setStyle(ButtonStyle.Success)
            .setDisabled(queueDisabled),

        new ButtonBuilder()
            .setCustomId("cancel_queue")
            .setLabel("ยกเลิก")
            .setStyle(ButtonStyle.Danger),

        new ButtonBuilder()
            .setCustomId("toggle_duty")
            .setLabel("เข้าเวร / ออกเวร")
            .setStyle(ButtonStyle.Primary)
    );

    const row2 = new ActionRowBuilder().addComponents(
        new ButtonBuilder()
            .setCustomId("finish_testing")
            .setLabel("เทสเสร็จแล้ว")
            .setStyle(ButtonStyle.Secondary)
            .setDisabled(doneDisabled)
    );

    return [row1, row2];
}
async function getOrCreateResultsChannel(guild) {
const channel = guild.channels.cache.get(RESULTS_CHANNEL_ID);
    return channel || null;
}

async function createTestRoom(guild, testerId, queueItem, parentChannel) {

    const mode = queueItem.mode;

    if (!mode) {
        throw new Error(
            `ไม่พบ Mode สำหรับ Queue Item: ${queueItem.userId}`
        );
    }

    const channelName =
        `${mode.toLowerCase()}-${queueItem.userId}-test`;

    const channel = await guild.channels.create({
        name: channelName,
        type: ChannelType.GuildText,
        parent: parentChannel ? parentChannel.parentId : null,
        position: 0,
        permissionOverwrites: [
            {
                id: guild.roles.everyone.id,
                deny: [PermissionsBitField.Flags.ViewChannel],
            },
            {
                id: testerId,
                allow: [
                    PermissionsBitField.Flags.ViewChannel,
                    PermissionsBitField.Flags.SendMessages,
                    PermissionsBitField.Flags.ReadMessageHistory
                ],
            },
            {
                id: queueItem.userId,
                allow: [
                    PermissionsBitField.Flags.ViewChannel,
                    PermissionsBitField.Flags.SendMessages,
                    PermissionsBitField.Flags.ReadMessageHistory
                ],
            },
            {
                id: client.user.id,
                allow: [
                    PermissionsBitField.Flags.ViewChannel,
                    PermissionsBitField.Flags.SendMessages,
                    PermissionsBitField.Flags.ManageChannels
                ],
            },
        ],
    });
    const verifyInfo = verifiedUsers.get(queueItem.userId);

    const infoEmbed = new EmbedBuilder()
        .setColor(0x00FF00)
        .setTitle("ห้องทดสอบ")
        .addFields(
            { name: "ผู้เทส", value: "<@" + testerId + ">" },
            { name: "คนที่มาเทส", value: "<@" + queueItem.userId + ">" },
            { name: "ชื่อในเกม", value: verifyInfo ? verifyInfo.gameName : "ไม่มีข้อมูล" },
            { name: "โหมด", value: queueItem.mode || "ไม่ระบุ" },
        );

    if (verifyInfo) {
    infoEmbed.setImage(`https://starlightskins.lunareclipse.studio/render/default/${verifyInfo.gameName}/full`);
}

    const tierButton = new ActionRowBuilder().addComponents(
        new ButtonBuilder()
            .setCustomId("give_tier")
            .setLabel("ให้ Tier")
            .setStyle(ButtonStyle.Primary)
    );

    await channel.send({ embeds: [infoEmbed], components: [tierButton] });

    return channel;
}
function buildVerifyModal() {

    const modal = new ModalBuilder()
        .setCustomId("verify_modal")
        .setTitle("ยืนยันตัวตน");

    const minecraftInput = new TextInputBuilder()
        .setCustomId("minecraft_name")
        .setLabel("ชื่อ Minecraft")
        .setPlaceholder("เช่น Notch")
        .setStyle(TextInputStyle.Short)
        .setMinLength(3)
        .setMaxLength(16)
        .setRequired(true);

    modal.addComponents(
        new ActionRowBuilder().addComponents(
            minecraftInput
        )
    );

    return modal;
}
function isRankedTier(tier) {
    return rankedTierOrder.includes(tier);
}

function getRankedTierForMode(userId, mode) {
    const player = verifiedUsers.get(userId);

    if (!player) return null;

    if (!player.tiers || typeof player.tiers !== "object") {
        return null;
    }

    return player.tiers[mode] || null;
}

function canJoinRanked(userId, mode) {
    const tier = getRankedTierForMode(userId, mode);

    if (!tier) return false;

    return isRankedTier(tier);
}

function getRankedFirstTo(tier) {
    return rankedFirstTo[tier] || null;
}

function getRankedTierAfterWin(tier) {
    return rankedTierUp[tier] || tier;
}

function getRankedTierAfterLoss(tier) {
    return rankedTierDown[tier] || tier;
}
    // ========================================
// RANKED QUEUE SYSTEM
// ========================================

function getRankedQueueKey(mode, tier) {
    return `${mode}:${tier}`;
}

function getRankedQueue(mode, tier) {
    const key = getRankedQueueKey(mode, tier);

    if (!rankedQueues.has(key)) {
        rankedQueues.set(key, []);
    }

    return rankedQueues.get(key);
}

function isUserInRankedQueue(userId) {
    for (const queue of rankedQueues.values()) {
        if (queue.includes(userId)) {
            return true;
        }
    }

    return false;
}

function removeUserFromRankedQueue(userId) {
    for (const [key, queue] of rankedQueues.entries()) {

        const index = queue.indexOf(userId);

        if (index !== -1) {
            queue.splice(index, 1);
        }

        if (queue.length === 0) {
            rankedQueues.delete(key);
        }
    }
}

function addUserToRankedQueue(userId, mode) {

    const tier = getRankedTierForMode(userId, mode);

    if (!tier || !isRankedTier(tier)) {
        return {
            success: false,
            reason: "LOCKED"
        };
    }

    if (isUserInRankedQueue(userId)) {
        return {
            success: false,
            reason: "ALREADY_QUEUE"
        };
    }

    const queue = getRankedQueue(mode, tier);

    queue.push(userId);

    return {
        success: true,
        mode,
        tier,
        queueSize: queue.length
    };
}

function getRankedOpponent(mode, tier, userId) {

    const queue = getRankedQueue(mode, tier);

    const opponentIndex = queue.findIndex(
        id => id !== userId
    );

    if (opponentIndex === -1) {
        return null;
    }

    const opponentId = queue[opponentIndex];

    queue.splice(opponentIndex, 1);

    if (queue.length === 0) {
        rankedQueues.delete(
            getRankedQueueKey(mode, tier)
        );
    }

    return opponentId;
}
    // ========================================
// CREATE RANKED FIGHT ROOM
// ========================================

async function createRankedFightRoom(
    guild,
    player1Id,
    player2Id,
    mode,
    tier
) {
    const player1 = await guild.members
        .fetch(player1Id)
        .catch(() => null);

    const player2 = await guild.members
        .fetch(player2Id)
        .catch(() => null);

    if (!player1 || !player2) {
        throw new Error(
            "ไม่พบสมาชิกผู้เล่นในเซิร์ฟเวอร์"
        );
    }

    const firstTo = getRankedFirstTo(tier);

    if (!firstTo) {
        throw new Error(
            `ไม่พบ First to สำหรับ Tier ${tier}`
        );
    }

    const roomNumber =
        Math.floor(
            1000 + Math.random() * 9000
        );

    const roomName =
        `${tier.toLowerCase()}-fights-${mode.toLowerCase()}-${roomNumber}`;

    const permissionOverwrites = [
        {
            id: guild.roles.everyone.id,
            deny: [
                PermissionsBitField.Flags.ViewChannel
            ]
        },
        {
            id: player1Id,
            allow: [
                PermissionsBitField.Flags.ViewChannel,
                PermissionsBitField.Flags.SendMessages,
                PermissionsBitField.Flags.ReadMessageHistory
            ]
        },
        {
            id: player2Id,
            allow: [
                PermissionsBitField.Flags.ViewChannel,
                PermissionsBitField.Flags.SendMessages,
                PermissionsBitField.Flags.ReadMessageHistory
            ]
        }
    ];

    const testerRole = guild.roles.cache.find(
        role => role.name === testerRoleName
    );

    if (testerRole) {
        permissionOverwrites.push({
            id: testerRole.id,
            allow: [
                PermissionsBitField.Flags.ViewChannel,
                PermissionsBitField.Flags.SendMessages,
                PermissionsBitField.Flags.ReadMessageHistory
            ]
        });
    }

    const adminRole = guild.roles.cache.find(
        role => role.name === adminRoleName
    );

    if (adminRole) {
        permissionOverwrites.push({
            id: adminRole.id,
            allow: [
                PermissionsBitField.Flags.ViewChannel,
                PermissionsBitField.Flags.SendMessages,
                PermissionsBitField.Flags.ReadMessageHistory
            ]
        });
    }

    const channel =
        await guild.channels.create({
            name: roomName,
            type: ChannelType.GuildText,
            permissionOverwrites
        });

    const matchId =
        `RANKED-${Date.now()}-${roomNumber}`;

    const matchData = {
        matchId,
        channelId: channel.id,
        mode,
        startingTier: tier,
        firstTo,

        player1: {
            userId: player1Id,
            score: 0,
            reportedResult: null,
            confirmed: false
        },

        player2: {
            userId: player2Id,
            score: 0,
            reportedResult: null,
            confirmed: false
        },

        status: "FIGHTING",
        createdAt: Date.now()
    };

    rankedMatches.set(
        matchId,
        matchData
    );

    const embed =
        new EmbedBuilder()
            .setTitle("🏆 Ranked Fight")
            .setDescription(
                [
                    `**Mode:** ${mode}`,
                    `**Starting Tier:** ${tier}`,
                    `**Format:** First to ${firstTo}`,
                    "",
                    `🥊 <@${player1Id}>`,
                    `⚔️`,
                    `🥊 <@${player2Id}>`,
                    "",
                    "เมื่อแข่งจบ ให้ผู้ชนะกด **🏆 ฉันชนะ**",
                    "และผู้แพ้กด **❌ ฉันแพ้**",
                    "",
                    "หากมีปัญหาให้กด **⚠️ Report**"
                ].join("\n")
            )
            .setColor(0x5865F2)
            .setFooter({
                text: `Match ID: ${matchId}`
            });

    const row =
        new ActionRowBuilder()
            .addComponents(
                new ButtonBuilder()
                    .setCustomId(
                        `ranked_win:${matchId}`
                    )
                    .setLabel("ฉันชนะ")
                    .setEmoji("🏆")
                    .setStyle(
                        ButtonStyle.Success
                    ),

                new ButtonBuilder()
                    .setCustomId(
                        `ranked_loss:${matchId}`
                    )
                    .setLabel("ฉันแพ้")
                    .setEmoji("❌")
                    .setStyle(
                        ButtonStyle.Danger
                    ),

                new ButtonBuilder()
                    .setCustomId(
                        `ranked_report:${matchId}`
                    )
                    .setLabel("Report")
                    .setEmoji("⚠️")
                    .setStyle(
                        ButtonStyle.Secondary
                    )
            );

    await channel.send({
        content:
            `<@${player1Id}> <@${player2Id}>`,
        embeds: [embed],
        components: [row]
    });

    return {
        matchId,
        channel
    };
}
    // ========================================
// RANKED RESULT HELPERS
// ========================================

function getRankedMatchPlayer(match, userId) {

    if (match.player1.userId === userId) {
        return match.player1;
    }

    if (match.player2.userId === userId) {
        return match.player2;
    }

    return null;
}


function getRankedMatchOpponent(match, userId) {

    if (match.player1.userId === userId) {
        return match.player2;
    }

    if (match.player2.userId === userId) {
        return match.player1;
    }

    return null;
}


function validateRankedScore(
    firstTo,
    playerScore,
    opponentScore,
    result
) {

    if (
        !Number.isInteger(playerScore) ||
        !Number.isInteger(opponentScore)
    ) {
        return {
            valid: false,
            reason: "คะแนนต้องเป็นตัวเลขจำนวนเต็ม"
        };
    }

    if (
        playerScore < 0 ||
        opponentScore < 0
    ) {
        return {
            valid: false,
            reason: "คะแนนต้องไม่ติดลบ"
        };
    }

    if (
        playerScore > firstTo ||
        opponentScore > firstTo
    ) {
        return {
            valid: false,
            reason: `คะแนนต้องไม่เกิน First to ${firstTo}`
        };
    }

    if (result === "WIN") {

        if (playerScore !== firstTo) {
            return {
                valid: false,
                reason:
                    `ผู้ชนะต้องมีคะแนน ${firstTo} คะแนน`
            };
        }

        if (opponentScore >= firstTo) {
            return {
                valid: false,
                reason:
                    "คะแนนของผู้แพ้ต้องน้อยกว่า First to"
            };
        }

    }

    if (result === "LOSS") {

        if (opponentScore !== firstTo) {
            return {
                valid: false,
                reason:
                    `คะแนนของผู้ชนะต้องมี ${firstTo} คะแนน`
            };
        }

        if (playerScore >= firstTo) {
            return {
                valid: false,
                reason:
                    "คะแนนของผู้แพ้ต้องน้อยกว่า First to"
            };
        }

    }

    return {
        valid: true
    };
}


async function finalizeRankedMatch(
    interaction,
    match
) {

    if (match.status === "COMPLETED") {
        return;
    }

    const player1 =
        match.player1;

    const player2 =
        match.player2;

    if (
        !player1.reportedResult ||
        !player2.reportedResult
    ) {
        return;
    }

    if (
        player1.reportedResult.result ===
        player2.reportedResult.result
    ) {

        // ถ้าทั้งสองคนบอกว่าตัวเองชนะ
        // ถือว่าเป็นผลไม่ตรงกัน
        if (
            player1.reportedResult.result === "WIN"
        ) {

            match.status = "DISPUTED";

            await notifyRankedDispute(
                interaction,
                match
            );

            return;
        }

    }

    const winner =
        player1.reportedResult.result === "WIN"
            ? player1
            : player2;

    const loser =
        winner === player1
            ? player2
            : player1;

    const winnerScore =
        winner.reportedResult.playerScore;

    const loserScore =
        winner.reportedResult.opponentScore;

    const winnerData =
        verifiedUsers.get(
            winner.userId
        );

    const loserData =
        verifiedUsers.get(
            loser.userId
        );

    if (!winnerData || !loserData) {
        throw new Error(
            "ไม่พบข้อมูลผู้เล่นสำหรับเปลี่ยน Tier"
        );
    }

    winnerData.tiers =
        winnerData.tiers || {};

    loserData.tiers =
        loserData.tiers || {};

    const currentWinnerTier =
        winnerData.tiers[match.mode] ||
        match.startingTier;

    const currentLoserTier =
        loserData.tiers[match.mode] ||
        match.startingTier;

    const winnerNewTier =
        getRankedTierAfterWin(
            currentWinnerTier
        );

    const loserNewTier =
        getRankedTierAfterLoss(
            currentLoserTier
        );

    winnerData.tiers[match.mode] =
        winnerNewTier;

    loserData.tiers[match.mode] =
        loserNewTier;

    saveVerifiedUsers();

    match.status = "COMPLETED";

    match.winnerId =
        winner.userId;

    match.loserId =
        loser.userId;

    match.finalScore = {
        winner: winnerScore,
        loser: loserScore
    };

    match.completedAt =
        Date.now();

    // ========================================
    // ส่งผล Ranked
    // ========================================

    const resultChannel =
        interaction.guild.channels.cache.get(
            RANKED_RESULT_CHANNEL_ID
        );

    if (resultChannel) {

        const resultEmbed =
            new EmbedBuilder()
                .setTitle("🏆 Ranked Result")
                .setDescription(
                    [
                        `**Mode:** ${match.mode}`,
                        `**Starting Tier:** ${match.startingTier}`,
                        `**Format:** First to ${match.firstTo}`,
                        "",
                        `🏆 **Winner:** <@${winner.userId}>`,
                        `❌ **Loser:** <@${loser.userId}>`,
                        "",
                        `**Score:** ${winnerScore} - ${loserScore}`,
                        "",
                        `🏆 <@${winner.userId}>: **${currentWinnerTier} → ${winnerNewTier}**`,
                        `❌ <@${loser.userId}>: **${currentLoserTier} → ${loserNewTier}**`
                    ].join("\n")
                )
                .setColor(0x57F287)
                .setFooter({
                    text:
                        `Match ID: ${match.matchId}`
                })
                .setTimestamp();

        await resultChannel.send({
            embeds: [resultEmbed]
        }).catch(console.error);
    }

    // ========================================
    // แจ้งในห้อง Fight
    // ========================================

    const room =
        interaction.guild.channels.cache.get(
            match.channelId
        );

    if (room) {

        await room.send({
            content:
                [
                    "🏆 **Ranked Match เสร็จสิ้น**",
                    "",
                    `ผู้ชนะ: <@${winner.userId}>`,
                    `ผู้แพ้: <@${loser.userId}>`,
                    `คะแนน: **${winnerScore} - ${loserScore}**`,
                    "",
                    `🏆 ${currentWinnerTier} → **${winnerNewTier}**`,
                    `❌ ${currentLoserTier} → **${loserNewTier}**`,
                    "",
                    "ห้องนี้จะถูกปิดในอีกไม่กี่วินาที"
                ].join("\n")
        }).catch(() => {});

        setTimeout(() => {

            room.delete(
                "Ranked match completed"
            ).catch(() => {});

        }, 5000);
    }
}


async function notifyRankedDispute(
    interaction,
    match
) {

    const room =
        interaction.guild.channels.cache.get(
            match.channelId
        );

    const testerRole =
        interaction.guild.roles.cache.find(
            role =>
                role.name === testerRoleName
        );

    const adminRole =
        interaction.guild.roles.cache.find(
            role =>
                role.name === adminRoleName
        );

    const mentions = [];

    if (testerRole) {
        mentions.push(
            `<@&${testerRole.id}>`
        );
    }

    if (adminRole) {
        mentions.push(
            `<@&${adminRole.id}>`
        );
    }

    if (room) {

        const resolveRow =
    new ActionRowBuilder()
        .addComponents(

            new ButtonBuilder()
                .setCustomId(
                    `ranked_resolve:${match.matchId}:player1`
                )
                .setLabel("ให้ Player 1 ชนะ")
                .setEmoji("🏆")
                .setStyle(
                    ButtonStyle.Success
                ),

            new ButtonBuilder()
                .setCustomId(
                    `ranked_resolve:${match.matchId}:player2`
                )
                .setLabel("ให้ Player 2 ชนะ")
                .setEmoji("🏆")
                .setStyle(
                    ButtonStyle.Success
                )
        );

await room.send({
    content:
        [
            mentions.join(" "),
            "",
            "⚠️ **Ranked Match ถูก Dispute**",
            "",
            "ผลการแข่งขันของผู้เล่นไม่ตรงกัน",
            "",
            `🥊 Player 1: <@${match.player1.userId}>`,
            `🥊 Player 2: <@${match.player2.userId}>`,
            "",
            `Match ID: ${match.matchId}`,
            "",
            "Tester/Admin กรุณาเลือกผู้ชนะ"
        ].join("\n"),
    components: [
        resolveRow
    ]
}).catch(console.error);
    }
}
    // ========================================
// RANKED DISPUTE RESOLUTION
// ========================================

function isRankedStaff(member) {

    if (!member) {
        return false;
    }

    return (
        member.permissions.has(
            PermissionsBitField.Flags.Administrator
        ) ||
        member.roles.cache.some(
            role =>
                role.name === testerRoleName ||
                role.name === adminRoleName
        )
    );
}
// ========================================
// RANKED MATCHMAKING
// ========================================

async function tryMatchRankedPlayer(
    guild,
    userId,
    mode,
    tier
) {
    const opponentId =
        getRankedOpponent(
            mode,
            tier,
            userId
        );

    // ยังไม่มีคู่แข่ง
    if (!opponentId) {
        return null;
    }

    // ตรวจ Tier ปัจจุบันของทั้งสองคนอีกครั้ง
    const playerTier =
        getRankedTierForMode(
            userId,
            mode
        );

    const opponentTier =
        getRankedTierForMode(
            opponentId,
            mode
        );

    // Tier เปลี่ยนระหว่างรอคิว
    if (
        playerTier !== tier ||
        opponentTier !== tier
    ) {
        removeUserFromRankedQueue(userId);
        removeUserFromRankedQueue(opponentId);

        return null;
    }

    // สร้าง Fight Room
    const match =
        await createRankedFightRoom(
            guild,
            userId,
            opponentId,
            mode,
            tier
        );

    return match;
}
    // ========================================
// RANKED MODE BUTTONS
// ========================================

function buildRankedModeButtons(userId) {

    const rows = [];
    let row = new ActionRowBuilder();

    for (const mode of modeOptions) {

        const tier =
            getRankedTierForMode(
                userId,
                mode
            );

        const unlocked =
            canJoinRanked(
                userId,
                mode
            );

        const button =
            new ButtonBuilder()
                .setCustomId(
                    `ranked_queue:${mode}`
                )
                .setLabel(
                    unlocked
                        ? `${mode} • ${tier}`
                        : `${mode} • 🔒`
                )
                .setStyle(
                    unlocked
                        ? ButtonStyle.Primary
                        : ButtonStyle.Secondary
                )
                .setDisabled(!unlocked);

        row.addComponents(button);

        if (row.components.length === 5) {
            rows.push(row);
            row = new ActionRowBuilder();
        }
    }

    if (row.components.length > 0) {
        rows.push(row);
    }

        return rows;
}


// ========================================
// RANKED CANCEL QUEUE BUTTON
// ========================================

function buildRankedCancelButton() {
    return new ActionRowBuilder()
        .addComponents(
            new ButtonBuilder()
                .setCustomId("ranked_cancel_queue")
                .setLabel("ออกจาก Ranked Queue")
                .setEmoji("❌")
                .setStyle(ButtonStyle.Danger)
        );
}
    function isRankedStaff(member) {
    if (!member) {
        return false;
    }

    return (
        member.permissions.has(
            PermissionsBitField.Flags.Administrator
        ) ||
        member.roles.cache.some(
            role =>
                role.name === testerRoleName ||
                role.name === adminRoleName
        )
    );
}

client.on("interactionCreate", async (interaction) => {

    console.log(
        "Interaction:",
        interaction.type,
        interaction.isButton()
            ? interaction.customId
            : "not button"
    );
    // ========================================
// OPEN RANKED PANEL
// ========================================

if (
    interaction.isButton() &&
    interaction.customId === "ranked_open"
) {
    const userId = interaction.user.id;

    const rankedRows =
        buildRankedModeButtons(userId);

    await interaction.reply({
        embeds: [
            new EmbedBuilder()
                .setTitle("🏆 Ranked ของคุณ")
                .setDescription(
                    [
                        "เลือก Mode ที่ต้องการเล่น",
                        "",
                        "🔓 Mode ที่มี Tier สามารถเข้า Ranked ได้",
                        "🔒 Mode ที่ยังไม่มี Tier จะไม่สามารถเข้าได้",
                        "",
                        "Tier Ranked จะเปลี่ยนแยกกันในแต่ละ Mode"
                    ].join("\n")
                )
                .setColor(0x5865F2)
                .setFooter({
                    text: "Zenith Community • Ranked"
                })
        ],
        components: [
            ...rankedRows,
            buildRankedCancelButton()
        ],
        flags: MessageFlags.Ephemeral
    });

    return;
}
    // ========================================
// RANKED WIN BUTTON
// ========================================

if (
    interaction.isButton() &&
    interaction.customId.startsWith("ranked_win:")
) {

    const matchId =
        interaction.customId.split(":")[1];

    const match =
        rankedMatches.get(matchId);

    if (!match) {

        await interaction.reply({
            content:
                "❌ ไม่พบ Ranked Match นี้",
            flags: MessageFlags.Ephemeral
        });

        return;
    }

    const player =
        getRankedMatchPlayer(
            match,
            interaction.user.id
        );

    if (!player) {

        await interaction.reply({
            content:
                "❌ คุณไม่ได้อยู่ในการแข่งขันนี้",
            flags: MessageFlags.Ephemeral
        });

        return;
    }

    if (match.status !== "FIGHTING") {

        await interaction.reply({
            content:
                "❌ Match นี้ไม่ได้อยู่ในสถานะแข่งขันแล้ว",
            flags: MessageFlags.Ephemeral
        });

        return;
    }

    const modal =
        new ModalBuilder()
            .setCustomId(
                `ranked_result_modal:${matchId}:WIN`
            )
            .setTitle("🏆 รายงานผล Ranked");

    const playerScoreInput =
        new TextInputBuilder()
            .setCustomId("player_score")
            .setLabel("คะแนนของคุณ")
            .setStyle(TextInputStyle.Short)
            .setPlaceholder(
                `เช่น ${match.firstTo}`
            )
            .setRequired(true);

    const opponentScoreInput =
        new TextInputBuilder()
            .setCustomId("opponent_score")
            .setLabel("คะแนนคู่แข่ง")
            .setStyle(TextInputStyle.Short)
            .setPlaceholder("เช่น 3")
            .setRequired(true);

    modal.addComponents(
        new ActionRowBuilder()
            .addComponents(
                playerScoreInput
            ),

        new ActionRowBuilder()
            .addComponents(
                opponentScoreInput
            )
    );

    await interaction.showModal(modal);

    return;
}
    // ========================================
// RANKED LOSS BUTTON
// ========================================

if (
    interaction.isButton() &&
    interaction.customId.startsWith("ranked_loss:")
) {

    const matchId =
        interaction.customId.split(":")[1];

    const match =
        rankedMatches.get(matchId);

    if (!match) {

        await interaction.reply({
            content:
                "❌ ไม่พบ Ranked Match นี้",
            flags: MessageFlags.Ephemeral
        });

        return;
    }

    const player =
        getRankedMatchPlayer(
            match,
            interaction.user.id
        );

    if (!player) {

        await interaction.reply({
            content:
                "❌ คุณไม่ได้อยู่ในการแข่งขันนี้",
            flags: MessageFlags.Ephemeral
        });

        return;
    }

    if (match.status !== "FIGHTING") {

        await interaction.reply({
            content:
                "❌ Match นี้ไม่ได้อยู่ในสถานะแข่งขันแล้ว",
            flags: MessageFlags.Ephemeral
        });

        return;
    }

    const modal =
        new ModalBuilder()
            .setCustomId(
                `ranked_result_modal:${matchId}:LOSS`
            )
            .setTitle("❌ รายงานผล Ranked");

    const playerScoreInput =
        new TextInputBuilder()
            .setCustomId("player_score")
            .setLabel("คะแนนของคุณ")
            .setStyle(TextInputStyle.Short)
            .setPlaceholder("เช่น 3")
            .setRequired(true);

    const opponentScoreInput =
        new TextInputBuilder()
            .setCustomId("opponent_score")
            .setLabel("คะแนนคู่แข่ง")
            .setStyle(TextInputStyle.Short)
            .setPlaceholder(
                `เช่น ${match.firstTo}`
            )
            .setRequired(true);

    modal.addComponents(
        new ActionRowBuilder()
            .addComponents(
                playerScoreInput
            ),

        new ActionRowBuilder()
            .addComponents(
                opponentScoreInput
            )
    );

    await interaction.showModal(modal);

    return;
}
// ========================================
// RANKED QUEUE BUTTON
// ========================================

if (
    interaction.isButton() &&
    interaction.customId.startsWith("ranked_queue:")
) {
    const mode =
        interaction.customId.split(":")[1];

    const userId =
        interaction.user.id;

    const tier =
        getRankedTierForMode(
            userId,
            mode
        );

    // ตรวจว่า Mode นี้ปลดล็อก Ranked หรือไม่
    if (
        !tier ||
        !isRankedTier(tier)
    ) {
        await interaction.reply({
            content:
                `❌ คุณยังไม่ปลดล็อก Ranked สำหรับ **${mode}**`,
            flags: MessageFlags.Ephemeral
        });

        return;
    }

    // ตรวจว่าผู้เล่นอยู่ Queue อื่นอยู่หรือไม่
    if (isUserInRankedQueue(userId)) {
        await interaction.reply({
            content:
                "❌ คุณอยู่ใน Ranked Queue อยู่แล้ว",
            flags: MessageFlags.Ephemeral
        });

        return;
    }

    // เพิ่มเข้า Queue
    const result =
        addUserToRankedQueue(
            userId,
            mode
        );

    if (!result.success) {

        let message =
            "❌ ไม่สามารถเข้า Ranked Queue ได้";

        if (
            result.reason ===
            "ALREADY_QUEUE"
        ) {
            message =
                "❌ คุณอยู่ใน Ranked Queue อยู่แล้ว";
        }

        if (
            result.reason ===
            "LOCKED"
        ) {
            message =
                `❌ คุณยังไม่ปลดล็อก Ranked สำหรับ **${mode}**`;
        }

        await interaction.reply({
            content: message,
            flags: MessageFlags.Ephemeral
        });

        return;
    }

    // แจ้งว่าเข้า Queue แล้ว
    await interaction.reply({
        content: [
            "🏆 **เข้าสู่ Ranked Queue แล้ว**",
            "",
            `🎮 Mode: **${mode}**`,
            `🏅 Tier: **${tier}**`,
            `⚔️ Format: **First to ${getRankedFirstTo(tier)}**`,
            "",
            "กำลังค้นหาคู่แข่ง Tier เดียวกัน..."
        ].join("\n"),
        flags: MessageFlags.Ephemeral
    });

    // พยายามจับคู่
    try {

        const match =
            await tryMatchRankedPlayer(
                interaction.guild,
                userId,
                mode,
                tier
            );

        if (match) {

            await interaction.followUp({
                content:
                    `⚔️ **พบคู่แข่งแล้ว!**\n\nห้องแข่ง: <#${match.channel.id}>`,
                flags: MessageFlags.Ephemeral
            });

        }

    } catch (error) {

        console.error(
            "❌ Ranked matchmaking error:",
            error
        );

        removeUserFromRankedQueue(
            userId
        );

        await interaction.followUp({
            content:
                "❌ เกิดข้อผิดพลาดในการสร้างห้อง Ranked กรุณาลองใหม่",
            flags: MessageFlags.Ephemeral
        }).catch(() => {});
    }

    return;
}
    if (
    interaction.isButton() &&
    interaction.customId === "ranked_cancel_queue"
) {
    const userId = interaction.user.id;

    if (!isUserInRankedQueue(userId)) {
        await interaction.reply({
            content: "❌ คุณไม่ได้อยู่ใน Ranked Queue",
            flags: MessageFlags.Ephemeral
        });
        return;
    }

    removeUserFromRankedQueue(userId);

    await interaction.reply({
        content: "✅ ออกจาก Ranked Queue แล้ว",
        flags: MessageFlags.Ephemeral
    });

    return;
}
if (
    interaction.isButton() &&
    interaction.customId === "call_next"
) {
    console.log("================================");
    console.log("CALL NEXT BUTTON CLICKED");
    console.log("Channel:", interaction.channelId);
    console.log("User:", interaction.user.id);

    try {

        await interaction.deferReply({
            flags: MessageFlags.Ephemeral
        });

        const member = interaction.member;

        const isTester = member.roles.cache.some(
            role => role.name === testerRoleName
        );

        if (!isTester) {
            await interaction.editReply({
                content: "คุณไม่มีสิทธิ์เป็น Tester"
            });
            return;
        }

        const state = getState(interaction.channelId);

        console.log("Queue:", state.queue);
        console.log("Queue length:", state.queue.length);
        console.log(
            "Online testers:",
            [...state.onlineTesters]
        );
        console.log(
            "Current testing:",
            state.currentTesting
        );

        if (!state.onlineTesters.has(interaction.user.id)) {
            await interaction.editReply({
                content:
                    "คุณต้องเข้าเวรก่อนจึงจะเรียกคิวได้"
            });
            return;
        }

        if (state.currentTesting) {
            await interaction.editReply({
                content:
                    "ตอนนี้มีคนกำลังทดสอบอยู่แล้ว"
            });
            return;
        }

        if (state.queue.length === 0) {
            await interaction.editReply({
                content:
                    "ตอนนี้ไม่มีคนอยู่ในคิว"
            });
            return;
        }

        const queueItem = state.queue.shift();

        console.log(
            "เรียกผู้เล่น:",
            queueItem.userId
        );

        console.log(
            "Mode:",
            queueItem.mode
        );

        const testRoom = await createTestRoom(
            interaction.guild,
            interaction.user.id,
            queueItem,
            interaction.channel
        );

        state.currentTesting = {
            userId: queueItem.userId,
            testerId: interaction.user.id,
            detail: queueItem.detail,
            mode: queueItem.mode,
            channelId: testRoom.id
        };
        // ========================================
// แจ้งเตือนผู้เล่น + เริ่มเวลา 5 นาที
// ========================================

await interaction.channel.send({
    content:
        `<@${queueItem.userId}> **ถึงคิวของคุณแล้ว!**\n` +
        `กรุณาเข้า Test Room ภายใน **5 นาที**\n` +
        `หากไม่เข้าภายในเวลาที่กำหนด ระบบจะข้ามคิวอัตโนมัติ`
}).catch(() => {});

// ส่ง DM ด้วย
const calledMember =
    await interaction.guild.members
        .fetch(queueItem.userId)
        .catch(() => null);

if (calledMember) {

    await calledMember.send(
        "**ถึงคิวของคุณแล้ว!**\n\n" +
        "กรุณาเข้า **Test Room** ภายใน **5 นาที**\n" +
        "หากไม่เข้าภายในเวลาที่กำหนด " +
        "ระบบจะข้ามคิวอัตโนมัติ"
    ).catch(() => {});
}

// เริ่ม Timer 5 นาที
startQueueCallTimer(
    interaction.channelId,
    queueItem.userId
);

        console.log(
            "===== ACTIVE TEST CREATED ====="
        );

        console.log(
            "Room:",
            testRoom.id
        );

        console.log(
            "Queue:",
            interaction.channelId
        );

        console.log(
            "Player:",
            queueItem.userId
        );

        console.log(
            "Tester:",
            interaction.user.id
        );

        // แจ้งผู้เล่นที่ถูกเรียก
await calledMember.send(
    `**ถึงคิวของคุณแล้ว!**\n\n` +
    `🎮 โหมด: **${queueItem.mode || "ไม่ระบุ"}**\n` +
    `🏠 ห้องทดสอบ: <#${testRoom.id}>\n\n` +
    `กรุณาเข้า Test Room ภายใน **5 นาที**\n` +
    `หากไม่เข้าภายในเวลาที่กำหนด ระบบจะข้ามคิวอัตโนมัติ`
).catch(() => {});
        // อัปเดต Queue Embed
        if (state.mainMessageId) {

            const mainMessage =
                await interaction.channel.messages
                    .fetch(state.mainMessageId)
                    .catch(err => {
                        console.error(
                            "❌ หา Main Message ไม่เจอ:",
                            err
                        );
                        return null;
                    });

            if (mainMessage) {

                await mainMessage.edit({
                    embeds: [
                        buildEmbed(
                            interaction.channelId
                        )
                    ],
                    components:
                        buildButtons(
                            interaction.channelId
                        )
                }).catch(err => {

                    console.error(
                        "❌ อัปเดต Queue Embed ไม่สำเร็จ:",
                        err
                    );

                });

            } else {

                console.log(
                    "⚠️ ไม่พบ Main Message ID:",
                    state.mainMessageId
                );

            }
        }

        console.log(
            "===== CALL NEXT SUCCESS ====="
        );

    } catch (err) {

        console.error(
            "===== CALL NEXT ERROR ====="
        );

        console.error(err);

        if (
            interaction.deferred ||
            interaction.replied
        ) {

            await interaction.editReply({
                content:
                    "เกิดข้อผิดพลาดในการเรียกคิว"
            }).catch(console.error);

        } else {

            await interaction.reply({
                content:
                    "เกิดข้อผิดพลาดในการเรียกคิว",
                flags: MessageFlags.Ephemeral
            }).catch(console.error);

        }
    }

    return;
}
if (interaction.isChatInputCommand()) {

    // =====================================================
    // /confirm
    // =====================================================
    if (interaction.commandName === "confirm") {

    await interaction.deferReply({
        flags: MessageFlags.Ephemeral
    });

    const member = interaction.member;

    const isTester =
        member.roles.cache.some(
            role => role.name === testerRoleName
        );

    const isAdmin =
        member.roles.cache.some(
            role => role.name === adminRoleName
        ) ||
        member.permissions.has(
            PermissionsBitField.Flags.Administrator
        );

    if (!isTester && !isAdmin) {
        await interaction.editReply({
            content:
                "คำสั่งนี้ใช้ได้เฉพาะ Tester และ Admin เท่านั้น"
        });
        return;
    }

    // =========================
    // รับข้อมูลจาก /confirm
    // =========================

    const targetUser =
        interaction.options.getUser("user");

    const minecraftName =
        interaction.options.getString("minecraft");

    const isTargetTester =
        interaction.options.getBoolean("tester");

    if (!targetUser || !minecraftName) {
        await interaction.editReply({
            content: "กรุณาระบุข้อมูลให้ครบ"
        });
        return;
    }

    // =========================
    // ยืนยันเลย ไม่ต้องมี pending
    // =========================

    loadVerifiedUsers();

    // =========================
    // Resolve Minecraft UUID from username (required)
    // =========================
    const uuid = await fetchMinecraftUUID(minecraftName);
    if (!uuid) {
        await interaction.editReply({
            content: "ไม่พบผู้เล่น Minecraft นี้ กรุณาตรวจสอบชื่อใหม่",
            flags: MessageFlags.Ephemeral
        });
        return;
    }

    const oldData =
        verifiedUsers.get(targetUser.id);

    const playerData = {
    gameName: minecraftName,
    imageUrl: getMinecraftRenderUrl(minecraftName),
    tester: isTargetTester === true,
    confirmed: true
};

    verifiedUsers.set(
    targetUser.id,
    playerData
);

saveVerifiedUsers();

// ⭐ ให้ยศตาม Points ปัจจุบัน
await updateCombatRank(targetUser.id);

    // =========================
    // ลบคำขอเก่า ถ้ามี
    // =========================

    pendingVerifications.delete(
        targetUser.id
    );

    // =========================
    // เรียก onVerified
    // =========================

    if (global.onVerified) {

        await global.onVerified(
            targetUser.id,
            minecraftName,
            oldData?.imageUrl || "",
            isTargetTester === true,
            uuid
        );

    }

    // =========================
    // สำเร็จ
    // =========================

    await interaction.editReply({
        content:
            `ยืนยันตัวตนให้ <@${targetUser.id}> เรียบร้อยแล้ว\n\n` +
            `Minecraft: **${minecraftName}**\n` +
            `ประเภท: **${
                isTargetTester
                    ? "Tester"
                    : "Player"
            }**`
    });

    console.log(
        `CONFIRM: ${targetUser.tag} -> ${minecraftName}`
    );

    return;
}
}
// =====================================================
// /unconfirm
// =====================================================
if (interaction.commandName === "unconfirm") {

    await interaction.deferReply({
        flags: MessageFlags.Ephemeral
    });

    const member = interaction.member;

    // =========================
    // ตรวจ Tester / Admin
    // =========================

    const isTester =
        member.roles.cache.some(
            role => role.name === testerRoleName
        );

    const isAdmin =
        member.roles.cache.some(
            role => role.name === adminRoleName
        ) ||
        member.permissions.has(
            PermissionsBitField.Flags.Administrator
        );

    if (!isTester && !isAdmin) {
        await interaction.editReply({
            content:
                "คำสั่งนี้ใช้ได้เฉพาะ Tester และ Admin เท่านั้น"
        });
        return;
    }

    // =========================
    // ผู้เล่นเป้าหมาย
    // =========================

    const targetUser =
        interaction.options.getUser("user");

    if (!targetUser) {
        await interaction.editReply({
            content: "กรุณาเลือกผู้เล่น"
        });
        return;
    }

    // =========================
    // โหลดข้อมูลล่าสุด
    // =========================

    loadVerifiedUsers();
    loadPlayerMessages();

    const oldData =
        verifiedUsers.get(targetUser.id);

    if (!oldData) {
        await interaction.editReply({
            content:
                `<@${targetUser.id}> ยังไม่ได้ยืนยันตัวตน`
        });
        return;
    }

    // =====================================================
    // ลบ Embed ข้อมูลผู้เล่น
    // =====================================================

    const messageId =
        playerMessages.get(targetUser.id);

    if (messageId) {

        // ถ้าเดิมเป็น Tester ให้ลบจากห้อง Tester
        const oldChannelId =
            oldData.tester === true
                ? TESTER_INFO_CHANNEL_ID
                : PLAYER_INFO_CHANNEL_ID;

        const infoChannel =
            await interaction.guild.channels
                .fetch(oldChannelId)
                .catch(() => null);

        if (infoChannel) {

            const oldMessage =
                await infoChannel.messages
                    .fetch(messageId)
                    .catch(() => null);

            if (oldMessage) {

                await oldMessage
                    .delete()
                    .catch(err => {
                        console.error(
                            "ลบข้อมูลผู้เล่นไม่สำเร็จ:",
                            err
                        );
                    });

                console.log(
                    `ลบข้อมูลผู้เล่นใน Channel ${oldChannelId}: ${messageId}`
                );
            }
        }

        // ลบ Message ID ที่จำไว้
        playerMessages.delete(targetUser.id);
        savePlayerMessages();
    }

    // =====================================================
    // ลบข้อมูลยืนยัน
    // =====================================================

   // ลบ Combat Rank ก่อน
await removeCombatRanks(targetUser.id);

// ลบข้อมูลยืนยัน
verifiedUsers.delete(targetUser.id);
saveVerifiedUsers();

    // ลบคำขอยืนยันที่ค้างอยู่
    pendingVerifications.delete(targetUser.id);

    // =====================================================
    // เปลี่ยนชื่อ Discord กลับ
    // =====================================================

    const targetMember =
        await interaction.guild.members
            .fetch(targetUser.id)
            .catch(() => null);

    if (targetMember) {

        await targetMember
            .setNickname(null)
            .catch(err => {
                console.log(
                    "ไม่สามารถคืนชื่อ Discord ได้:",
                    err.message
                );
            });
    }

    // =====================================================
    // สำเร็จ
    // =====================================================

    await interaction.editReply({
        content:
            `ยกเลิกการยืนยันของ <@${targetUser.id}> เรียบร้อยแล้ว\n` +
            `🗑️ลบข้อมูลจากห้องข้อมูลผู้เล่นแล้ว`
    });

    console.log(
        `UNCONFIRM: ${targetUser.tag} (${targetUser.id})`
    );

    return;
}
    if (interaction.isButton()) {
        
        const member = interaction.member;
        const isTester = member.roles.cache.some((role) => role.name === testerRoleName);
// =====================================================
// ให้ Tier
// =====================================================

// =====================================================
// เลือกผู้ชนะ
// =====================================================
}
// =====================================================
// เลือกผู้ชนะ
// =====================================================
// =====================================================
// ให้ Tier
// =====================================================

if (interaction.customId === "give_tier") {

    try {

        const member = interaction.member;

        const isTester = member.roles.cache.some(
            role => role.name === testerRoleName
        );

        if (!isTester) {
            await interaction.reply({
                content: "เฉพาะ Tester เท่านั้นที่สามารถให้ Tier ได้",
                flags: MessageFlags.Ephemeral
            });
            return;
        }

        const found = getStateByRoom(interaction.channelId);

        if (!found || !found.state.currentTesting) {
            await interaction.reply({
                content: "ไม่พบข้อมูลการทดสอบ",
                flags: MessageFlags.Ephemeral
            });
            return;
        }

        const testing = found.state.currentTesting;

        // เก็บข้อมูลการทดสอบ
        pendingTierPick.set(interaction.user.id, {
            testedUserId: testing.userId,
            testerUserId: testing.testerId,
            mode: testing.mode,
            detail: testing.detail,
            winnerSide: null
        });

        const row = new ActionRowBuilder().addComponents(
            new ButtonBuilder()
                .setCustomId("tier_winner_applicant")
                .setLabel("ผู้เล่นชนะ")
                .setStyle(ButtonStyle.Success),

            new ButtonBuilder()
                .setCustomId("tier_winner_tester")
                .setLabel("Tester ชนะ")
                .setStyle(ButtonStyle.Danger)
        );

        await interaction.reply({
            content:
                "**เลือกผู้ชนะ**\n\n" +
                `ผู้เล่น: <@${testing.userId}>\n` +
                `Tester: <@${testing.testerId}>`,
            components: [row],
            flags: MessageFlags.Ephemeral
        });

    } catch (err) {

        console.error("===== GIVE TIER ERROR =====");
        console.error(err);

        if (!interaction.replied && !interaction.deferred) {
            await interaction.reply({
                content: "เกิดข้อผิดพลาดในการให้ Tier",
                flags: MessageFlags.Ephemeral
            }).catch(console.error);
        }
    }

    return;
}
if (
    interaction.customId === "tier_winner_applicant" ||
    interaction.customId === "tier_winner_tester"
) {

    const picked = pendingTierPick.get(interaction.user.id);

    if (!picked) {
       await interaction.editReply({
            content: "ไม่พบข้อมูลการทดสอบ",
            flags: MessageFlags.Ephemeral
        });
        return;
    }

    // กำหนดผู้ชนะ
    if (interaction.customId === "tier_winner_applicant") {
        picked.winnerSide = "applicant";
    } else {
        picked.winnerSide = "tester";
    }

    pendingTierPick.set(
        interaction.user.id,
        picked
    );

    // =====================================================
    // สร้างเมนูเลือก Tier
    // =====================================================

    const tierMenu = new StringSelectMenuBuilder()
        .setCustomId("tier_select")
        .setPlaceholder("เลือก Tier")
        .addOptions(
            tierOptions.map(tier => ({
                label: tier,
                value: tier,
                description: `เลือก ${tier} (${tierPoints[tier]} คะแนน)`
            }))
        );
const tierRow = new ActionRowBuilder()
        .addComponents(tierMenu);

   await interaction.update({
    content:
        `ผู้ชนะ: ${
            picked.winnerSide === "applicant"
                ? `<@${picked.testedUserId}>`
                : `<@${picked.testerUserId}>`
        }\n\n` +
        `**เลือก Tier ที่ต้องการให้ผู้เล่น**`,
    components: [tierRow]
});

    return;
}


// =====================================================
// เลือก Tier
// =====================================================
if (interaction.customId === "tier_select") {

    const picked = pendingTierPick.get(interaction.user.id);

    if (!picked) {
        await interaction.followUp({
            content: "ไม่พบข้อมูลการทดสอบ",
            flags: MessageFlags.Ephemeral
        });
        return;
    }

    const tier = interaction.values[0];

    picked.tier = tier;

    pendingTierPick.set(
        interaction.user.id,
        picked
    );

    // =====================================================
    // เปิด Modal กรอก Score
    // =====================================================

    const modal = new ModalBuilder()
        .setCustomId("tier_score_modal")
        .setTitle(`ผลการทดสอบ ${tier}`);

    const testerScoreInput = new TextInputBuilder()
        .setCustomId("tester_score")
        .setLabel("Score ของ Tester")
        .setStyle(TextInputStyle.Short)
        .setPlaceholder("เช่น 3")
        .setRequired(true);

    const playerScoreInput = new TextInputBuilder()
        .setCustomId("player_score")
        .setLabel("Score ของผู้เล่น")
        .setStyle(TextInputStyle.Short)
        .setPlaceholder("เช่น 5")
        .setRequired(true);

    modal.addComponents(
        new ActionRowBuilder().addComponents(testerScoreInput),
        new ActionRowBuilder().addComponents(playerScoreInput)
    );

    await interaction.showModal(modal);

    return;
}
    // ========================================
// RANKED RESULT MODAL
// ========================================

if (
    interaction.isModalSubmit() &&
    interaction.customId.startsWith(
        "ranked_result_modal:"
    )
) {

    const parts =
        interaction.customId.split(":");

    const matchId = parts[1];
    const result = parts[2];

    const match =
        rankedMatches.get(matchId);

    if (!match) {

        await interaction.reply({
            content:
                "❌ ไม่พบ Ranked Match นี้",
            flags: MessageFlags.Ephemeral
        });

        return;
    }

    const player =
        getRankedMatchPlayer(
            match,
            interaction.user.id
        );

    if (!player) {

        await interaction.reply({
            content:
                "❌ คุณไม่ได้อยู่ในการแข่งขันนี้",
            flags: MessageFlags.Ephemeral
        });

        return;
    }

    if (match.status !== "FIGHTING") {

        await interaction.reply({
            content:
                "❌ Match นี้ไม่ได้อยู่ในสถานะแข่งขันแล้ว",
            flags: MessageFlags.Ephemeral
        });

        return;
    }

    const playerScore =
        Number(
            interaction.fields.getTextInputValue(
                "player_score"
            )
        );

    const opponentScore =
        Number(
            interaction.fields.getTextInputValue(
                "opponent_score"
            )
        );

    const validation =
        validateRankedScore(
            match.firstTo,
            playerScore,
            opponentScore,
            result
        );

    if (!validation.valid) {

        await interaction.reply({
            content:
                `❌ ${validation.reason}`,
            flags: MessageFlags.Ephemeral
        });

        return;
    }

    player.reportedResult = {
        result,
        playerScore,
        opponentScore,
        reportedBy:
            interaction.user.id,
        reportedAt:
            Date.now()
    };

    player.confirmed = false;

    const opponent =
        getRankedMatchOpponent(
            match,
            interaction.user.id
        );

    await interaction.reply({
        content:
            [
                "✅ **ส่งผลการแข่งขันแล้ว**",
                "",
                `คะแนน: **${playerScore} - ${opponentScore}**`,
                "",
                `รอ <@${opponent.userId}> ยืนยันผล`,
                "",
                "หากผลไม่ถูกต้อง ให้กด Report"
            ].join("\n"),
        flags: MessageFlags.Ephemeral
    });

    const room =
        interaction.guild.channels.cache.get(
            match.channelId
        );

    if (room) {

        const confirmRow =
            new ActionRowBuilder()
                .addComponents(

                    new ButtonBuilder()
                        .setCustomId(
                            `ranked_confirm:${matchId}`
                        )
                        .setLabel("ยืนยันผล")
                        .setEmoji("✅")
                        .setStyle(
                            ButtonStyle.Success
                        ),

                    new ButtonBuilder()
                        .setCustomId(
                            `ranked_dispute:${matchId}`
                        )
                        .setLabel("ผลไม่ตรง")
                        .setEmoji("⚠️")
                        .setStyle(
                            ButtonStyle.Danger
                        )
                );

        await room.send({
            content:
                [
                    `📋 <@${opponent.userId}>`,
                    "",
                    `<@${interaction.user.id}> รายงานว่า:`,
                    `**${result === "WIN" ? "🏆 ชนะ" : "❌ แพ้"}**`,
                    `คะแนน **${playerScore} - ${opponentScore}**`,
                    "",
                    "กรุณาตรวจสอบและยืนยันผล"
                ].join("\n"),
            components: [
                confirmRow
            ]
        });
    }

    return;
}
    // ========================================
// RANKED CONFIRM RESULT
// ========================================

if (
    interaction.isButton() &&
    interaction.customId.startsWith(
        "ranked_confirm:"
    )
) {

    const matchId =
        interaction.customId.split(":")[1];

    const match =
        rankedMatches.get(matchId);

    if (!match) {

        await interaction.reply({
            content:
                "❌ ไม่พบ Ranked Match นี้",
            flags: MessageFlags.Ephemeral
        });

        return;
    }

    if (match.status !== "FIGHTING") {

        await interaction.reply({
            content:
                "❌ Match นี้ไม่ได้อยู่ในสถานะแข่งขันแล้ว",
            flags: MessageFlags.Ephemeral
        });

        return;
    }

    const player =
        getRankedMatchPlayer(
            match,
            interaction.user.id
        );

    if (!player) {

        await interaction.reply({
            content:
                "❌ คุณไม่ได้อยู่ในการแข่งขันนี้",
            flags: MessageFlags.Ephemeral
        });

        return;
    }

    const opponent =
        getRankedMatchOpponent(
            match,
            interaction.user.id
        );

    if (!opponent) {

        await interaction.reply({
            content:
                "❌ ไม่พบคู่แข่งของคุณ",
            flags: MessageFlags.Ephemeral
        });

        return;
    }

    // ========================================
    // ต้องเป็นคู่แข่งเท่านั้นที่กดยืนยัน
    // ========================================

    if (!opponent.reportedResult) {

        await interaction.reply({
            content:
                "❌ ยังไม่มีการรายงานผลจากคู่แข่ง",
            flags: MessageFlags.Ephemeral
        });

        return;
    }

    if (player.reportedResult) {

        await interaction.reply({
            content:
                "❌ คุณได้รายงานผลของตัวเองไปแล้ว",
            flags: MessageFlags.Ephemeral
        });

        return;
    }

    // ========================================
    // รับผลของคู่แข่ง
    // แล้วสร้างผลของผู้ยืนยันแบบกลับด้าน
    // ========================================

    player.reportedResult = {
        result:
            opponent.reportedResult.result === "WIN"
                ? "LOSS"
                : "WIN",

        playerScore:
            opponent.reportedResult.opponentScore,

        opponentScore:
            opponent.reportedResult.playerScore,

        reportedBy:
            interaction.user.id,

        reportedAt:
            Date.now()
    };

    player.confirmed = true;
    opponent.confirmed = true;

    await interaction.reply({
        content:
            [
                "✅ **ยืนยันผลการแข่งขันแล้ว**",
                "",
                `คะแนน: **${opponent.reportedResult.playerScore} - ${opponent.reportedResult.opponentScore}**`,
                "",
                "กำลังสรุปผลและอัปเดต Tier..."
            ].join("\n"),
        flags: MessageFlags.Ephemeral
    });

    // ========================================
    // สรุปผล Ranked
    // ========================================

    try {

        await finalizeRankedMatch(
            interaction,
            match
        );

    } catch (error) {

        console.error(
            "❌ Ranked finalize error:",
            error
        );

        match.status = "FIGHTING";

        await interaction.followUp({
            content:
                "❌ เกิดข้อผิดพลาดในการสรุปผล Ranked กรุณาแจ้ง Tester/Admin",
            flags: MessageFlags.Ephemeral
        }).catch(() => {});
    }

    return;
}
// ========================================
// RANKED REPORT
// ========================================

if (
    interaction.isButton() &&
    interaction.customId.startsWith(
        "ranked_report:"
    )
) {

    const matchId =
        interaction.customId.split(":")[1];

    const match =
        rankedMatches.get(matchId);

    if (!match) {

        await interaction.reply({
            content:
                "❌ ไม่พบ Ranked Match นี้",
            flags: MessageFlags.Ephemeral
        });

        return;
    }

    const player =
        getRankedMatchPlayer(
            match,
            interaction.user.id
        );

    if (!player) {

        await interaction.reply({
            content:
                "❌ คุณไม่ได้อยู่ในการแข่งขันนี้",
            flags: MessageFlags.Ephemeral
        });

        return;
    }

    if (
        match.status === "COMPLETED"
    ) {

        await interaction.reply({
            content:
                "❌ Match นี้จบไปแล้ว",
            flags: MessageFlags.Ephemeral
        });

        return;
    }

    match.status = "DISPUTED";

    await interaction.reply({
        content:
            "⚠️ ส่ง Report แล้ว\nTester/Admin จะเข้ามาตรวจสอบผลการแข่งขัน",
        flags: MessageFlags.Ephemeral
    });

    await notifyRankedDispute(
        interaction,
        match
    );

    return;
}
// ========================================
// RANKED DISPUTE RESOLVE BUTTON
// ========================================

if (
    interaction.isButton() &&
    interaction.customId.startsWith(
        "ranked_resolve:"
    )
) {

    const parts =
        interaction.customId.split(":");

    const matchId = parts[1];
    const winnerKey = parts[2];

    const match =
        rankedMatches.get(matchId);

    if (!match) {

        await interaction.reply({
            content:
                "❌ ไม่พบ Ranked Match นี้",
            flags: MessageFlags.Ephemeral
        });

        return;
    }

    if (!isRankedStaff(interaction.member)) {

        await interaction.reply({
            content:
                "❌ เฉพาะ Tester/Admin เท่านั้นที่สามารถตัดสิน Dispute ได้",
            flags: MessageFlags.Ephemeral
        });

        return;
    }

    if (match.status !== "DISPUTED") {

        await interaction.reply({
            content:
                "❌ Match นี้ไม่ได้อยู่ในสถานะ Dispute",
            flags: MessageFlags.Ephemeral
        });

        return;
    }

    const winner =
        winnerKey === "player1"
            ? match.player1
            : match.player2;

    const loser =
        winnerKey === "player1"
            ? match.player2
            : match.player1;

    const modal =
        new ModalBuilder()
            .setCustomId(
                `ranked_resolve_modal:${matchId}:${winnerKey}`
            )
            .setTitle("⚠️ ตัดสิน Ranked Dispute");

    const winnerScoreInput =
        new TextInputBuilder()
            .setCustomId("winner_score")
            .setLabel("คะแนนผู้ชนะ")
            .setStyle(
                TextInputStyle.Short
            )
            .setPlaceholder(
                `ต้องเป็น ${match.firstTo}`
            )
            .setRequired(true);

    const loserScoreInput =
        new TextInputBuilder()
            .setCustomId("loser_score")
            .setLabel("คะแนนผู้แพ้")
            .setStyle(
                TextInputStyle.Short
            )
            .setPlaceholder(
                "เช่น 3"
            )
            .setRequired(true);

    modal.addComponents(

        new ActionRowBuilder()
            .addComponents(
                winnerScoreInput
            ),

        new ActionRowBuilder()
            .addComponents(
                loserScoreInput
            )
    );

    await interaction.showModal(modal);

    return;
}
    // ========================================
// RANKED DISPUTE RESOLVE MODAL
// ========================================

if (
    interaction.isModalSubmit() &&
    interaction.customId.startsWith(
        "ranked_resolve_modal:"
    )
) {

    const parts =
        interaction.customId.split(":");

    const matchId = parts[1];
    const winnerKey = parts[2];

    const match =
        rankedMatches.get(matchId);

    if (!match) {

        await interaction.reply({
            content:
                "❌ ไม่พบ Ranked Match นี้",
            flags: MessageFlags.Ephemeral
        });

        return;
    }

    // ========================================
    // ตรวจสอบ Tester / Admin
    // ========================================

    if (!isRankedStaff(interaction.member)) {

        await interaction.reply({
            content:
                "❌ เฉพาะ Tester/Admin เท่านั้นที่สามารถตัดสิน Dispute ได้",
            flags: MessageFlags.Ephemeral
        });

        return;
    }

    // ========================================
    // ตรวจสอบสถานะ Match
    // ========================================

    if (match.status !== "DISPUTED") {

        await interaction.reply({
            content:
                "❌ Match นี้ไม่ได้อยู่ในสถานะ Dispute",
            flags: MessageFlags.Ephemeral
        });

        return;
    }

    // ========================================
    // รับคะแนน
    // ========================================

    const winnerScore =
        Number(
            interaction.fields.getTextInputValue(
                "winner_score"
            )
        );

    const loserScore =
        Number(
            interaction.fields.getTextInputValue(
                "loser_score"
            )
        );

    // ========================================
    // ตรวจสอบคะแนน
    // ========================================

    const validation =
        validateRankedScore(
            match.firstTo,
            winnerScore,
            loserScore,
            "WIN"
        );

    if (!validation.valid) {

        await interaction.reply({
            content:
                `❌ ${validation.reason}`,
            flags: MessageFlags.Ephemeral
        });

        return;
    }

    // ========================================
    // กำหนดผู้ชนะ / ผู้แพ้
    // ========================================

    const winner =
        winnerKey === "player1"
            ? match.player1
            : match.player2;

    const loser =
        winnerKey === "player1"
            ? match.player2
            : match.player1;

    // ========================================
    // บันทึกผลที่ Tester/Admin ตัดสิน
    // ========================================

    winner.reportedResult = {
        result: "WIN",
        playerScore: winnerScore,
        opponentScore: loserScore,
        reportedBy: interaction.user.id,
        reportedAt: Date.now()
    };

    loser.reportedResult = {
        result: "LOSS",
        playerScore: loserScore,
        opponentScore: winnerScore,
        reportedBy: interaction.user.id,
        reportedAt: Date.now()
    };

    winner.confirmed = true;
    loser.confirmed = true;

    // ========================================
    // ให้ finalizeRankedMatch() ทำงาน
    // ========================================

    match.status = "FIGHTING";

    await interaction.reply({
        content:
            [
                "✅ **ตัดสิน Ranked Dispute แล้ว**",
                "",
                `🏆 ผู้ชนะ: <@${winner.userId}>`,
                `❌ ผู้แพ้: <@${loser.userId}>`,
                "",
                `คะแนน: **${winnerScore} - ${loserScore}**`,
                "",
                "กำลังอัปเดต Tier..."
            ].join("\n"),
        flags: MessageFlags.Ephemeral
    });

    try {

        await finalizeRankedMatch(
            interaction,
            match
        );

    } catch (error) {

        console.error(
            "❌ Ranked dispute finalize error:",
            error
        );

        match.status = "DISPUTED";

        await interaction.followUp({
            content:
                "❌ เกิดข้อผิดพลาดในการอัปเดต Tier กรุณาตรวจสอบ Console",
            flags: MessageFlags.Ephemeral
        }).catch(() => {});
    }

    return;
}

        if (interaction.customId === "verify_identity") {

    try {

        loadVerifiedUsers();

        // ตรวจว่ายืนยันไปแล้วหรือยัง
        if (verifiedUsers.has(interaction.user.id)) {

            await interaction.reply({
                content: "คุณยืนยันตัวตนแล้ว",
                flags: MessageFlags.Ephemeral
            });

            return;
        }

        // ตรวจว่ามีคำขอยืนยันค้างอยู่หรือไม่
        if (pendingVerifications.has(interaction.user.id)) {

            await interaction.reply({
                content:
                    "คุณมีคำขอยืนยันตัวตนอยู่แล้ว กรุณารอ Tester หรือ Admin ยืนยัน",
                flags: MessageFlags.Ephemeral
            });

            return;
        }

        // เปิด Modal
        await interaction.showModal(
            buildVerifyModal()
        );

    } catch (err) {

        console.error(
            "===== VERIFY BUTTON ERROR ====="
        );

        console.error(err);

    }

    return;
}
if (interaction.customId === "join_queue") {

    // ตอบ Interaction ทันที ป้องกัน "ไม่ตอบสนองในเวลาที่กำหนด"
    await interaction.deferReply({
        flags: MessageFlags.Ephemeral
    });

    loadVerifiedUsers();

    console.log("===== JOIN =====");
    console.log("interaction.user.id =", interaction.user.id);
    console.log("verified =", verifiedUsers.has(interaction.user.id));
    console.log("verifiedUsers.get =", verifiedUsers.get(interaction.user.id));
    console.log("Map size =", verifiedUsers.size);

    for (const id of verifiedUsers.keys()) {
        console.log("ID =", id);
    }

    const state = getState(interaction.channelId);

    if (!verifiedUsers.has(interaction.user.id)) {
    await interaction.editReply({
        content: "คุณต้องยืนยันตัวตนก่อน"
    });
    return;
}

    // โค้ดเดิมต่อจากนี้...
const data = verifiedUsers.get(interaction.user.id);

if (data?.tester === true) {
    await interaction.editReply({
        content: "Tester ไม่สามารถจองคิวได้",
        flags: MessageFlags.Ephemeral
    });
    return;
}
            const mode = channelModes.get(interaction.channelId);

const cooldownKey = `${interaction.user.id}:${mode}`;

const lastTested = testCooldowns.get(cooldownKey);

if (lastTested) {
    const elapsed = Date.now() - lastTested;

    if (elapsed < cooldownMs) {
        const remaining = cooldownMs - elapsed;

       await interaction.editReply({
            content: `คุณเทส ${mode} ไปแล้ว ต้องรออีก ${formatRemaining(remaining)} ถึงจะเทส ${mode} ได้อีกครั้ง`,
            flags: MessageFlags.Ephemeral
        });

        return;
    }
}

// ========================================
// ตรวจว่ามีคนกำลังทดสอบอยู่หรือไม่
// ========================================

if (state.currentTesting) {
    await interaction.editReply({
        content: "ตอนนี้มีคนกำลังทดสอบอยู่ กรุณารอให้การทดสอบเสร็จก่อน"
    });
    return;
}

// ========================================
// หา Tester ที่กำลังเข้าเวร
// ========================================

const testerIds = Array.from(state.onlineTesters);

if (testerIds.length === 0) {
    await interaction.editReply({
        content: "ตอนนี้ไม่มี Tester เข้าเวร"
    });
    return;
}

// เลือก Tester คนแรกที่กำลังเข้าเวร
const testerId = testerIds[0];

const queueItem = {
    userId: interaction.user.id,
    detail: "รอทดสอบ",
    mode
};

// ========================================
// ล็อกผู้เล่นเป็นกำลังทดสอบทันที
// ป้องกันคนอื่นกดพร้อมกัน
// ========================================

state.currentTesting = {
    userId: interaction.user.id,
    testerId: testerId,
    detail: "รอทดสอบ",
    mode,
    channelId: null
};

let testRoom;

try {

    // ========================================
    // สร้างห้อง Test ทันที
    // ========================================

    testRoom = await createTestRoom(
        interaction.guild,
        testerId,
        queueItem,
        interaction.channel
    );

    state.currentTesting.channelId = testRoom.id;

    // ========================================
    // บันทึก Active Test
    // ========================================

    activeTests.set(testRoom.id, {
        userId: interaction.user.id,
        testerId: testerId,
        detail: "รอทดสอบ",
        mode,
        channelId: testRoom.id,
        queueChannelId: interaction.channelId
    });
    clearQueueCallTimer(
    interaction.channelId
);

} catch (err) {

    console.error("สร้างห้อง Test ไม่สำเร็จ:", err);

    // ถ้าสร้างห้องไม่สำเร็จ ให้คืนสถานะว่าง
    state.currentTesting = null;

    await interaction.editReply({
        content: "ไม่สามารถสร้างห้องทดสอบได้ กรุณาลองใหม่อีกครั้ง"
    });

    return;
}
let mainMessage = null;

if (state.mainMessageId) {
    mainMessage = await interaction.channel.messages
        .fetch(state.mainMessageId)
        .catch(err => {
            console.log(
                "⚠️ Main Message เดิมหาไม่เจอ:",
                state.mainMessageId
            );
            return null;
        });
}
// ========================================
// ถ้า Main Message ถูกลบ → สร้างใหม่
// ========================================
if (!mainMessage) {

    console.log(
        "กำลังสร้าง Main Message ใหม่..."
    );

    mainMessage = await interaction.channel.send({
        embeds: [
            buildEmbed(interaction.channelId)
        ],
        components:
            buildButtons(interaction.channelId)
    });

    state.mainMessageId =
        mainMessage.id;

    saveMainMessages();

    console.log(
        "Main Message ใหม่:",
        mainMessage.id
    );
}

// ========================================
// อัปเดต Main Message
// ========================================

await mainMessage.edit({
    embeds: [
        buildEmbed(interaction.channelId)
    ],
    components:
        buildButtons(interaction.channelId)
}).catch(err => {

    console.error(
        "อัปเดต Queue Embed ไม่สำเร็จ:",
        err
    );

});

await interaction.editReply({
    content:
        `เริ่มการทดสอบทันที!\n` +
        `Tester: <@${testerId}>\n` +
        `ห้องทดสอบ: ${testRoom}`
});

const onlineTesters = Array.from(state.onlineTesters);

const mentions =
    onlineTesters.length > 0
        ? onlineTesters.map(id => `<@${id}>`).join(" ")
        : "";
const notifyChannel =
    interaction.guild.channels.cache.get(
        QUEUE_NOTIFY_CHANNEL_ID
    );

if (notifyChannel) {
    const notifyEmbed = new EmbedBuilder()
        .setColor(0xf1c40f)
        .setTitle("📢 มีผู้จองคิวใหม่")
        .setDescription(`<@${interaction.user.id}> ได้จองคิวทดสอบ`)
        .addFields(
            {
                name: "ห้อง",
                value: `${interaction.channel}`,
                inline: true
            },
            {
                name: "โหมด",
                value: mode || "ไม่ระบุ",
                inline: true
            },
            {
                name: "ผู้จอง",
                value: `<@${interaction.user.id}>`,
                inline: true
            }
        )
        .setTimestamp();

    await notifyChannel.send({
        content: mentions || undefined,
        embeds: [notifyEmbed]
    });

    console.log(
        "ส่งแจ้งเตือนจองคิวไปห้อง:",
        QUEUE_NOTIFY_CHANNEL_ID
    );
}

return;
}

        if (interaction.customId === "cancel_queue") {

    await interaction.deferReply({
        flags: MessageFlags.Ephemeral
    });

    const state = getState(interaction.channelId);
            const index = state.queue.findIndex((item) => item.userId === interaction.user.id);

            if (state.currentTesting && interaction.user.id === state.currentTesting.userId) {
                await interaction.editReply({
    content: "คุณกำลังทดสอบอยู่ ไม่สามารถยกเลิกได้ตรงนี้"
});
                return;
            }

            if (index === -1) {
                await interaction.editReply({
    content: "คุณไม่ได้อยู่ในคิว"
});
                return;
            }

            state.queue.splice(index, 1);

           await interaction.editReply({
    content: "ยกเลิกคิวเรียบร้อยแล้ว",
    embeds: [buildEmbed(interaction.channelId)],
    components: buildButtons(interaction.channelId)
});
        }

       if (interaction.customId === "toggle_duty") {

    console.log("===== TOGGLE DUTY CLICKED =====");
    console.log("User:", interaction.user.id);
    console.log("Channel:", interaction.channelId);

    // ตอบ Discord ทันที
    await interaction.deferUpdate();

    try {

        const member = interaction.member;

        // =========================
        // ตรวจ Tester
        // =========================

        const isTester = member.roles.cache.some(
            role => role.name === testerRoleName
        );

        if (!isTester) {

            await interaction.followUp({
                content: "คุณไม่มีสิทธิ์เป็น Tester",
                flags: MessageFlags.Ephemeral
            });

            return;
        }

        // =========================
        // State
        // =========================

        const state = getState(interaction.channelId);

        // =========================
        // Mode
        // =========================

        const mode =
            channelModes.get(interaction.channelId) || "ไม่ระบุ";

        // =========================
        // สลับสถานะเข้า / ออกเวร
        // =========================

        const goingOnDuty =
            !state.onlineTesters.has(interaction.user.id);

        if (goingOnDuty) {

            state.onlineTesters.add(
                interaction.user.id
            );

        } else {

            state.onlineTesters.delete(
                interaction.user.id
            );

        }

        console.log("===== TESTER DUTY =====");
        console.log("Tester:", interaction.user.id);
        console.log("Mode:", mode);
        console.log("Going on duty:", goingOnDuty);
        console.log(
            "Online testers:",
            [...state.onlineTesters]
        );

        // =========================
        // อัปเดต Queue Embed
        // =========================

        await interaction.editReply({
            embeds: [
                buildEmbed(interaction.channelId)
            ],
            components: buildButtons(
                interaction.channelId
            )
        });

        console.log("Queue Embed Updated");

        // =========================
        // แจ้งเตือน Tester Duty
        // =========================

        const notifyChannel =
            interaction.guild.channels.cache.get(
                TESTER_DUTY_NOTIFY_CHANNEL_ID
            );

        if (!notifyChannel) {

            console.log(
                "⚠️ ไม่พบห้องแจ้งเตือน Tester:",
                TESTER_DUTY_NOTIFY_CHANNEL_ID
            );

            return;
        }

        // =========================
        // ข้อมูล Tester
        // =========================

        const testerData =
            verifiedUsers.get(
                interaction.user.id
            );

        const minecraftName =
            testerData?.gameName || "ไม่ทราบชื่อ";

        // =========================
        // สร้าง Embed
        // =========================

        const dutyEmbed =
            new EmbedBuilder()
                .setColor(
                    goingOnDuty
                        ? 0x2ecc71
                        : 0xe74c3c
                )
                .setTitle(
                    goingOnDuty
                        ? "🟢 Tester เข้าเวร"
                        : "🔴 Tester ออกเวร"
                )
                .setDescription(
                    goingOnDuty
                        ? `<@${interaction.user.id}> เข้าประจำการแล้ว`
                        : `<@${interaction.user.id}> ออกจากเวรแล้ว`
                )
                .addFields(
                    {
                        name: "Tester",
                        value: `<@${interaction.user.id}>`,
                        inline: true
                    },
                    {
                        name: "Minecraft",
                        value: minecraftName,
                        inline: true
                    },
                    {
                        name: "โหมด",
                        value: `**${mode}**`,
                        inline: true
                    },
                    {
                        name: "ห้อง",
                        value: `<#${interaction.channelId}>`,
                        inline: true
                    },
                    {
                        name: "สถานะ",
                        value: goingOnDuty
                            ? "🟢 พร้อมรับคิว"
                            : "🔴 ไม่อยู่ในเวร",
                        inline: true
                    }
                )
                .setTimestamp()
                .setFooter({
                    text: "Zenith Community • Tester Duty"
                });

       if (minecraftName !== "ไม่ทราบชื่อ") {

        dutyEmbed.setThumbnail(
            getMinecraftRenderUrl(minecraftName)
        );

}

        // =========================
        // ส่งแจ้งเตือน
        // =========================

const memberRole =
    interaction.guild.roles.cache.find(
        role => role.name === "member"
    );
// =========================
// เพิ่ม / ลบ Role Member
// =========================
if (memberRole) {

    if (goingOnDuty) {

        // เข้าเวร → เพิ่ม Member
        await interaction.member.roles.add(memberRole);

        console.log(
            `${interaction.user.tag} ได้รับ Role Member`
        );

    } else {

        // ออกเวร → ลบ Member
        await interaction.member.roles.remove(memberRole);

        console.log(
            `${interaction.user.tag} ถูกลบ Role Member`
        );
    }
}
await notifyChannel.send({
    content: goingOnDuty
        ? memberRole
            ? `<@&${memberRole.id}>\n📢 <@${interaction.user.id}> **เข้าเวรแล้ว!**`
            : `📢 <@${interaction.user.id}> **เข้าเวรแล้ว!**`
        : `📢 <@${interaction.user.id}> **ออกจากเวรแล้ว!**`,
    allowedMentions: {
        roles: goingOnDuty && memberRole
            ? [memberRole.id]
            : [],
        users: [interaction.user.id]
    },
    embeds: [dutyEmbed]
});

        console.log("Duty notification sent");

    } catch (err) {
        console.error(
            "===== TOGGLE DUTY ERROR ====="
        );

        console.error(err);

        // เพราะ deferUpdate ไปแล้ว
        // ต้องใช้ followUp ไม่ใช่ reply

        await interaction.followUp({
            content: "เกิดข้อผิดพลาดในการเปลี่ยนสถานะเวร",
            flags: MessageFlags.Ephemeral
        }).catch(console.error);

    }

    return;
}
if (interaction.isButton()) {

    // ========================================
    // ยืนยันตัวตน
    // ========================================

    if (interaction.customId.startsWith("verify_accept_")) {

        await interaction.deferReply({
            flags: MessageFlags.Ephemeral
        });

        const userId =
            interaction.customId.replace(
                "verify_accept_",
                ""
            );

        // หา request
        const request =
            pendingVerifications.get(userId);

        if (!request) {

            await interaction.editReply({
                content:
                    "ไม่พบคำขอยืนยันตัวตน หรือคำขอนี้หมดอายุแล้ว"
            });

            return;
        }

        // ========================================
        // ตรวจว่าคนกดยืนยันเป็น Tester / Admin
        // ========================================

        const member = interaction.member;

        const isTester =
            member.roles.cache.some(
                role => role.name === testerRoleName
            );

        const isAdmin =
            member.permissions.has(
                PermissionsBitField.Flags.Administrator
            ) ||
            member.roles.cache.some(
                role => role.name === adminRoleName
            );

        if (!isTester && !isAdmin) {

            await interaction.editReply({
                content:
                    "คุณไม่มีสิทธิ์ยืนยันตัวตน"
            });

            return;
        }

        // ========================================
        // บันทึกข้อมูล
        // ========================================

        const oldData =
            verifiedUsers.get(userId);

        const playerData = {

            gameName:
                request.minecraftName,

           imageUrl: 
                getMinecraftRenderUrl(request.minecraftName),

            tier:
                oldData?.tier || "-",

            points:
                oldData?.points || "0",

            tester:
                request.tester === true,

            confirmed: true
        };

        verifiedUsers.set(
            userId,
            playerData
        );

        saveVerifiedUsers();

        // ========================================
        // เรียก onVerified
        // ========================================

        if (typeof global.onVerified === "function") {

            await global.onVerified(
                userId,
                request.minecraftName,
                playerData.imageUrl,
                request.tester,
                request.minecraftUuid
            );
        }

        // ========================================
        // ลบ Pending
        // ========================================

        pendingVerifications.delete(userId);

        // ========================================
        // ปิดปุ่มข้อความคำขอ
        // ========================================

        await interaction.message.edit({
            components: []
        }).catch(() => {});

        // ========================================
        // แจ้งคนกด
        // ========================================

        await interaction.editReply({
            content:
                `ยืนยันตัวตนของ <@${userId}> เรียบร้อยแล้ว\n` +
                `Minecraft: **${request.minecraftName}**`
        });

        return;
    }


    // ========================================
    // ปฏิเสธ
    // ========================================

    if (interaction.customId.startsWith("verify_reject_")) {

        await interaction.deferReply({
            flags: MessageFlags.Ephemeral
        });

        const userId =
            interaction.customId.replace(
                "verify_reject_",
                ""
            );

        const request =
            pendingVerifications.get(userId);

        if (!request) {

            await interaction.editReply({
                content:
                    "ไม่พบคำขอยืนยันตัวตน หรือคำขอนี้หมดอายุแล้ว"
            });

            return;
        }

        // ========================================
        // ตรวจสิทธิ์
        // ========================================

        const member = interaction.member;

        const isTester =
            member.roles.cache.some(
                role => role.name === testerRoleName
            );

        const isAdmin =
            member.permissions.has(
                PermissionsBitField.Flags.Administrator
            ) ||
            member.roles.cache.some(
                role => role.name === adminRoleName
            );

        if (!isTester && !isAdmin) {

            await interaction.editReply({
                content:
                    "คุณไม่มีสิทธิ์ปฏิเสธคำขอ"
            });

            return;
        }

        // ========================================
        // ลบ Pending
        // ========================================

        pendingVerifications.delete(userId);

        // ========================================
        // ปิดปุ่ม
        // ========================================

        await interaction.message.edit({
            components: []
        }).catch(() => {});

        // ========================================
        // แจ้งผล
        // ========================================

        await interaction.editReply({
            content:
                `ปฏิเสธคำขอยืนยันตัวตนของ <@${userId}> แล้ว`
        });

        return;
    }
}
    if (interaction.isModalSubmit()) {
if (interaction.customId === "verify_modal") {

    try {

        const minecraftName =
            interaction.fields
                .getTextInputValue("minecraft_name")
                .trim();

        // ========================================
        // ตรวจชื่อ
        // ========================================

        if (!minecraftName) {

            await interaction.reply({
                content: "กรุณาใส่ชื่อ Minecraft",
                flags: MessageFlags.Ephemeral
            });

            return;
        }

        // ========================================
        // ตรวจชื่อ Minecraft
        // ========================================

        if (!/^[A-Za-z0-9_]{3,16}$/.test(minecraftName)) {

            await interaction.reply({
                content:
                    "ชื่อ Minecraft ต้องมี 3-16 ตัวอักษร และใช้ได้เฉพาะ A-Z, 0-9 และ _",
                flags: MessageFlags.Ephemeral
            });

            return;
        }

        // ========================================
        // ตรวจชื่อ Minecraft จาก Mojang API
        // ========================================

        let minecraftUuid;
        try {
            minecraftUuid = await fetchMinecraftUUID(minecraftName);
            if (!minecraftUuid) {
                await interaction.reply({
                    content: "ไม่พบผู้เล่น Minecraft นี้ กรุณาตรวจสอบชื่อใหม่",
                    flags: MessageFlags.Ephemeral
                });
                return;
            }
        } catch (error) {
            console.error("Error fetching Minecraft UUID:", error);
            await interaction.reply({
                content: "เกิดข้อผิดพลาดในการตรวจสอบชื่อ Minecraft กรุณาลองใหม่ภายหลัง",
                flags: MessageFlags.Ephemeral
            });
            return;
        }

        // ========================================
        // ตรวจว่ายืนยันแล้ว
        // ========================================

        loadVerifiedUsers();

        if (verifiedUsers.has(interaction.user.id)) {

            await interaction.reply({
                content: "คุณยืนยันตัวตนแล้ว",
                flags: MessageFlags.Ephemeral
            });

            return;
        }
        // ========================================
        // ตรวจ Tester Verify Channel
        // ========================================

        const isTester =
            interaction.channelId ===
            TESTER_VERIFY_CHANNEL_ID;

        // ========================================
        // บันทึกคำขอ
        // ========================================

        pendingVerifications.set(
            interaction.user.id,
            {
                discordId: interaction.user.id,
                discordUsername: interaction.user.username,
                minecraftName: minecraftName,
                minecraftUuid: minecraftUuid,
                tester: isTester,
                time: Date.now()
            }
        );

        // ========================================
        // ส่งคำขอไปห้อง
        // ========================================

        const verifyChannel =
            await interaction.guild.channels
                .fetch(VERIFY_REQUEST_CHANNEL_ID)
                .catch(() => null);

        if (!verifyChannel) {

            pendingVerifications.delete(
                interaction.user.id
            );

            await interaction.reply({
                content:
                    "ไม่พบห้องสำหรับคำขอยืนยันตัวตน",
                flags: MessageFlags.Ephemeral
            });

            return;
        }

        // ========================================
        // Embed คำขอ
        // ========================================

        const requestEmbed =
            new EmbedBuilder()
                .setColor(
                    isTester
                        ? 0x9b59b6
                        : 0x3498db
                )
                .setTitle("คำขอยืนยันตัวตน")
                .setThumbnail(
                    getMinecraftRenderUrl(minecraftName)
                )
                .addFields(
                    {
                        name: "Discord",
                        value:
                            `<@${interaction.user.id}>`,
                        inline: true
                    },
                    {
                        name: "Minecraft",
                        value:
                            minecraftName,
                        inline: true
                    },
                    {
                        name: "ประเภท",
                        value:
                            isTester
                                ? "Tester"
                                : "Player",
                        inline: true
                    }
                )
                .setTimestamp()
                .setFooter({
                    text: "Zenith Community • รอการยืนยัน"
                });

const row = new ActionRowBuilder()
    .addComponents(
        new ButtonBuilder()
            .setCustomId(`verify_accept_${interaction.user.id}`)
            .setLabel("ยืนยันตัวตน")
            .setStyle(ButtonStyle.Success),

        new ButtonBuilder()
            .setCustomId(`verify_reject_${interaction.user.id}`)
            .setLabel("ปฏิเสธ")
            .setStyle(ButtonStyle.Danger)
    );

const requestMessage =
    await verifyChannel.send({
        embeds: [requestEmbed],
        components: [row]
    });

        // ========================================
        // เก็บ Message ID
        // ========================================

        const request =
            pendingVerifications.get(
                interaction.user.id
            );

        request.messageId =
            requestMessage.id;

        request.channelId =
            verifyChannel.id;

        pendingVerifications.set(
            interaction.user.id,
            request
        );

        // ========================================
        // ตอบผู้เล่น
        // ========================================

        await interaction.reply({
            content:
                `ส่งคำขอยืนยันตัวตนเรียบร้อยแล้ว\n\n` +
                `Minecraft: **${minecraftName}**\n` +
                `กรุณารอ Tester หรือ Admin ยืนยันตัวตน`,
            flags: MessageFlags.Ephemeral
        });

        console.log(
            "===== VERIFY REQUEST ====="
        );

        console.log(
            "Discord:",
            interaction.user.id
        );

        console.log(
            "Minecraft:",
            minecraftName
        );

        console.log(
            "Tester:",
            isTester
        );

    } catch (err) {

        console.error(
            "===== VERIFY MODAL ERROR ====="
        );

        console.error(err);

        if (
            !interaction.replied &&
            !interaction.deferred
        ) {

            await interaction.reply({
                content:
                    "เกิดข้อผิดพลาดในการส่งคำขอ",
                flags: MessageFlags.Ephemeral
            }).catch(() => {});

        }

    }

    return;
}
if (interaction.customId === "tier_score_modal") {

    try {

        // ========================================
        // ตอบ Modal ทันที
        // ========================================

        await interaction.deferReply({
            flags: MessageFlags.Ephemeral
        });

        // ========================================
        // ดึงข้อมูลการทดสอบ
        // ========================================

        const picked =
            pendingTierPick.get(interaction.user.id);

        if (!picked) {

            await interaction.editReply({
                content: "ไม่พบข้อมูลการทดสอบ"
            });

            return;
        }

        // ========================================
        // ตรวจ Tier
        // ========================================

        const tier = picked.tier;

        if (
            !tier ||
            !tierOptions.includes(tier)
        ) {

            await interaction.editReply({
                content: "ไม่พบ Tier ที่เลือก"
            });

            return;
        }

        // ========================================
        // รับ Score
        // ========================================

        const testerScore = Number(
            interaction.fields.getTextInputValue(
                "tester_score"
            )
        );

        const playerScore = Number(
            interaction.fields.getTextInputValue(
                "player_score"
            )
        );

        if (
            !Number.isInteger(testerScore) ||
            !Number.isInteger(playerScore) ||
            testerScore < 0 ||
            playerScore < 0
        ) {

            await interaction.editReply({
                content:
                    "กรุณาใส่ Score เป็นตัวเลขจำนวนเต็ม เช่น 3 และ 0"
            });

            return;
        }
        if (picked.winnerSide === "applicant" && playerScore <= testerScore) {
    await interaction.editReply({
        content: "ถ้าผู้เล่นชนะ Score ของผู้เล่นต้องมากกว่า Tester"
    });
    return;
}

if (picked.winnerSide === "tester" && testerScore <= playerScore) {
    await interaction.editReply({
        content: "ถ้า Tester ชนะ Score ของ Tester ต้องมากกว่า Player"
    });
    return;
}

        // ========================================
        // คะแนน Tier
        // ========================================

        const basePoint =
            tierPoints[tier] || 0;

        // ========================================
        // ดึงข้อมูล Player / Tester
        // ========================================

        const player =
            verifiedUsers.get(
                picked.testedUserId
            );

        const tester =
            verifiedUsers.get(
                picked.testerUserId
            );

        if (!player) {

            await interaction.editReply({
                content: "ไม่พบข้อมูลผู้เล่น"
            });

            return;
        }
        // ========================================
        // บันทึก Tier แยกตาม Mode
        // ========================================

        player.tiers = player.tiers || {};

        player.tiers[picked.mode] = tier;

        const playerName =
            player.gameName || "Player";

        const testerName =
            tester?.gameName || "Tester";

        const scoreText =
            `${playerName} ${playerScore}-${testerScore} ${testerName}`;

        // ========================================
        // คะแนนสะสม
        // ========================================

        const currentPoints =
            Number(player.points) || 0;

        let pointsChange = 0;

        if (
            picked.winnerSide === "applicant"
        ) {

            // ผู้เล่นชนะ
            pointsChange = basePoint;

           player.points = String(
    currentPoints + basePoint
);

} else {

    pointsChange = -basePoint;

    player.points = String(
        Math.max(0, currentPoints - basePoint)
    );
}

        // ========================================
        // Tier
        // ========================================

        const currentTier =
            player.tier || "-";

        if (
            picked.winnerSide === "applicant"
        ) {

            const currentTierPoints =
                tierPoints[currentTier] || 0;

            const newTierPoints =
                tierPoints[tier] || 0;

            // เปลี่ยน Tier เฉพาะเมื่อ Tier ใหม่สูงกว่า
            if (
                currentTier === "-" ||
                newTierPoints > currentTierPoints
            ) {

                player.tier = tier;
            }

        } else {

            // แพ้ → Tier เดิม
            player.tier = currentTier;
        }

        // ========================================
        // บันทึกข้อมูลในท้องถิ่นสำหรับ UI ทันที
        // ========================================

        player.tester =
            player.tester ?? false;

verifiedUsers.set(
    picked.testedUserId,
    player
);

saveVerifiedUsers();

// อัปเดตยศอัตโนมัติตาม Points
await updateCombatRank(
    picked.testedUserId
);

await updatePlayerInfoMessage(
    interaction.guild,
    picked.testedUserId
);
        // ========================================
        // บันทึกการแข่งขันไปยัง API (แหล่งที่มาของความจริง)
        // ========================================
        try {
          // ตั้งค่าการโต้ตอบกับ Discord สำหรับการตรวจสอบความปลอดภัยของ API
          apiClient.setCurrentDiscordInteractionId(interaction.id);

          // รับโทเค็น API
          const token = await apiClient.getApiToken();

          // ตรวจสอบหรือสร้างผู้เล่นและทดสอบผ่าน API
          // Fetch Discord users for both participants
          const testedDiscordUser = await client.users.fetch(picked.testedUserId);
          const testerDiscordUser = await client.users.fetch(picked.testerUserId);

          // Get verified user data from verifiedUsers map
          const testedVerifiedUser = verifiedUsers.get(picked.testedUserId);
          const testerVerifiedUser = verifiedUsers.get(picked.testerUserId);

          // Verify that we have verified user data for both (with UUID)
          if (!testedVerifiedUser || !testedVerifiedUser.uuid) {
            await interaction.editReply({
              content: "ไม่พบข้อมูลผู้เล่นที่ยืนยันแล้วสำหรับผู้เล่น",
              flags: MessageFlags.Ephemeral
            });
            return;
          }
          if (!testerVerifiedUser || !testerVerifiedUser.uuid) {
            await interaction.editReply({
              content: "ไม่พบข้อมูลผู้เล่นที่ยืนยันแล้วสำหรับผู้ทดสอบ",
              flags: MessageFlags.Ephemeral
            });
            return;
          }

          // Create or get players using verified UUID
          await apiClient.getOrCreatePlayer(token, testedVerifiedUser, testedDiscordUser);
          await apiClient.getOrCreatePlayer(token, testerVerifiedUser, testerDiscordUser);

          // สร้างข้อมูลการแข่งขันตามสคีมา MatchCreate
          const matchData = {
            applicant: picked.testedUserId,    // Discord ID
            tester: picked.testerUserId,       // Discord ID
            winner: picked.winnerSide === "applicant"
              ? picked.testedUserId
              : picked.testerUserId,
            loser: picked.winnerSide === "applicant"
              ? picked.testerUserId
              : picked.testedUserId,
            score: `${playerScore}-${testerScore}`, // Format: "playerScore-testerScore"
            tier: picked.tier,                 // Already uppercase (HT1, LT1, etc.)
            game_mode: picked.mode.toLowerCase()  // Convert to lowercase (cpvp, spvp, etc.)
          };

          // ส่งการแข่งขันไปยัง API
          await apiClient.createMatch(token, matchData);

          // ตัวเลือก: อัปเดตสถานะท้องถิ่นด้วยข้อมูลจาก API เพื่อให้สอดคล้องกัน
          // ในปัจจุบันเราจะเก็บสถานะท้องถิ่นไว้สำหรับ UI ทันที และเชื่อมั่นว่า API เป็นแหล่งที่มาของความจริง
          console.log(`บันทึกการแข่งขันไปยัง API สำเร็จ: ${JSON.stringify(matchData)}`);
        } catch (apiError) {
          console.error("===== API ERROR =====", apiError);
          // แสดงข้อผิดพลาดให้ผู้ใช้เห็น แต่ดำเนินการต่อเนื่องจากเราได้อัปเดตสถานะท้องถิ่นแล้วสำหรับ UI ทันที
          await interaction.editReply({
            content:
              `บันทึกผลการทดสอบเรียบร้อยแล้วในท้องถิ่น แต่เกิดข้อผิดพลาดในการบันทึกไปยังศูนย์กลาง\n` +
              `กรุณาลองใหม่ภายหลังหรือติดต่อผู้ดูแลระบบ\n\n` +
              `ข้อผิดพลาด: ${apiError.message}`,
            flags: MessageFlags.Ephemeral
          });
          // ฟอลล์เบค: บันทึกผู้ใช้ที่ยืนยันแล้วในท้องถิ่นเป็นการสำรอง
          saveVerifiedUsers();
        }

        console.log(
            "===== SCORE UPDATE ====="
        );

        console.log(
            "Player:",
            picked.testedUserId
        );

        console.log(
            "Old Points:",
            currentPoints
        );

        console.log(
            "Points Change:",
            pointsChange
        );

        console.log(
            "New Points:",
            player.points
        );

        console.log(
            "Old Tier:",
            currentTier
        );

        console.log(
            "New Tier:",
            player.tier
        );

        // ========================================
        // ห้องผลการทดสอบ
        // ========================================

        const resultsChannel =
            interaction.guild.channels.cache.get(
                RESULTS_CHANNEL_ID
            );

        if (!resultsChannel) {

            await interaction.editReply({
                content:
                    "ไม่พบห้องผลการทดสอบ"
            });

            return;
        }

        // ========================================
        // Applicant
        // ========================================

        const applicant =
            verifiedUsers.get(
                picked.testedUserId
            );

        // ========================================
        // Winner / Loser
        // ========================================

        const winner =
            picked.winnerSide === "applicant"
                ? `<@${picked.testedUserId}>`
                : `<@${picked.testerUserId}>`;

        const loser =
            picked.winnerSide === "applicant"
                ? `<@${picked.testerUserId}>`
                : `<@${picked.testedUserId}>`;

        // ========================================
        // Result Embed
        // ========================================

        const embed =
            new EmbedBuilder()
                .setColor(0x2ecc71)
                .setTitle(
                    "Match Result Submitted"
                )
                .addFields(

                    {
                        name: "Type",
                        value: picked.mode || "-",
                        inline: true
                    },

                    {
                        name: "Tier",
                        value: tier,
                        inline: true
                    },

                    {
                        name: "Score",
                        value: scoreText,
                        inline: true
                    },

                    {
                        name: "Applicant",
                        value:
                            `<@${picked.testedUserId}>`,
                        inline: true
                    },

                    {
                        name: "Tester",
                        value:
                            `<@${picked.testerUserId}>`,
                        inline: true
                    },

                    {
                        name: "Winner",
                        value: winner,
                        inline: true
                    },

                    {
                        name: "Loser",
                        value: loser,
                        inline: true
                    },

                    {
                        name: "Points Change",
                       value:
    pointsChange > 0
        ? `+${pointsChange}`
        : String(pointsChange),
                        inline: true
                    },

                    {
                        name: "Points Total",
                        value:
                            String(player.points),
                        inline: true
                    }

                )
            .setThumbnail(
                applicant?.gameName
                    ? getMinecraftRenderUrl(applicant.gameName)
                    : null
                )
                .setTimestamp()
                .setFooter({
                    text:
                        `Submitted by ${interaction.user.username}`
                });

        await resultsChannel.send({
            embeds: [embed]
        });
        // ========================================
// บันทึก Tester Stats
// ========================================

recordTesterStats(
    picked.testerUserId,
    picked.testedUserId,
    tier,
    picked.mode
);

        // ========================================
        // หา State ของห้อง Test
        // ========================================

        const found =
            getStateByRoom(
                interaction.channelId
            );

        // ========================================
        // ลบ Pending
        // ========================================

        pendingTierPick.delete(
            interaction.user.id
        );

        // ========================================
        // ตอบผู้ใช้
        // ========================================

        await interaction.editReply({
            content:
                `บันทึกผลการทดสอบเรียบร้อยแล้ว\n\n` +
                `Tier: **${player.tier}**\n` +
                `คะแนน: **${player.points}**\n` +
                `ผล: **${scoreText}**`
        });

        // ========================================
        // จัดการ Cooldown / ห้อง Test
        // ========================================

        if (found) {

            // -----------------------------
            // Finished Users
            // -----------------------------

            if (
                !found.state.finishedUsers.some(
                    u =>
                        u.userId ===
                        picked.testedUserId
                )
            ) {

                const finishedData = {
                    userId:
                        picked.testedUserId,
                    time: Date.now()
                };

                found.state.finishedUsers.push(
                    finishedData
                );

                const finishedKey =
                    `${found.queueChannelId}:${picked.testedUserId}`;

                finishedUsersData.set(
                    finishedKey,
                    finishedData
                );

                saveFinishedUsers();
            }

            // -----------------------------
            // Cooldown
            // -----------------------------

            const cooldownKey =
                `${picked.testedUserId}:${picked.mode}`;

            testCooldowns.set(
                cooldownKey,
                Date.now()
            );

            saveCooldowns();

            // -----------------------------
            // ลบ Active Test
            // -----------------------------

            activeTests.delete(
    interaction.channelId
);

// ยกเลิก Timer 5 นาที
clearQueueCallTimer(
    found.queueChannelId
);

found.state.currentTesting = null;

            // -----------------------------
            // อัปเดต Queue
            // -----------------------------

            const queueChannel =
                interaction.guild.channels.cache.get(
                    found.queueChannelId
                );

            if (queueChannel) {

                const queueState =
                    getState(
                        found.queueChannelId
                    );

                if (queueState.mainMessageId) {

                    const msg =
                        await queueChannel.messages
                            .fetch(
                                queueState.mainMessageId
                            )
                            .catch(() => null);

                    if (
                        msg &&
                        typeof msg.edit === "function"
                    ) {

                        await msg.edit({
                            embeds: [
                                buildEmbed(
                                    found.queueChannelId
                                )
                            ],
                            components:
                                buildButtons(
                                    found.queueChannelId
                                )
                        });

                    }
                }
            }

            // -----------------------------
            // ลบห้อง Test
            // -----------------------------

            await interaction.channel
                .delete()
                .catch(err => {
                    console.error(
                        "ลบห้อง Test ไม่สำเร็จ:",
                        err
                    );
                });
        }
    } catch (err) {
        console.error("===== TIER MODAL ERROR =====");
        console.error(err);

        const errorText =
            err?.stack ||
            err?.message ||
            String(err);

        if (interaction.deferred && !interaction.replied) {

            await interaction.editReply({
                content:
                    `เกิดข้อผิดพลาดในการให้ Tier\n` +
                    `\`\`\`\n${errorText.slice(0, 1500)}\n\`\`\``
            }).catch(console.error);

        } else if (interaction.replied) {

            await interaction.followUp({
                content:
                    `เกิดข้อผิดพลาดในการให้ Tier\n` +
                    `\`\`\`\n${errorText.slice(0, 1500)}\n\`\`\``,
                flags: MessageFlags.Ephemeral
            }).catch(console.error);

        } else {

            await interaction.reply({
                content:
                    `เกิดข้อผิดพลาดในการให้ Tier\n` +
                    `\`\`\`\n${errorText.slice(0, 1500)}\n\`\`\``,
                flags: MessageFlags.Ephemeral
            }).catch(console.error);
        }
       }

    return;
} // ปิด if (interaction.customId === "tier_score_modal")

} // ปิด if (interaction.isModalSubmit())

}); // ปิด client.on("interactionCreate")

client.on("messageCreate", async (message) => {
    if (message.author.bot) return;
if (message.content === "!setupverify") {

    const isAdmin =
        message.member.permissions.has(PermissionsBitField.Flags.Administrator) ||
        message.member.roles.cache.some(role => role.name === adminRoleName);

    if (!isAdmin) {
        await message.reply("คุณไม่มีสิทธิ์ใช้คำสั่งนี้");
        return;
    }

    await message.channel.send({
        embeds: [buildVerifyEmbed()],
        components: [buildVerifyButton()]
    });

    return;
}
    if (message.content.startsWith("!setup") && !message.content.startsWith("!setupverify")) {const isAdmin =
    message.member.permissions.has(PermissionsBitField.Flags.Administrator) ||
    message.member.roles.cache.some(
        role => role.name === adminRoleName
    );
    
console.log("Roles:", message.member.roles.cache.map(r => r.name));
console.log("isAdmin:", isAdmin);
console.log(
    "Administrator:",
    message.member.permissions.has(PermissionsBitField.Flags.Administrator)
);
if (!isAdmin) {
    console.log(
    message.member.roles.cache.map(r => r.name)
);
    await message.reply("คุณไม่มีสิทธิ์ใช้คำสั่งนี้");
    return;
}
        const parts = message.content.trim().split(/\s+/);
const setupType = parts[1]?.toUpperCase();


// ========================================
// SETUP RANKED
// ========================================

if (setupType === "RANKED") {

    const rankedEmbed =
        new EmbedBuilder()
            .setTitle("🏆 Zenith Ranked")
            .setDescription(
                [
                    "ระบบ Ranked สำหรับการแข่งขันแบบ Competitive",
                    "",
                    "🔓 ต้องมี **LT3 ขึ้นไป** ใน Mode นั้น",
                    "🎮 Ranked แยก Tier ตามแต่ละ Mode",
                    "⚔️ ระบบจะจับคู่ผู้เล่น Tier เดียวกัน",
                    "",
                    "กดปุ่มด้านล่างเพื่อดู Ranked ของคุณ"
                ].join("\n")
            )
            .setColor(0x5865F2)
            .setFooter({
                text: "Zenith Community • Ranked"
            });

    const rankedButton =
        new ActionRowBuilder()
            .addComponents(
                new ButtonBuilder()
                    .setCustomId("ranked_open")
                    .setLabel("เปิด Ranked")
                    .setEmoji("🏆")
                    .setStyle(ButtonStyle.Primary)
            );

    await message.channel.send({
        embeds: [rankedEmbed],
        components: [rankedButton]
    });

    return;
}


// ========================================
// SETUP TEST เดิม
// ========================================

if (parts.length > 1) {
    const mode = setupType;

    if (modeOptions.includes(mode)) {
        channelModes.set(message.channelId, mode);
        saveChannelModes();
    }
}

const state = getState(message.channelId);

const msg = await message.channel.send({
    embeds: [buildEmbed(message.channelId)],
    components: buildButtons(message.channelId)
});
state.mainMessageId = msg.id;
saveMainMessages();
console.log("ส่ง Embed แล้ว");
console.log("Message ID =", msg.id);;
console.log("state.mainMessageId =", state.mainMessageId);
console.log("saveMainMessages() เรียบร้อย");
        return;
    }

    if (message.content.startsWith("!resetcooldown")) {

    try {
        // ลบข้อความคำสั่งออกจากห้อง
        await message.delete().catch(() => {});

        const member = message.member;

        const isTester = member.roles.cache.some(
            role => role.name === testerRoleName
        );

        const isAdmin =
            member.roles.cache.some(
                role => role.name === adminRoleName
            ) ||
            member.permissions.has(
                PermissionsBitField.Flags.Administrator
            );

        // เฉพาะ Tester / Admin
        if (!isTester && !isAdmin) {
            return;
        }

        const mentioned = message.mentions.users.first();

        if (!mentioned) {
            await message.author.send(
                "❌ กรุณาแท็กคนที่ต้องการยกเลิก Cooldown เช่น `!resetcooldown @ชื่อคน`"
            ).catch(() => {});
            return;
        }

        // =========================
        // หาโหมดของห้องนี้
        // =========================

        const mode = channelModes.get(message.channelId);

        if (!mode) {
            await message.author.send(
                "ห้องนี้ยังไม่ได้ตั้งโหมด PVP"
            ).catch(() => {});
            return;
        }

        // =========================
        // ลบ Cooldown เฉพาะโหมดนี้
        // =========================

        const cooldownKey =
            `${mentioned.id}:${mode}`;

        const existed =
            testCooldowns.has(cooldownKey);

        testCooldowns.delete(cooldownKey);

        saveCooldowns();

        // =========================
        // ลบออกจาก "เทสเสร็จแล้ว"
        // =========================

        const state =
            getState(message.channelId);

        state.finishedUsers =
            state.finishedUsers.filter(
                u => u.userId !== mentioned.id
            );
const finishedKey =
    `${message.channelId}:${mentioned.id}`;

finishedUsersData.delete(
    finishedKey
);

saveFinishedUsers();
        // =========================
        // อัปเดต Embed ห้อง
        // =========================

        if (state.mainMessageId) {

            const channel =
                message.guild.channels.cache.get(
                    message.channelId
                );

            if (channel) {

                const msg =
                    await channel.messages
                        .fetch(state.mainMessageId)
                        .catch(() => null);

                if (
                    msg &&
                    typeof msg.edit === "function"
                ) {

                    await msg.edit({
                        embeds: [
                            buildEmbed(message.channelId)
                        ],
                        components:
                            buildButtons(message.channelId)
                    });

                }
            }
        }

        // =========================
        // แจ้งผลแบบส่วนตัว
        // =========================

        if (existed) {

            await message.author.send(
                `ยกเลิก Cooldown ของ **${mentioned.username}** สำหรับโหมด **${mode}** เรียบร้อยแล้ว`
            ).catch(() => {});

        } else {

            await message.author.send(
                `ℹ️ **${mentioned.username}** ไม่มี Cooldown ของโหมด **${mode}**`
            ).catch(() => {});

        }

        console.log(
            `${message.author.tag} reset cooldown ของ ${mentioned.tag} (${mode})`
        );

    } catch (err) {

        console.error(
            "===== RESET COOLDOWN ERROR ====="
        );

        console.error(err);

    }

    return;
}
});

process.on("uncaughtException", (err) => {
    console.error(err);
});
console.log("Current directory:", process.cwd());
console.log("TOKEN =", !!process.env.TOKEN);
console.log("CLIENT_ID =", process.env.CLIENT_ID);
console.log("GUILD_ID =", process.env.GUILD_ID);
client.once("clientReady", async () => {

    console.log("บอทออนไลน์แล้ว!");

    loadVerifiedUsers();
    loadCooldowns();
    loadFinishedUsers();
    loadChannelModes();
    loadMainMessages();
    loadTesterStats();

    await registerCommands();

    

    const guild =
        await client.guilds.fetch(process.env.GUILD_ID);

    console.log("CALL onVerified");

global.onVerified = async (
        discordId,
        gameName,
        imageUrl,
        tester,
        uuid
    ) => {

        console.log("===== ON VERIFIED =====");
        console.log("Discord ID:", discordId);
        console.log("Minecraft:", gameName);
        console.log("Tester:", tester);
        const member = await guild.members
    .fetch(discordId)
    .catch(() => null);

if (member) {
    await member.setNickname(gameName).catch(err => {
        console.error("เปลี่ยนชื่อ Discord ไม่สำเร็จ:", err);
    });
}
    const oldData = verifiedUsers.get(discordId);

    // ========================================
    // เลือกห้องตามสถานะ Tester
    // ========================================

    const channelId = tester === true
        ? TESTER_INFO_CHANNEL_ID
        : PLAYER_INFO_CHANNEL_ID;

    console.log("ส่งข้อมูลไป Channel ID:", channelId);

    // ========================================
    // ถ้ามีข้อความเก่า ให้ลบก่อน
    // ป้องกันข้อมูลซ้ำ / ข้อมูลอยู่ผิดห้อง
    // ========================================

    const oldMessageId = playerMessages.get(discordId);

    if (oldMessageId) {

        const oldChannelId = oldData?.tester === true
            ? TESTER_INFO_CHANNEL_ID
            : PLAYER_INFO_CHANNEL_ID;

        const oldChannel = await guild.channels
            .fetch(oldChannelId)
            .catch(() => null);

        if (oldChannel) {

            const oldMessage = await oldChannel.messages
                .fetch(oldMessageId)
                .catch(() => null);

            if (oldMessage) {
                await oldMessage.delete().catch(() => {});
            }
        }
    }

    // ========================================
    // บันทึกข้อมูลผู้เล่น
    // ========================================

    const playerData = {
        gameName: gameName,
        imageUrl: imageUrl || oldData?.imageUrl || "",
        uuid: uuid,
        tier: oldData?.tier || "-",
        points: oldData?.points || "0",
        tester: tester === true,
        confirmed: true
    };

// ========================================
// บันทึกข้อมูลผู้เล่นก่อน
// ========================================

// ========================================
// บันทึกข้อมูลผู้เล่นก่อน
// ========================================

verifiedUsers.set(discordId, playerData);
saveVerifiedUsers();
// ========================================
// Sync Player ไปยัง Zenith API
// ให้ Website ใช้ Minecraft name เป็นชื่อหลัก
// ========================================

try {
    const token = await apiClient.getApiToken();

    const discordUser = await client.users
        .fetch(discordId)
        .catch(() => null);

    if (discordUser) {
        await apiClient.getOrCreatePlayer(
            token,
            playerData,
            discordUser
        );

        console.log(
            `[API SYNC] ${gameName} (${discordId}) synced successfully`
        );
    } else {
        console.warn(
            `[API SYNC] ไม่พบ Discord user: ${discordId}`
        );
    }

} catch (apiError) {
    console.error(
        `[API SYNC] Sync player failed for ${discordId}:`,
        apiError.message
    );
}

// ========================================
// ลบยศ Combat Rank เดิมทั้งหมด
// ========================================

await removeCombatRanks(discordId);

// ========================================
// ใส่ยศ Combat Rank ใหม่ตาม Tier / Points
// ========================================

await updateCombatRank(discordId);

// ========================================
// หา Channel
// ========================================

    // ========================================
    // หา Channel
    // ========================================

    const channel = await guild.channels
        .fetch(channelId)
        .catch(err => {
            console.error("ไม่สามารถหาห้องได้:", err);
            return null;
        });

    if (!channel || !channel.isTextBased()) {
        console.log("ไม่พบห้องข้อมูล");
        return;
    }

    // ========================================
    // Embed
    // ========================================

    const embed = new EmbedBuilder()
    .setColor(
        tester === true
            ? 0x9b59b6
            : 0x3498db
    )
    .setTitle(
        tester === true
            ? "ข้อมูล Tester"
            : "ข้อมูลผู้เล่น"
    )
    .setDescription(
        tester === true
            ? "ข้อมูล Tester ที่ยืนยันตัวตนแล้ว"
            : "ข้อมูลผู้เล่นที่ยืนยันตัวตนแล้ว"
    )
    .setThumbnail(
        getMinecraftRenderUrl(gameName)
        )
    .addFields(
        {
            name: "Discord",
            value: `<@${discordId}>`,
            inline: true
        },
        {
            name: "Minecraft",
            value: gameName,
            inline: true
        },
        {
            name: "Tier",
            value: playerData.tier,
            inline: true
        },
        {
            name: "Points",
            value: String(playerData.points),
            inline: true
        }
    )
    .setTimestamp()
    .setFooter({
        text: "Zenith Community"
    });

    // ========================================
    // ส่งข้อความ
    // ========================================

    const msg = await channel.send({
        embeds: [embed]
    });

    // ========================================
    // จำ Message ID
    // ========================================

    playerMessages.set(discordId, msg.id);
    savePlayerMessages();

    console.log("ส่งข้อมูลสำเร็จ");
    console.log("Channel ID:", channel.id);
    console.log("Message ID:", msg.id);
};

});
async function registerCommands() {

    const commands = [

        new SlashCommandBuilder()
            .setName("confirm")
            .setDescription("ยืนยันผู้เล่นโดยไม่ต้องยืนยันใน Minecraft")
            .addUserOption(option =>
                option
                    .setName("user")
                    .setDescription("ผู้เล่นใน Discord")
                    .setRequired(true)
            )
           .addStringOption(option =>
    option
        .setName("minecraft")
        .setDescription("ชื่อ Minecraft ของผู้เล่น")
        .setRequired(true)
)
.addBooleanOption(option =>
    option
        .setName("tester")
        .setDescription("ผู้เล่นคนนี้เป็น Tester หรือไม่")
        .setRequired(true)
),

        new SlashCommandBuilder()
            .setName("unconfirm")
            .setDescription("ยกเลิกการยืนยันผู้เล่น")
            .addUserOption(option =>
                option
                    .setName("user")
                    .setDescription("ผู้เล่นที่ต้องการยกเลิกการยืนยัน")
                    .setRequired(true)
            )

    ].map(command => command.toJSON());

    const rest = new REST({ version: "10" })
        .setToken(process.env.TOKEN);

    await rest.put(
        Routes.applicationGuildCommands(
            process.env.CLIENT_ID,
            process.env.GUILD_ID
        ),
        { body: commands }
    );

    console.log("ลงทะเบียน /confirm และ /unconfirm เรียบร้อยแล้ว");
}
async function shutdownBot() {

    console.log("===== BOT SHUTDOWN =====");

    try {

        // ========================================
        // วนทุก Queue
        // ========================================

        for (const [queueChannelId, state] of channelStates) {

            // ========================================
            // 1. เอา Tester ออกจากเวร
            // ========================================

            if (
                state.onlineTesters &&
                state.onlineTesters.size > 0
            ) {

                const testerIds =
                    Array.from(state.onlineTesters);

                for (const testerId of testerIds) {

                    const testerData =
                        verifiedUsers.get(testerId);

                    const minecraftName =
                        testerData?.gameName ||
                        "ไม่ทราบชื่อ";

                    const mode =
                        channelModes.get(queueChannelId) ||
                        "ไม่ระบุ";

                    const notifyChannel =
                        client.channels.cache.get(
                            TESTER_DUTY_NOTIFY_CHANNEL_ID
                        );

                    if (notifyChannel) {

                        const dutyEmbed =
                            new EmbedBuilder()
                                .setColor(0xe74c3c)
                                .setTitle("🔴 Tester ออกเวร")
                                .setDescription(
                                    `<@${testerId}> ออกจากเวรแล้ว เนื่องจากบอทกำลังปิด`
                                )
                                .addFields(
                                    {
                                        name: "Tester",
                                        value: `<@${testerId}>`,
                                        inline: true
                                    },
                                    {
                                        name: "Minecraft",
                                        value: minecraftName,
                                        inline: true
                                    },
                                    {
                                        name: "โหมด",
                                        value: `**${mode}**`,
                                        inline: true
                                    },
                                    {
                                        name: "ห้อง",
                                        value: `<#${queueChannelId}>`,
                                        inline: true
                                    },
                                    {
                                        name: "สถานะ",
                                        value: "🔴 ไม่อยู่ในเวร",
                                        inline: true
                                    }
                                )
                                .setTimestamp()
                                .setFooter({
                                    text:
                                        "Zenith Community • Tester Duty"
                                });

                        if (minecraftName !== "ไม่ทราบชื่อ") {

                        dutyEmbed.setThumbnail(
                            getMinecraftRenderUrl(minecraftName)
                        );

                        }

                        await notifyChannel.send({
                            content: `<@${testerId}>`,
                            embeds: [dutyEmbed]
                        }).catch(console.error);

                    }

                }

                // ล้าง Tester ทั้งหมด
                state.onlineTesters.clear();

            }


            // ========================================
            // 2. ล้างคนที่กำลังจองคิว
            // ========================================

            state.queue = [];


            // ========================================
            // 3. ล้างคนที่กำลังเทส
            // ========================================

            if (state.currentTesting) {

                console.log(
                    `ล้างผู้เล่นที่กำลังเทส: ${state.currentTesting.userId}`
                );

                state.currentTesting = null;

            }


            // ========================================
            // 4. ลบห้อง Test ที่กำลังเปิดอยู่
            // ========================================

            for (const [roomId, active] of activeTests) {

                if (
                    active &&
                    active.queueChannelId === queueChannelId
                ) {

                    const room =
                        client.channels.cache.get(roomId);

                    if (room) {

                        console.log(
                            `ลบห้อง Test: ${room.name}`
                        );

                        await room.delete(
                            "Bot shutdown"
                        ).catch(err => {

                            console.error(
                                `ลบห้อง Test ไม่สำเร็จ ${roomId}:`,
                                err.message
                            );

                        });

                    }

                    activeTests.delete(roomId);

                }

            }


            // ========================================
            // 5. อัปเดต Queue Embed
            // ========================================

            if (state.mainMessageId) {

                const queueChannel =
                    client.channels.cache.get(
                        queueChannelId
                    );

                if (queueChannel) {

                    const mainMessage =
                        await queueChannel.messages
                            .fetch(state.mainMessageId)
                            .catch(() => null);

                    if (mainMessage) {

                        await mainMessage.edit({

                            embeds: [
                                buildEmbed(queueChannelId)
                            ],

                            components:
                                buildButtons(queueChannelId)

                        }).catch(console.error);

                    }

                }

            }

        }


        // ========================================
        // 6. สำคัญ:
        //    ห้ามล้าง finishedUsersData
        // ========================================

        // finishedUsersData
        // ยังคงอยู่เหมือนเดิม
        //
        // เพราะต้องการให้
        // "เทสเสร็จแล้ว" ยังคงอยู่หลัง Restart


        // ========================================
        // 7. ไม่ต้อง save channelStates
        // ========================================
        //
        // queue / tester / currentTesting
        // เป็นข้อมูลชั่วคราว
        //
        // finishedUsersData เท่านั้นที่ถูกบันทึกไว้


        console.log(
            "===== SHUTDOWN CLEANUP COMPLETE ====="
        );

        console.log(
            "✓ Tester ถูกนำออกจากเวร"
        );

        console.log(
            "✓ คิวทั้งหมดถูกล้าง"
        );

        console.log(
            "✓ ผู้เล่นที่กำลังเทสถูกล้าง"
        );

        console.log(
            "✓ ห้อง Test ที่กำลังเปิดถูกลบ"
        );

        console.log(
            "✓ รายชื่อ 'เทสเสร็จแล้ว' ยังคงอยู่"
        );

    } catch (err) {

        console.error(
            "===== SHUTDOWN ERROR ====="
        );

        console.error(err);

    }

}
process.once("SIGINT", async () => {

    console.log("ได้รับ SIGINT");

    await shutdownBot();

    client.destroy();

    process.exit(0);
});


process.once("SIGTERM", async () => {

    console.log("ได้รับ SIGTERM");

    await shutdownBot();

    client.destroy();

    process.exit(0);
});
client.login(process.env.TOKEN);