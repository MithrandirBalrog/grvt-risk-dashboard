declare module '../functions/_lib/grvt.js' {
  export function appendRewrittenSetCookies(
    targetHeaders: Headers,
    sourceHeaders: Headers,
    requestUrl: URL,
  ): void

  export function buildCookieNamesHelper(
    setCookieLines: string[],
    requestUrl: URL,
  ): string

  export function buildLogoutSetCookies(request: Request): string[]

  export function getSetCookieLines(headers: Headers): string[]

  export function jsonResponse(
    payload: unknown,
    init?: ResponseInit,
  ): Response

  export function proxyToGrvt(
    request: Request,
    options: {
      baseUrl: string
      prefix: string
      includeAuthCookies?: boolean
      rewriteUpstreamCookies?: boolean
      extraHeaders?: Record<string, string>
    },
  ): Promise<Response>
}
