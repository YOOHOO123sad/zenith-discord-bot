// apiClient.js — Adapted from ZenithTierAPI_BOT/helpers.js for zenith-discord-bot
// Handles API communication with ZenithTier backend

const { AsyncLocalStorage } = require('async_hooks');
const { createHmac, randomUUID } = require('crypto');

let cachedToken = null;
let cachedRefreshToken = null;
let tokenExpiry = 0; // seconds

// H5 (security audit) — bot-mediated admin calls carry the originating
// Discord interaction id so the API can attribute them in its audit log.
// Using AsyncLocalStorage to safely propagate the interaction ID across
// async boundaries without race conditions between concurrent invocations.
const interactionContext = new AsyncLocalStorage();

// HMAC secret for signing interaction IDs.
// Must be set via INTERACTION_HMAC_SECRET or DISCORD_TOKEN environment variable.
// No fallback — running without a secret allows signature forgery.
function getInteractionHmacSecret() {
  const secret = process.env.INTERACTION_HMAC_SECRET || process.env.DISCORD_TOKEN;
  if (!secret) {
    throw new Error('INTERACTION_HMAC_SECRET or DISCORD_TOKEN must be set for HMAC signing');
  }
  return secret;
}

function signInteractionId(interactionId) {
  const secret = getInteractionHmacSecret();
  const hmac = createHmac('sha256', secret);
  hmac.update(String(interactionId));
  return hmac.digest('hex');
}

function setCurrentDiscordInteractionId(id) {
  const store = interactionContext.getStore();
  if (store) {
    store.interactionId = id == null ? null : String(id);
  }
}

function interactionHeaders() {
  const store = interactionContext.getStore();
  if (!store || !store.interactionId) {
    // Suppressed warning log here: cron jobs (like postStats) run outside
    // interaction contexts intentionally, so returning empty headers is normal.
    return {};
  }

  const interactionId = store.interactionId;
  const signature = signInteractionId(interactionId);

  return {
    'X-Discord-Interaction-Id': interactionId,
    'X-Discord-Interaction-Signature': signature
  };
}

const VERSIONED = '/api/v1';
const LEGACY = '/api';

function apiBase() {
  const raw = process.env.API_BASE_URL || '';
  return raw.replace(/\/+$/, '');
}

function pathV1(p) {
  return `${apiBase()}${VERSIONED}${p}`;
}

function pathLegacy(p) {
  return `${apiBase()}${LEGACY}${p}`;
}

/**
 * Fetch with one automatic fallback to the legacy un-versioned prefix when
 * the versioned call returns 404. Network errors are caught and propagated.
 */
async function fetchWithFallback(method, p, init = {}) {
  // Note: This assumes Node.js 18+ with built-in fetch
  // If using older Node.js, you'd need to install node-fetch and use it instead
  const headers = {
    ...(init.headers || {}),
    ...interactionHeaders()
  };

  const initWithHeaders = {
    ...init,
    headers
  };

  let resp;

  try {
    resp = await fetch(pathV1(p), {
      method,
      ...initWithHeaders
    });
  } catch (e) {
    // Network error on v1 path.
    // Try legacy path once before giving up.
    try {
      resp = await fetch(pathLegacy(p), {
        method,
        ...initWithHeaders
      });
    } catch (legacyErr) {
      throw new Error(
        `Network error on both v1 and legacy endpoints: ${e.message} | ${legacyErr.message}`
      );
    }

    return resp;
  }

  if (resp.status === 404) {
    try {
      const retry = await fetch(pathLegacy(p), {
        method,
        ...initWithHeaders
      });

      if (retry.ok || retry.status !== 404) {
        return retry;
      }
    } catch (e) {
      throw new Error(
        `v1 returned 404, legacy fallback network error: ${e.message}`
      );
    }
  }

  return resp;
}

/**
 * Trade versioned admin token contract with refresh token support.
 */
async function getApiToken() {
  const now = Math.floor(Date.now() / 1000);

  if (cachedToken && now < tokenExpiry - 30) {
    return cachedToken;
  }

  // Try refresh token first if available.
  if (cachedRefreshToken) {
    try {
      const refreshInit = {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          refresh_token: cachedRefreshToken
        })
      };

      let refreshResp = await fetch(
        pathV1('/admin/token/refresh'),
        refreshInit
      );

      if (refreshResp.status === 404) {
        refreshResp = await fetch(
          pathLegacy('/admin/token/refresh'),
          refreshInit
        );
      }

      if (refreshResp.ok) {
        const data = await refreshResp.json();

        cachedToken = data.access_token;
        cachedRefreshToken = data.refresh_token;

        const minutes =
          Number(process.env.ACCESS_TOKEN_EXPIRE_MINUTES) || 60;

        tokenExpiry =
          now + (data.expires_in || minutes * 60);

        return cachedToken;
      }
    } catch (e) {
      console.debug(
        '[getApiToken] Refresh token failed, falling back to password grant:',
        e.message
      );
    }
  }

  // Fallback: password grant.
  const init = {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded'
    },
    body: new URLSearchParams({
      username: process.env.ADMIN_USERNAME,
      password: process.env.ADMIN_PASSWORD
    })
  };

  let resp = await fetch(pathV1('/admin/token'), init);

  if (resp.status === 404) {
    resp = await fetch(pathLegacy('/admin/token'), init);
  }

  if (!resp.ok) {
    const txt = await resp.text();
    throw new Error(
      `Failed to obtain API token: ${resp.status} ${txt}`
    );
  }

  const data = await resp.json();

  cachedToken = data.access_token;
  cachedRefreshToken = data.refresh_token;

  const minutes =
    Number(process.env.ACCESS_TOKEN_EXPIRE_MINUTES) || 60;

  tokenExpiry =
    now + (data.expires_in || minutes * 60);

  return cachedToken;
}

