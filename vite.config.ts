import { defineConfig, type Plugin } from 'vite'
import react from '@vitejs/plugin-react'
import https from 'node:https'
import type { IncomingMessage } from 'node:http'

/**
 * Dev-only: GRVT session for trades.grvt.io. The browser cannot reliably attach
 * the HttpOnly `gravity` cookie to `/api/trades` proxy requests; we store the
 * cookie server-side after API-key login and inject it on each proxied request.
 */
let devGrvtSession: { cookieHeader: string; accountId: string } | null = null

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = []
    req.on('data', (c) => chunks.push(c))
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')))
    req.on('error', reject)
  })
}

/** First `name=value` segment from each Set-Cookie line → `Cookie` request header. */
function parseSetCookieToCookieHeader(setCookie: string | string[] | undefined): string {
  if (!setCookie) return ''
  const lines = Array.isArray(setCookie) ? setCookie : [setCookie]
  const pairs: string[] = []
  for (const line of lines) {
    const first = line.split(';')[0]?.trim()
    if (first?.includes('=')) pairs.push(first)
  }
  return pairs.join('; ')
}

function edgeApiKeyLogin(apiKey: string): Promise<{
  cookieHeader: string
  accountId: string
  body: Record<string, unknown>
}> {
  const postData = JSON.stringify({ api_key: apiKey })
  return new Promise((resolve, reject) => {
    const req = https.request(
      'https://edge.grvt.io/auth/api_key/login',
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Cookie: 'rm=true',
          'Content-Length': Buffer.byteLength(postData),
        },
      },
      (upRes) => {
        const chunks: Buffer[] = []
        upRes.on('data', (c) => chunks.push(c))
        upRes.on('end', () => {
          const text = Buffer.concat(chunks).toString('utf8')
          let body: Record<string, unknown> = {}
          try {
            body = JSON.parse(text || '{}') as Record<string, unknown>
          } catch {
            body = {}
          }
          const status = upRes.statusCode ?? 0
          const rawAid = upRes.headers['x-grvt-account-id']
          const fromHeader = (Array.isArray(rawAid) ? rawAid[0] : rawAid ?? '').trim()
          const fromBody = String(body.funding_account_address ?? '').trim()
          const accountId = fromHeader || fromBody
          const cookieHeader = parseSetCookieToCookieHeader(upRes.headers['set-cookie'])

          if (status < 200 || status >= 300) {
            devGrvtSession = null
            reject(new Error(`GRVT auth HTTP ${status}: ${text.slice(0, 500)}`))
            return
          }
          if (!cookieHeader) {
            devGrvtSession = null
            reject(new Error('GRVT login succeeded but no Set-Cookie (gravity) returned'))
            return
          }
          if (!accountId) {
            devGrvtSession = null
            reject(new Error('GRVT login succeeded but no X-Grvt-Account-Id or funding_account_address'))
            return
          }

          devGrvtSession = { cookieHeader, accountId }
          resolve({ cookieHeader, accountId, body })
        })
      },
    )
    req.on('error', reject)
    req.write(postData)
    req.end()
  })
}

function grvtDevSessionPlugin(): Plugin {
  return {
    name: 'grvt-dev-session',
    configureServer(server) {
      server.middlewares.use(async (req, res, next) => {
        const pathOnly = req.url?.split('?')[0] ?? ''

        if (pathOnly === '/api/grvt-dev-logout' && req.method === 'POST') {
          devGrvtSession = null
          res.statusCode = 204
          res.end()
          return
        }

        if (pathOnly !== '/api/grvt-dev-login' || req.method !== 'POST') {
          next()
          return
        }

        try {
          const raw = await readBody(req)
          const parsed = JSON.parse(raw || '{}') as { api_key?: string }
          const apiKey = parsed.api_key
          if (!apiKey) {
            res.statusCode = 400
            res.setHeader('Content-Type', 'application/json')
            res.end(JSON.stringify({ error: 'api_key required' }))
            return
          }

          const { accountId, body } = await edgeApiKeyLogin(apiKey)
          res.statusCode = 200
          res.setHeader('Content-Type', 'application/json')
          res.end(JSON.stringify({ ok: true, accountId, body }))
        } catch (e) {
          devGrvtSession = null
          const msg = e instanceof Error ? e.message : String(e)
          res.statusCode = 401
          res.setHeader('Content-Type', 'application/json')
          res.end(JSON.stringify({ ok: false, error: msg }))
        }
      })
    },
  }
}

export default defineConfig({
  plugins: [react(), grvtDevSessionPlugin()],
  server: {
    port: 5173,
    proxy: {
      '/api/auth': {
        target: 'https://edge.grvt.io',
        changeOrigin: true,
        secure: true,
        rewrite: (path) => path.replace('/api/auth', ''),
        configure: (proxy) => {
          proxy.on('proxyRes', (proxyRes) => {
            proxyRes.headers['access-control-expose-headers'] =
              'x-grvt-account-id, set-cookie'
            const setCookie = proxyRes.headers['set-cookie']
            if (setCookie) {
              proxyRes.headers['set-cookie'] = (
                Array.isArray(setCookie) ? setCookie : [setCookie]
              ).map((c) =>
                c
                  .replace(/Domain=[^;]+;?/gi, '')
                  .replace(/SameSite=None/gi, 'SameSite=Lax')
                  .replace(/Secure;?/gi, ''),
              )
            }
          })
        },
      },
      '/api/trades': {
        target: 'https://trades.grvt.io',
        changeOrigin: true,
        secure: true,
        rewrite: (path) => path.replace('/api/trades', ''),
        configure: (proxy) => {
          proxy.on('proxyReq', (proxyReq, req) => {
            const fromBrowser = req.headers['x-grvt-account-id']
            if (devGrvtSession) {
              proxyReq.setHeader('Cookie', devGrvtSession.cookieHeader)
              proxyReq.setHeader('X-Grvt-Account-Id', devGrvtSession.accountId)
            } else if (fromBrowser) {
              proxyReq.setHeader('X-Grvt-Account-Id', fromBrowser)
            }
          })
        },
      },
      '/api/market': {
        target: 'https://market-data.grvt.io',
        changeOrigin: true,
        secure: true,
        rewrite: (path) => path.replace('/api/market', ''),
      },
    },
  },
})
