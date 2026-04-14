// @ts-nocheck
import {
  appendRewrittenSetCookies,
  buildBackendSessionCookie,
  buildCookieNamesHelper,
  buildLogoutSetCookies,
  getSetCookieLines,
  jsonResponse,
  parseSetCookieToCookieHeader,
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

  const upstreamResponse = await fetch('https://edge.grvt.io/auth/api_key/login', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Cookie: 'rm=true',
    },
    body: JSON.stringify({ api_key: apiKey }),
  })

  const rawText = await upstreamResponse.text()
  let upstreamBody: Record<string, unknown> = {}
  try {
    upstreamBody = JSON.parse(rawText || '{}') as Record<string, unknown>
  } catch {
    upstreamBody = {}
  }

  const accountId =
    upstreamResponse.headers.get('x-grvt-account-id')?.trim() ||
    String(upstreamBody.funding_account_address ?? '').trim()
  const setCookieLines = getSetCookieLines(upstreamResponse.headers)
  const cookieHeader = parseSetCookieToCookieHeader(setCookieLines)

  if (!upstreamResponse.ok) {
    return jsonResponse(
      { ok: false, error: `GRVT auth HTTP ${upstreamResponse.status}: ${rawText.slice(0, 500)}` },
      { status: 401 },
    )
  }

  if (!accountId) {
    return jsonResponse(
      { ok: false, error: 'GRVT login succeeded but no account id was returned' },
      { status: 502 },
    )
  }

  if (!cookieHeader) {
    return jsonResponse(
      { ok: false, error: 'GRVT login succeeded but no auth cookie was returned' },
      { status: 502 },
    )
  }

  const headers = new Headers({
    'Content-Type': 'application/json',
    'X-Grvt-Account-Id': accountId,
  })

  if (setCookieLines.length > 0) {
    const requestUrl = new URL(request.url)
    appendRewrittenSetCookies(headers, upstreamResponse.headers, requestUrl)
    headers.append('Set-Cookie', buildCookieNamesHelper(setCookieLines, requestUrl))
    headers.append('Set-Cookie', buildBackendSessionCookie(requestUrl, { accountId, cookieHeader }))
  }

  return jsonResponse(
    { ok: true, accountId, cookieHeader, body: upstreamBody },
    { status: 200, headers },
  )
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
