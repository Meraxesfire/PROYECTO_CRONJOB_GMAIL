# ☀️ Resumen Diario Gmail

Automatización que cada mañana a las **08:30 (hora Madrid)** revisa tu Gmail, clasifica los correos no leídos de las últimas 24h con **IA (Gemini)** y te envía un resumen con 4 bloques temáticos.

Coste total: **0 €** — Railway free tier + Gemini free tier + Gmail gratuito.

---

## Requisitos previos

- Node.js v18+
- Cuenta de Gmail con **2FA activado**
- Una **App Password** de Gmail (generarla en [myaccount.google.com/apppasswords](https://myaccount.google.com/apppasswords))
- Una **API Key** de Google Gemini (gratis en [aistudio.google.com/apikey](https://aistudio.google.com/apikey))
- Cuenta en [Railway](https://railway.app) (para el cronjob en la nube)

---

## Archivos del proyecto

```
├── .env              ← Variables de entorno (NO se sube a git)
├── .gitignore        ← Ignora node_modules y .env
├── package.json      ← Dependencias del proyecto
├── railway.json      ← Configuración del cron en Railway
└── index.js          ← Toda la lógica (~250 líneas)
```

---

## Configuración local

### 1. Variables de entorno

Crea un archivo `.env` en la raíz del proyecto:

```env
GMAIL_EMAIL=isabelcaromorillo@gmail.com
GMAIL_APP_PASSWORD=tu_app_password_sin_espacios
GEMINI_API_KEY=AIza...
TO_EMAIL=isabelcaromorillo@gmail.com
```

### 2. Instalar dependencias

```bash
npm install
```

### 3. Probar localmente

Para saltar la comprobación de hora, edita `index.js` línea ~205:

```javascript
// Cambiar temporalmente de:
if (!isMadrid830()) {
// a:
if (false) {
```

Y ejecuta:

```bash
node index.js
```

**No olvides revertir** el cambio antes de subir a producción:

```javascript
if (!isMadrid830()) {
```

---

## Cómo funciona

```
Railway cron (6:30 y 7:30 UTC)
       │
       ▼
main() se ejecuta
       │
       ▼
¿Son las 08:30 en Madrid?  ──No──▶ process.exit(0)
       │ Sí
       ▼
fetchUnreadEmails()
  ──▶ IMAP imap.gmail.com:993
  ──▶ Busca emails no leídos ("UNSEEN")
  ──▶ Filtra solo los de las últimas 24h
       │
       ▼
classifyWithGemini()
  ──▶ Gemini 1.5 Flash
  ──▶ Clasifica cada email + genera resumen de 1 línea
  ──▶ Agrupa en 4 categorías
       │
       ▼ (si Gemini falla → classifyFallback por palabras clave)
       │
       ▼
buildHTML()
  ──▶ Genera email HTML con diseño responsive y estilos inline
       │
       ▼
sendEmail()
  ──▶ SMTP smtp.gmail.com
  ──▶ Envía el resumen a isabelcaromorillo@gmail.com
       │
       ▼
✅ ¡Listo! Hasta mañana a las 08:30
```

---

## Las 4 categorías del resumen

| Categoría | Icono | Color | Ejemplos |
|-----------|-------|-------|----------|
| **MUY IMPORTANTES** | 🔴 | Rojo | Administraciones, Ilerna, alertas seguridad, Railway |
| **IMPORTANTES** | 🟡 | Ámbar | Tareas, recordatorios, personas conocidas |
| **NEWSLETTERS EDUCATIVAS** | 🟢 | Verde | Udemy, Duolingo, Brilliant, Mimo |
| **REDES SOCIALES** | 🔵 | Azul | LinkedIn, Twitter, Instagram |

Si una categoría no tiene emails, el bloque muestra:
> ✅ No hay nada nuevo en esta sección hoy

---

## Despliegue en Railway

### 1. Subir a GitHub

```bash
git add .
git commit -m "Initial commit"
git push origin main
```

### 2. Conectar Railway

1. Ve a [railway.app](https://railway.app) → **New Project** → **Deploy from GitHub repo**
2. Selecciona tu repositorio (`Meraxesfire/PROYECTO_CRONJOB_GMAIL`)
3. Si no aparece, instala la Railway App en GitHub y concede acceso al repositorio

### 3. Variables de entorno

En el dashboard de Railway → pestaña **Variables**, añade:

| Variable | Valor |
|----------|-------|
| `GMAIL_EMAIL` | `isabelcaromorillo@gmail.com` |
| `GMAIL_APP_PASSWORD` | Tu App Password (sin espacios) |
| `GEMINI_API_KEY` | Tu API Key de Gemini |
| `TO_EMAIL` | `isabelcaromorillo@gmail.com` |

### 4. Configuración del cron

El archivo `railway.json` ya incluye la configuración:

```json
{
  "$schema": "https://railway.com/railway.schema.json",
  "deploy": {
    "cronSchedule": "30 6,7 * * *"
  }
}
```

Esto ejecuta el script a las 6:30 y 7:30 UTC. El código filtra internamente con `isMadrid830()` para ejecutarse solo cuando en Madrid son las 08:30, funcionando tanto en horario de verano como de invierno.

---

## Detalle de funciones

### `isMadrid830()`
Verifica si la hora actual en Europe/Madrid son las **08:30** usando `Intl.DateTimeFormat` con `timeZone: 'Europe/Madrid'`. Funciona automáticamente con cambios de horario de verano/invierno.

### `fetchUnreadEmails()`
- Conecta a **IMAP de Gmail** (imap.gmail.com:993, SSL)
- Busca todos los emails **no leídos** (`UNSEEN`)
- Filtra los de las **últimas 24h** comparando la fecha interna del servidor
- Devuelve array de objetos: `{ fromName, fromAddress, subject, date }`

### `classifyWithGemini(emails)`
- Envía **todos los emails en una sola llamada** a Gemini 1.5 Flash
- Prompt en español pidiendo clasificación por categorías + resumen de 1 línea
- Recibe un JSON array con `{ categoria, resumen }` por cada email
- Los emails clasificados como `OTRO` se descartan

### `classifyFallback(emails)`
**Fallback automático** cuando Gemini falla (límite de cuota, error de red, etc):
- Usa **expresiones regulares** sobre remitente + asunto
- Detecta palabras clave como `ilerna`, `railway`, `udemy`, `linkedin`, etc.
- Cubre las 4 categorías con patrones en español

### `buildHTML(groups)`
Genera el HTML completo del email con:
- **Header:** degradado púrpura con saludo personalizado y fecha
- **4 bloques:** cada uno con su color de fondo y borde
- **Tarjetas:** remitente, asunto y resumen por cada email
- **Estado vacío:** mensaje suave si no hay emails en una categoría
- **Footer:** "Generado automáticamente · 08:30 Madrid"
- Todos los estilos son **inline** (compatibles con Gmail, Outlook, etc.)
- Función `esc()` para escapar caracteres HTML peligrosos

### `sendEmail(html)`
- Envía el email mediante **Nodemailer**
- SMTP de Gmail (smtp.gmail.com, STARTTLS)
- Autenticación con **App Password**
- Asunto dinámico con la fecha del día

---

## Costes

| Servicio | Plan | Coste |
|----------|------|-------|
| Gmail IMAP/SMTP | Gratuito | 0 € |
| Gemini API | Free tier (60 req/min, 1500 req/día) | 0 € |
| Railway | Free tier (500 horas/mes) | 0 € |
| **Total mensual** | | **0 €** |

---

## Posibles errores

| Error | Causa | Solución |
|-------|-------|----------|
| `Faltan variables de entorno` | No hay `.env` local o no están en Railway | Añadir las 4 variables en el dashboard de Railway |
| `ETIMEOUT smtp.gmail.com` | Puerto 587/465 bloqueado por red local | Railway no tiene este problema; o probar con puerto 587 |
| `ETIMEOUT imap.gmail.com` | Puerto 993 bloqueado por red local | Railway no tiene este problema |
| `Gemini falló: ...` | Límite de cuota o error de red | Se activa `classifyFallback()` automáticamente |
