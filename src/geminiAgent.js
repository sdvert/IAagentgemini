const { GoogleGenerativeAI } = require('@google/generative-ai')
const { getHistory, saveHistory } = require('./sessionStore')
const { generatePdf, generateImage } = require('./mediaTools')

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY)

// Retry com backoff para erros 429 (rate limit)
async function withRetry(fn, maxRetries = 3) {
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      return await fn()
    } catch (err) {
      const is429 = err.message?.includes('429') || err.status === 429
      const retryMatch = err.message?.match(/retry in (\d+)s/i)
      if (is429 && attempt < maxRetries) {
        const wait = retryMatch ? parseInt(retryMatch[1]) * 1000 : attempt * 15000
        console.log(`⏳ Rate limit (429). Aguardando ${wait / 1000}s antes de tentar novamente... (${attempt}/${maxRetries})`)
        await new Promise(r => setTimeout(r, wait))
      } else {
        throw err
      }
    }
  }
}

// Ferramentas de mídia — Gemini chama quando o usuário pede PDF ou imagem
const MEDIA_FUNCTION_DECLARATIONS = [
  {
    name: 'gerar_pdf',
    description: 'Gera um documento PDF formatado com título e conteúdo. Use quando o usuário pedir para criar, gerar ou exportar um PDF ou documento.',
    parameters: {
      type: 'object',
      properties: {
        titulo: { type: 'string', description: 'Título do documento' },
        conteudo: { type: 'string', description: 'Conteúdo completo do documento em texto corrido' }
      },
      required: ['titulo', 'conteudo']
    }
  },
  {
    name: 'gerar_imagem',
    description: 'Gera uma imagem a partir de uma descrição. Use quando o usuário pedir para criar, gerar ou desenhar uma imagem, foto ou ilustração.',
    parameters: {
      type: 'object',
      properties: {
        prompt: { type: 'string', description: 'Descrição detalhada da imagem em inglês para melhores resultados' }
      },
      required: ['prompt']
    }
  }
]

// Carrega ferramentas ClickUp se configurado
let clickupDeclarations = []
let executeClickupTool = null
if (process.env.CLICKUP_API_KEY) {
  const clickup = require('./clickupTools')
  clickupDeclarations = clickup.CLICKUP_FUNCTION_DECLARATIONS
  executeClickupTool = clickup.executeTool
  console.log('🔧 ClickUp integrado:', clickupDeclarations.map(t => t.name).join(', '))
}

const ALL_DECLARATIONS = [...MEDIA_FUNCTION_DECLARATIONS, ...clickupDeclarations]

const SYSTEM_INSTRUCTION = `Você é um assistente inteligente disponível via WhatsApp, desenvolvido com Google Gemini.

Regras de comportamento:
- Responda sempre em português brasileiro, de forma clara e natural
- Seja direto e objetivo — mensagens de WhatsApp devem ser curtas quando possível
- Use formatação simples: evite markdown pesado, prefira texto limpo
- Você pode ajudar com: perguntas gerais, redação, análise de texto, cálculos, programação, tradução, e muito mais
- Se não souber algo, diga claramente
- Não invente informações ou fatos

Geração de mídia:
- Quando o usuário pedir para criar um PDF, relatório ou documento: use a ferramenta gerar_pdf
- Quando o usuário pedir para criar, gerar ou desenhar uma imagem: use a ferramenta gerar_imagem
- Após gerar, confirme ao usuário que o arquivo foi enviado${clickupDeclarations.length > 0 ? `

ClickUp:
- Você tem acesso ao ClickUp do usuário via ferramentas
- Use buscar_tarefa quando não souber o ID da lista ou tarefa
- Ao listar tarefas, apresente: nome, status e prazo (se houver)
- Para criar tarefas, confirme os detalhes antes de criar` : ''}`

const MAX_HISTORY = 20
const MAX_TOOL_ROUNDS = 5

// Converte histórico armazenado (formato simples) para formato Gemini
function toGeminiHistory(history) {
  return history.map(msg => ({
    role: msg.role === 'assistant' ? 'model' : 'user',
    parts: [{ text: typeof msg.content === 'string' ? msg.content : JSON.stringify(msg.content) }]
  }))
}

async function handleMessage(userId, userText) {
  const storedHistory = await getHistory(userId)

  const modelConfig = {
    model: process.env.GEMINI_MODEL || 'gemini-2.5-flash',
    systemInstruction: SYSTEM_INSTRUCTION,
    tools: [{ functionDeclarations: ALL_DECLARATIONS }]
  }

  const model = genAI.getGenerativeModel(modelConfig)
  const chat = model.startChat({ history: toGeminiHistory(storedHistory) })

  let result = await withRetry(() => chat.sendMessage(userText))

  let pendingMedia = null
  let rounds = 0

  // Loop de chamada de ferramentas
  while (rounds < MAX_TOOL_ROUNDS) {
    const parts = result.response.candidates?.[0]?.content?.parts || []
    const functionCalls = parts.filter(p => p.functionCall)
    if (functionCalls.length === 0) break

    rounds++
    const responseParts = []

    for (const part of functionCalls) {
      const { name, args } = part.functionCall
      console.log(`🔧 Tool: ${name}`, JSON.stringify(args))

      let toolResult

      if (name === 'gerar_pdf') {
        try {
          const pdfBuffer = await generatePdf(args.titulo, args.conteudo)
          pendingMedia = { type: 'pdf', buffer: pdfBuffer, filename: `${args.titulo.replace(/[^a-zA-Z0-9 ]/g, '')}.pdf` }
          toolResult = { sucesso: true, mensagem: 'PDF gerado com sucesso.' }
        } catch (err) {
          toolResult = { erro: err.message }
        }
      } else if (name === 'gerar_imagem') {
        try {
          const img = await generateImage(args.prompt)
          pendingMedia = { type: 'image', buffer: img.buffer, mimeType: img.mimeType }
          toolResult = { sucesso: true, mensagem: 'Imagem gerada com sucesso.' }
        } catch (err) {
          toolResult = { erro: err.message }
        }
      } else if (executeClickupTool) {
        toolResult = await executeClickupTool(name, args)
      } else {
        toolResult = { erro: `Ferramenta desconhecida: ${name}` }
      }

      console.log(`✅ Resultado ${name}:`, JSON.stringify(toolResult).substring(0, 150))
      responseParts.push({ functionResponse: { name, response: { result: toolResult } } })
    }

    result = await withRetry(() => chat.sendMessage(responseParts))
  }

  const responseText = result.response.text().trim() ||
    (pendingMedia ? 'Aqui está o arquivo solicitado!' : 'Não consegui gerar uma resposta. Tente reformular.')

  // Persiste histórico (formato simples, sem blocos de tool_use)
  const updatedHistory = [
    ...storedHistory,
    { role: 'user', content: userText },
    { role: 'assistant', content: responseText }
  ].slice(-MAX_HISTORY)

  await saveHistory(userId, updatedHistory)

  if (pendingMedia) {
    return { ...pendingMedia, caption: responseText }
  }

  return { type: 'text', content: responseText }
}

async function clearHistory(userId) {
  await saveHistory(userId, [])
}

module.exports = { handleMessage, clearHistory }
