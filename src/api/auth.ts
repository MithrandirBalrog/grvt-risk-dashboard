import type { GrvtSession } from '../types'

const DEV_LOGIN = '/api/grvt-dev-login'
const LEGACY_AUTH = '/api/auth/auth/api_key/login'

let currentSession: GrvtSession | null = null
let refreshTimer: ReturnType<typeof setTimeout> | null = null

export async function loginWithApiKey(apiKey: string): Promise<GrvtSession> {
  let response = await fetch(LEGACY_AUTH, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    credentials: 'include',
    body: JSON.stringify({ api_key: apiKey }),
  })

  if (response.status === 404 || response.status === 405) {
    response = await fetch(DEV_LOGIN, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ api_key: apiKey }),
    })
  }

  if (!response.ok) {
    const text = await response.text()
    throw new Error(`GRVT auth failed ${response.status}: ${text}`)
  }

  const rawText = await response.text()
  let payload: Record<string, unknown> = {}
  try {
    payload = (rawText ? JSON.parse(rawText) : {}) as Record<string, unknown>
  } catch {
    payload = {}
  }

  const body =
    (payload.body as Record<string, unknown> | undefined) ??
    payload

  const accountId =
    response.headers.get('x-grvt-account-id')?.trim() ||
    String(payload.accountId ?? '').trim() ||
    String(
      (body as { funding_account_address?: string }).funding_account_address ?? '',
    ).trim() ||
    ''

  const cookieHeader =
    String(payload.cookieHeader ?? '').trim() ||
    String((body as { cookieHeader?: string }).cookieHeader ?? '').trim()

  console.log('[GRVT] auth accountId:', accountId, 'sub_account_id:', body.sub_account_id)

  const subAccountId = String(body.sub_account_id ?? '')

  const session: GrvtSession = {
    cookie: cookieHeader,
    accountId,
    subAccountId,
    expiresAt: Date.now() + 25 * 60 * 1000,
  }

  currentSession = session
  persistSession(session)
  scheduleRefresh(apiKey)

  return session
}

export function getSession(): GrvtSession | null {
  if (currentSession && currentSession.expiresAt > Date.now()) {
    const stored = loadSession()
    if (stored?.subAccountId && !currentSession.subAccountId) {
      currentSession = { ...currentSession, subAccountId: stored.subAccountId }
    }
    return currentSession
  }

  const stored = loadSession()
  if (stored && stored.expiresAt > Date.now()) {
    currentSession = stored
    return stored
  }

  return null
}

export function clearSession(): void {
  currentSession = null
  if (refreshTimer) clearTimeout(refreshTimer)
  localStorage.removeItem('grvt_session')
  void fetch('/api/grvt-dev-logout', { method: 'POST' }).catch(() => {})
}

function scheduleRefresh(apiKey: string): void {
  if (refreshTimer) clearTimeout(refreshTimer)
  refreshTimer = setTimeout(async () => {
    try {
      await loginWithApiKey(apiKey)
    } catch (e) {
      console.error('GRVT session refresh failed', e)
    }
  }, 24 * 60 * 1000)
}

function persistSession(session: GrvtSession): void {
  localStorage.setItem('grvt_session', JSON.stringify(session))
}

function loadSession(): GrvtSession | null {
  try {
    const raw = localStorage.getItem('grvt_session')
    if (!raw) return null
    return JSON.parse(raw)
  } catch {
    return null
  }
}
