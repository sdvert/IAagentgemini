const BASE_URL = (process.env.EVOLUTION_API_URL || '').replace(/\/$/, '')
const API_KEY = process.env.EVOLUTION_API_KEY
const INSTANCE = process.env.EVOLUTION_INSTANCE

function getHeaders() {
  return { 'Content-Type': 'application/json', 'apikey': API_KEY }
}

function toNumber(remoteJid) {
  return remoteJid.replace(/@s\.whatsapp\.net|@g\.us/, '')
}

async function sendText(remoteJid, text) {
  const res = await fetch(`${BASE_URL}/message/sendText/${INSTANCE}`, {
    method: 'POST',
    headers: getHeaders(),
    body: JSON.stringify({ number: toNumber(remoteJid), text })
  })
  if (!res.ok) throw new Error(`Evolution API ${res.status}: ${await res.text()}`)
  return res.json()
}

async function sendPresence(remoteJid, presence = 'composing') {
  try {
    await fetch(`${BASE_URL}/chat/sendPresence/${INSTANCE}`, {
      method: 'POST',
      headers: getHeaders(),
      body: JSON.stringify({ number: toNumber(remoteJid), options: { presence, delay: 1000 } })
    })
  } catch {
    // presença é opcional, ignora falhas
  }
}

async function sendMedia(remoteJid, { type, buffer, mimeType, filename, caption }) {
  const mediatype = type === 'pdf' ? 'document' : type
  const body = {
    number: toNumber(remoteJid),
    mediatype,
    mimetype: mimeType || (type === 'pdf' ? 'application/pdf' : 'image/png'),
    media: buffer.toString('base64'),
    caption: caption || '',
    ...(filename ? { fileName: filename } : {})
  }
  const res = await fetch(`${BASE_URL}/message/sendMedia/${INSTANCE}`, {
    method: 'POST',
    headers: getHeaders(),
    body: JSON.stringify(body)
  })
  if (!res.ok) throw new Error(`Evolution API ${res.status}: ${await res.text()}`)
  return res.json()
}

module.exports = { sendText, sendPresence, sendMedia }
