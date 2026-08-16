const state = require("./state");
const { Client, GatewayIntentBits, ChannelType, PermissionsBitField, EmbedBuilder, ActionRowBuilder, ButtonBuilder, StringSelectMenuBuilder, ModalBuilder, TextInputBuilder, TextInputStyle, MessageFlags } = require("discord.js");
const { generateCode } = require("../services/verifyApi");
const apiClient = require("../services/apiClient");
const path = require("path");
const fs = require("fs");
const { formatRemaining, normalizeMinecraftUUID } = require("../utils/helpers");
const { TIER_OPTIONS, MODE_OPTIONS, TIER_POINTS, RANK_ROLES, QUEUE_CALL_TIMEOUT_MS } = require("../config/constants");

// Queue call timers
const queueCallTimers = new Map();

// ========================================
// Queue Call Timeout — 5 นาที
// ========================================
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
            const stateObj = state.getState(queueChannelId);

            if (!stateObj || !stateObj.currentTesting) {
                return;
            }

            // ถ้าไม่ใช่ผู้เล่นคนที่ถูกเรียกแล้ว ไม่ต้องทำอะไร
            if (stateObj.currentTesting.userId !== userId) {
                return;
            }

            // ถ้าเริ่มเทสไปแล้ว แสดงว่าผู้เล่นเข้าห้องแล้ว
            const roomId = stateObj.currentTesting.channelId;

            if (roomId && state.activeTests.has(roomId)) {
                return;
            }

            const guild = await client.guilds.fetch(state.env.GUILD_ID).catch(() => null);

            if (!guild) {
                return;
            }

            const queueChannel = guild.channels.cache.get(queueChannelId);

            const skippedUserId = stateObj.currentTesting.userId;

            // ล้าง Current Testing
            stateObj.currentTesting = null;

            // ลบห้อง Test ถ้ายังมีอยู่
            if (roomId) {
                const testRoom = guild.channels.cache.get(roomId);

                if (testRoom) {
                    await testRoom.delete("ผู้เล่นไม่เข้าห้อง Test ภายใน 5 นาที").catch(() => {});
                }

                state.activeTests.delete(roomId);
            }

            // แจ้งผู้เล่นว่าถูกข้าม
            const member = await guild.members.fetch(skippedUserId).catch(() => null);

            if (member) {
                await member.send(
                    "**หมดเวลาการเรียกคิว**\n\n" +
                    "คุณไม่ได้เข้าห้อง Test ภายใน **5 นาที**\n" +
                    "ระบบจึงข้ามคิวของคุณอัตโนมัติ\n\n" +
                    "หากต้องการทดสอบ สามารถเข้าคิวใหม่ได้"
                ).catch(() => {});
            }

            // แจ้งในห้อง Queue
            if (queueChannel) {
                await queueChannel.send({
                    content: `<@${skippedUserId}> ไม่เข้าห้อง Test ภายใน **5 นาที** จึงถูกข้ามคิวอัตโนมัติ`
                }).catch(() => {});

                // อัปเดต Queue Embed
                if (stateObj.mainMessageId) {
                    const mainMessage = await queueChannel.messages.fetch(stateObj.mainMessageId).catch(() => null);

                    if (mainMessage) {
                        await mainMessage.edit({
                            embeds: [buildEmbed(queueChannelId)],
                            components: buildButtons(queueChannelId)
                        }).catch(() => {});
                    }
                }
            }

            console.log(`ข้ามคิว ${skippedUserId} เนื่องจากไม่เข้าห้องภายใน 5 นาที`);
        } catch (err) {
            console.error("Queue Timeout Error:", err);
        }
    }, QUEUE_CALL_TIMEOUT_MS);

    queueCallTimers.set(queueChannelId, timer);
}

