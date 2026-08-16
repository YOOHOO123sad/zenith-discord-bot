// Modular entry point for zenith-discord-bot
// All functionality is split into modules for better organization

require("dotenv").config();

// Discord.js imports
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
  MessageFlags,
  SlashCommandBuilder,
  REST,
  Routes
} = require("discord.js");

// Core modules
const state = require("./core/state");
const queue = require("./core/queue");
const helpers = require("./utils/helpers");
const env = require("./config/env");
const constants = require("./config/constants");
const apiClient = require("./services/apiClient");
const verifyApi = require("./services/verifyApi");

// Constants from modules
const {
  TIER_OPTIONS,
  MODE_OPTIONS,
  TIER_POINTS,
  RANK_ROLES,
  QUEUE_CALL_TIMEOUT_MS
} = constants;

// Initialize Discord client
const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMembers,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent
  ]
});

// Set environment in state for access in other modules
state.env = env;

// Load all state data on startup
function loadAllState() {
  console.log("Loading all state data...");
  state.loadTesterStats();
  state.loadVerifiedUsers();
  state.loadChannelModes();
  state.loadCooldowns();
  state.loadPlayerMessages();
  state.loadFinishedUsers();
  state.loadMainMessages();
  console.log("All state data loaded.");
}

// Interaction handler
client.on("interactionCreate", async (interaction) => {
  // Handle buttons
  if (interaction.isButton()) {
    await handleButtonInteraction(interaction);
    return;
  }

  // Handle modal submits
  if (interaction.isModalSubmit()) {
    await handleModalSubmit(interaction);
    return;
  }

  // Handle chat input commands (/confirm, /unconfirm)
  if (interaction.isChatInputCommand()) {
    await handleChatInputCommand(interaction);
    return;
  }
});

// Message handler (for !setup commands)
client.on("messageCreate", async (message) => {
  if (message.author.bot) return;

  if (message.content === "!setupverify") {
    await handleSetupVerify(message);
    return;
  }

  if (message.content.startsWith("!setup") && !message.content.startsWith("!setupverify")) {
    await handleSetupMode(message);
    return;
  }

  if (message.content.startsWith("!resetcooldown")) {
    await handleResetCooldown(message);
    return;
  }
});

// Error handling
process.on("uncaughtException", (err) => {
  console.error("Uncaught Exception:", err);
});

// Bot lifecycle events
client.once("clientReady", async () => {
  console.log("บอทออนไลน์แล้ว!");

  // Load all state data
  loadAllState();

  // Register slash commands
  await registerCommands();

  // Set up global onVerified handler
  setupOnVerifiedHandler();

  // Get guild for later use
  const guild = await client.guilds.fetch(env.GUILD_ID);
  console.log("Guild fetched:", guild.name);
});

