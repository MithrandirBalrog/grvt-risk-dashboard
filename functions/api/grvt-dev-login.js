import {
  appendRewrittenSetCookies,
  buildCookieNamesHelper,
  getSetCookieLines,
  parseSetCookieToCookieHeader,
  jsonResponse,
} from '../_lib/grvt.js'

export async function onRequest(context) {
  if (context.request.method !== 'POST') {
    return new Response('Method Not Allowed', {
      status: 405,
      headers: { Allow: 'POST' },
    })
  }

  let body = {}
  try {
    body = await context.request.json()
  } catch {
    body = {}
  }

  const apiKey = String(body?.api_key ?? '').trim()
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
  let upstreamBody = {}
  try {
    upstreamBody = JSON.parse(rawText || '{}')
  } catch {
    upstreamBody = {}
  }

  const accountId =
    upstreamResponse.headers.get('x-grvt-account-id')?.trim() ||
    String(upstreamBody?.funding_account_address ?? '').trim()
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
    const requestUrl = new URL(context.request.url)
    appendRewrittenSetCookies(headers, upstreamResponse.headers, requestUrl)
    headers.append('Set-Cookie', buildCookieNamesHelper(setCookieLines, requestUrl))
  }

  return jsonResponse(
    { ok: true, accountId, cookieHeader, body: upstreamBody },
    { status: 200, headers },
  )
}
