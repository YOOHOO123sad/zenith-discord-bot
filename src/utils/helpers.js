/**
 * Format remaining cooldown time
 * @param {number} ms - milliseconds remaining
 * @returns {string} formatted time string
 */
function formatRemaining(ms) {
    const totalMinutes = Math.ceil(ms / 60000);
    const days = Math.floor(totalMinutes / 1440);
    const hours = Math.floor((totalMinutes % 1440) / 60);
    const minutes = totalMinutes % 60;
    return days + " วัน " + hours + " ชั่วโมง " + minutes + " นาที";
}

/**
 * Normalize Minecraft UUID to canonical format
 * @param {string|null} uuid - UUID to normalize
 * @returns {string|null} normalized UUID or null if invalid
 */
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

/**
 * Fetch Minecraft UUID from Mojang API
 * @param {string} username - Minecraft username
 * @returns {Promise<string|null>} UUID or null if not found/invalid
 */
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

module.exports = {
    formatRemaining,
    normalizeMinecraftUUID,
    fetchMinecraftUUID
};