// Graceful shutdown
async function shutdownBot() {
  console.log("===== BOT SHUTDOWN =====");

  try {
    // Notify testers going off duty
    for (const [queueChannelId, stateObj] of state.channelStates.entries()) {
      if (stateObj.onlineTesters.size > 0) {
        const testerIds = Array.from(stateObj.onlineTesters);
        for (const testerId of testerIds) {
          const testerData = state.verifiedUsers.get(testerId);
          const minecraftName = testerData?.gameName || "ไม่ทราบชื่อ";
          const mode = state.channelModes.get(queueChannelId) || "ไม่ระบุ";
          const notifyChannel = client.channels.cache.get(env.TESTER_DUTY_NOTIFY_CHANNEL_ID);

          if (notifyChannel) {
            const dutyEmbed = new EmbedBuilder()
              .setColor(0xe74c3c)
              .setTitle("🔴 Tester ออกเวร")
              .setDescription(`<@${testerId}> ออกจากเวรแล้ว เนื่องจากบอทกำลังปิด`)
              .addFields(
                { name: "Tester", value: `<@${testerId}>`, inline: true },
                { name: "Minecraft", value: minecraftName, inline: true },
                { name: "โหมด", value: `**${mode}**`, inline: true },
                { name: "ห้อง", value: `<#${queueChannelId}>`, inline: true },
                { name: "สถานะ", value: "🔴 ไม่อยู่ในเวร", inline: true }
              )
              .setTimestamp()
              .setFooter({ text: "Zenith Community • Tester Duty" });

            if (minecraftName !== "ไม่ทราบชื่อ") {
              dutyEmbed.setThumbnail(`https://minotar.net/helm/${encodeURIComponent(minecraftName)}/128.png`);
            }

            await notifyChannel.send({
              content: `<@${testerId}>`,
              embeds: [dutyEmbed]
            }).catch(console.error);
          }
        }

        // Clear online testers
        stateObj.onlineTesters.clear();
      }

      // Update queue embeds
      if (stateObj.mainMessageId) {
        const queueChannel = client.channels.cache.get(queueChannelId);
        if (queueChannel) {
          const mainMessage = await queueChannel.messages.fetch(stateObj.mainMessageId).catch(() => null);
          if (mainMessage) {
            await mainMessage.edit({
              embeds: [queue.buildEmbed(queueChannelId)],
              components: [queue.buildButtons(queueChannelId)]
            }).catch(console.error);
          }
        }
      }
    }

    console.log("Tester ถูกนำออกจากเวรทั้งหมดแล้ว");
    console.log("ผู้เล่นในคิวยังคงอยู่ใน Queue");
  } catch (err) {
    console.error("===== SHUTDOWN ERROR =====");
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

// Login to Discord
client.login(env.DISCORD_TOKEN);

// Helper functions
async function handleButtonInteraction(interaction) {
  try {
    const member = interaction.member;

    // Verify identity button
    if (interaction.customId === "verify_identity") {
      await handleVerifyIdentity(interaction);
      return;
    }

    // Join queue button
    if (interaction.customId === "join_queue") {
      await queue.handleJoinQueue(interaction);
      return;
    }

    // Cancel queue button
    if (interaction.customId === "cancel_queue") {
      await queue.handleCancelQueue(interaction);
      return;
    }

    // Toggle duty button
    if (interaction.customId === "toggle_duty") {
      await queue.handleToggleDuty(interaction);
      return;
    }

    // Finish testing button
    if (interaction.customId === "finish_testing") {
      await queue.handleFinishTesting(interaction);
      return;
    }

    // Call next button (tester only)
    if (interaction.customId === "call_next") {
      await queue.handleCallNext(interaction);
      return;
    }

    // Give tier button
    if (interaction.customId === "give_tier") {
      await queue.handleGiveTier(interaction);
      return;
    }

    // Tier winner selection
    if (interaction.customId === "tier_winner_applicant" ||
        interaction.customId === "tier_winner_tester") {
      await queue.handleTierWinnerSelection(interaction);
      return;
    }

    // Verify accept/reject buttons
    if (interaction.customId.startsWith("verify_accept_") ||
        interaction.customId.startsWith("verify_reject_")) {
      await queue.handleVerifyResponse(interaction);
      return;
    }
  } catch (err) {
    console.error("Button interaction error:", err);
    if (!interaction.replied && !interaction.deferred) {
      await interaction.reply({ content: "เกิดข้อผิดพลาด", flags: MessageFlags.Ephemeral });
    } else if (interaction.deferred && !interaction.replied) {
      await interaction.editReply({ content: "เกิดข้อผิดพลาด" });
    } else {
      await interaction.followUp({ content: "เกิดข้อผิดพลาด", flags: MessageFlags.Ephemeral });
    }
  }
}

async function handleModalSubmit(interaction) {
  try {
    // Verify modal
    if (interaction.customId === "verify_modal") {
      await queue.handleVerifyModal(interaction);
      return;
    }

    // Tier score modal
    if (interaction.customId === "tier_score_modal") {
      await queue.handleTierScoreModal(interaction);
      return;
    }
  } catch (err) {
    console.error("Modal submit error:", err);
    if (!interaction.replied && !interaction.deferred) {
      await interaction.reply({ content: "เกิดข้อผิดพลาด", flags: MessageFlags.Ephemeral });
    } else if (interaction.deferred && !interaction.replied) {
      await interaction.editReply({ content: "เกิดข้อผิดพลาด" });
    } else {
      await interaction.followUp({ content: "เกิดข้อผิดพลาด", flags: MessageFlags.Ephemeral });
    }
  }
}

async function handleChatInputCommand(interaction) {
  try {
    if (interaction.commandName === "confirm") {
      await queue.handleConfirmCommand(interaction);
      return;
    }

    if (interaction.commandName === "unconfirm") {
      await queue.handleUnconfirmCommand(interaction);
      return;
    }
  } catch (err) {
    console.error("Command error:", err);
    if (!interaction.replied && !interaction.deferred) {
      await interaction.reply({ content: "เกิดข้อผิดพลาด", flags: MessageFlags.Ephemeral });
    } else if (interaction.deferred && !interaction.replied) {
      await interaction.editReply({ content: "เกิดข้อผิดพลาด" });
    } else {
      await interaction.followUp({ content: "เกิดข้อผิดพลาด", flags: MessageFlags.Ephemeral });
    }
  }
}

async function handleSetupVerify(message) {
  try {
    const isAdmin = message.member.permissions.has(PermissionsBitField.Flags.Administrator) ||
                   message.member.roles.cache.some(role => role.name === env.ADMIN_ROLE_NAME);

    if (!isAdmin) {
      await message.reply("คุณไม่มีสิทธิ์ใช้คำสั่งนี้");
      return;
    }

    await message.channel.send({
      embeds: [verifyApi.buildVerifyEmbed()],
      components: [verifyApi.buildVerifyButton()]
    });
  } catch (err) {
    console.error("Setup verify error:", err);
    await message.reply("เกิดข้อผิดพลาดในการตั้งค่าการยืนยันตัวตน");
  }
}

async function handleSetupMode(message) {
  try {
    const isAdmin = message.member.permissions.has(PermissionsBitField.Flags.Administrator) ||
                   message.member.roles.cache.some(role => role.name === env.ADMIN_ROLE_NAME);

    if (!isAdmin) {
      await message.reply("คุณไม่มีสิทธิ์ใช้คำสั่งนี้");
      return;
    }

    const parts = message.content.trim().split(/\s+/);
    if (parts.length > 1) {
      const mode = parts[1].toUpperCase();
      if (MODE_OPTIONS.includes(mode)) {
        state.channelModes.set(message.channelId, mode);
        state.saveChannelModes();

        const stateObj = state.getState(message.channelId);
        const msg = await message.channel.send({
          embeds: [queue.buildEmbed(message.channelId)],
          components: [queue.buildButtons(message.channelId)]
        });

        stateObj.mainMessageId = msg.id;
        state.saveMainMessages();

        console.log("ส่ง Embed แล้ว");
        return;
      }
    }

    await message.reply("กรุณาระบุโหมดที่ถูกต้อง (เช่น: !setup CPVP)");
  } catch (err) {
    console.error("Setup mode error:", err);
    await message.reply("เกิดข้อผิดพลาดในการตั้งค่าโหมด");
  }
}

async function handleResetCooldown(message) {
  try {
    await message.delete().catch(() => {});

    const member = message.member;
    const isTester = member.roles.cache.some(role => role.name === env.TESTER_ROLE_NAME);
    const isAdmin = member.roles.cache.some(role => role.name === env.ADMIN_ROLE_NAME) ||
                   member.permissions.has(PermissionsBitField.Flags.Administrator);

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

    const mode = state.channelModes.get(message.channelId);
    if (!mode) {
      await message.author.send("ห้องนี้ยังไม่ได้ตั้งโหมด PVP").catch(() => {});
      return;
    }

    const cooldownKey = `${mentioned.id}:${mode}`;
    const existed = state.testCooldowns.has(cooldownKey);

    state.testCooldowns.delete(cooldownKey);
    state.saveCooldowns();

    // Remove from finished users
    const stateObj = state.getState(message.channelId);
    stateObj.finishedUsers = stateObj.finishedUsers.filter(u => u.userId !== mentioned.id);
    const finishedKey = `${message.channelId}:${mentioned.id}`;
    state.finishedUsersData.delete(finishedKey);
    state.saveFinishedUsers();

    // Update embed
    if (stateObj.mainMessageId) {
      const channel = message.guild.channels.cache.get(message.channelId);
      if (channel) {
        const msg = await channel.messages.fetch(stateObj.mainMessageId).catch(() => null);
        if (msg && typeof msg.edit === "function") {
          await msg.edit({
            embeds: [queue.buildEmbed(message.channelId)],
            components: [queue.buildButtons(message.channelId)]
          });
        }
      }
    }

    // Notify user
    if (existed) {
      await message.author.send(
        `ยกเลิก Cooldown ของ **${mentioned.username}** สำหรับโหมด **${mode}** เรียบร้อยแล้ว`
      ).catch(() => {});
    } else {
      await message.author.send(
        `ℹ️ **${mentioned.username}** ไม่มี Cooldown ของโหมด **${mode}**`
      ).catch(() => {});
    }

    console.log(`${message.author.tag} reset cooldown ของ ${mentioned.tag} (${mode})`);
  } catch (err) {
    console.error("Reset cooldown error:", err);
    await message.author.send("เกิดข้อผิดพลาดในการยกเลิก Cooldown").catch(() => {});
  }
}

async function registerCommands() {
  try {
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
  } catch (err) {
    console.error("Command registration error:", err);
  }
}

function setupOnVerifiedHandler() {
  global.onVerified = async (discordId, gameName, imageUrl, tester, uuid) => {
    try {
      console.log("===== ON VERIFIED =====");
      console.log("Discord ID:", discordId);
      console.log("Minecraft:", gameName);
      console.log("Tester:", tester);

      const guild = await client.guilds.fetch(env.GUILD_ID);
      const member = await guild.members.fetch(discordId).catch(() => null);

      if (member) {
        await member.setNickname(gameName).catch(err => {
          console.error("เปลี่ยนชื่อ Discord ไม่สำเร็จ:", err);
        });
      }

      const oldData = state.verifiedUsers.get(discordId);

      // Choose channel based on tester status
      const channelId = tester === true ? env.TESTER_INFO_CHANNEL_ID : env.PLAYER_INFO_CHANNEL_ID;
      console.log("ส่งข้อมูลไป Channel ID:", channelId);

      // Delete old message if exists
      const oldMessageId = state.playerMessages.get(discordId);
      if (oldMessageId) {
        const oldChannelId = oldData?.tester === true ? env.TESTER_INFO_CHANNEL_ID : env.PLAYER_INFO_CHANNEL_ID;
        const oldChannel = await guild.channels.fetch(oldChannelId).catch(() => null);
        if (oldChannel) {
          const oldMessage = await oldChannel.messages.fetch(oldMessageId).catch(() => null);
          if (oldMessage) {
            await oldMessage.delete().catch(() => {});
          }
        }
      }

      // Save player data
      const playerData = {
        gameName: gameName,
        imageUrl: imageUrl || oldData?.imageUrl || "",
        uuid: uuid,
        tier: oldData?.tier || "-",
        points: oldData?.points || "0",
        tester: tester === true,
        confirmed: true
      };

      state.verifiedUsers.set(discordId, playerData);
      state.saveVerifiedUsers();

      // Remove old combat ranks
      await queue.removeCombatRanks(discordId);

      // Add new combat rank
      await queue.updateCombatRank(discordId);

      // Find channel and send embed
      const channel = await guild.channels.fetch(channelId).catch(err => {
        console.error("ไม่สามารถหาห้องได้:", err);
        return null;
      });

      if (!channel || !channel.isTextBased()) {
        console.log("ไม่พบห้องข้อมูล");
        return;
      }

      const embed = new EmbedBuilder()
        .setColor(tester === true ? 0x9b59b6 : 0x3498db)
        .setTitle(tester === true ? "ข้อมูล Tester" : "ข้อมูลผู้เล่น")
        .setDescription(tester === true ? "ข้อมูล Tester ที่ยืนยันตัวตนแล้ว" : "ข้อมูลผู้เล่นที่ยืนยันตัวตนแล้ว")
        .setThumbnail(`https://minotar.net/helm/${encodeURIComponent(gameName)}/128.png`)
        .addFields(
          { name: "Discord", value: `<@${discordId}>`, inline: true },
          { name: "Minecraft", value: gameName, inline: true },
          { name: "Tier", value: playerData.tier, inline: true },
          { name: "Points", value: String(playerData.points), inline: true }
        )
        .setImage(`https://starlightskins.lunareclipse.studio/render/default/${encodeURIComponent(gameName)}/full`)
        .setTimestamp()
        .setFooter({ text: "Zenith Community" });

      const msg = await channel.send({ embeds: [embed] });
      state.playerMessages.set(discordId, msg.id);
      state.savePlayerMessages();

      console.log("ส่งข้อมูลสำเร็จ");
    } catch (error) {
      console.error("onVerified error:", error);
    }
  };
}

// Export for testing if needed
module.exports = {
  client,
  state,
  queue,
  loadAllState
};