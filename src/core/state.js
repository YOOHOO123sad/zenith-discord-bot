const fs = require("fs");
const path = require("path");

const dataDir = path.resolve(__dirname, "../../data");

// State objects
let channelStates = new Map();
let activeTests = new Map();
let verifiedUsers = new Map();
let pendingTierPick = new Map();
let channelModes = new Map();
let testCooldowns = new Map();
let playerMessages = new Map();
let finishedUsersData = new Map();
let pendingVerifications = new Map();
let testerStats = new Map();
let mainMessages = new Map(); // Note: mainMessages is a Map in the original, but we see it used as a Map in getState and set in loadMainMessages/saveMainMessages

// ========================================
// Tester Stats
// ========================================
function loadTesterStats() {
    const file = path.join(dataDir, "testerStats.json");

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
        path.join(dataDir, "testerStats.json");

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
// Verified Users
// ========================================
function saveVerifiedUsers() {
    const obj = Object.fromEntries(verifiedUsers);

    console.log("Saving to =", path.resolve(dataDir, "verified.json"));
    console.log("=== SAVE VERIFIED ===");
    console.log("Current directory:", process.cwd());
    console.log("Writing file:", path.resolve(dataDir, "verified.json"));
    console.log(obj);

    fs.writeFileSync(
        path.join(dataDir, "verified.json"),
        JSON.stringify(obj, null, 2)
    );

    console.log("verified.json saved");
}

function loadVerifiedUsers() {
    console.log("Loading verified.json...");

    if (!fs.existsSync(path.join(dataDir, "verified.json"))) {
        console.log("verified.json not found");
        return;
    }

    const raw = fs.readFileSync(path.join(dataDir, "verified.json"), "utf8");

    console.log(raw);

    const data = JSON.parse(raw);

    verifiedUsers = new Map(Object.entries(data));

    console.log("Loaded IDs:", [...verifiedUsers.keys()]);
}

// Note: There are two loadVerifiedUsers functions in the original? We'll keep one.

// ========================================
// Channel Modes
// ========================================
function loadChannelModes() {
    if (fs.existsSync(path.join(dataDir, "channelModes.json"))) {
        const data = JSON.parse(fs.readFileSync(path.join(dataDir, "channelModes.json"), "utf8"));
        channelModes = new Map(Object.entries(data));
    }
}

function saveChannelModes() {
    const obj = Object.fromEntries(channelModes);
    fs.writeFileSync(path.join(dataDir, "channelModes.json"), JSON.stringify(obj, null, 2));
}

// ========================================
// Cooldowns
// ========================================
function loadCooldowns() {
    if (fs.existsSync(path.join(dataDir, "cooldowns.json"))) {
        const data = JSON.parse(fs.readFileSync(path.join(dataDir, "cooldowns.json"), "utf8"));
        testCooldowns = new Map(Object.entries(data));
    }
}

function saveCooldowns() {
    const obj = Object.fromEntries(testCooldowns);
    fs.writeFileSync(path.join(dataDir, "cooldowns.json"), JSON.stringify(obj, null, 2));
}

// ========================================
// Player Messages
// ========================================
function loadPlayerMessages() {
    if (fs.existsSync(path.join(dataDir, "playerMessages.json"))) {
        const data = JSON.parse(fs.readFileSync(path.join(dataDir, "playerMessages.json"), "utf8"));
        playerMessages = new Map(Object.entries(data));
    }
}

function savePlayerMessages() {
    const obj = Object.fromEntries(playerMessages);
    fs.writeFileSync(
        path.join(dataDir, "playerMessages.json"),
        JSON.stringify(obj, null, 2)
    );
}

// ========================================
// Finished Users
// ========================================
function loadFinishedUsers() {
    if (!fs.existsSync(path.join(dataDir, "finishedUsers.json"))) {
        finishedUsersData = new Map();
        return;
    }

    try {
        const data = JSON.parse(
            fs.readFileSync(path.join(dataDir, "finishedUsers.json"), "utf8")
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
        path.join(dataDir, "finishedUsers.json"),
        JSON.stringify(obj, null, 2)
    );

    console.log(
        "บันทึก finishedUsers.json แล้ว"
    );
}

// ========================================
// Main Messages
// ========================================
function loadMainMessages() {
    if (!fs.existsSync(path.join(dataDir, "mainMessages.json"))) return;

    const data = JSON.parse(
        fs.readFileSync(path.join(dataDir, "mainMessages.json"), "utf8")
    );

    for (const channelId of Object.keys(data)) {
        const state = getState(channelId); // Note: getState is defined in queue.js, but we are in state.js. We'll have to adjust.
        // We cannot call getState from here because it's in queue.js. We'll change the approach: state.js will not have getState.
        // Instead, we'll let queue.js import state.js and use the state objects directly.
        // For now, we'll leave a note and adjust later.
        // We'll change: state.js will not have getState. We'll remove the call to getState and instead directly set the state in channelStates.
        // But note: the original loadMainMessages function in index.js used getState (which is a function that returns state for a channelId, creating if not exists).
        // We'll have to move getState to state.js or queue.js? Let's put getState in state.js because it's about state.
        // However, getState also loads finishedUsers from finishedUsersData? Actually, in the original, getState does:
        //   state.finishedUsers = []; then loops through finishedUsersData to populate.
        // So getState depends on finishedUsersData and channelStates.
        // We'll put getState in state.js and have it depend on the state objects in this file.
        // We'll adjust: state.js will export getState and other state management functions.
        // We'll restructure: state.js will hold the state objects and provide getState (and maybe setState) functions.
        // We'll do that after we create queue.js? Let's first write state.js without getState, and then we'll add it.
        // For now, we'll comment out the call to getState and do it manually.
        // We'll create the state if it doesn't exist.
        if (!channelStates.has(channelId)) {
            channelStates.set(channelId, {
                queue: [],
                onlineTesters: new Set(),
                finishedUsers: [],
                currentTesting: null,
                mainMessageId: null
            });
        }
        const chanState = channelStates.get(channelId);
        chanState.mainMessageId = data[channelId];
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
        path.join(dataDir, "mainMessages.json"),
        JSON.stringify(data, null, 2)
    );
}

// We'll also need to export the state objects and the load/save functions.
// But note: the original index.js also had a function `getState` that we moved to queue.js? Actually, we are going to put it in state.js.

// Let's define getState in state.js (since it's about state) and then we can use it in loadMainMessages.

// We'll add getState and other state management functions after we finish the load/save functions.

// We'll now write the getState function and other state helpers.

// But note: the original index.js had a function `getState` that also did:
//   state.finishedUsers = [];
//   for (const [key, data] of finishedUsersData.entries()) {
//        if (!key.startsWith(`${channelId}:`)) continue;
//        if (!data || !data.userId || !data.time) continue;
//        state.finishedUsers.push({ userId: data.userId, time: data.time });
//   }
// So we need finishedUsersData in scope.

// We'll put getState in state.js and have it access the state objects (including finishedUsersData) via closure.

// However, we are going to export the state objects and functions. We'll do:

//   module.exports = {
//        channelStates,
//        activeTests,
//        verifiedUsers,
//        ... and so on,
//        loadTesterStats,
//        saveTesterStats,
//        recordTesterStats,
//        loadVerifiedUsers,
//        saveVerifiedUsers,
//        loadChannelModes,
//        saveChannelModes,
//        loadCooldowns,
//        saveCooldowns,
//        loadPlayerMessages,
//        savePlayerMessages,
//        loadFinishedUsers,
//        saveFinishedUsers,
//        loadMainMessages,
//        saveMainMessages,
//        getState,   // we'll add this
//        ... other state helpers
//   };

// Let's write getState now.

function getState(channelId) {
    if (!channelStates.has(channelId)) {
        channelStates.set(channelId, {
            queue: [],
            onlineTesters: new Set(),
            finishedUsers: [],
            currentTesting: null,
            mainMessageId: null
        });
    }

    const state = channelStates.get(channelId);

    // Load finished users from finishedUsersData for this channel
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

// We'll also need a function to get state by room? That was in index.js as getStateByRoom.
// We'll put that in queue.js because it's more about queue/testing state.

// Now, we export everything.

module.exports = {
    channelStates,
    activeTests,
    verifiedUsers,
    pendingTierPick,
    channelModes,
    testCooldowns,
    playerMessages,
    finishedUsersData,
    pendingVerifications,
    testerStats,
    mainMessages, // Note: we are not using mainMessages as a Map? Actually, we are using channelStates for mainMessageId. So we don't need a separate mainMessages map? In the original, mainMessages was a Map that was saved to mainMessages.json and loaded into channelStates via loadMainMessages. We are now using channelStates for mainMessageId, so we don't need a separate mainMessages map. We'll remove it.

    // Load and save functions
    loadTesterStats,
    saveTesterStats,
    recordTesterStats,
    loadVerifiedUsers,
    saveVerifiedUsers,
    loadChannelModes,
    saveChannelModes,
    loadCooldowns,
    saveCooldowns,
    loadPlayerMessages,
    savePlayerMessages,
    loadFinishedUsers,
    saveFinishedUsers,
    loadMainMessages,
    saveMainMessages,
    getState
};