import { proxyToGrvt } from '../../_lib/grvt.js'

export async function onRequest(context) {
  const requestUrl = new URL(context.request.url)
  const isApiKeyLogin =
    context.request.method === 'POST' &&
    requestUrl.pathname === '/api/auth/auth/api_key/login'

  if (isApiKeyLogin) {
    return fetch('https://edge.grvt.io/auth/api_key/login', {
      method: 'POST',
      headers: {
        'Content-Type': context.request.headers.get('content-type') ?? 'application/json',
        Cookie: 'rm=true',
      },
      body: await context.request.arrayBuffer(),
    })
  }

  return proxyToGrvt(context.request, {
    baseUrl: 'https://edge.grvt.io',
    prefix: '/api/auth',
    rewriteUpstreamCookies: true,
  })
}
