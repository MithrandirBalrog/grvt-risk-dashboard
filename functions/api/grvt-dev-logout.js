import { buildLogoutSetCookies } from '../_lib/grvt.js'

export async function onRequest(context) {
  if (context.request.method !== 'POST') {
    return new Response('Method Not Allowed', {
      status: 405,
      headers: { Allow: 'POST' },
    })
  }

  const headers = new Headers()
  for (const line of buildLogoutSetCookies(context.request)) {
    headers.append('Set-Cookie', line)
  }

  return new Response(null, { status: 204, headers })
}
