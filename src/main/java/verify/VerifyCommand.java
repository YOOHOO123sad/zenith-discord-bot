package verify;
import org.bukkit.command.Command;
import org.bukkit.command.CommandExecutor;
import org.bukkit.command.CommandSender;
import org.bukkit.entity.Player;
public class VerifyCommand implements CommandExecutor {

    private final Main plugin;

    public VerifyCommand(Main plugin) {
        this.plugin = plugin;
    }

    @Override
    public boolean onCommand(CommandSender sender, Command command, String label, String[] args) {

        if (!(sender instanceof Player player)) {
            sender.sendMessage("ใช้ได้เฉพาะผู้เล่นเท่านั้น");
            return true;
        }

        if (args.length != 1) {
            player.sendMessage("§cใช้: /verify <code>");
            return true;
        }
player.sendMessage("§aVerifyCommand ทำงานแล้ว");
        String code = args[0].trim();

        if (plugin.getVerifyManager().isVerified(player.getUniqueId())) {
            player.sendMessage("§aคุณยืนยันตัวตนแล้ว");
            return true;
        }

        player.sendMessage("§eกำลังตรวจสอบโค้ด...");

        plugin.getVerifyManager().verify(player, code);

        return true;
    }
}