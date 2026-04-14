import {
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
  return upstreamResponse
}
