import { getSession } from './auth'

type MessageHandler = (data: unknown) => void

interface Subscription {
  stream: string
  feed: string[]
  handler: MessageHandler
}

class GrvtWebSocketClient {
  private ws: WebSocket | null = null
  private subscriptions: Map<string, Subscription> = new Map()
  private reconnectDelay = 1000
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null
  private isConnecting = false
  private pingInterval: ReturnType<typeof setInterval> | null = null

  connect(url: string): void {
    if (this.isConnecting || this.ws?.readyState === WebSocket.OPEN) return
    this.isConnecting = true

    const session = getSession()
    const wsUrl = session?.accountId
      ? `${url}?x_grvt_account_id=${session.accountId}`
      : url

    this.ws = new WebSocket(wsUrl)

    this.ws.onopen = () => {
      this.isConnecting = false
      this.reconnectDelay = 1000
      console.log('[GRVT WS] Connected')
      this.resubscribeAll()
      this.startPing()
    }

    this.ws.onmessage = (event) => {
      try {
        const msg = JSON.parse(event.data)
        const stream = msg.stream as string
        if (stream) {
          const sub = this.subscriptions.get(stream)
          if (sub) sub.handler(msg.feed ?? msg.data ?? msg)
        }
      } catch {
        // ignore malformed messages
      }
    }

    this.ws.onclose = () => {
      this.isConnecting = false
      this.stopPing()
      console.log('[GRVT WS] Disconnected, reconnecting…')
      this.scheduleReconnect(url)
    }

    this.ws.onerror = (err) => {
      console.error('[GRVT WS] Error', err)
      this.ws?.close()
    }
  }

  subscribe(stream: string, feed: string[], handler: MessageHandler): void {
    this.subscriptions.set(stream, { stream, feed, handler })
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.sendSubscription(stream, feed)
    }
  }

  unsubscribe(stream: string): void {
    this.subscriptions.delete(stream)
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify({ stream, method: 'unsubscribe', feed: [] }))
    }
  }

  disconnect(): void {
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer)
    this.stopPing()
    this.ws?.close()
    this.ws = null
    this.subscriptions.clear()
  }

  private sendSubscription(stream: string, feed: string[]): void {
    this.ws?.send(
      JSON.stringify({ stream, feed, method: 'subscribe', is_full: true }),
    )
  }

  private resubscribeAll(): void {
    this.subscriptions.forEach(({ stream, feed }) => {
      this.sendSubscription(stream, feed)
    })
  }

  private scheduleReconnect(url: string): void {
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer)
    this.reconnectTimer = setTimeout(() => {
      this.reconnectDelay = Math.min(this.reconnectDelay * 2, 30000)
      this.connect(url)
    }, this.reconnectDelay)
  }

  private startPing(): void {
    this.pingInterval = setInterval(() => {
      if (this.ws?.readyState === WebSocket.OPEN) {
        this.ws.send(JSON.stringify({ op: 'ping' }))
      }
    }, 20000)
  }

  private stopPing(): void {
    if (this.pingInterval) clearInterval(this.pingInterval)
  }
}

export const tradesWs = new GrvtWebSocketClient()
export const marketWs = new GrvtWebSocketClient()

export const WS_STREAMS = {
  POSITIONS: 'v1.position',
  ORDERS: 'v1.order',
  FILLS: 'v1.fill',
  MINI_TICKER: 'v1.mini.ticker',
  FUNDING: 'v1.funding',
  BOOK_TICKER: 'v1.book.ticker',
} as const
