const COOKIE_NAMES_COOKIE = '__grvt_cookie_names'
const BACKEND_SESSION_COOKIE = '__grvt_backend_session'
const BACKEND_SESSION_MAX_AGE = 60 * 60 * 12

function splitCombinedSetCookie(headerValue) {
  const cookies = []
  let start = 0
  let inExpires = false

  for (let i = 0; i < headerValue.length; i += 1) {
    const lowerSlice = headerValue.slice(i, i + 8).toLowerCase()
    if (lowerSlice === 'expires=') {
      inExpires = true
      continue
    }

    const char = headerValue[i]
    if (inExpires && char === ';') {
      inExpires = false
      continue
    }

    if (char !== ',' || inExpires) {
      continue
    }

    const rest = headerValue.slice(i + 1)
    if (/^\s*[^=;, ]+=/.test(rest)) {
      cookies.push(headerValue.slice(start, i).trim())
      start = i + 1
    }
  }

  const last = headerValue.slice(start).trim()
  if (last) cookies.push(last)
  return cookies
}

export function getSetCookieLines(headers) {
  if (typeof headers.getSetCookie === 'function') {
    return headers.getSetCookie()
  }

  if (typeof headers.getAll === 'function') {
    return headers.getAll('Set-Cookie')
  }

  const raw = headers.get('Set-Cookie')
  return raw ? splitCombinedSetCookie(raw) : []
}

export function parseSetCookieToCookieHeader(setCookieLines) {
  return setCookieLines
    .map((line) => line.split(';')[0]?.trim() ?? '')
    .filter((pair) => pair.includes('='))
    .join('; ')
}

function parseCookieHeader(cookieHeader) {
  const cookies = new Map()
  if (!cookieHeader) return cookies

  for (const segment of cookieHeader.split(';')) {
    const trimmed = segment.trim()
    if (!trimmed) continue
    const eqIndex = trimmed.indexOf('=')
    if (eqIndex <= 0) continue
    const name = trimmed.slice(0, eqIndex).trim()
    const value = trimmed.slice(eqIndex + 1).trim()
    if (!name) continue
    cookies.set(name, value)
  }

  return cookies
}

function getCookieNamesFromHelper(cookieMap) {
  const raw = cookieMap.get(COOKIE_NAMES_COOKIE)
  if (!raw) return []

  try {
    const decoded = decodeURIComponent(raw)
    if (decoded.startsWith('[')) {
      const parsed = JSON.parse(decoded)
      if (Array.isArray(parsed)) {
        return parsed.filter((name) => typeof name === 'string' && name.trim())
      }
    }

    return decoded
      .split(',')
      .map((name) => name.trim())
      .filter(Boolean)
  } catch {
    return []
  }
}

function serializeCookie(name, value, url, options = {}) {
  const parts = [`${name}=${value}`]
  parts.push(`Path=${options.path ?? '/'}`)

  if (options.maxAge != null) {
    parts.push(`Max-Age=${options.maxAge}`)
  }

  if (options.expires instanceof Date) {
    parts.push(`Expires=${options.expires.toUTCString()}`)
  }

  if (options.httpOnly) {
    parts.push('HttpOnly')
  }

  parts.push(`SameSite=${options.sameSite ?? 'Lax'}`)

  if (options.secure ?? url.protocol === 'https:') {
    parts.push('Secure')
  }

  return parts.join('; ')
}

function encodeBackendSession(session) {
  return encodeURIComponent(JSON.stringify(session))
}

function decodeBackendSession(raw) {
  if (!raw) return null

  try {
    const parsed = JSON.parse(decodeURIComponent(raw))
    const cookieHeader = String(parsed?.cookieHeader ?? '').trim()
    if (!cookieHeader) return null
    const accountId = String(parsed?.accountId ?? '').trim()
    return { accountId, cookieHeader }
  } catch {
    return null
  }
}

function getBackendSession(request) {
  const cookieMap = parseCookieHeader(request.headers.get('Cookie'))
  return decodeBackendSession(cookieMap.get(BACKEND_SESSION_COOKIE))
}

export function rewriteSetCookie(setCookieLine, requestUrl) {
  let rewritten = setCookieLine
    .replace(/;\s*Domain=[^;]+/gi, '')
    .replace(/;\s*Path=[^;]*/gi, '')
    .replace(/;\s*SameSite=None/gi, '; SameSite=Lax')

  rewritten += '; Path=/'

  if (!/;\s*SameSite=/i.test(rewritten)) {
    rewritten += '; SameSite=Lax'
  }

  if (requestUrl.protocol === 'https:') {
    if (!/;\s*Secure/i.test(rewritten)) {
      rewritten += '; Secure'
    }
  } else {
    rewritten = rewritten.replace(/;\s*Secure/gi, '')
  }

  return rewritten
}

export function appendRewrittenSetCookies(targetHeaders, sourceHeaders, requestUrl) {
  for (const line of getSetCookieLines(sourceHeaders)) {
    targetHeaders.append('Set-Cookie', rewriteSetCookie(line, requestUrl))
  }
}

