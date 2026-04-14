import { proxyToGrvt } from '../../_lib/grvt.js'

export async function onRequest(context) {
  return proxyToGrvt(context.request, {
    baseUrl: 'https://trades.grvt.io',
    prefix: '/api/trades',
    includeAuthCookies: true,
  })
}
