import type { GrvtSession } from '../types'

/** Vite dev: server stores `gravity` and injects it into `/api/trades` proxy (fixes 401). */
const DEV_LOGIN = '/api/grvt-dev-login'
const LEGACY_AUTH = '/api/auth/auth/api_key/login'

let currentSession: GrvtSession | null = null
let refreshTimer: ReturnType<typeof setTimeout> | null = null

export async function loginWithApiKey(apiKey: string): Promise<GrvtSession> {
  let response = await fetch(DEV_LOGIN, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ api_key: apiKey }),
  })

  // `vite preview` / static hosts have no dev middleware — fall back to browser cookie flow.
  if (response.status === 404 || response.status === 405) {
    response = await fetch(LEGACY_AUTH, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Cookie: 'rm=true;',
      },
      credentials: 'include',
      body: JSON.stringify({ api_key: apiKey }),
    })
  }

  if (!response.ok) {
    const text = await response.text()
    throw new Error(`GRVT auth failed ${response.status}: ${text}`)
  }

  const payload = (await response.json()) as Record<string, unknown>
  const body =
    (payload.body as Record<string, unknown> | undefined) ??
    payload

  const accountId =
    String(payload.accountId ?? '').trim() ||
    String(
      (body as { funding_account_address?: string }).funding_account_address ?? '',
    ).trim() ||
    response.headers.get('x-grvt-account-id')?.trim() ||
    ''

  console.log('[GRVT] auth accountId:', accountId, 'sub_account_id:', body.sub_account_id)

  // sub_account_id is in the body when the key was generated from a Trading Account.
  // May be missing if the key is on the funding (main) account — bootstrap will fetch it.
  const subAccountId = String(body.sub_account_id ?? '')

  const session: GrvtSession = {
    cookie: '',
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
    // Bootstrap may patch `sub_account_id` into localStorage only; merge so REST uses it.
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
