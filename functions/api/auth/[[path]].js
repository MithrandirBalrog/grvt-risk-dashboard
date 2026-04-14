import {
  appendRewrittenSetCookies,
  buildBackendSessionCookie,
  buildCookieNamesHelper,
  getSetCookieLines,
  parseSetCookieToCookieHeader,
  proxyToGrvt,
} from '../../_lib/grvt.js'

function copyUpstreamHeaders(upstreamHeaders) {
  const headers = new Headers()
  for (const [key, value] of upstreamHeaders.entries()) {
    if (key.toLowerCase() === 'set-cookie') continue
    headers.set(key, value)
  }
  return headers
}

export async function onRequest(context) {
  const requestUrl = new URL(context.request.url)
  const isApiKeyLogin =
    context.request.method === 'POST' &&
    requestUrl.pathname === '/api/auth/auth/api_key/login'

  if (isApiKeyLogin) {
    const upstreamResponse = await fetch('https://edge.grvt.io/auth/api_key/login', {
      method: 'POST',
      headers: {
        'Content-Type': context.request.headers.get('content-type') ?? 'application/json',
        Cookie: 'rm=true',
      },
      body: await context.request.arrayBuffer(),
    })

    const setCookieLines = getSetCookieLines(upstreamResponse.headers)
    if (setCookieLines.length === 0) {
      return upstreamResponse
    }

    const headers = copyUpstreamHeaders(upstreamResponse.headers)
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
    const cookieHeader = parseSetCookieToCookieHeader(setCookieLines)

    appendRewrittenSetCookies(headers, upstreamResponse.headers, requestUrl)
    headers.append('Set-Cookie', buildCookieNamesHelper(setCookieLines, requestUrl))
    if (cookieHeader) {
      headers.append('Set-Cookie', buildBackendSessionCookie(requestUrl, { accountId, cookieHeader }))
    }

    return new Response(rawText, {
      status: upstreamResponse.status,
      statusText: upstreamResponse.statusText,
      headers,
    })
  }

  return proxyToGrvt(context.request, {
    baseUrl: 'https://edge.grvt.io',
    prefix: '/api/auth',
    rewriteUpstreamCookies: true,
  })
}
