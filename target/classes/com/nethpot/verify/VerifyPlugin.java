package com.nethpot.verify;

import com.google.gson.JsonObject;
import org.bukkit.ChatColor;
import org.bukkit.command.Command;
import org.bukkit.command.CommandExecutor;
import org.bukkit.command.CommandSender;
import org.bukkit.entity.Player;
import org.bukkit.plugin.java.JavaPlugin;

import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.time.Duration;

public class VerifyPlugin extends JavaPlugin implements CommandExecutor {

    private String webhookUrl;
    private String secretKey;

    private final HttpClient httpClient = HttpClient.newBuilder()
            .connectTimeout(Duration.ofSeconds(5))
            .build();

    @Override
    public void onEnable() {
        saveDefaultConfig();
        webhookUrl = getConfig().getString("webhook-url");
        secretKey = getConfig().getString("secret-key");

        if (webhookUrl == null || webhookUrl.isBlank() || webhookUrl.contains("your-bot-domain")) {
            getLogger().warning("!! ยังไม่ได้ตั้งค่า webhook-url ใน config.yml ให้ถูกต้อง !!");
        }

        var cmd = getCommand("verify");
        if (cmd != null) {
            cmd.setExecutor(this);
        } else {
            getLogger().severe("ไม่พบคำสั่ง 'verify' ใน plugin.yml");
        }

        getLogger().info("NethpotVerify เปิดใช้งานแล้ว");
    }

    @Override
    public boolean onCommand(CommandSender sender, Command command, String label, String[] args) {
        if (!(sender instanceof Player player)) {
            sender.sendMessage("คำสั่งนี้ใช้ได้เฉพาะในเกมเท่านั้น");
            return true;
        }

        if (args.length != 1) {
            player.sendMessage(ChatColor.RED + "วิธีใช้: /verify <code>");
            return true;
        }

        String code = args[0];
        String uuid = player.getUniqueId().toString();
        String username = player.getName();

        player.sendMessage(ChatColor.YELLOW + "กำลังยืนยันตัวตน...");

        // ทำงานแบบ async กันเซิร์ฟเวอร์กระตุก
        getServer().getScheduler().runTaskAsynchronously(this,
                () -> sendVerifyRequest(player, code, uuid, username));

        return true;
    }

    private void sendVerifyRequest(Player player, String code, String uuid, String username) {
        try {
            JsonObject body = new JsonObject();
            body.addProperty("code", code);
            body.addProperty("uuid", uuid);
            body.addProperty("username", username);

            HttpRequest request = HttpRequest.newBuilder()
                    .uri(URI.create(webhookUrl + "/verify"))
                    .header("Content-Type", "application/json")
                    .header("Authorization", "Bearer " + secretKey)
                    .POST(HttpRequest.BodyPublishers.ofString(body.toString()))
                    .timeout(Duration.ofSeconds(10))
                    .build();

            HttpResponse<String> response = httpClient.send(request, HttpResponse.BodyHandlers.ofString());
            int status = response.statusCode();

            getServer().getScheduler().runTask(this, () -> {
                if (status == 200) {
                    player.sendMessage(ChatColor.GREEN + "ยืนยันตัวตนสำเร็จ! กลับไปเช็คที่ Discord ได้เลย");
                } else if (status == 404) {
                    player.sendMessage(ChatColor.RED + "โค้ดไม่ถูกต้องหรือหมดอายุแล้ว ลองขอโค้ดใหม่จาก Discord (พิมพ์ !verify)");
                } else if (status == 401) {
                    player.sendMessage(ChatColor.RED + "เซิร์ฟเวอร์นี้ไม่มีสิทธิ์ยืนยันตัวตน (secret key ไม่ตรง) แจ้งแอดมิน");
                } else {
                    player.sendMessage(ChatColor.RED + "ยืนยันตัวตนล้มเหลว (error " + status + ") ลองใหม่อีกครั้ง");
                }
            });
        } catch (Exception e) {
            getLogger().warning("Verify request failed: " + e.getMessage());
            getServer().getScheduler().runTask(this, () ->
                    player.sendMessage(ChatColor.RED + "เกิดข้อผิดพลาด ไม่สามารถเชื่อมต่อกับ Discord ได้ ลองใหม่อีกครั้ง"));
        }
    }
}
