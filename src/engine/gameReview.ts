import { Chess, DEFAULT_POSITION, type PieceSymbol, type Square } from 'chess.js'

export type MoveClassification =
  | 'best'
  | 'good'
  | 'inaccuracy'
  | 'mistake'
  | 'blunder'

export interface ReviewMoveInfo {
  ply: number
  san: string
  uci: string
  color: 'w' | 'b'
  cp: number | null
  mate: number | null
  /** White's win probability after this move (0–100) */
  whiteWinPercent: number
  bestMoveBefore: string | null
  winLoss: number
  classification: MoveClassification
}

export interface SideReviewSummary {
  accuracy: number
  best: number
  good: number
  inaccuracy: number
  mistake: number
  blunder: number
}

export interface GameReviewResult {
  /** White win probability at ply 0 (starting position) */
  startWinPercent: number
  moves: ReviewMoveInfo[]
  white: SideReviewSummary
  black: SideReviewSummary
}

export interface ReviewInputMove {
  from: Square
  to: Square
  san: string
  promotion?: PieceSymbol
}

export const CLASSIFICATION_META: Record<
  MoveClassification,
  { symbol: string; label: string; color: string; bg: string }
> = {
  best: {
    symbol: '★',
    label: 'Best move',
    color: '#81b64c',
    bg: 'rgba(129, 182, 76, 0.2)',
  },
  good: {
    symbol: '✓',
    label: 'Tốt',
    color: '#96bc4b',
    bg: 'rgba(150, 188, 75, 0.14)',
  },
  inaccuracy: {
    symbol: '?!',
    label: 'Thiếu chính xác',
    color: '#f0c15c',
    bg: 'rgba(240, 193, 92, 0.2)',
  },
  mistake: {
    symbol: '?',
    label: 'Mistake',
    color: '#e6912c',
    bg: 'rgba(230, 145, 44, 0.22)',
  },
  blunder: {
    symbol: '??',
    label: 'Blunder',
    color: '#e05347',
    bg: 'rgba(224, 83, 71, 0.24)',
  },
}

export function evalToWhiteWinPercent(
  cp: number | null,
  mate: number | null,
): number {
  if (mate !== null) {
    return mate > 0 ? 100 : 0
  }
  if (cp === null) return 50
  const winChance = 2 / (1 + Math.exp(-0.00368208 * cp)) - 1
  return Math.max(0, Math.min(100, 50 + 50 * winChance))
}

function classifyMove(
  uci: string,
  bestMoveBefore: string | null,
  winLoss: number,
): MoveClassification {
  if (bestMoveBefore && uci === bestMoveBefore) return 'best'
  if (winLoss <= 1.8) return 'best'
  if (winLoss <= 5.5) return 'good'
  if (winLoss <= 10.5) return 'inaccuracy'
  if (winLoss <= 20) return 'mistake'
  return 'blunder'
}

function computeSideSummary(
  moves: ReviewMoveInfo[],
  color: 'w' | 'b',
): SideReviewSummary {
  const sideMoves = moves.filter((m) => m.color === color)
  const summary: SideReviewSummary = {
    accuracy: 100,
    best: 0,
    good: 0,
    inaccuracy: 0,
    mistake: 0,
    blunder: 0,
  }

  if (sideMoves.length === 0) return summary

  let accSum = 0
  for (const m of sideMoves) {
    summary[m.classification] += 1
    // Lichess-style per-move accuracy curve from win-percent loss
    const moveAcc = Math.max(
      0,
      Math.min(100, 103.1668 * Math.exp(-0.04354 * Math.max(0, m.winLoss)) - 3.1669),
    )
    accSum += moveAcc
  }

  summary.accuracy = Math.round((accSum / sideMoves.length) * 10) / 10
  return summary
}

interface PositionEval {
  cp: number | null
  mate: number | null
  bestMove: string | null
}

function evaluateSingleFen(
  worker: Worker,
  fen: string,
  depth: number,
  signal: AbortSignal,
): Promise<PositionEval> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) {
      reject(new DOMException('Aborted', 'AbortError'))
      return
    }

    const turn: 'w' | 'b' = fen.split(' ')[1] === 'b' ? 'b' : 'w'
    const perspective = turn === 'w' ? 1 : -1
    let cp: number | null = 0
    let mate: number | null = null
    let bestMove: string | null = null

    const onAbort = () => {
      cleanup()
      worker.postMessage('stop')
      reject(new DOMException('Aborted', 'AbortError'))
    }

    const onMessage = (event: MessageEvent<string>) => {
      const line = typeof event.data === 'string' ? event.data.trim() : ''
      if (!line) return

      if (line.startsWith('info ') && line.includes(' score ')) {
        const cpMatch = line.match(/\bscore\s+cp\s+(-?\d+)/)
        const mateMatch = line.match(/\bscore\s+mate\s+(-?\d+)/)
        const pvMatch = line.match(/\bpv\s+(\S+)/)

        if (cpMatch) {
          cp = Number.parseInt(cpMatch[1], 10) * perspective
          mate = null
        } else if (mateMatch) {
          mate = Number.parseInt(mateMatch[1], 10) * perspective
          cp = null
        }
        if (pvMatch) {
          bestMove = pvMatch[1]
        }
        return
      }

      if (line.startsWith('bestmove ')) {
        const match = line.match(/^bestmove\s+(\S+)/)
        if (match && match[1] !== '(none)') {
          bestMove = match[1]
        }
        cleanup()
        resolve({ cp, mate, bestMove })
      }
    }

    const cleanup = () => {
      worker.removeEventListener('message', onMessage)
      signal.removeEventListener('abort', onAbort)
    }

    signal.addEventListener('abort', onAbort)
    worker.addEventListener('message', onMessage)
    worker.postMessage(`position fen ${fen}`)
    worker.postMessage(`go depth ${depth}`)
  })
}

