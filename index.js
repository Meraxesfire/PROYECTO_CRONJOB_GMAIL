// ============================================================
//  PROYECTO: RESUMEN DIARIO GMAIL
//  Version: 2.0
//  Descripcion:
//    Cada dia a las 08:30 (hora Madrid) este script revisa
//    los correos NO LEIDOS de tu Gmail de las ultimas 24h,
//    los clasifica con GEMINI (IA de Google) en 4 categorias,
//    y te envia un resumen visual con el contenido agrupado.
//
//  Como se ejecuta:
//    Railway ejecuta node index.js a las 6:30 y 7:30 UTC.
//    El script comprueba si en Madrid son las 08:30 y solo
//    entonces ejecuta la logica completa.
// ============================================================

// ================================================================
//  SECCION 1: IMPORTACIONES
//  Aqui cargamos las librerias externas que necesita el programa.
//  Son como "plugins" que anaden funcionalidades a Node.js.
// ================================================================

// imapflow: permite CONECTARSE al servidor IMAP de Gmail
// para LEER los correos (como si abrieras Gmail desde otro programa)
import { ImapFlow } from 'imapflow'

// @google/generative-ai: SDK oficial de Google para usar GEMINI
// Gemini es la inteligencia artificial que CLASIFICARA tus emails
// en las categorias: MUY IMPORTANTE, IMPORTANTE, NEWSLETTER, RRSS
import { GoogleGenerativeAI } from '@google/generative-ai'

// nodemailer: permite ENVIAR emails a traves del servidor SMTP
// SMTP es el protocolo para enviar (IMAP es para leer)
import nodemailer from 'nodemailer'

// dotenv: carga automaticamente las variables del archivo .env
// y las mete en process.env para que el resto del codigo las use
// EJEMPLO: GMAIL_EMAIL, GMAIL_APP_PASSWORD, GEMINI_API_KEY, TO_EMAIL
import 'dotenv/config'


// ================================================================
//  SECCION 2: VARIABLES DE ENTORNO
//  Sacamos las 4 variables necesarias del .env.
//  Si alguna falta, el programa se detiene con error.
//
//  IMPORTANTE: el archivo .env NUNCA se sube a GitHub porque
//  contiene tus contrasenas. Esta en .gitignore.
//  En Railway las variables se configuran en el Dashboard.
// ================================================================

// Extraemos las 4 variables del entorno.
// Si no estan definidas, la variable vale undefined.
const { GMAIL_EMAIL, GMAIL_APP_PASSWORD, GEMINI_API_KEY, TO_EMAIL } = process.env

// Verificamos que las 4 existan. Si alguna falta, error y salimos.
if (!GMAIL_EMAIL || !GMAIL_APP_PASSWORD || !GEMINI_API_KEY || !TO_EMAIL) {
  console.error('[ERROR] Faltan variables de entorno. Revisa tu archivo .env')
  process.exit(1)  // Codigo 1 = error. Railway lo registra en los logs.
}


// ================================================================
//  SECCION 3: COMPROBAR LA HORA
//  funcion: isMadrid830()
//
//  Por que existe? Railway ejecuta el script a las 6:30 y 7:30 UTC.
//  Nosotros queremos que la logica ocurra SOLO a las 08:30 hora
//  de Madrid. Esta funcion es "el portero" que decide si pasas.
//
//  Como funciona:
//    1. Obtiene la hora UTC actual
//    2. Calcula si Madrid esta en horario de VERANO o INVIERNO
//    3. Suma 2h (verano) o 1h (invierno) a la hora UTC
//    4. Comprueba si el resultado son las 08:30 exactas
//
//  NOTA: Se usa calculo manual porque Intl.DateTimeFormat con
//  zona horaria 'Europe/Madrid' NO funciona en Railway.
// ================================================================

