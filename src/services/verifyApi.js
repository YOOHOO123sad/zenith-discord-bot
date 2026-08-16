const fs = require("fs");
const express = require("express");

const app = express();
app.use(express.json());

const verifyCodes = new Map();

function generateCode(userId, tester = false) {
    const fs = require("fs");
const path = require("path");

console.log("Current dir:", process.cwd());
console.log("Verified file:", path.resolve("verified.json"));

if (fs.existsSync("verified.json")) {
    const verified = JSON.parse(fs.readFileSync("verified.json", "utf8"));

    console.log("verified =", verified);
    console.log("checking id =", userId);
    console.log("found =", !!verified[userId]);

    if (verified[userId]) {
        console.log("Already verified -> return null");
        return null;
    }
}
    const code = Math.random().toString(36).substring(2, 8).toUpperCase();

    verifyCodes.set(code, {
    discordId: userId,
    tester: tester,
    created: Date.now()
});
console.log("Generated code:", code);
    return code;
}

app.post("/verify", (req, res) => {
console.log("POST /verify");
console.log(req.body);
    console.log(req.body);

    const { code, gameName, imageUrl } = req.body;

    if (!verifyCodes.has(code)) {
        return res.json({
            success: false,
            message: "Invalid code"
        });
    }

    const data = verifyCodes.get(code);
    verifyCodes.delete(code);

   const onVerified = global.onVerified;

if (typeof onVerified === "function") {

    // เช็คว่ามีการยืนยันแล้วหรือยัง
    onVerified(
    data.discordId,
    gameName,
    imageUrl,
    data.tester
);
}

    res.json({
        success: true,
        discordId: data.discordId
    });
});

app.listen(3000, () => {
    console.log("Verify API Started :3000");
});

module.exports = {
    generateCode,
    
    verifyCodes
};