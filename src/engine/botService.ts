import {
  getStockfishWorkerUrl,
  type StockfishFlavor,
} from './stockfishFullCache'

export type BotPresetId =
  | 'maia-1100'
  | 'maia-1300'
  | 'maia-1500'
  | 'maia-1700'
  | 'maia-1900'
  | 'sf-1000'
  | 'sf-1500'
  | 'sf-2000'
  | 'sf-2600'
  | 'sf-max'

export interface BotPreset {
  id: BotPresetId
  engine: 'maia' | 'stockfish'
  name: string
  eloLabel: string
  desc: string
  maiaElo?: number
  skillLevel?: number
  uciElo?: number
  depth?: number
  movetimeMs?: number
}

export const BOT_PRESETS: BotPreset[] = [
  {
    id: 'maia-1100',
    engine: 'maia',
    name: 'Maia 1100',
    eloLabel: '~1100',
    desc: 'Người mới • Đánh tự nhiên như người thật',
    maiaElo: 1100,
  },
  {
    id: 'maia-1300',
    engine: 'maia',
    name: 'Maia 1300',
    eloLabel: '~1300',
    desc: 'Phong trào • Lối đánh giống người thật',
    maiaElo: 1300,
  },
  {
    id: 'maia-1500',
    engine: 'maia',
    name: 'Maia 1500',
    eloLabel: '~1500',
    desc: 'Trung cấp • Phổ biến nhất để luyện tập',
    maiaElo: 1500,
  },
  {
    id: 'maia-1700',
    engine: 'maia',
    name: 'Maia 1700',
    eloLabel: '~1700',
    desc: 'Khá • Ít sai lầm chiến thuật hơn',
    maiaElo: 1700,
  },
  {
    id: 'maia-1900',
    engine: 'maia',
    name: 'Maia 1900',
    eloLabel: '~1900',
    desc: 'Mạnh • Mô phỏng kỳ thủ câu lạc bộ',
    maiaElo: 1900,
  },
  {
    id: 'sf-1000',
    engine: 'stockfish',
    name: 'Stockfish Dễ',
    eloLabel: '~1100',
    desc: 'Skill 2 • Depth 6 • Dễ làm quen',
    skillLevel: 2,
    depth: 6,
    movetimeMs: 400,
  },
  {
    id: 'sf-1500',
    engine: 'stockfish',
    name: 'Stockfish Trung bình',
    eloLabel: '~1500',
    desc: 'UCI Elo 1500 • Depth 10',
    uciElo: 1500,
    depth: 10,
    movetimeMs: 600,
  },
  {
    id: 'sf-2000',
    engine: 'stockfish',
    name: 'Stockfish Khá',
    eloLabel: '~2000',
    desc: 'UCI Elo 2000 • Depth 13',
    uciElo: 2000,
    depth: 13,
    movetimeMs: 900,
  },
  {
    id: 'sf-2600',
    engine: 'stockfish',
    name: 'Stockfish GM',
    eloLabel: '~2600',
    desc: 'UCI Elo 2600 • Depth 16 • Hash 64MB',
    uciElo: 2600,
    depth: 16,
    movetimeMs: 1300,
  },
  {
    id: 'sf-max',
    engine: 'stockfish',
    name: 'Stockfish Tối đa',
    eloLabel: '3600+',
    desc: 'Full Strength • Depth 18 • Hash 64MB',
    skillLevel: 20,
    depth: 18,
    movetimeMs: 1800,
  },
]

// Persistent Stockfish Bot Worker so Hash/Transposition Table is preserved across moves
let sharedBotWorker: Worker | null = null
let sharedBotFlavor: StockfishFlavor = 'lite'
let sharedBotReady = false

function ensureBotWorker(flavor: StockfishFlavor): Worker {
  if (sharedBotWorker && sharedBotFlavor !== flavor) {
    try {
      sharedBotWorker.postMessage('quit')
    } catch {
      // Ignore
    }
    sharedBotWorker.terminate()
    sharedBotWorker = null
    sharedBotReady = false
  }
  if (!sharedBotWorker) {
    sharedBotFlavor = flavor
    sharedBotWorker = new Worker(getStockfishWorkerUrl(flavor))
    sharedBotReady = false
  }
  return sharedBotWorker
}

export function resetStockfishBotCache(): void {
  if (sharedBotWorker && sharedBotReady) {
    sharedBotWorker.postMessage('ucinewgame')
  }
}

/**
 * Computes a high-quality Stockfish Bot move on a persistent Web Worker
 * with 64MB Hash table and official UCI_LimitStrength / UCI_Elo calibration.
 */
export function getStockfishBotMove(
  fen: string,
  options: {
    skillLevel?: number
    uciElo?: number
    depth: number
    movetimeMs?: number
    flavor?: StockfishFlavor
  },
  signal: AbortSignal,
): Promise<string | null> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) {
      reject(new DOMException('Aborted', 'AbortError'))
      return
    }

    const worker = ensureBotWorker(options.flavor ?? 'lite')
    const movetime = options.movetimeMs ?? 1000

    const configureAndSearch = () => {
      worker.postMessage('setoption name Hash value 64')
      worker.postMessage('setoption name MultiPV value 1')
      if (options.uciElo !== undefined) {
        worker.postMessage('setoption name UCI_LimitStrength value true')
        worker.postMessage(`setoption name UCI_Elo value ${options.uciElo}`)
      } else {
        worker.postMessage('setoption name UCI_LimitStrength value false')
        worker.postMessage(
          `setoption name Skill Level value ${options.skillLevel ?? 20}`,
        )
      }
      worker.postMessage('isready')
    }

    const cleanup = () => {
      signal.removeEventListener('abort', onAbort)
      worker.removeEventListener('message', onMessage)
      worker.removeEventListener('error', onError)
    }

    const onAbort = () => {
      worker.postMessage('stop')
      cleanup()
      reject(new DOMException('Aborted', 'AbortError'))
    }

    const onError = (err: ErrorEvent) => {
      cleanup()
      sharedBotWorker?.terminate()
      sharedBotWorker = null
      sharedBotReady = false
      reject(new Error(err.message || 'Stockfish Bot lỗi.'))
    }

    const onMessage = (event: MessageEvent<string>) => {
      const line = typeof event.data === 'string' ? event.data.trim() : ''
      if (!line) return

      if (line === 'uciok') {
        sharedBotReady = true
        configureAndSearch()
        return
      }

      if (line === 'readyok') {
        worker.postMessage(`position fen ${fen}`)
        worker.postMessage(`go depth ${options.depth} movetime ${movetime}`)
        return
      }

      if (line.startsWith('bestmove ')) {
        const match = line.match(/^bestmove\s+(\S+)/)
        const move = match && match[1] !== '(none)' ? match[1] : null
        cleanup()
        resolve(move)
      }
    }

    signal.addEventListener('abort', onAbort)
    worker.addEventListener('message', onMessage)
    worker.addEventListener('error', onError)

    if (sharedBotReady) {
      configureAndSearch()
    } else {
      worker.postMessage('uci')
    }
  })
}
