module.exports = {
  TIER_OPTIONS: ["HT1", "LT1", "HT2", "LT2", "HT3", "LT3", "HT4", "LT4", "HT5", "LT5"],
  MODE_OPTIONS: ["CPVP", "SPVP", "MACEPVP", "AXEPVP", "UHC", "MACEROCKET", "SMP", "DIAPOT", "NETHPOT"],
  TIER_POINTS: {
    HT1: 10,
    LT1: 9,
    HT2: 8,
    LT2: 7,
    HT3: 6,
    LT3: 5,
    HT4: 4,
    LT4: 3,
    HT5: 2,
    LT5: 1
  },
  RANK_ROLES: [
    { name: "Combat Grandmaster", minPoints: 400 },
    { name: "Combat Master", minPoints: 250 },
    { name: "Combat Ace", minPoints: 150 },
    { name: "Combat Specialist", minPoints: 60 },
    { name: "Combat Cadet", minPoints: 20 },
    { name: "Combat Rookie", minPoints: 0 }
  ],
  QUEUE_CALL_TIMEOUT_MS: 5 * 60 * 1000 // 5 minutes
};