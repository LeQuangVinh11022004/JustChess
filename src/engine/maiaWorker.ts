import { Chess, type Move } from 'chess.js'
import * as ort from 'onnxruntime-web'
import allMovesMaia3Dict from './data/all_moves_maia3.json'
import allMovesMaia3ReversedDict from './data/all_moves_maia3_reversed.json'

const allMovesMaia3 = allMovesMaia3Dict as Record<string, number>
const allMovesMaia3Reversed = allMovesMaia3ReversedDict as Record<
  string,
  string
>

const MAIA3_MODEL_URL =
  'https://raw.githubusercontent.com/CSSLab/maia-platform-frontend/main/public/maia3/maia3_simplified.onnx'
const DB_NAME = 'JustChessMaiaDB'
const STORE_NAME = 'models'
const MODEL_KEY = 'maia3_simplified_v1'

export interface MaiaMovePrediction {
  uci: string
  san: string
  probability: number
}

export interface MaiaInferenceResult {
  elo: number
  /** White win probability (0–100) */
  whiteWinPercent: number
  /** [loss, draw, win] from side-to-move perspective */
  wdl: [number, number, number]
  topMoves: MaiaMovePrediction[]
  bestMove: string | null
}

export type MaiaWorkerRequest =
  | { type: 'init' }
  | { type: 'download' }
  | { type: 'analyze'; id: number; fen: string; elo: number }

export type MaiaWorkerResponse =
  | { type: 'status'; status: 'idle' | 'downloading' | 'loading' | 'ready' | 'error'; error?: string }
  | { type: 'progress'; percent: number }
  | { type: 'result'; id: number; fen: string; elo: number; data: MaiaInferenceResult }
  | { type: 'error'; id?: number; message: string }

// Configure single-threaded WASM so no COOP/COEP headers are required
ort.env.wasm.numThreads = 1
ort.env.wasm.simd = true

let session: ort.InferenceSession | null = null

function openModelDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1)
    req.onerror = () => reject(req.error)
    req.onsuccess = () => resolve(req.result)
    req.onupgradeneeded = () => {
      const db = req.result
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME)
      }
    }
  })
}

async function getCachedModelBytes(): Promise<Uint8Array | null> {
  try {
    const db = await openModelDB()
    return await new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readonly')
      const req = tx.objectStore(STORE_NAME).get(MODEL_KEY)
      req.onerror = () => reject(req.error)
      req.onsuccess = () => {
        const val = req.result
        if (val instanceof Uint8Array) resolve(val)
        else if (val instanceof ArrayBuffer) resolve(new Uint8Array(val))
        else resolve(null)
      }
    })
  } catch {
    return null
  }
}

async function saveModelBytes(bytes: Uint8Array): Promise<void> {
  try {
    const db = await openModelDB()
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readwrite')
      const req = tx.objectStore(STORE_NAME).put(bytes, MODEL_KEY)
      req.onerror = () => reject(req.error)
      req.onsuccess = () => resolve()
    })
  } catch {
    // Non-fatal: model still runs in memory for current session
  }
}

function mirrorSquare(sq: string): string {
  return sq[0] + String(9 - Number.parseInt(sq[1], 10))
}

function mirrorMove(uci: string): string {
  const from = mirrorSquare(uci.slice(0, 2))
  const to = mirrorSquare(uci.slice(2, 4))
  const promo = uci.length > 4 ? uci.slice(4) : ''
  return from + to + promo
}

function swapCase(str: string): string {
  let out = ''
  for (const ch of str) {
    if (ch >= 'A' && ch <= 'Z') out += ch.toLowerCase()
    else if (ch >= 'a' && ch <= 'z') out += ch.toUpperCase()
    else out += ch
  }
  return out
}

function swapCastling(castling: string): string {
  if (castling === '-') return '-'
  let out = ''
  if (castling.includes('k')) out += 'K'
  if (castling.includes('q')) out += 'Q'
  if (castling.includes('K')) out += 'k'
  if (castling.includes('Q')) out += 'q'
  return out || '-'
}

