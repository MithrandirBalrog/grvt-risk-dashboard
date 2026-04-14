// @ts-nocheck
import {
  buildLogoutSetCookies,
  jsonResponse,
  proxyToGrvt,
} from '../functions/_lib/grvt.js'

interface Env {
  ASSETS: {
    fetch(request: Request): Promise<Response>
  }
}

function methodNotAllowed(allowed: string[]): Response {
  return new Response('Method Not Allowed', {
    status: 405,
    headers: { Allow: allowed.join(', ') },
  })
}

async function handleDevLogin(request: Request): Promise<Response> {
  if (request.method !== 'POST') {
    return methodNotAllowed(['POST'])
  }

  let body: Record<string, unknown> = {}
  try {
    body = (await request.json()) as Record<string, unknown>
  } catch {
    body = {}
  }

  const apiKey = String(body.api_key ?? '').trim()
  if (!apiKey) {
    return jsonResponse({ error: 'api_key required' }, { status: 400 })
  }

  return fetch('https://edge.grvt.io/auth/api_key/login', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Cookie: 'rm=true',
    },
    body: JSON.stringify({ api_key: apiKey }),
  })
}

function handleDevLogout(request: Request): Response {
  if (request.method !== 'POST') {
    return methodNotAllowed(['POST'])
  }

  const headers = new Headers()
  for (const line of buildLogoutSetCookies(request)) {
    headers.append('Set-Cookie', line)
  }

  return new Response(null, { status: 204, headers })
}

async function routeApi(request: Request): Promise<Response> {
  const requestUrl = new URL(request.url)
  const pathname = requestUrl.pathname

  if (pathname === '/api/grvt-dev-login') {
    return handleDevLogin(request)
  }

  if (pathname === '/api/grvt-dev-logout') {
    return handleDevLogout(request)
  }

  if (pathname.startsWith('/api/trades/')) {
    return proxyToGrvt(request, {
      baseUrl: 'https://trades.grvt.io',
      prefix: '/api/trades',
      includeAuthCookies: true,
    })
  }

  if (pathname.startsWith('/api/market/')) {
    return proxyToGrvt(request, {
      baseUrl: 'https://market-data.grvt.io',
      prefix: '/api/market',
    })
  }

  if (pathname.startsWith('/api/auth/')) {
    const isApiKeyLogin =
      request.method === 'POST' &&
      pathname === '/api/auth/auth/api_key/login'

    if (isApiKeyLogin) {
      return fetch('https://edge.grvt.io/auth/api_key/login', {
        method: 'POST',
        headers: {
          'Content-Type': request.headers.get('content-type') ?? 'application/json',
          Cookie: 'rm=true',
        },
        body: await request.arrayBuffer(),
      })
    }

    return proxyToGrvt(request, {
      baseUrl: 'https://edge.grvt.io',
      prefix: '/api/auth',
      rewriteUpstreamCookies: true,
    })
  }

  if (pathname === '/healthz') {
    return jsonResponse({ ok: true, runtime: 'cloudflare-worker' })
  }

  return jsonResponse({ error: 'Not found' }, { status: 404 })
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const pathname = new URL(request.url).pathname

    if (pathname.startsWith('/api/') || pathname === '/healthz') {
      return routeApi(request)
    }

    return env.ASSETS.fetch(request)
  },
}
