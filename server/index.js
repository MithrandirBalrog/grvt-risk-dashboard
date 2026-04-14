import express from 'express'
import { createProxyMiddleware } from 'http-proxy-middleware'
import { existsSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const projectRoot = path.resolve(__dirname, '..')
const distDir = path.join(projectRoot, 'dist')
const indexFile = path.join(distDir, 'index.html')

const HOST = process.env.HOST ?? '0.0.0.0'
const PORT = Number(process.env.PORT ?? 4173)

let grvtSession = null

function getSetCookieLines(headers) {
  if (typeof headers.getSetCookie === 'function') {
    return headers.getSetCookie()
  }

  const header = headers.get('set-cookie')
  return header ? [header] : []
}

function parseSetCookieToCookieHeader(setCookieLines) {
  return setCookieLines
    .map((line) => line.split(';')[0]?.trim() ?? '')
    .filter((pair) => pair.includes('='))
    .join('; ')
}

function rewriteSetCookie(setCookieHeader) {
  const lines = Array.isArray(setCookieHeader) ? setCookieHeader : [setCookieHeader]
  return lines.map((line) =>
    line
      .replace(/Domain=[^;]+;?/gi, '')
      .replace(/SameSite=None/gi, 'SameSite=Lax')
      .replace(/Secure;?/gi, ''),
  )
}

async function edgeApiKeyLogin(apiKey) {
  const response = await fetch('https://edge.grvt.io/auth/api_key/login', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Cookie: 'rm=true',
    },
    body: JSON.stringify({ api_key: apiKey }),
  })

  const rawText = await response.text()
  let body = {}
  try {
    body = JSON.parse(rawText || '{}')
  } catch {
    body = {}
  }

  const cookieHeader = parseSetCookieToCookieHeader(getSetCookieLines(response.headers))
  const accountId =
    response.headers.get('x-grvt-account-id')?.trim() ||
    String(body.funding_account_address ?? '').trim()

  if (!response.ok) {
    throw new Error(`GRVT auth HTTP ${response.status}: ${rawText.slice(0, 500)}`)
  }

  if (!cookieHeader) {
    throw new Error('GRVT login succeeded but no Set-Cookie (gravity) returned')
  }

  if (!accountId) {
    throw new Error('GRVT login succeeded but no account id was returned')
  }

  grvtSession = { cookieHeader, accountId }
  return { ok: true, accountId, body }
}

if (!existsSync(indexFile)) {
  console.error(`Missing build output: ${indexFile}. Run "npm run build" first.`)
  process.exit(1)
}

const app = express()
app.disable('x-powered-by')

app.get('/healthz', (_req, res) => {
  res.json({ ok: true, sessionActive: Boolean(grvtSession) })
})

app.post('/api/grvt-dev-login', express.json(), async (req, res) => {
  try {
    const apiKey = String(req.body?.api_key ?? '').trim()
    if (!apiKey) {
      res.status(400).json({ error: 'api_key required' })
      return
    }

    const payload = await edgeApiKeyLogin(apiKey)
    res.json(payload)
  } catch (error) {
    grvtSession = null
    const message = error instanceof Error ? error.message : String(error)
    res.status(401).json({ ok: false, error: message })
  }
})

app.post('/api/grvt-dev-logout', (_req, res) => {
  grvtSession = null
  res.status(204).end()
})

app.use(
  '/api/auth',
  createProxyMiddleware({
    target: 'https://edge.grvt.io',
    changeOrigin: true,
    secure: true,
    pathRewrite: (pathValue) => pathValue.replace(/^\/api\/auth/, ''),
    on: {
      proxyRes(proxyRes) {
        proxyRes.headers['access-control-expose-headers'] = 'x-grvt-account-id, set-cookie'
        const setCookie = proxyRes.headers['set-cookie']
        if (setCookie) {
          proxyRes.headers['set-cookie'] = rewriteSetCookie(setCookie)
        }
      },
    },
  }),
)

app.use(
  '/api/trades',
  createProxyMiddleware({
    target: 'https://trades.grvt.io',
    changeOrigin: true,
    secure: true,
    pathRewrite: (pathValue) => pathValue.replace(/^\/api\/trades/, ''),
    on: {
      proxyReq(proxyReq, req) {
        const browserAccountId = req.headers['x-grvt-account-id']
        if (grvtSession) {
          proxyReq.setHeader('Cookie', grvtSession.cookieHeader)
          proxyReq.setHeader('X-Grvt-Account-Id', grvtSession.accountId)
          return
        }

        if (browserAccountId) {
          proxyReq.setHeader('X-Grvt-Account-Id', browserAccountId)
        }
      },
    },
  }),
)

app.use(
  '/api/market',
  createProxyMiddleware({
    target: 'https://market-data.grvt.io',
    changeOrigin: true,
    secure: true,
    pathRewrite: (pathValue) => pathValue.replace(/^\/api\/market/, ''),
  }),
)

app.use(express.static(distDir, { index: false }))

app.use((req, res, next) => {
  if (req.path.startsWith('/api/')) {
    res.status(404).json({ error: 'Not found' })
    return
  }

  if (req.method !== 'GET' && req.method !== 'HEAD') {
    next()
    return
  }

  res.sendFile(indexFile)
})

app.listen(PORT, HOST, () => {
  console.log(`GRVT dashboard server listening on http://${HOST}:${PORT}`)
})