function isMadrid830() {
  // Obtenemos la hora UTC actual
  // new Date() sin argumentos = fecha/hora actual
  // Las funciones getUTCHoras/minutes devuelven la hora en UTC
  const now = new Date()
  const utcMinutos = now.getUTCHours() * 60 + now.getUTCMinutes()
  const mes = now.getUTCMonth() + 1  // getUTCMonth() devuelve 0-11, sumamos 1
  const dia = now.getUTCDate()

  // Calculamos si Madrid esta en horario de VERANO (UTC+2) o INVIERNO (UTC+1)
  // Regla: ultimo domingo de MARZO a ultimo domingo de OCTUBRE = verano
  // Aproximacion simplificada: 25 de marzo a 25 de octubre
  let esVerano
  if (mes < 3 || mes > 10) {
    esVerano = false  // Enero, Febrero, Noviembre, Diciembre = invierno
  } else if (mes > 3 && mes < 10) {
    esVerano = true   // Abril a Septiembre = verano seguro
  } else if (mes === 3) {
    esVerano = dia >= 25  // Marzo: verano a partir del dia 25
  } else {
    esVerano = dia < 25   // Octubre: verano hasta el dia 24
  }

  // Convertimos la hora UTC a hora de Madrid
  // VERANO:  UTC + 120 minutos  (2 horas)
  // INVIERNO: UTC + 60 minutos  (1 hora)
  const madridMinutos = utcMinutos + (esVerano ? 120 : 60)
  // madridMinutos ahora representa la hora actual de Madrid en
  // formato "minutos desde medianoche"

  // 08:30 en minutos desde medianoche = 8*60 + 30 = 510
  // Comparamos: si es 510, son las 08:30 en Madrid
  return madridMinutos === 510
}


// ================================================================
//  SECCION 4: LEER CORREOS DE GMAIL
//  funcion: fetchUnreadEmails()
//
//  Se conecta al servidor IMAP de Gmail y obtiene todos los
//  correos NO LEIDOS de las ultimas 24 horas.
//
//  IMAP es el protocolo que permite a programas externos
//  leer correos (Outlook, Thunderbird, etc.). Nosotros lo
//  usamos desde Node.js con la libreria imapflow.
//
//  Que devuelve? Un array de objetos, cada uno con:
//    { fromName, fromAddress, subject, date }
// ================================================================

async function fetchUnreadEmails() {
  // Creamos el cliente IMAP con los datos de Gmail
  // El App Password es la contrasena que generaste en Google
  // especificamente para que este programa pueda acceder
  const client = new ImapFlow({
    host: 'imap.gmail.com',    // Servidor IMAP de Gmail
    port: 993,                  // Puerto seguro (SSL/TLS)
    secure: true,               // Conexion CIFRADA
    auth: { user: GMAIL_EMAIL, pass: GMAIL_APP_PASSWORD }
  })

  // Conectamos al servidor (esperamos a que responda)
  await client.connect()

  // Bloqueamos la bandeja de entrada (INBOX) para que nadie
  // mas la modifique mientras la leemos. Buena practica.
  const lock = await client.getMailboxLock('INBOX')

  const emails = []  // Array donde guardaremos los correos

  // Definimos la fecha limite: hace 24 horas
  // Date.now() = milisegundos desde 1970 hasta ahora
  // Restamos 24h en milisegundos: 24 * 60 * 60 * 1000
  const cutoff = Date.now() - 24 * 60 * 60 * 1000

  try {
    // Buscamos los UIDs de los emails NO LEIDOS
    // "UNSEEN" es el comando IMAP estandar para "no leidos"
    const uids = await client.search('UNSEEN')

    // Iteramos sobre cada email no leido
    // envelope = datos del remitente y asunto
    // internalDate = fecha en que el servidor recibio el email
    for await (const msg of client.fetch(uids, { envelope: true, internalDate: true })) {
      // Saltamos emails de mas de 24h
      const date = msg.internalDate || new Date()
      if (date.getTime() < cutoff) continue

      // Extraemos el remitente del envelope del email
      // envelope.from[0] contiene: { name: "Nombre", address: "email@..." }
      const from = msg.envelope.from?.[0]

      // fromName: para MOSTRAR en el resumen (ej: "Ilerna FP")
      const fromName = from?.name || from?.address || 'Desconocido'
      // fromAddress: para IDENTIFICAR en la clasificacion (ej: "info@ilerna.com")
      const fromAddress = from?.address || ''

      // Anadimos el email al array
      emails.push({
        fromName,
        fromAddress,
        subject: msg.envelope.subject || 'Sin asunto',
        date
      })
    }
  } finally {
    // finally se ejecuta SIEMPRE, haya error o no
    // Es IMPORTANTE liberar los recursos: el lock y la conexion
    lock.release()
    await client.logout()
  }

  return emails
}


