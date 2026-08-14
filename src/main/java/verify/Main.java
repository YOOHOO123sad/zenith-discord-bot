package verify;

import org.bukkit.plugin.java.JavaPlugin;

public class Main extends JavaPlugin {

    private VerifyManager verifyManager;

    @Override
    public void onEnable() {

        saveDefaultConfig();

        getLogger().info("Config folder = " + getDataFolder().getAbsolutePath());
        getLogger().info("Webhook = " + getConfig().getString("webhook-url"));

        verifyManager = new VerifyManager(this);

        getCommand("verify").setExecutor(new VerifyCommand(this));

        getLogger().info("Verify Plugin Enabled");
    }

    public VerifyManager getVerifyManager() {
        return verifyManager;
    }
}