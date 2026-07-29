import { ImapFlow } from 'imapflow'
import { GoogleGenerativeAI } from '@google/generative-ai'
import nodemailer from 'nodemailer'
import 'dotenv/config'

const { GMAIL_EMAIL, GMAIL_APP_PASSWORD, GEMINI_API_KEY, TO_EMAIL } = process.env

if (!GMAIL_EMAIL || !GMAIL_APP_PASSWORD || !GEMINI_API_KEY || !TO_EMAIL) {
  console.error('Faltan variables de entorno en .env')
  process.exit(1)
}

function isMadrid830() {
  const now = new Date()
  const parts = new Intl.DateTimeFormat('es-ES', {
    timeZone: 'Europe/Madrid',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false
  }).formatToParts(now)
  return parts.find(p => p.type === 'hour').value === '08' && parts.find(p => p.type === 'minute').value === '30'
}

async function fetchUnreadEmails() {
  const client = new ImapFlow({
    host: 'imap.gmail.com',
    port: 993,
    secure: true,
    auth: { user: GMAIL_EMAIL, pass: GMAIL_APP_PASSWORD }
  })

  await client.connect()
  const lock = await client.getMailboxLock('INBOX')
  const emails = []
  const cutoff = Date.now() - 24 * 60 * 60 * 1000

  try {
    const uids = await client.search('UNSEEN')
    for await (const msg of client.fetch(uids, { envelope: true, internalDate: true })) {
      const date = msg.internalDate || new Date()
      if (date.getTime() < cutoff) continue

      const from = msg.envelope.from?.[0]
      const fromName = from?.name || from?.address || 'Desconocido'
      const fromAddress = from?.address || ''

      emails.push({
        fromName,
        fromAddress,
        subject: msg.envelope.subject || 'Sin asunto',
        date
      })
    }
  } finally {
    lock.release()
    await client.logout()
  }

  return emails
}

async function classifyWithGemini(emails) {
  if (emails.length === 0) return null

  const genAI = new GoogleGenerativeAI(GEMINI_API_KEY)
  const model = genAI.getGenerativeModel({ model: 'gemini-1.5-flash' })

  const list = emails.map((e, i) =>
    `${i + 1}. De: ${e.fromName} <${e.fromAddress}> | Asunto: ${e.subject}`
  ).join('\n')

  const prompt = `Clasifica cada email en una categoría y da un resumen MUY CORTO en español (máx 80 caracteres).

Categorías:
- MUY_IMPORTANTE: administraciones, gobierno, ilerna, alertas seguridad, railway, crasheos de apps
- IMPORTANTE: tareas, recordatorios, comunicaciones de personas conocidas, info personal
- NEWSLETTER_EDUCATIVA: udemy, mimo, duolingo, brilliant, plataformas educativas
- RRSS: linkedin, twitter, instagram, redes sociales
- OTRO: spam, promociones, notificaciones sin importancia (IGNORAR)

Emails:
${list}

Responde SOLO con un JSON array, nada más:
[{"categoria": "MUY_IMPORTANTE", "resumen": "..."}]`

  const result = await model.generateContent(prompt)
  const text = result.response.text().replace(/```json?\s*/g, '').replace(/```/g, '').trim()
  return JSON.parse(text)
}

function classifyFallback(emails) {
  const groups = { MUY_IMPORTANTE: [], IMPORTANTE: [], NEWSLETTER_EDUCATIVA: [], RRSS: [] }

  for (const email of emails) {
    const text = `${email.fromName} ${email.fromAddress} ${email.subject}`.toLowerCase()
    let resumen = ''

    if (/ilerna|seguridad|alerta|railway|crasheo|crash|administracion|gobierno|agenci|hacienda|sancion|multa|notificacion electronic/i.test(text)) {
      resumen = 'Email importante de administración o seguridad'
      groups.MUY_IMPORTANTE.push({ ...email, resumen })
    } else if (/recordatorio|tarea|task|reminder|vencimient|factura|personal|amigo|familia|confirmación|cita/i.test(text)) {
      resumen = 'Comunicación personal o tarea'
      groups.IMPORTANTE.push({ ...email, resumen })
    } else if (/udemy|mimo|duolingo|brilliant|coursera|codecademy|edx|platzi|domestika|educacion|curso|aprender/i.test(text)) {
      resumen = 'Newsletter de plataforma educativa'
      groups.NEWSLETTER_EDUCATIVA.push({ ...email, resumen })
    } else if (/linkedin|twitter|instagram|facebook|tiktok|threads|youtube|red social/i.test(text)) {
      resumen = 'Notificación de red social'
      groups.RRSS.push({ ...email, resumen })
    }
  }

  return groups
}

