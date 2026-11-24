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
  depth?: number
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
    eloLabel: '~1000',
    desc: 'Skill 1 • Depth 4',
    skillLevel: 1,
    depth: 4,
  },
  {
    id: 'sf-1500',
    engine: 'stockfish',
    name: 'Stockfish Trung bình',
    eloLabel: '~1500',
    desc: 'Skill 6 • Depth 6',
    skillLevel: 6,
    depth: 6,
  },
  {
    id: 'sf-2000',
    engine: 'stockfish',
    name: 'Stockfish Khá',
    eloLabel: '~2000',
    desc: 'Skill 12 • Depth 10',
    skillLevel: 12,
    depth: 10,
  },
  {
    id: 'sf-2600',
    engine: 'stockfish',
    name: 'Stockfish GM',
    eloLabel: '~2600',
    desc: 'Skill 18 • Depth 14',
    skillLevel: 18,
    depth: 14,
  },
  {
    id: 'sf-max',
    engine: 'stockfish',
    name: 'Stockfish Tối đa',
    eloLabel: '3600+',
    desc: 'Skill 20 • Depth 16',
    skillLevel: 20,
    depth: 16,
  },
]

/**
 * Computes a single Stockfish Bot move on a dedicated lightweight Web Worker
 * using UCI `Skill Level` and `depth` so it never conflicts with the analysis engine.
 */
export function getStockfishBotMove(
  fen: string,
  skillLevel: number,
  depth: number,
  signal: AbortSignal,
): Promise<string | null> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) {
      reject(new DOMException('Aborted', 'AbortError'))
      return
    }

    const worker = new Worker(
      `${import.meta.env.BASE_URL}stockfish/stockfish-19-lite-single.js`,
    )

    const cleanup = () => {
      signal.removeEventListener('abort', onAbort)
      worker.postMessage('quit')
      worker.terminate()
    }

    const onAbort = () => {
      cleanup()
      reject(new DOMException('Aborted', 'AbortError'))
    }

    signal.addEventListener('abort', onAbort)

    worker.onerror = (err) => {
      cleanup()
      reject(new Error(err.message || 'Stockfish Bot lỗi.'))
    }

    worker.onmessage = (event: MessageEvent<string>) => {
      const line = typeof event.data === 'string' ? event.data.trim() : ''
      if (!line) return

      if (line === 'uciok') {
        worker.postMessage(`setoption name Skill Level value ${skillLevel}`)
        worker.postMessage('setoption name MultiPV value 1')
        worker.postMessage('isready')
        return
      }

      if (line === 'readyok') {
        worker.postMessage(`position fen ${fen}`)
        worker.postMessage(`go depth ${depth}`)
        return
      }

      if (line.startsWith('bestmove ')) {
        const match = line.match(/^bestmove\s+(\S+)/)
        const move = match && match[1] !== '(none)' ? match[1] : null
        cleanup()
        resolve(move)
      }
    }

    worker.postMessage('uci')
  })
}