function mirrorFen(fen: string): string {
  const [placement, turn, castling, ep, half, full] = fen.split(' ')
  const mirroredPlacement = placement
    .split('/')
    .reverse()
    .map(swapCase)
    .join('/')
  const mirroredTurn = turn === 'w' ? 'b' : 'w'
  const mirroredCastling = swapCastling(castling)
  const mirroredEp = ep && ep !== '-' ? mirrorSquare(ep) : '-'
  return `${mirroredPlacement} ${mirroredTurn} ${mirroredCastling} ${mirroredEp} ${half ?? '0'} ${full ?? '1'}`
}

function boardToMaia3Tokens(fen: string): Float32Array {
  const pieceTypes = [
    'P',
    'N',
    'B',
    'R',
    'Q',
    'K',
    'p',
    'n',
    'b',
    'r',
    'q',
    'k',
  ]
  const tensor = new Float32Array(64 * 12)
  const rows = fen.split(' ')[0].split('/')

  for (let rank = 0; rank < 8; rank++) {
    const row = 7 - rank
    let file = 0
    for (const ch of rows[rank]) {
      const empty = Number.parseInt(ch, 10)
      if (Number.isNaN(empty)) {
        const pieceIdx = pieceTypes.indexOf(ch)
        if (pieceIdx >= 0) {
          tensor[(row * 8 + file) * 12 + pieceIdx] = 1.0
        }
        file += 1
      } else {
        file += empty
      }
    }
  }
  return tensor
}

function softmax3(a: number, b: number, c: number): [number, number, number] {
  const m = Math.max(a, b, c)
  const ea = Math.exp(a - m)
  const eb = Math.exp(b - m)
  const ec = Math.exp(c - m)
  const sum = ea + eb + ec
  return [ea / sum, eb / sum, ec / sum]
}

async function initSessionFromBytes(bytes: Uint8Array): Promise<void> {
  post({ type: 'status', status: 'loading' })
  session = await ort.InferenceSession.create(bytes, {
    executionProviders: ['wasm'],
  })
  post({ type: 'status', status: 'ready' })
}

async function downloadAndInitModel(): Promise<void> {
  post({ type: 'status', status: 'downloading' })
  post({ type: 'progress', percent: 0 })

  const res = await fetch(MAIA3_MODEL_URL)
  if (!res.ok) {
    throw new Error(`Không thể tải model Maia-3 (HTTP ${res.status}).`)
  }

  const totalBytes =
    Number.parseInt(res.headers.get('content-length') ?? '0', 10) || 45_683_686
  const reader = res.body?.getReader()
  if (!reader) {
    const buf = new Uint8Array(await res.arrayBuffer())
    await saveModelBytes(buf)
    await initSessionFromBytes(buf)
    return
  }

  const chunks: Uint8Array[] = []
  let received = 0
  let lastPercent = -1

  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    if (value) {
      chunks.push(value)
      received += value.byteLength
      const pct = Math.min(99, Math.round((received / totalBytes) * 100))
      if (pct !== lastPercent) {
        lastPercent = pct
        post({ type: 'progress', percent: pct })
      }
    }
  }

  const combined = new Uint8Array(received)
  let offset = 0
  for (const chunk of chunks) {
    combined.set(chunk, offset)
    offset += chunk.byteLength
  }

  post({ type: 'progress', percent: 100 })
  await saveModelBytes(combined)
  await initSessionFromBytes(combined)
}