// ========================================
// Get State By Room
// ========================================
function getStateByRoom(roomChannelId) {
    console.log("===== GET STATE BY ROOM =====");
    console.log("Room Channel ID:", roomChannelId);

    // หาใน activeTests ก่อน
    const active = state.activeTests.get(roomChannelId);

    if (active) {
        console.log("FOUND IN activeTests");
        console.log(active);

        const stateObj = state.getState(active.queueChannelId);

        // ซิงก์ currentTesting
        if (!stateObj.currentTesting) {
            stateObj.currentTesting = {
                userId: active.userId,
                testerId: active.testerId,
                detail: active.detail,
                mode: active.mode,
                channelId: roomChannelId
            };
        }

        return {
            queueChannelId: active.queueChannelId,
            state: stateObj
        };
    }

    // ถ้าไม่เจอใน activeTests ให้ค้นจาก channelStates
    for (const [queueChannelId, stateObj] of state.channelStates.entries()) {
        console.log(
            "Checking Queue:",
            queueChannelId,
            "currentTesting:",
            stateObj.currentTesting
        );

        if (!stateObj.currentTesting) continue;

        if (stateObj.currentTesting.channelId === roomChannelId) {
            console.log("FOUND BY CHANNEL ID");

            return {
                queueChannelId,
                state: stateObj
            };
        }

        const roomChannel = client.channels.cache.get(roomChannelId);

        if (
            roomChannel &&
            roomChannel.name === `test-${stateObj.currentTesting.userId}`
        ) {
            stateObj.currentTesting.channelId = roomChannelId;

            console.log("FOUND BY ROOM NAME");

            return {
                queueChannelId,
                state: stateObj
            };
        }
    }

    console.log("❌ NOT FOUND");

    return null;
}

// ========================================
// Create Test Room
// ========================================
async function createTestRoom(guild, testerId, queueItem, parentChannel) {
    const channelName = "test-" + queueItem.userId;

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
                allow: [PermissionsBitField.Flags.ViewChannel, PermissionsBitField.Flags.SendMessages, PermissionsBitField.Flags.ReadMessageHistory],
            },
            {
                id: queueItem.userId,
                allow: [PermissionsBitField.Flags.ViewChannel, PermissionsBitField.Flags.SendMessages, PermissionsBitField.Flags.ReadMessageHistory],
            },
            {
                id: client.user.id,
                allow: [PermissionsBitField.Flags.ViewChannel, PermissionsBitField.Flags.SendMessages, PermissionsBitField.Flags.ManageChannels],
            },
        ],
    });

    const verifyInfo = state.verifiedUsers.get(queueItem.userId);

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

