
const express = require('express');
const {
  default: makeWASocket,
  useMultiFileAuthState,
  DisconnectReason,
  jidDecode
} = require("baileys-mod");
const pino = require("pino");
const { Boom } = require("@hapi/boom");
const readline = require("readline");
const app = express();
app.use(express.json());

let api = null;
let isConnected = false;

const question = (text) => {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout
  });
  return new Promise(resolve => {
    rl.question(text, answer => {
      rl.close();
      resolve(answer);
    });
  });
};

async function connectBot() {
  try {
    const { state, saveCreds } = await useMultiFileAuthState("session");
    
    api = makeWASocket({
      logger: pino({ level: "silent" }),
      printQRInTerminal: false,
      auth: state,
      browser: ['Mac OS', 'Safari', '10.15.7']
    });

    if (!state.creds?.registered) {
      
      const phoneNumber = await question('Number:\n');
      let code = await api.requestPairingCode(phoneNumber);
      code = code?.match(/.{1,4}/g)?.join("-") || code;
      console.log(`code:`, code);
    }

    api.decodeJid = (jid) => {
      if (!jid) return jid;
      if (/:\d+@/gi.test(jid)) {
        const decode = jidDecode(jid) || {};
        return (decode.user && decode.server && decode.user + "@" + decode.server) || jid;
      } else return jid;
    };

    api.ev.on('connection.update', async (update) => {
      const { connection, lastDisconnect } = update;
      if (connection === 'close') {
        const reason = new Boom(lastDisconnect?.error)?.output?.statusCode;
        if ([
          DisconnectReason.badSession,
          DisconnectReason.connectionClosed,
          DisconnectReason.connectionLost,
          DisconnectReason.connectionReplaced,
          DisconnectReason.restartRequired,
          DisconnectReason.timedOut
        ].includes(reason)) {
          isConnected = false;
          console.log("إعادة محاولة الاتصال...");
          setTimeout(connectBot, 5000);
        } else if (reason === DisconnectReason.loggedOut) {
          console.log("تم تسجيل الخروج، يرجى إعادة تشغيل البوت");
          isConnected = false;
        }
      } else if (connection === 'open') {
        console.log("البوت متصل بنجاح");
        isConnected = true;
      }
    });

    api.ev.on("creds.update", saveCreds);
    
    return api;
  } catch (error) {
    console.error("خطأ في الاتصال:", error);
    isConnected = false;
    return null;
  }
}

app.get('/send', async (req, res) => {
  try {
    const { number, message } = req.query;
    
    if (!number || !message) {
      return res.status(400).json({ 
        success: false, 
        error: "يجب توفير الرقم والرسالة" 
      });
    }

    if (!isConnected || !api) {
      console.log("البوت غير متصل، محاولة الاتصال...");
      await connectBot();
      
      await new Promise(resolve => setTimeout(resolve, 3000));
      
      if (!isConnected) {
        return res.status(503).json({ 
          success: false, 
          error: "فشل في الاتصال بالبوت" 
        });
      }
    }

    let targetNumber = number;
    if (!targetNumber.includes('@')) {
      targetNumber = targetNumber.replace(/\D/g, '') + '@s.whatsapp.net';
    }

    await api.sendMessage(targetNumber, { text: message });
    
    res.json({ 
      success: true, 
      message: "تم إرسال الرسالة بنجاح",
      to: targetNumber
    });

  } catch (error) {
    console.error("خطأ في إرسال الرسالة:", error);
    res.status(500).json({ 
      success: false, 
      error: "فشل في إرسال الرسالة: " + error.message 
    });
  }
});

app.get('/status', (req, res) => {
  res.json({ 
    connected: isConnected,
    timestamp: new Date().toISOString()
  });
});

const PORT = process.env.PORT || 5000;

app.listen(PORT, '0.0.0.0', async () => {
  console.log(`API يعمل على البورت ${PORT}`);
  await connectBot();
});
