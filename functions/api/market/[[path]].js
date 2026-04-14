import { proxyToGrvt } from '../../_lib/grvt.js'

export async function onRequest(context) {
  return proxyToGrvt(context.request, {
    baseUrl: 'https://market-data.grvt.io',
    prefix: '/api/market',
  })
}