export function buildCookieNamesHelper(setCookieLines, requestUrl) {
  const names = setCookieLines
    .map((line) => line.split(';')[0]?.trim() ?? '')
    .map((pair) => pair.split('=')[0]?.trim() ?? '')
    .filter(Boolean)
  const uniqueNames = [...new Set(names)]
  const payload = encodeURIComponent(JSON.stringify(uniqueNames))

  return serializeCookie(COOKIE_NAMES_COOKIE, payload, requestUrl, {
    httpOnly: true,
    maxAge: 60 * 60 * 24 * 30,
  })
}

export function buildBackendSessionCookie(requestUrl, session) {
  return serializeCookie(
    BACKEND_SESSION_COOKIE,
    encodeBackendSession(session),
    requestUrl,
    {
      httpOnly: true,
      maxAge: BACKEND_SESSION_MAX_AGE,
    },
  )
}

export function buildForwardCookieHeader(request) {
  const backendSession = getBackendSession(request)
  if (backendSession?.cookieHeader) {
    return backendSession.cookieHeader
  }

  const forwardedCookie = request.headers.get('x-grvt-cookie')
  if (forwardedCookie) {
    return forwardedCookie.trim()
  }

  const cookieMap = parseCookieHeader(request.headers.get('Cookie'))
  const helperNames = getCookieNamesFromHelper(cookieMap)

  if (cookieMap.has('gravity')) {
    return `gravity=${cookieMap.get('gravity')}`
  }

  const candidateNames =
    helperNames.length > 0
      ? helperNames
      : [...cookieMap.keys()].filter((name) => name !== COOKIE_NAMES_COOKIE)

  const pairs = []
  for (const name of candidateNames) {
    if (!cookieMap.has(name)) continue
    pairs.push(`${name}=${cookieMap.get(name)}`)
  }

  return pairs.join('; ')
}

export function buildForwardAccountId(request) {
  const backendSession = getBackendSession(request)
  if (backendSession?.accountId) {
    return backendSession.accountId
  }

  return request.headers.get('x-grvt-account-id')?.trim() ?? ''
}

export function buildLogoutSetCookies(request) {
  const requestUrl = new URL(request.url)
  const cookieMap = parseCookieHeader(request.headers.get('Cookie'))
  const helperNames = getCookieNamesFromHelper(cookieMap)
  const cookieNames = [...new Set([COOKIE_NAMES_COOKIE, BACKEND_SESSION_COOKIE, 'gravity', ...helperNames])]

  return cookieNames.map((name) =>
    serializeCookie(name, '', requestUrl, {
      httpOnly: true,
      expires: new Date(0),
      maxAge: 0,
    }),
  )
}

function copyResponseHeaders(upstreamHeaders) {
  const headers = new Headers()
  for (const [key, value] of upstreamHeaders.entries()) {
    if (key.toLowerCase() === 'set-cookie') continue
    headers.set(key, value)
  }
  return headers
}

export async function proxyToGrvt(request, options) {
  const {
    baseUrl,
    prefix,
    includeAuthCookies = false,
    rewriteUpstreamCookies = false,
    extraHeaders = {},
  } = options
  const requestUrl = new URL(request.url)
  const suffix = requestUrl.pathname.slice(prefix.length)
  const upstreamUrl = new URL(`${baseUrl}${suffix}${requestUrl.search}`)

  const headers = new Headers()

  for (const headerName of ['accept', 'content-type']) {
    const value = request.headers.get(headerName)
    if (value) headers.set(headerName, value)
  }

  if (includeAuthCookies) {
    const cookieHeader = buildForwardCookieHeader(request)
    if (cookieHeader) headers.set('cookie', cookieHeader)
    const accountId = buildForwardAccountId(request)
    if (accountId) headers.set('x-grvt-account-id', accountId)
  } else {
    const accountId = request.headers.get('x-grvt-account-id')
    if (accountId) headers.set('x-grvt-account-id', accountId)
  }

  for (const [key, value] of Object.entries(extraHeaders)) {
    if (value == null || value === '') continue
    headers.set(key, value)
  }

  const init = {
    method: request.method,
    headers,
    redirect: 'manual',
  }

  if (!['GET', 'HEAD'].includes(request.method)) {
    init.body = await request.arrayBuffer()
  }

  const upstreamResponse = await fetch(upstreamUrl, init)
  const responseHeaders = copyResponseHeaders(upstreamResponse.headers)

  if (rewriteUpstreamCookies) {
    appendRewrittenSetCookies(responseHeaders, upstreamResponse.headers, requestUrl)
  }

  return new Response(upstreamResponse.body, {
    status: upstreamResponse.status,
    statusText: upstreamResponse.statusText,
    headers: responseHeaders,
  })
}

export function jsonResponse(payload, init = {}) {
  const headers = new Headers(init.headers)
  if (!headers.has('Content-Type')) {
    headers.set('Content-Type', 'application/json')
  }

  return new Response(JSON.stringify(payload), {
    ...init,
    headers,
  })
}