/**
 * Get or create a player by Discord ID.
 * Ensures profile_url is set on the player record using
 * the atomic avatar-default endpoint when appropriate.
 */
async function getOrCreatePlayer(token, discordUser) {
  if (!discordUser) {
    return null;
  }

  const discordId = discordUser.id;
  const username = discordUser.username;

  // 1) lookup
  let lookupResp;

  try {
    lookupResp = await fetchWithFallback(
      'GET',
      `/admin/players/discord/${encodeURIComponent(discordId)}`,
      {
        headers: {
          Authorization: `Bearer ${token}`
        }
      }
    );
  } catch (e) {
    throw new Error(
      `Network error looking up player by discord_id: ${e.message}`
    );
  }

  if (lookupResp.ok) {
    const player = await lookupResp.json();

    if (!player.profile_url) {
      const avatarUrl = discordUser.displayAvatarURL({
        extension: 'png',
        size: 256,
        forceStatic: true
      });

      try {
        const updated = await setAvatarIfNull(
          token,
          player.id,
          avatarUrl
        );

        player.profile_url = updated.profile_url;
      } catch (e) {
        console.warn(
          `[getOrCreatePlayer] avatar-default failed for ${discordId}:`,
          e.message
        );
      }
    }

    if (player.username !== username) {
      const u = await fetchWithFallback(
        'PATCH',
        `/admin/players/${player.id}`,
        {
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${token}`
          },
          body: JSON.stringify({
            username
          })
        }
      );

      if (!u.ok) {
        console.warn(
          `[getOrCreatePlayer] username sync: ${u.status}`
        );
      }
    }

    return player;
  }

  // 2) create
  const uuid = randomUUID();

  const avatarUrl = discordUser.displayAvatarURL({
    extension: 'png',
    size: 256,
    forceStatic: true
  });

  const create = await fetchWithFallback(
    'POST',
    '/admin/players',
    {
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`
      },
      body: JSON.stringify({
        discord_id: discordId,
        username,
        uuid,
        profile_url: avatarUrl
      })
    }
  );

  if (!create.ok) {
    const txt = await create.text();

    if (
      create.status === 400 &&
      /already exists|with this discord_id/.test(txt)
    ) {
      const retry = await fetchWithFallback(
        'GET',
        `/admin/players/discord/${encodeURIComponent(discordId)}`,
        {
          headers: {
            Authorization: `Bearer ${token}`
          }
        }
      );

      if (retry.ok) {
        return retry.json();
      }
    }

    throw new Error(
      `Failed to create player: ${create.status} ${txt}`
    );
  }

  return create.json();
}

async function setAvatarIfNull(token, playerId, avatarUrl) {
  const resp = await fetchWithFallback(
    'PATCH',
    `/admin/players/${playerId}/avatar-default`,
    {
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`
      },
      body: JSON.stringify({
        avatar_url: avatarUrl
      })
    }
  );

  if (!resp.ok) {
    const txt = await resp.text();
    throw new Error(
      `Failed to set avatar if null: ${resp.status} ${txt}`
    );
  }

  return resp.json();
}

/**
 * Create a match via POST /api/v1/matches/
 * @param {string} token - JWT admin token
 * @param {Object} matchData - Match data matching MatchCreate schema
 * @returns {Promise<Object>} Parsed API response
 */
async function createMatch(token, matchData) {
  const resp = await fetchWithFallback(
    'POST',
    '/matches/',
    {
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`
      },
      body: JSON.stringify(matchData)
    }
  );

  if (!resp.ok) {
    const txt = await resp.text();
    throw new Error(
      `Failed to create match: ${resp.status} ${txt}`
    );
  }

  return resp.json();
}

module.exports = {
  getApiToken,
  getOrCreatePlayer,
  setAvatarIfNull,
  createMatch,
  setCurrentDiscordInteractionId,
  interactionHeaders,
  interactionContext,
  fetchWithFallback
};