// ================================================================
//  SECCION 5: CLASIFICAR CON GEMINI (INTELIGENCIA ARTIFICIAL)
//  funcion: classifyWithGemini(emails)
//
//  Envia TODOS los emails en UNA SOLA llamada a Gemini.
//  Gemini los clasifica en categorias y adivina un resumen.
//
//  Por que una sola llamada? Es mas eficiente y barato.
//  Gemini ve todos los emails juntos y puede contextualizar.
//
//  Que devuelve? Un array con objetos:
//    [{ categoria: "MUY_IMPORTANTE", resumen: "Texto corto" }]
// ================================================================

async function classifyWithGemini(emails) {
  // Si no hay emails, devolvemos null (no hay nada que clasificar)
  if (emails.length === 0) return null

  // Inicializamos Gemini con nuestra API Key
  // La API Key la obtienes gratis de https://aistudio.google.com/apikey
  const genAI = new GoogleGenerativeAI(GEMINI_API_KEY)

  // Elegimos el modelo "gemini-1.5-flash"
  // flash = rapido y ligero. Suficiente para clasificar emails.
  // Tiene un tier GRATUITO que nos sirve perfectamente.
  const model = genAI.getGenerativeModel({ model: 'gemini-1.5-flash' })

  // Construimos la lista de emails en texto plano
  // para que Gemini pueda leerlos en el prompt
  const list = emails.map((e, i) =>
    `${i + 1}. De: ${e.fromName} <${e.fromAddress}> | Asunto: ${e.subject}`
  ).join('\n')

  // PROMPT: las instrucciones que le damos a Gemini
  // Es IMPORTANTE ser muy especifico con el formato de respuesta
  // para poder convertir el texto a objeto JavaScript con JSON.parse()
  //
  // Las categorias que definimos:
  //   MUY_IMPORTANTE:     administraciones, Ilerna, alertas seguridad, Railway
  //   IMPORTANTE:         tareas, recordatorios, personas conocidas
  //   NEWSLETTER_EDUCATIVA: Udemy, Duolingo, Brilliant, Mimo
  //   RRSS:               LinkedIn, Twitter, Instagram
  //   OTRO:               spam, promociones (se IGNORA)
  const prompt = `Clasifica cada email en una categoria y da un resumen MUY CORTO en espanol (max 80 caracteres).

Categorias:
- MUY_IMPORTANTE: administraciones, gobierno, ilerna, alertas seguridad, railway, crasheos de apps
- IMPORTANTE: tareas, recordatorios, comunicaciones de personas conocidas, info personal
- NEWSLETTER_EDUCATIVA: udemy, mimo, duolingo, brilliant, plataformas educativas
- RRSS: linkedin, twitter, instagram, redes sociales
- OTRO: spam, promociones, notificaciones sin importancia (IGNORAR)

Emails:
${list}

Responde SOLO con un JSON array, nada mas:
[{"categoria": "MUY_IMPORTANTE", "resumen": "..."}]`

  // Enviamos el prompt a Gemini y esperamos la respuesta
  const result = await model.generateContent(prompt)

  // Extraemos el texto de la respuesta de Gemini
  const text = result.response.text()

  // A veces Gemini devuelve el JSON dentro de bloques de codigo
  // como ```json [...] ```. Limpiamos eso antes de convertir.
  const cleaned = text.replace(/```json?\s*/g, '').replace(/```/g, '').trim()

  // Convertimos el texto plano a un array de objetos JavaScript
  return JSON.parse(cleaned)
}


