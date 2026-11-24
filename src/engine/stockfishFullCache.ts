export type StockfishFlavor = 'lite' | 'full'

const CACHE_NAME = 'justchess-sf19-full-v1'
const READY_FLAG_KEY = 'justchess-sf19-full-ready'

export function getStockfishWorkerUrl(flavor: StockfishFlavor): string {
  const base = `${import.meta.env.BASE_URL}stockfish/`
  return flavor === 'full'
    ? `${base}stockfish-19-single.js`
    : `${base}stockfish-19-lite-single.js`
}

export function getStockfishWasmUrl(flavor: StockfishFlavor): string {
  const base = `${import.meta.env.BASE_URL}stockfish/`
  return flavor === 'full'
    ? `${base}stockfish-19-single.wasm`
    : `${base}stockfish-19-lite-single.wasm`
}

export async function isFullStockfishCached(): Promise<boolean> {
  if (typeof window === 'undefined') return false
  try {
    if ('caches' in window) {
      const cache = await window.caches.open(CACHE_NAME)
      const hit = await cache.match(getStockfishWasmUrl('full'))
      if (hit) return true
    }
    return window.localStorage.getItem(READY_FLAG_KEY) === '1'
  } catch {
    return false
  }
}

/**
 * Downloads Stockfish 19 Full NNUE (~94.5 MB) on demand with live percentage progress
 * and stores it in the browser Cache Storage so it only needs to be downloaded once.
 */
export async function downloadFullStockfish(
  onProgress: (percent: number) => void,
  signal?: AbortSignal,
): Promise<void> {
  const jsUrl = getStockfishWorkerUrl('full')
  const wasmUrl = getStockfishWasmUrl('full')

  // 1. Fetch tiny JS loader first
  const jsRes = await fetch(jsUrl, { signal })
  if (!jsRes.ok) {
    throw new Error(`HTTP ${jsRes.status} khi tải Stockfish 19 Full JS`)
  }
  const jsClone = jsRes.clone()

  // 2. Stream the ~94.5 MB WASM binary with real-time progress
  const wasmRes = await fetch(wasmUrl, { signal })
  if (!wasmRes.ok) {
    throw new Error(`HTTP ${wasmRes.status} khi tải Stockfish 19 Full WASM`)
  }

  const contentLength = Number(wasmRes.headers.get('content-length') || 0)
  const expectedTotal = contentLength > 0 ? contentLength : 99_160_000

  let loaded = 0
  const chunks: Uint8Array[] = []
  const reader = wasmRes.body?.getReader()

  if (reader) {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      if (value) {
        chunks.push(value)
        loaded += value.byteLength
        const pct = Math.min(99, Math.round((loaded / expectedTotal) * 100))
        onProgress(pct)
      }
    }
  } else {
    const buf = new Uint8Array(await wasmRes.arrayBuffer())
    chunks.push(buf)
    loaded = buf.byteLength
  }

  // Merge chunks into a clean ArrayBuffer for Cache Storage
  const merged = new Uint8Array(loaded)
  let offset = 0
  for (const chunk of chunks) {
    merged.set(chunk, offset)
    offset += chunk.byteLength
  }

  if (typeof window !== 'undefined' && 'caches' in window) {
    try {
      const cache = await window.caches.open(CACHE_NAME)
      await cache.put(jsUrl, jsClone)
      await cache.put(
        wasmUrl,
        new Response(merged.buffer, {
          status: 200,
          headers: { 'Content-Type': 'application/wasm' },
        }),
      )
    } catch {
      // Browser HTTP cache still retains the downloaded binary
    }
  }

  try {
    window.localStorage.setItem(READY_FLAG_KEY, '1')
  } catch {
    // Ignore storage errors
  }
  onProgress(100)
}
