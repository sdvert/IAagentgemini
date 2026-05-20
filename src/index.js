const express = require('express')
const { handleMessage } = require('./geminiAgent')
const { sendText, sendPresence, sendMedia } = require('./evolutionClient')

const app = express()
app.use(express.json({ limit: '50mb' }))

const PORT = process.env.PORT || 3000
const WEBHOOK_SECRET = process.env.WEBHOOK_SECRET
const BOT_NUMBER = process.env.BOT_NUMBER || ''

app.get('/health', (req, res) => res.json({ status: 'ok', timestamp: new Date().toISOString() }))

app.post('/webhook', async (req, res) => {
  if (WEBHOOK_SECRET && req.headers['x-webhook-secret'] !== WEBHOOK_SECRET) {
    return res.status(401).json({ error: 'Unauthorized' })
  }

  const { event, data } = req.body

  if (event !== 'messages.upsert') return res.sendStatus(200)
  if (!data || data.key?.fromMe) return res.sendStatus(200)

  const remoteJid = data.key?.remoteJid
  if (!remoteJid) return res.sendStatus(200)

  const isGroup = remoteJid.endsWith('@g.us')

  const text =
    data.message?.conversation ||
    data.message?.extendedTextMessage?.text ||
    data.message?.imageMessage?.caption ||
    null

  if (!text) return res.sendStatus(200)

  if (isGroup) {
    const mentionedJids = data.message?.extendedTextMessage?.contextInfo?.mentionedJid || []
    const wasMentioned = BOT_NUMBER && mentionedJids.some(jid => jid.includes(BOT_NUMBER))
    if (!wasMentioned) return res.sendStatus(200)
  }

  // Responde imediatamente para Evolution API não dar timeout
  res.sendStatus(200)

  const contact = remoteJid.replace(/@s\.whatsapp\.net|@g\.us/, '')
  const label = isGroup ? `grupo:${contact}` : contact
  console.log(`📩 [${label}]: ${text}`)

  try {
    await sendPresence(remoteJid, 'composing')
    const cleanText = text.replace(/@\d+/g, '').trim()
    const response = await handleMessage(remoteJid, cleanText)

    if (response.type === 'text') {
      await sendText(remoteJid, response.content)
      console.log(`📤 [${label}]: ${response.content.substring(0, 80)}`)
    } else {
      await sendMedia(remoteJid, response)
      console.log(`📤 [${label}]: [${response.type.toUpperCase()}] ${response.caption || ''}`)
    }
  } catch (err) {
    console.error(`❌ Erro ao processar mensagem de ${label}:`, err.message)
    await sendText(remoteJid, '⚠️ Ocorreu um erro ao processar sua mensagem. Tente novamente.')
  }
})

app.listen(PORT, () => {
  console.log(`🚀 Servidor rodando na porta ${PORT}`)
  console.log(`📡 Webhook: POST /webhook`)
  console.log(`❤️  Health: GET /health`)
})
