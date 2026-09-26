const express = require('express');
const admin = require('firebase-admin');
const axios = require('axios');
const crypto = require('crypto');
const cors = require('cors');

const app = express();
app.use(express.json());
app.use(cors());

// 1. Firebase Admin Setup (Securely from Environment Variables)
const serviceAccountString = process.env.FIREBASE_SERVICE_ACCOUNT;
if (!serviceAccountString) {
    console.error("FIREBASE_SERVICE_ACCOUNT is missing!");
} else {
    try {
        const serviceAccount = JSON.parse(serviceAccountString);
        admin.initializeApp({
            credential: admin.credential.cert(serviceAccount),
            databaseURL: "https://hrrybimd-default-rtdb.firebaseio.com/"
        });
    } catch (e) {
        console.error("Error parsing FIREBASE_SERVICE_ACCOUNT:", e);
    }
}

const db = admin.database();
const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;

// 2. HEALTH CHECK
app.get('/health', (req, res) => {
    res.json({ status: "ok" });
});

// 3. GENERATE BINDING TOKEN
app.post('/api/bind/start', async (req, res) => {
    try {
        const token = crypto.randomBytes(6).toString('hex').toUpperCase(); // Example: A1B2C3D4E5F6
        const expiresAt = Date.now() + (5 * 60 * 1000); // 5 Minutes

        await db.ref(`binding_tokens/${token}`).set({
            status: 'pending',
            createdAt: Date.now(),
            expiresAt: expiresAt
        });

        res.json({
            success: true,
            token: token,
            telegramUrl: `https://t.me/studymodshrry_bot?start=${token}`
        });
    } catch (error) {
        res.status(500).json({ success: false, error: "Internal Server Error" });
    }
});

// 4. CHECK STATUS API (For Android App)
app.post('/api/bind/status', async (req, res) => {
    const { token } = req.body;
    if (!token) return res.status(400).json({ success: false, error: "Token missing" });

    try {
        const snapshot = await db.ref(`binding_tokens/${token}`).once('value');
        if (!snapshot.exists()) {
            return res.json({ success: false, status: "not_found" });
        }

        const data = snapshot.val();
        if (data.status === 'completed') {
            // Delete token after successful read for security
            await db.ref(`binding_tokens/${token}`).remove();
            return res.json({ success: true, status: "completed", telegramData: data.telegramData });
        } else if (Date.now() > data.expiresAt) {
            await db.ref(`binding_tokens/${token}`).remove();
            return res.json({ success: false, status: "expired" });
        }

        res.json({ success: true, status: "pending" });
    } catch (error) {
        res.status(500).json({ success: false, error: "Server Error" });
    }
});

// 5. UNBIND API
app.post('/api/bind/unbind', async (req, res) => {
    const { telegramId } = req.body;
    if (!telegramId) return res.status(400).json({ success: false });

    await db.ref(`telegram_bindings/${telegramId}`).remove();
    res.json({ success: true });
});

// 6. TELEGRAM WEBHOOK (Receives messages from Telegram)
app.post('/telegram/webhook', async (req, res) => {
    const update = req.body;
    
    if (update.message && update.message.text && update.message.text.startsWith('/start ')) {
        const token = update.message.text.split(' ')[1];
        const user = update.message.from;
        
        const tokenRef = db.ref(`binding_tokens/${token}`);
        const snapshot = await tokenRef.once('value');
        
        if (snapshot.exists() && snapshot.val().status === 'pending' && snapshot.val().expiresAt > Date.now()) {
            
            // 🌟 NAYA CODE: Profile Picture Fetch Karne Ke Liye
            let finalPhotoUrl = "";
            try {
                // User ki profile photos fetch karo
                const photoResponse = await axios.get(`https://api.telegram.org/bot${BOT_TOKEN}/getUserProfilePhotos?user_id=${user.id}&limit=1`);
                
                if (photoResponse.data.ok && photoResponse.data.result.total_count > 0) {
                    // Sabse acchi quality wali photo ki ID nikalo
                    const photoArray = photoResponse.data.result.photos[0];
                    const fileId = photoArray[photoArray.length - 1].file_id;
                    
                    // Photo ID se uska File Path nikalo
                    const fileResponse = await axios.get(`https://api.telegram.org/bot${BOT_TOKEN}/getFile?file_id=${fileId}`);
                    
                    if (fileResponse.data.ok) {
                        const filePath = fileResponse.data.result.file_path;
                        // Final URL ban gaya jo app me dikhega
                        finalPhotoUrl = `https://api.telegram.org/file/bot${BOT_TOKEN}/${filePath}`;
                    }
                }
            } catch (err) {
                console.error("Photo fetch error:", err.message);
                // Agar photo hide ki hui hai ya koi error aaye, to khali rakho, app apna letter avatar dikha degi
            }

            const telegramData = {
                telegramId: user.id,
                firstName: user.first_name || '',
                username: user.username || 'No Username',
                photoUrl: finalPhotoUrl, // 👈 Yahan URL save ho jayega
                connectedAt: Date.now()
            };

            // Update Token status
            await tokenRef.update({
                status: 'completed',
                telegramData: telegramData
            });

            // Save to permanent bindings
            await db.ref(`telegram_bindings/${user.id}`).set(telegramData);

            // Send Success Message to User in Telegram
            await axios.post(`https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`, {
                chat_id: user.id,
                text: `✅ Authentication Successful!\n\nWelcome ${user.first_name}. Your Telegram account has been linked to the app. You can now return to the app.`
            });
        } else {
            // Token expired or invalid
            await axios.post(`https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`, {
                chat_id: user.id,
                text: `❌ Invalid or Expired Token. Please generate a new one from the App.`
            });
        }
    }
    
    // Always return 200 OK to Telegram
    res.sendStatus(200);
});

// Start Server
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`Server is running on port ${PORT}`);
});