// ================================================================
//  SECCION 6: CLASIFICACION DE RESPALDO (FALLBACK)
//  funcion: classifyFallback(emails)
//
//  Cuando Gemini falla (error de red, limite de cuota, etc.)
//  este metodo de RESPALDO clasifica los emails buscando
//  palabras clave en el remitente y el asunto.
//
//  Es menos inteligente que Gemini pero SIEMPRE funciona
//  porque no necesita conexion a ningun servicio externo.
// ================================================================

function classifyFallback(emails) {
  // Inicializamos las 4 categorias vacias
  const groups = { MUY_IMPORTANTE: [], IMPORTANTE: [], NEWSLETTER_EDUCATIVA: [], RRSS: [] }

  for (const email of emails) {
    // Unimos todo el texto del email en minusculas
    // para buscar patrones independientemente de mayusculas
    const text = `${email.fromName} ${email.fromAddress} ${email.subject}`.toLowerCase()
    let resumen = ''

    // Las expresiones regulares /patron/i buscan coincidencias
    // El flag /i significa "ignore case" (ignorar mayusculas)

    if (/ilerna|seguridad|alerta|railway|crasheo|crash|administracion|gobierno|agenci|hacienda|sancion|multa|notificacion electronic/i.test(text)) {
      resumen = 'Email importante de administracion o seguridad'
      groups.MUY_IMPORTANTE.push({ ...email, resumen })

    } else if (/recordatorio|tarea|task|reminder|vencimient|factura|personal|amigo|familia|confirmacion|cita/i.test(text)) {
      resumen = 'Comunicacion personal o tarea'
      groups.IMPORTANTE.push({ ...email, resumen })

    } else if (/udemy|mimo|duolingo|brilliant|coursera|codecademy|edx|platzi|domestika|educacion|curso|aprender/i.test(text)) {
      resumen = 'Newsletter de plataforma educativa'
      groups.NEWSLETTER_EDUCATIVA.push({ ...email, resumen })

    } else if (/linkedin|twitter|instagram|facebook|tiktok|threads|youtube|red social/i.test(text)) {
      resumen = 'Notificacion de red social'
      groups.RRSS.push({ ...email, resumen })
    }
    // Si no coincide con ninguna: se ignora (probablemente spam)
  }

  return groups
}


// ================================================================
//  SECCION 7: GENERAR EL HTML DEL EMAIL
//  funcion: buildHTML(groups)
//
//  Crea el codigo HTML completo que se enviara como email.
//  Consta de 4 bloques de color, cada uno con tarjetas
//  individuales para cada email clasificado.
//
//  Por que estilos INLINE? Porque Gmail y Outlook ignoran
//  las etiquetas <style> del <head>. Los estilos deben ir
//  en el atributo style="..." de cada elemento HTML.
// ================================================================

