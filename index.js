const {
  default: makeWASocket,
  useMultiFileAuthState,
  downloadMediaMessage,
  DisconnectReason
} = require("@whiskeysockets/baileys");

const fs = require("fs-extra");
const sharp = require("sharp");
const ffmpeg = require("fluent-ffmpeg");
const pino = require("pino");
const path = require("path");

async function startBot() {
  // Define a pasta de autenticação
  const authPath = path.resolve(__dirname, "auth_info");
  const { state, saveCreds } = await useMultiFileAuthState(authPath);

  const sock = makeWASocket({
    auth: state,
    printQRInTerminal: true,
    logger: pino({ level: "silent" }),
    // Identificação do navegador para evitar banimentos
    browser: ["StickerBot-VPS", "Chrome", "1.0.0"]
  });

  sock.ev.on("creds.update", saveCreds);

  sock.ev.on("connection.update", (update) => {
    const { connection, lastDisconnect } = update;
    if (connection === "close") {
      const shouldReconnect = lastDisconnect.error?.output?.statusCode !== DisconnectReason.loggedOut;
      if (shouldReconnect) startBot();
    } else if (connection === "open") {
      console.log("🚀 BOT ONLINE NA VPS!");
    }
  });

  sock.ev.on("messages.upsert", async ({ messages }) => {
    const msg = messages[0];
    if (!msg.message || msg.key.fromMe) return;

    const jid = msg.key.remoteJid;
    const text = msg.message.conversation || msg.message.extendedTextMessage?.text || 
                 msg.message.imageMessage?.caption || msg.message.videoMessage?.caption || "";
    
    if (text.toLowerCase() === "/menu") {
        return await sock.sendMessage(jid, { text: "🤖 Sticker Bot VPS\n\nEnvie imagem/vídeo com !fig" });
    }

    if (text.toLowerCase().startsWith("!fig")) {
      const isQuotedImage = msg.message.extendedTextMessage?.contextInfo?.quotedMessage?.imageMessage;
      const isQuotedVideo = msg.message.extendedTextMessage?.contextInfo?.quotedMessage?.videoMessage;
      const isImage = msg.message.imageMessage || isQuotedImage;
      const isVideo = msg.message.videoMessage || isQuotedVideo;

      if (!isImage && !isVideo) return;

      const messageWithMedia = isQuotedImage ? { message: msg.message.extendedTextMessage.contextInfo.quotedMessage } : 
                              isQuotedVideo ? { message: msg.message.extendedTextMessage.contextInfo.quotedMessage } : msg;

      // Pasta temporária na VPS
      const tempId = `temp_${Date.now()}_${msg.key.id}`;
      const tempMp4 = path.resolve(__dirname, `${tempId}.mp4`);
      const tempWebp = path.resolve(__dirname, `${tempId}.webp`);

     try {
        const buffer = await downloadMediaMessage(messageWithMedia, "buffer", {}, {});

        if (isImage) {
          const sticker = await sharp(buffer)
            .resize(512, 512, { fit: "contain", background: { r: 0, g: 0, b: 0, alpha: 0 } })
            .webp()
            .toBuffer();
          await sock.sendMessage(jid, { sticker });
        } 
        else if (isVideo) { // O else if deve vir colado no } do if
          await fs.writeFile(tempMp4, buffer);
          // ... resto da lógica do ffmpeg
        }
      } catch (error) {
        console.error("Erro ao criar figurinha:", error);
        await sock.sendMessage(jid, { text: "❌ Erro ao processar." });
      }
          await new Promise((resolve, reject) => {
            ffmpeg(tempMp4)
              .outputOptions([
                "-vcodec libwebp", "-vf scale='if(gt(iw,ih),512,-1)':'if(gt(ih,iw),512,-1)',fps=15,pad=512:512:(512-iw)/2:(512-ih)/2:color=0x00000000",
                "-lossless 1", "-loop 0", "-an", "-vsync 0"
              ])
              .save(tempWebp)
              .on("end", resolve)
              .on("error", reject);
          });
          const sticker = await fs.readFile(tempWebp);
          await sock.sendMessage(jid, { sticker });
        }
      } catch (e) {
        console.error("Erro:", e);
      } finally {
        if (fs.existsSync(tempMp4)) fs.unlinkSync(tempMp4);
        if (fs.existsSync(tempWebp)) fs.unlinkSync(tempWebp);
      }
    }
  });
}

startBot();