async function analyzePosition(
  fen: string,
  elo: number,
): Promise<MaiaInferenceResult> {
  if (!session) {
    throw new Error('Model Maia-3 chưa được tải.')
  }

  const originalGame = new Chess()
  originalGame.load(fen)
  const isBlack = originalGame.turn() === 'b'

  if (originalGame.isGameOver()) {
    const whiteWin = originalGame.isCheckmate()
      ? isBlack
        ? 100
        : 0
      : 50
    return {
      elo,
      whiteWinPercent: whiteWin,
      wdl: originalGame.isCheckmate() ? [1, 0, 0] : [0, 1, 0],
      topMoves: [],
      bestMove: null,
    }
  }

  const canonicalFen = isBlack ? mirrorFen(fen) : fen
  const canonicalGame = new Chess()
  canonicalGame.load(canonicalFen)

  const tokens = boardToMaia3Tokens(canonicalFen)
  const legalIndices: number[] = []
  const uciToSanMap = new Map<string, string>()

  const originalMoves = originalGame.moves({ verbose: true }) as Move[]
  for (const m of originalMoves) {
    const uci = `${m.from}${m.to}${m.promotion ?? ''}`
    uciToSanMap.set(uci, m.san)
  }

  const canonicalMoves = canonicalGame.moves({ verbose: true }) as Move[]
  for (const m of canonicalMoves) {
    const uci = `${m.from}${m.to}${m.promotion ?? ''}`
    const idx = allMovesMaia3[uci]
    if (idx !== undefined) {
      legalIndices.push(idx)
    }
  }

  const feeds = {
    tokens: new ort.Tensor('float32', tokens, [1, 64, 12]),
    elo_self: new ort.Tensor('float32', new Float32Array([elo]), [1]),
    elo_oppo: new ort.Tensor('float32', new Float32Array([elo]), [1]),
  }

  const output = await session.run(feeds)
  const logitsMove = output.logits_move.data as Float32Array
  const logitsValue = output.logits_value.data as Float32Array

  // Softmax over legal moves only
  let maxLogit = -Infinity
  for (const idx of legalIndices) {
    if (logitsMove[idx] > maxLogit) maxLogit = logitsMove[idx]
  }

  let expSum = 0
  const scored: Array<{ idx: number; expVal: number }> = []
  for (const idx of legalIndices) {
    const e = Math.exp(logitsMove[idx] - maxLogit)
    expSum += e
    scored.push({ idx, expVal: e })
  }

  scored.sort((a, b) => b.expVal - a.expVal)

  const topMoves: MaiaMovePrediction[] = scored.slice(0, 4).map((item) => {
    const canonicalUci = allMovesMaia3Reversed[String(item.idx)] ?? ''
    const realUci = isBlack ? mirrorMove(canonicalUci) : canonicalUci
    return {
      uci: realUci,
      san: uciToSanMap.get(realUci) ?? realUci,
      probability: expSum > 0 ? item.expVal / expSum : 0,
    }
  })

  // Value head: [loss, draw, win] from side-to-move perspective
  const wdl = softmax3(logitsValue[0], logitsValue[1], logitsValue[2])
  const moverWinPct = (wdl[2] + 0.5 * wdl[1]) * 100
  const whiteWinPercent = isBlack ? 100 - moverWinPct : moverWinPct

  return {
    elo,
    whiteWinPercent,
    wdl,
    topMoves,
    bestMove: topMoves[0]?.uci ?? null,
  }
}

function post(msg: MaiaWorkerResponse): void {
  self.postMessage(msg)
}

self.onmessage = async (event: MessageEvent<MaiaWorkerRequest>) => {
  const msg = event.data
  try {
    if (msg.type === 'init') {
      if (session) {
        post({ type: 'status', status: 'ready' })
        return
      }
      const cached = await getCachedModelBytes()
      if (cached) {
        await initSessionFromBytes(cached)
      } else {
        post({ type: 'status', status: 'idle' })
      }
      return
    }

    if (msg.type === 'download') {
      if (session) {
        post({ type: 'status', status: 'ready' })
        return
      }
      await downloadAndInitModel()
      return
    }

    if (msg.type === 'analyze') {
      const data = await analyzePosition(msg.fen, msg.elo)
      post({ type: 'result', id: msg.id, fen: msg.fen, elo: msg.elo, data })
    }
  } catch (err) {
    const message =
      err instanceof Error ? err.message : 'Lỗi không xác định khi chạy Maia-3.'
    if (msg.type === 'download' || msg.type === 'init') {
      post({ type: 'status', status: 'error', error: message })
    } else {
      post({ type: 'error', id: msg.id, message })
    }
  }
}