function buildHTML(groups) {
  // Fecha formateada para el encabezado del email
  // Ejemplo: "martes, 28 de julio de 2026"
  const dateStr = new Date().toLocaleDateString('es-ES', {
    timeZone: 'Europe/Madrid',
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    year: 'numeric'
  })

  // Definicion de los 4 bloques con sus colores
  const blocks = [
    { key: 'MUY_IMPORTANTE', title: 'MUY IMPORTANTES', icon: '[!!]', color: '#dc3545', bg: '#fff5f5' },
    { key: 'IMPORTANTE', title: 'IMPORTANTES', icon: '[!]', color: '#e67e22', bg: '#fffaf0' },
    { key: 'NEWSLETTER_EDUCATIVA', title: 'NEWSLETTERS EDUCATIVAS', icon: '[*]', color: '#28a745', bg: '#f0fff4' },
    { key: 'RRSS', title: 'REDES SOCIALES', icon: '[@]', color: '#3498db', bg: '#f0f8ff' }
  ]

  // Generamos el HTML de cada bloque
  const blockHTML = blocks.map(block => {
    const items = groups[block.key] || []

    // Si hay emails en este bloque, creamos tarjetas
    // Si no, mostramos mensaje "vacio" con borde punteado
    const cards = items.length > 0
      ? items.map(e => `
        <div style="background:#fff;border-radius:10px;padding:14px 16px;margin-bottom:10px;border-left:4px solid ${block.color};box-shadow:0 1px 3px rgba(0,0,0,.08)">
          <div style="font-size:13px;color:#888">${esc(e.fromName)}</div>
          <div style="font-size:14px;font-weight:600;color:#333;margin:6px 0 4px">${esc(e.subject)}</div>
          <div style="font-size:13px;color:#666;font-style:italic">${esc(e.resumen)}</div>
        </div>`).join('')
      : `<div style="background:#fff;border-radius:10px;padding:20px;text-align:center;color:#bbb;font-size:14px;border:1px dashed #ddd">
           [OK] No hay nada nuevo en esta seccion hoy
         </div>`

    // Cada bloque es un contenedor con color de fondo suave
    return `
    <div style="background:${block.bg};border-radius:12px;padding:18px;margin-bottom:20px">
      <h2 style="color:${block.color};font-size:18px;margin:0 0 14px 0;padding-bottom:10px;border-bottom:2px solid ${block.color}">
        ${block.icon} ${block.title} (${items.length})
      </h2>
      ${cards}
    </div>`
  }).join('')

  // Plantilla HTML completa del email
  return `<!DOCTYPE html>
<html lang="es">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1.0"></head>
<body style="margin:0;padding:0;background:#f0f2f5;font-family:'Segoe UI',Arial,sans-serif">
<div style="max-width:600px;margin:0 auto;padding:20px">

  <div style="background:linear-gradient(135deg,#667eea,#764ba2);border-radius:16px;padding:28px 24px;text-align:center;margin-bottom:24px">
    <h1 style="color:#fff;font-size:26px;margin:0">Buenos dias, Isabel</h1>
    <p style="color:rgba(255,255,255,.85);font-size:14px;margin:8px 0 0">Resumen de tus correos - ${dateStr}</p>
  </div>

  ${blockHTML}

  <div style="text-align:center;padding:20px;color:#aaa;font-size:12px;border-top:1px solid #e0e0e0">
    Generado automaticamente - 08:30 Madrid - Tu asistente personal
  </div>

</div>
</body>
</html>`
}


// ================================================================
//  SECCION 8: ESCAPAR CARACTERES HTML
//  funcion: esc(s)
//
//  Cuando insertamos el asunto o remitente de un email en el
//  HTML, estos podrian contener caracteres especiales como
//  < > & " que ROMPERIAN el codigo HTML.
//
//  Esta funcion los convierte a "entidades HTML" seguras:
//    <  se convierte en  &lt;
//    >  se convierte en  &gt;
//    &  se convierte en  &amp;
//    "  se convierte en  &quot;
// ================================================================

