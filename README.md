# Zenith Discord Bot

Modular Discord bot for game testing queues and player verification.

## Features

- Queue system with 5-minute timeout
- Test room automation
- Player verification via Minecraft UUID
- Combat rank role management
- Modular Node.js structure

## Installation

1. Clone repo
2. `npm install`
3. Copy `.env.example` to `.env`
4. Configure `.env` values
5. Run `node src/index.js`

## Usage

Start bot: `node src/index.js`  
Verify API: `http://localhost:3000`

## Configuration

Required `.env` variables:
- `DISCORD_TOKEN`: Bot token
- `GUILD_ID`: Discord server ID
- Channel IDs for verify, results, queues, etc.
- Role names for Tester/Admin
- API credentials for ZenithTier
- Cooldown days

## Project Structure

```
src/
├── config/
│   ├── env.js        # Environment loading
│   └── constants.js  # Tier/mode options
├── core/
│   ├── state.js      # Bot state management
│   └── queue.js      # Queue/test logic
├── services/
│   ├── apiClient.js  # ZenithTier API
│   └── verifyApi.js  # Verification endpoints
└── utils/
    └── helpers.js    # UUID/formatting helpers
```

## Notes

- Zero breaking changes from original implementation
- All state persisted in `data/` JSON files
- Modular design enables maintainability
- Expected token error on startup if using placeholder token