function buildHTML(groups) {
  const dateStr = new Date().toLocaleDateString('es-ES', {
    timeZone: 'Europe/Madrid',
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    year: 'numeric'
  })

  const blocks = [
    { key: 'MUY_IMPORTANTE', title: 'MUY IMPORTANTES', icon: '🔴', color: '#dc3545', bg: '#fff5f5' },
    { key: 'IMPORTANTE', title: 'IMPORTANTES', icon: '🟡', color: '#e67e22', bg: '#fffaf0' },
    { key: 'NEWSLETTER_EDUCATIVA', title: 'NEWSLETTERS EDUCATIVAS', icon: '🟢', color: '#28a745', bg: '#f0fff4' },
    { key: 'RRSS', title: 'REDES SOCIALES', icon: '🔵', color: '#3498db', bg: '#f0f8ff' }
  ]

  const blockHTML = blocks.map(block => {
    const items = groups[block.key] || []
    const cards = items.length > 0
      ? items.map(e => `
        <div style="background:#fff;border-radius:10px;padding:14px 16px;margin-bottom:10px;border-left:4px solid ${block.color};box-shadow:0 1px 3px rgba(0,0,0,.08)">
          <div style="font-size:13px;color:#888">${esc(e.fromName)}</div>
          <div style="font-size:14px;font-weight:600;color:#333;margin:6px 0 4px">${esc(e.subject)}</div>
          <div style="font-size:13px;color:#666;font-style:italic">${esc(e.resumen)}</div>
        </div>`).join('')
      : `<div style="background:#fff;border-radius:10px;padding:20px;text-align:center;color:#bbb;font-size:14px;border:1px dashed #ddd">
           ✅ No hay nada nuevo en esta sección hoy
         </div>`

    return `
    <div style="background:${block.bg};border-radius:12px;padding:18px;margin-bottom:20px">
      <h2 style="color:${block.color};font-size:18px;margin:0 0 14px 0;padding-bottom:10px;border-bottom:2px solid ${block.color}">
        ${block.icon} ${block.title} (${items.length})
      </h2>
      ${cards}
    </div>`
  }).join('')

  return `<!DOCTYPE html>
<html lang="es">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1.0"></head>
<body style="margin:0;padding:0;background:#f0f2f5;font-family:'Segoe UI',Arial,sans-serif">
<div style="max-width:600px;margin:0 auto;padding:20px">

  <div style="background:linear-gradient(135deg,#667eea,#764ba2);border-radius:16px;padding:28px 24px;text-align:center;margin-bottom:24px">
    <h1 style="color:#fff;font-size:26px;margin:0">☀️ Buenos días, Isabel</h1>
    <p style="color:rgba(255,255,255,.85);font-size:14px;margin:8px 0 0">Resumen de tus correos — ${dateStr}</p>
  </div>

  ${blockHTML}

  <div style="text-align:center;padding:20px;color:#aaa;font-size:12px;border-top:1px solid #e0e0e0">
    Generado automáticamente · 08:30 Madrid · Tu asistente personal
  </div>

</div>
</body>
</html>`
}

function esc(s) {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
}

async function sendEmail(html) {
  const transporter = nodemailer.createTransport({
    host: 'smtp.gmail.com',
    port: 587,
    secure: true,
    auth: { user: GMAIL_EMAIL, pass: GMAIL_APP_PASSWORD }
  })

  const subject = `☀️ Resumen diario — ${new Date().toLocaleDateString('es-ES', {
    timeZone: 'Europe/Madrid',
    day: 'numeric',
    month: 'long',
    year: 'numeric'
  })}`

  await transporter.sendMail({
    from: `"Resumen Diario" <${GMAIL_EMAIL}>`,
    to: TO_EMAIL,
    subject,
    html
  })
}

async function main() {
  if (!isMadrid830()) {
    console.log('No son las 08:30 en Madrid. Saliendo.')
    process.exit(0)
  }

  try {
    console.log('📥 Obteniendo emails no leídos...')
    const emails = await fetchUnreadEmails()
    console.log(`→ ${emails.length} emails no leídos en las últimas 24h`)

    let groups

    if (emails.length > 0) {
      try {
        console.log('🤖 Clasificando con Gemini...')
        const result = await classifyWithGemini(emails)
        groups = { MUY_IMPORTANTE: [], IMPORTANTE: [], NEWSLETTER_EDUCATIVA: [], RRSS: [] }
        emails.forEach((email, i) => {
          const item = result?.[i]
          if (item && groups[item.categoria]) {
            groups[item.categoria].push({ ...email, resumen: item.resumen || '' })
          }
        })
        console.log(`   MUY IMPORTANTES: ${groups.MUY_IMPORTANTE.length}`)
        console.log(`   IMPORTANTES:     ${groups.IMPORTANTE.length}`)
        console.log(`   NEWSLETTERS:     ${groups.NEWSLETTER_EDUCATIVA.length}`)
        console.log(`   RRSS:            ${groups.RRSS.length}`)
      } catch (e) {
        console.log('⚠️  Gemini falló, usando clasificación por palabras clave:', e.message)
        groups = classifyFallback(emails)
      }
    } else {
      groups = { MUY_IMPORTANTE: [], IMPORTANTE: [], NEWSLETTER_EDUCATIVA: [], RRSS: [] }
    }

    console.log('📤 Generando HTML y enviando email...')
    const html = buildHTML(groups)
    await sendEmail(html)
    console.log('✅ ¡Resumen enviado correctamente a', TO_EMAIL)
  } catch (e) {
    console.error('❌ Error:', e.message)
    process.exit(1)
  }

  process.exit(0)
}

main()