function waitForReady(worker: Worker, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) {
      reject(new DOMException('Aborted', 'AbortError'))
      return
    }

    const onAbort = () => {
      cleanup()
      reject(new DOMException('Aborted', 'AbortError'))
    }

    const onMessage = (event: MessageEvent<string>) => {
      const line = typeof event.data === 'string' ? event.data.trim() : ''
      if (line === 'uciok') {
        worker.postMessage('setoption name MultiPV value 1')
        worker.postMessage('isready')
      } else if (line === 'readyok') {
        cleanup()
        resolve()
      }
    }

    const cleanup = () => {
      worker.removeEventListener('message', onMessage)
      signal.removeEventListener('abort', onAbort)
    }

    signal.addEventListener('abort', onAbort)
    worker.addEventListener('message', onMessage)
    worker.postMessage('uci')
  })
}

/**
 * Loops through every ply in the game using a dedicated Stockfish 19 Worker,
 * builds the win-rate curve, and classifies each move (Best / Good / Inaccuracy / Mistake / Blunder).
 */
export async function runFullGameReview(
  startFen: string,
  moves: ReviewInputMove[],
  options: {
    depth?: number
    signal: AbortSignal
    onProgress?: (completed: number, total: number) => void
  },
): Promise<GameReviewResult> {
  const depth = options.depth ?? 12
  const { signal, onProgress } = options

  // Build FEN snapshots for ply 0 .. moves.length
  const chess = new Chess()
  if (startFen !== DEFAULT_POSITION) {
    chess.load(startFen)
  }

  const snapshots: Array<{
    fen: string
    isCheckmate: boolean
    isDraw: boolean
    turn: 'w' | 'b'
  }> = [
    {
      fen: chess.fen(),
      isCheckmate: chess.isCheckmate(),
      isDraw: chess.isDraw(),
      turn: chess.turn(),
    },
  ]

  const moveMeta: Array<{ uci: string; san: string; color: 'w' | 'b' }> = []

  for (const m of moves) {
    const color = chess.turn()
    chess.move({ from: m.from, to: m.to, promotion: m.promotion })
    moveMeta.push({
      uci: `${m.from}${m.to}${m.promotion ?? ''}`,
      san: m.san,
      color,
    })
    snapshots.push({
      fen: chess.fen(),
      isCheckmate: chess.isCheckmate(),
      isDraw: chess.isDraw(),
      turn: chess.turn(),
    })
  }

  const workerUrl = `${import.meta.env.BASE_URL}stockfish/stockfish-19-lite-single.js`
  const worker = new Worker(workerUrl)

  try {
    await waitForReady(worker, signal)

    const evals: PositionEval[] = []
    const total = snapshots.length

    for (let i = 0; i < total; i++) {
      if (signal.aborted) {
        throw new DOMException('Aborted', 'AbortError')
      }

      const snap = snapshots[i]
      if (snap.isCheckmate) {
        evals.push({
          cp: null,
          mate: snap.turn === 'w' ? -1 : 1,
          bestMove: null,
        })
      } else if (snap.isDraw) {
        evals.push({ cp: 0, mate: null, bestMove: null })
      } else {
        const res = await evaluateSingleFen(worker, snap.fen, depth, signal)
        evals.push(res)
      }

      onProgress?.(i + 1, total)
    }

    const startWinPercent = evalToWhiteWinPercent(evals[0].cp, evals[0].mate)
    const reviewedMoves: ReviewMoveInfo[] = []

    for (let i = 0; i < moveMeta.length; i++) {
      const before = evals[i]
      const after = evals[i + 1]
      const meta = moveMeta[i]

      const whiteWinBefore = evalToWhiteWinPercent(before.cp, before.mate)
      const whiteWinAfter = evalToWhiteWinPercent(after.cp, after.mate)

      const moverWinBefore =
        meta.color === 'w' ? whiteWinBefore : 100 - whiteWinBefore
      const moverWinAfter =
        meta.color === 'w' ? whiteWinAfter : 100 - whiteWinAfter
      const winLoss = Math.max(0, moverWinBefore - moverWinAfter)

      reviewedMoves.push({
        ply: i + 1,
        san: meta.san,
        uci: meta.uci,
        color: meta.color,
        cp: after.cp,
        mate: after.mate,
        whiteWinPercent: whiteWinAfter,
        bestMoveBefore: before.bestMove,
        winLoss,
        classification: classifyMove(meta.uci, before.bestMove, winLoss),
      })
    }

    return {
      startWinPercent,
      moves: reviewedMoves,
      white: computeSideSummary(reviewedMoves, 'w'),
      black: computeSideSummary(reviewedMoves, 'b'),
    }
  } finally {
    worker.postMessage('quit')
    worker.terminate()
  }
}
