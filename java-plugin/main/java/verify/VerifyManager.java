package verify;

import org.bukkit.entity.Player;

import java.io.BufferedReader;
import java.io.InputStreamReader;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import java.util.HashSet;
import java.util.Set;
import java.util.UUID;

public class VerifyManager {

    private final Main plugin;
    private final Set<UUID> verifiedPlayers = new HashSet<>();

    public VerifyManager(Main plugin) {
        this.plugin = plugin;
    }

    public boolean isVerified(UUID uuid) {
        return verifiedPlayers.contains(uuid);
    }

    public void verify(Player player, String code) {

        try {

            String imageUrl = "https://mc-heads.net/avatar/" + player.getName() + "/512";
            String webhook = plugin.getConfig().getString("webhook-url");

System.out.println("VERIFY URL = " + webhook + "/verify");
System.out.println("VERIFY URL = " + webhook + "/verify");
System.out.println("CODE = " + code);
System.out.println("PLAYER = " + player.getName());
System.out.println("Sending verify request...");

URL url = new URL(webhook + "/verify");
 
            HttpURLConnection con = (HttpURLConnection) url.openConnection();

            con.setRequestMethod("POST");
            con.setRequestProperty("Content-Type", "application/json");
            con.setDoOutput(true);

            String json = "{"
                    + "\"code\":\"" + code + "\","
                    + "\"gameName\":\"" + player.getName() + "\","
                    + "\"imageUrl\":\"" + imageUrl + "\""
                    + "}";

            try (OutputStream os = con.getOutputStream()) {
                os.write(json.getBytes(StandardCharsets.UTF_8));
            }

            System.out.println(json);

int response = con.getResponseCode();
System.out.println("Response Code = " + response);

BufferedReader reader = new BufferedReader(
        new InputStreamReader(
                response >= 400 ? con.getErrorStream() : con.getInputStream()
        )
);

StringBuilder result = new StringBuilder();
String line;

while ((line = reader.readLine()) != null) {
    result.append(line);
}

reader.close();

System.out.println("API Response = " + result);

if (result.toString().contains("\"success\":true")) {

    verifiedPlayers.add(player.getUniqueId());

    player.sendMessage("§aยืนยันตัวตนสำเร็จ!");

} else {

    player.sendMessage("§cยืนยันไม่สำเร็จ");
    player.sendMessage("§7API: " + result);
}

        } catch (Exception e) {

    e.printStackTrace();

    player.sendMessage("§cเชื่อมต่อ API ไม่ได้");
    player.sendMessage("§7" + e.getMessage());

}

    }
}