// ========================================
// Update Player Info Message
// ========================================
async function updatePlayerInfoMessage(guild, discordId) {
    try {
        const player = state.verifiedUsers.get(discordId);

        if (!player) {
            console.log(`ไม่พบข้อมูลผู้เล่น ${discordId}`);
            return;
        }

        const messageId = state.playerMessages.get(discordId);

        if (!messageId) {
            console.log(`ไม่พบ Message ID ของผู้เล่น ${discordId}`);
            return;
        }

        const channelId = player.tester === true
            ? state.env.TESTER_INFO_CHANNEL_ID
            : state.env.PLAYER_INFO_CHANNEL_ID;

        const channel = await guild.channels.fetch(channelId).catch(() => null);

        if (!channel) {
            console.log(`ไม่พบห้องข้อมูลผู้เล่น ${channelId}`);
            return;
        }

        const message = await channel.messages.fetch(messageId).catch(() => null);

        if (!message) {
            console.log(`ไม่พบ Message ${messageId}`);
            return;
        }

        if (!message.embeds || !message.embeds.length) {
            console.log("Message ไม่มี Embed");
            return;
        }

        const embed = EmbedBuilder.from(message.embeds[0]);

        const oldFields = message.embeds[0].fields || [];

        const newFields = oldFields.map(field => {
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

        console.log(`อัปเดต Tier/Points ใน Discord แล้ว: ${discordId}`);
    } catch (err) {
        console.error("อัปเดตข้อมูลผู้เล่นใน Discord ไม่สำเร็จ:", err);
    }
}

// ========================================
// Update Combat Rank
// ========================================
async function updateCombatRank(discordId) {
    try {
        const player = state.verifiedUsers.get(discordId);

        if (!player) {
            console.log(`ไม่พบข้อมูลผู้เล่น ${discordId}`);
            return;
        }

        const guild = await client.guilds.fetch(state.env.GUILD_ID).catch(() => null);

        if (!guild) {
            console.log("ไม่พบบอทอยู่ในเซิร์ฟเวอร์");
            return;
        }

        const member = await guild.members.fetch(discordId).catch(() => null);

        if (!member) {
            console.log(`ไม่พบสมาชิก Discord: ${discordId}`);
            return;
        }

        const points = Math.max(0, Number(player.points) || 0);

        const rank = [...RANK_ROLES]
            .sort((a, b) => b.minPoints - a.minPoints)
            .find(role => points >= role.minPoints);

        if (!rank) {
            console.log(`ไม่พบ Rank สำหรับ ${points} points`);
            return;
        }

        console.log("===== COMBAT RANK =====");
        console.log("Player:", player.gameName || discordId);
        console.log("Points:", points);
        console.log("Rank:", rank.name);
        console.log("=======================");

        // ลบ Rank เก่าทั้งหมด
        for (const roleInfo of RANK_ROLES) {
            const role = guild.roles.cache.find(r => r.name === roleInfo.name);

            if (role && member.roles.cache.has(role.id)) {
                await member.roles.remove(role).catch(error => {
                    console.error(`ลบยศ ${role.name} ไม่สำเร็จ:`, error.message);
                });
            }
        }

        // หา Role ใหม่
        const newRole = guild.roles.cache.find(r => r.name === rank.name);

        if (!newRole) {
            console.log(`ไม่พบ Role: ${rank.name}`);
            return;
        }

        // เพิ่ม Role ใหม่
        if (!member.roles.cache.has(newRole.id)) {
            await member.roles.add(newRole).catch(error => {
                console.error(`เพิ่มยศ ${rank.name} ไม่สำเร็จ:`, error.message);
            });
        }

        console.log(`🏆 ${player.gameName || discordId} มี ${points} points → ได้รับยศ ${rank.name}`);
    } catch (error) {
        console.error("updateCombatRank Error:", error);
    }
}

// ========================================
// Remove Combat Ranks (for unconfirm)
// ========================================
async function removeCombatRanks(discordId) {
    try {
        const guild = await client.guilds.fetch(state.env.GUILD_ID).catch(() => null);

        if (!guild) {
            console.log("ไม่พบบอทอยู่ในเซิร์ฟเวอร์");
            return;
        }

        const member = await guild.members.fetch(discordId).catch(() => null);

        if (!member) {
            console.log(`ไม่พบสมาชิก Discord: ${discordId}`);
            return;
        }

        // ลบ Rank เก่าทั้งหมด
        for (const roleInfo of RANK_ROLES) {
            const role = guild.roles.cache.find(r => r.name === roleInfo.name);

            if (role && member.roles.cache.has(role.id)) {
                await member.roles.remove(role).catch(error => {
                    console.error(`ลบยศ ${role.name} ไม่สำเร็จ:`, error.message);
                });
            }
        }
    } catch (error) {
        console.error("removeCombatRanks Error:", error);
    }
}

// ========================================
// Record Tester Stats (we already have it in state.js, but we'll use the one from state.js)
// We'll export the one from state.js, so we don't need to define it here.
// We'll just use state.recordTesterStats

// ========================================
// Build Embed
// ========================================
function buildEmbed(channelId) {
    const stateObj = state.getState(channelId);
    const mode = state.channelModes.get(channelId);

    const testerText = stateObj.onlineTesters.size > 0
        ? Array.from(stateObj.onlineTesters).map((id) => "<@" + id + ">").join(", ")
        : "ไม่มี";
    const testingText = stateObj.currentTesting
        ? "<@" + stateObj.currentTesting.userId + "> — " + stateObj.currentTesting.detail + (stateObj.currentTesting.channelId ? "\nห้อง: <#" + stateObj.currentTesting.channelId + ">" : "")
        : "ไม่มีใครกำลังทดสอบ";
    const finishedText = stateObj.finishedUsers.length > 0
        ? stateObj.finishedUsers
            .map(user => {
                const remain = state.env.COOLDOWN_DAYS * 24 * 60 * 60 * 1000 - (Date.now() - user.time);

                if (remain <= 0)
                    return `<@${user.userId}>`;

                return `<@${user.userId}> (รอ ${formatRemaining(remain)})`;
            })
            .join("\n")
        : "ยังไม่มี";

    const hasTester = stateObj.onlineTesters.size > 0;
    const embedColor = hasTester ? 0x00FF00 : 0xFF0000;

    return new EmbedBuilder()
        .setColor(embedColor)
        .setTitle(`${hasTester ? "🟢" : "🔴"} PVP${mode ? " — " + mode : ""}`)
        .addFields(
            { name: "Tester ออนไลน์ (" + stateObj.onlineTesters.size + ")", value: testerText },
            { name: "เทสเสร็จแล้ว", value: finishedText },
            { name: "กำลังทดสอบ", value: testingText },
        );
}

// ========================================
// Build Buttons
// ========================================
function buildButtons(channelId) {
    const stateObj = state.getState(channelId);

    // จองได้เมื่อมี Tester เข้าเวร และยังไม่มีคนกำลังทดสอบ
    const queueDisabled = stateObj.onlineTesters.size === 0 || stateObj.currentTesting !== null;
    const doneDisabled = stateObj.currentTesting === null;

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

module.exports = {
    clearQueueCallTimer,
    startQueueCallTimer,
    getStateByRoom,
    createTestRoom,
    updatePlayerInfoMessage,
    updateCombatRank,
    removeCombatRanks,
    buildEmbed,
    buildButtons
};