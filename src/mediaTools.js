const PDFDocument = require('pdfkit')
const { GoogleGenerativeAI } = require('@google/generative-ai')

async function generatePdf(titulo, conteudo) {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ margin: 60, size: 'A4' })
    const chunks = []

    doc.on('data', chunk => chunks.push(chunk))
    doc.on('end', () => resolve(Buffer.concat(chunks)))
    doc.on('error', reject)

    // Cabeçalho
    doc
      .fontSize(20)
      .font('Helvetica-Bold')
      .text(titulo, { align: 'center' })
    doc.moveDown(0.4)
    doc
      .moveTo(60, doc.y)
      .lineTo(535, doc.y)
      .strokeColor('#cccccc')
      .lineWidth(1)
      .stroke()
    doc.moveDown(1)

    // Corpo
    doc
      .fontSize(11)
      .font('Helvetica')
      .fillColor('#222222')
      .text(conteudo, { align: 'justify', lineGap: 5 })

    // Rodapé
    doc.moveDown(2)
    doc
      .fontSize(8)
      .fillColor('#999999')
      .text(`Gerado em ${new Date().toLocaleString('pt-BR')}`, { align: 'right' })

    doc.end()
  })
}

async function generateImage(prompt) {
  const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY)

  const model = genAI.getGenerativeModel({
    model: process.env.GEMINI_IMAGE_MODEL || 'gemini-2.5-flash-image'
  })

  const result = await model.generateContent({
    contents: [{ role: 'user', parts: [{ text: prompt }] }],
    generationConfig: { responseModalities: ['IMAGE', 'TEXT'] }
  })

  const parts = result.response.candidates?.[0]?.content?.parts || []
  const imagePart = parts.find(p => p.inlineData?.mimeType?.startsWith('image/'))

  if (!imagePart) {
    throw new Error('Gemini não retornou uma imagem. Tente descrever com mais detalhes.')
  }

  return {
    buffer: Buffer.from(imagePart.inlineData.data, 'base64'),
    mimeType: imagePart.inlineData.mimeType
  }
}

module.exports = { generatePdf, generateImage }