function esc(s) {
  return String(s)
    .replace(/&/g, '&amp;')     // & primero por seguridad
    .replace(/</g, '&lt;')      // <
    .replace(/>/g, '&gt;')      // >
    .replace(/"/g, '&quot;')    // "
}


// ================================================================
//  SECCION 9: ENVIAR EL EMAIL
//  funcion: sendEmail(html)
//
//  Usa NODEMAILER para enviar el email a traves del servidor
//  SMTP de Gmail.
//
//  SMTP es el protocolo de internet para ENVIAR correos.
//  IMAP (seccion 4) es para LEER correos. Son diferentes.
//
//  La autenticacion se hace con el App Password, NO con tu
//  contrasena normal de Gmail. El App Password es una clave
//  especifica que creaste para este programa.
// ================================================================

async function sendEmail(html) {
  // Creamos el transportista SMTP que conecta con Gmail
  const transporter = nodemailer.createTransport({
    host: 'smtp.gmail.com',     // Servidor SMTP de Gmail
    port: 587,                   // Puerto con STARTTLS (cifrado)
    secure: false,               // false = usa STARTTLS, true = SSL directo
    auth: { user: GMAIL_EMAIL, pass: GMAIL_APP_PASSWORD }
  })

  // Asunto del email con la fecha actual
  // Ejemplo: "Resumen diario - 28 de julio de 2026"
  const subject = `Resumen diario - ${new Date().toLocaleDateString('es-ES', {
    timeZone: 'Europe/Madrid',
    day: 'numeric',
    month: 'long',
    year: 'numeric'
  })}`

  // Enviamos el email
  await transporter.sendMail({
    from: `"Resumen Diario" <${GMAIL_EMAIL}>`,  // Quien lo envia (tu)
    to: TO_EMAIL,                                 // Quien lo recibe (tu)
    subject,                                      // Asunto del email
    html                                          // Cuerpo del email en HTML
  })
}


// ================================================================
//  SECCION 10: FUNCION PRINCIPAL
//  funcion: main()
//
//  Es el "director de orquesta" del programa.
//  Llama a cada paso en orden secuencial:
//
//    1. Comprobar si son las 08:30 Madrid (si no, salir)
//    2. Leer correos NO LEIDOS de las ultimas 24h
//    3. Clasificarlos con Gemini (o con palabras clave si falla)
//    4. Generar el HTML del email
//    5. Enviar el email
//
//  Si algo falla, se captura el error y se registra.
// ================================================================

async function main() {
  // PASO 1: Comprobar hora
  // Railway ejecuta esto a las 6:30 y 7:30 UTC
  // Solo UNA de esas ejecuciones coincidira con las 08:30 Madrid
  if (!isMadrid830()) {
    console.log('No son las 08:30 en Madrid. Saliendo.')
    process.exit(0)  // Codigo 0 = exito (no es error, solo no toca)
  }

  try {
    // PASO 2: Leer correos
    console.log('Leyendo emails no leidos...')
    const emails = await fetchUnreadEmails()
    console.log('-> ' + emails.length + ' emails no leidos en las ultimas 24h')

    let groups  // Aqui guardaremos los emails ya clasificados

    // PASO 3: Clasificar
    if (emails.length > 0) {
      // Primero intentamos con Gemini (plan A)
      try {
        console.log('Clasificando con Gemini...')
        const result = await classifyWithGemini(emails)

        // Inicializamos las 4 categorias vacias
        groups = { MUY_IMPORTANTE: [], IMPORTANTE: [], NEWSLETTER_EDUCATIVA: [], RRSS: [] }

        // Distribuimos cada email segun la categoria que Gemini asigno
        emails.forEach((email, i) => {
          const item = result?.[i]
          if (item && groups[item.categoria]) {
            groups[item.categoria].push({ ...email, resumen: item.resumen || '' })
          }
          // Si item.categoria es "OTRO" o undefined, el email se ignora
        })

        console.log('  MUY IMPORTANTES:     ' + groups.MUY_IMPORTANTE.length)
        console.log('  IMPORTANTES:         ' + groups.IMPORTANTE.length)
        console.log('  NEWSLETTERS:         ' + groups.NEWSLETTER_EDUCATIVA.length)
        console.log('  RRSS:                ' + groups.RRSS.length)

      } catch (e) {
        // Si Gemini falla, usamos el plan B: palabras clave
        console.log('Gemini fallo. Usando clasificacion manual: ' + e.message)
        groups = classifyFallback(emails)
      }
    } else {
      // No hay emails: todas las categorias quedan vacias
      groups = { MUY_IMPORTANTE: [], IMPORTANTE: [], NEWSLETTER_EDUCATIVA: [], RRSS: [] }
    }

    // PASO 4+5: Generar HTML y enviar email
    console.log('Generando HTML y enviando email...')
    const html = buildHTML(groups)
    await sendEmail(html)
    console.log('Resumen enviado correctamente a ' + TO_EMAIL)

  } catch (e) {
    // Si cualquier paso falla (IMAP, Gemini, SMTP...), llegamos aqui
    console.error('Error: ' + e.message)
    process.exit(1)  // Codigo 1 = error. Railway lo registra.
  }

  // Todo correcto: salimos con exito
  process.exit(0)
}

// ================================================================
//  ARRANQUE DEL PROGRAMA
//
//  Esto es lo PRIMERO que se ejecuta cuando haces:
//    node index.js
//
//  Simplemente llama a main() para que empiece todo el proceso.
//  El await espera a que main() termine antes de cerrar.
// ================================================================

main()
