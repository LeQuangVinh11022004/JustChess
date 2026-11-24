import { Chess, DEFAULT_POSITION, type PieceSymbol, type Square } from 'chess.js'
import type {
  ClassicalWorkerRequest,
  ClassicalWorkerResponse,
  WorkerEngineStyle,
} from './classicalWorker'

export type ReviewEngineId =
  | 'stockfish-12'
  | 'stockfish-16'
  | 'classical'
  | 'aggressive'
  | 'jschess'

export const REVIEW_ENGINES: Array<{
  id: ReviewEngineId
  label: string
  shortLabel: string
  desc: string
}> = [
  {
    id: 'stockfish-12',
    label: 'Stockfish 19 (Nhanh • d12)',
    shortLabel: 'Stockfish 19',
    desc: 'NNUE chuẩn xác, tốc độ nhanh',
  },
  {
    id: 'stockfish-16',
    label: 'Stockfish 19 Deep (d16)',
    shortLabel: 'SF19 Deep',
    desc: 'Phân tích sâu cho ván quan trọng',
  },
  {
    id: 'classical',
    label: 'PeSTO Cổ điển (d3)',
    shortLabel: 'PeSTO Cổ điển',
    desc: 'Đánh giá theo thế trận & vị trí quân',
  },
  {
    id: 'aggressive',
    label: 'Tấn công (Aggressive)',
    shortLabel: 'Tấn công',
    desc: 'Chấm điểm theo độ chủ động & áp lực Vua',
  },
  {
    id: 'jschess',
    label: 'js-chess-engine (MIT)',
    shortLabel: 'js-chess',
    desc: 'Góc nhìn từ open-source engine độc lập',
  },
]

export type TimeControlCategory = 'bullet' | 'blitz' | 'rapid' | 'classical'

export const TIME_CONTROL_META: Record<
  TimeControlCategory,
  {
    label: string
    shortLabel: string
    fideLabel: string
    chesscomLabel: string
    lichessLabel: string
  }
> = {
  bullet: {
    label: 'Bullet (< 3 phút)',
    shortLabel: 'Bullet',
    fideLabel: 'FIDE Blitz*',
    chesscomLabel: 'Chess.com Bullet',
    lichessLabel: 'Lichess Bullet',
  },
  blitz: {
    label: 'Blitz (3–8 phút)',
    shortLabel: 'Blitz',
    fideLabel: 'FIDE Blitz',
    chesscomLabel: 'Chess.com Blitz',
    lichessLabel: 'Lichess Blitz',
  },
  rapid: {
    label: 'Rapid (8–25 phút)',
    shortLabel: 'Rapid',
    fideLabel: 'FIDE Rapid',
    chesscomLabel: 'Chess.com Rapid',
    lichessLabel: 'Lichess Rapid',
  },
  classical: {
    label: 'Classical (≥ 25 phút)',
    shortLabel: 'Classical',
    fideLabel: 'FIDE Classical',
    chesscomLabel: 'Chess.com Daily',
    lichessLabel: 'Lichess Classical',
  },
}

/**
 * Infers Bullet / Blitz / Rapid / Classical from PGN headers ([TimeControl], [Event])
 * or an explicit online speed string (e.g. "blitz", "rapid", "bullet", "daily").
 */
export function detectTimeControl(
  headers?: Record<string, string>,
  explicitSpeed?: string,
): TimeControlCategory {
  const speed = (explicitSpeed ?? '').toLowerCase()
  if (speed.includes('bullet') || speed.includes('ultrabullet')) return 'bullet'
  if (speed.includes('blitz')) return 'blitz'
  if (speed.includes('rapid')) return 'rapid'
  if (
    speed.includes('classical') ||
    speed.includes('correspondence') ||
    speed.includes('daily')
  ) {
    return 'classical'
  }

  const tc = headers?.TimeControl?.trim()
  if (tc && tc !== '-' && tc !== '?') {
    if (tc.includes('/')) return 'classical' // Daily / correspondence (e.g. 1/86400)
    const [baseStr, incStr] = tc.split('+')
    const base = Number.parseInt(baseStr ?? '', 10)
    const inc = Number.parseInt(incStr ?? '0', 10) || 0
    if (!Number.isNaN(base) && base > 0) {
      // Official Lichess / FIDE estimated game duration = base + 40 * increment
      const estSeconds = base + 40 * inc
      if (estSeconds < 180) return 'bullet'
      if (estSeconds < 480) return 'blitz'
      if (estSeconds < 1500) return 'rapid'
      return 'classical'
    }
  }

  const eventName = (headers?.Event ?? '').toLowerCase()
  if (eventName.includes('bullet')) return 'bullet'
  if (eventName.includes('blitz')) return 'blitz'
  if (eventName.includes('classical') || eventName.includes('daily')) {
    return 'classical'
  }

  return 'rapid'
}

export interface EstimatedRatings {
  fide: number
  chesscom: number
  lichess: number
}

export type MoveClassification =
  | 'brilliant'
  | 'great'
  | 'best'
  | 'excellent'
  | 'good'
  | 'book'
  | 'inaccuracy'
  | 'mistake'
  | 'blunder'

export interface ReviewMoveInfo {
  ply: number
  moveNumber: number
  san: string
  uci: string
  from: Square
  to: Square
  color: 'w' | 'b'
  cp: number | null
  mate: number | null
  /** White's win probability after this move (0–100) */
  whiteWinPercent: number
  bestMoveBefore: string | null
  bestMoveBeforeSan: string | null
  winLoss: number
  classification: MoveClassification
  commentary: string
}

export interface SideReviewSummary {
  accuracy: number
  estimatedRating: number
  ratings: EstimatedRatings
  brilliant: number
  great: number
  best: number
  excellent: number
  good: number
  book: number
  inaccuracy: number
  mistake: number
  blunder: number
}

export interface GameReviewResult {
  engineId: ReviewEngineId
  engineLabel: string
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

export const CLASSIFICATION_ORDER: MoveClassification[] = [
  'brilliant',
  'great',
  'best',
  'excellent',
  'good',
  'book',
  'inaccuracy',
  'mistake',
  'blunder',
]

export const CLASSIFICATION_META: Record<
  MoveClassification,
  { symbol: string; label: string; color: string; bg: string; badgeText: string }
> = {
  brilliant: {
    symbol: '!!',
    label: 'Thiên tài (Brilliant)',
    color: '#1baca6',
    bg: 'rgba(27, 172, 166, 0.22)',
    badgeText: '#ffffff',
  },
  great: {
    symbol: '!',
    label: 'Xuất sắc (Great)',
    color: '#5c8bb0',
    bg: 'rgba(92, 139, 176, 0.22)',
    badgeText: '#ffffff',
  },
  best: {
    symbol: '★',
    label: 'Tốt nhất (Best)',
    color: '#81b64c',
    bg: 'rgba(129, 182, 76, 0.2)',
    badgeText: '#ffffff',
  },
  excellent: {
    symbol: '✓',
    label: 'Rất tốt (Excellent)',
    color: '#96bc4b',
    bg: 'rgba(150, 188, 75, 0.16)',
    badgeText: '#ffffff',
  },
  good: {
    symbol: '✓',
    label: 'Tốt (Good)',
    color: '#96af8b',
    bg: 'rgba(150, 175, 139, 0.15)',
    badgeText: '#ffffff',
  },
  book: {
    symbol: '📖',
    label: 'Sách khai cuộc (Book)',
    color: '#a88865',
    bg: 'rgba(168, 136, 101, 0.22)',
    badgeText: '#ffffff',
  },
  inaccuracy: {
    symbol: '?!',
    label: 'Thiếu chính xác',
    color: '#f0c15c',
    bg: 'rgba(240, 193, 92, 0.22)',
    badgeText: '#161512',
  },
  mistake: {
    symbol: '?',
    label: 'Sai lầm (Mistake)',
    color: '#e6912c',
    bg: 'rgba(230, 145, 44, 0.24)',
    badgeText: '#ffffff',
  },
  blunder: {
    symbol: '??',
    label: 'Nghiêm trọng (Blunder)',
    color: '#ca3431',
    bg: 'rgba(202, 52, 49, 0.26)',
    badgeText: '#ffffff',
  },
}

const MATERIAL_VALUE: Record<PieceSymbol, number> = {
  p: 1,
  n: 3,
  b: 3,
  r: 5,
  q: 9,
  k: 0,
}

function getSideMaterial(chess: Chess, color: 'w' | 'b'): number {
  let total = 0
  for (const row of chess.board()) {
    for (const cell of row) {
      if (cell && cell.color === color) {
        total += MATERIAL_VALUE[cell.type]
      }
    }
  }
  return total
}

function uciToSanSafe(fen: string, uci: string | null): string | null {
  if (!uci || uci.length < 4) return null
  try {
    const temp = new Chess()
    temp.load(fen)
    const move = temp.move({
      from: uci.slice(0, 2) as Square,
      to: uci.slice(2, 4) as Square,
      promotion: (uci[4] as PieceSymbol | undefined) ?? undefined,
    })
    return move.san
  } catch {
    return uci
  }
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

export function classifyLiveMove(params: {
  ply: number
  isStandardStart: boolean
  uci: string
  san: string
  color: 'w' | 'b'
  fenBefore: string
  before: { cp: number | null; mate: number | null; bestMove: string | null }
  after: { cp: number | null; mate: number | null }
  isCheckmate: boolean
}): {
  classification: MoveClassification
  winLoss: number
  bestMoveBeforeSan: string | null
  commentary: string
} {
  const whiteWinBefore = evalToWhiteWinPercent(
    params.before.cp,
    params.before.mate,
  )
  const whiteWinAfter = evalToWhiteWinPercent(params.after.cp, params.after.mate)

  const moverWinBefore =
    params.color === 'w' ? whiteWinBefore : 100 - whiteWinBefore
  const moverWinAfter =
    params.color === 'w' ? whiteWinAfter : 100 - whiteWinAfter
  const winLoss = Math.max(0, moverWinBefore - moverWinAfter)

  const classification = classifyMove({
    ply: params.ply,
    isStandardStart: params.isStandardStart,
    uci: params.uci,
    san: params.san,
    bestMoveBefore: params.before.bestMove,
    winLoss,
    moverWinBefore,
    moverWinAfter,
    isSacrifice: false,
    isCheckmate: params.isCheckmate,
    wasBlunderBefore: false,
  })

  const bestMoveBeforeSan = uciToSanSafe(
    params.fenBefore,
    params.before.bestMove,
  )
  const commentary = buildCoachCommentary({
    san: params.san,
    classification,
    bestMoveBeforeSan,
    winLoss,
    isCheckmate: params.isCheckmate,
    mateAfter: params.after.mate,
  })

  return { classification, winLoss, bestMoveBeforeSan, commentary }
}

function classifyMove(params: {
  ply: number
  isStandardStart: boolean
  uci: string
  san: string
  bestMoveBefore: string | null
  winLoss: number
  moverWinBefore: number
  moverWinAfter: number
  isSacrifice: boolean
  isCheckmate: boolean
  wasBlunderBefore: boolean
}): MoveClassification {
  const {
    ply,
    isStandardStart,
    uci,
    bestMoveBefore,
    winLoss,
    moverWinBefore,
    moverWinAfter,
    isSacrifice,
    isCheckmate,
    wasBlunderBefore,
  } = params

  const isTopChoice = Boolean(bestMoveBefore && uci === bestMoveBefore)

  if (isCheckmate) return 'best'

  // Opening book heuristic for early balanced moves from standard start
  if (
    isStandardStart &&
    ply <= 6 &&
    winLoss <= 2.5 &&
    moverWinAfter >= 42 &&
    moverWinAfter <= 58
  ) {
    return 'book'
  }

  // Brilliant: best/near-best move that sacrifices material while keeping strong/winning position
  if (
    isSacrifice &&
    (isTopChoice || winLoss <= 1.5) &&
    moverWinAfter >= 55 &&
    ply >= 6
  ) {
    return 'brilliant'
  }

  // Great: punishing an opponent's blunder or finding the sharp best move in a critical position
  if (
    isTopChoice &&
    winLoss <= 1.2 &&
    (wasBlunderBefore || (moverWinBefore >= 40 && moverWinAfter - moverWinBefore >= 4)) &&
    ply >= 6
  ) {
    return 'great'
  }

  if (isTopChoice || winLoss <= 1.5) return 'best'
  if (winLoss <= 3.5) return 'excellent'
  if (winLoss <= 6.5) return 'good'
  if (winLoss <= 12) return 'inaccuracy'
  if (winLoss <= 22) return 'mistake'
  return 'blunder'
}

function buildCoachCommentary(params: {
  san: string
  classification: MoveClassification
  bestMoveBeforeSan: string | null
  winLoss: number
  isCheckmate: boolean
  mateAfter: number | null
}): string {
  const {
    san,
    classification,
    bestMoveBeforeSan,
    winLoss,
    isCheckmate,
    mateAfter,
  } = params

  if (isCheckmate) {
    return `${san} là đòn chiếu hết kết liễu ván đấu!`
  }

  switch (classification) {
    case 'brilliant':
      return `${san}!! Một nước thí quân cực kỳ táo bạo nhưng hoàn toàn chính xác — giữ vững thế chủ động!`
    case 'great':
      return `${san}! Nước đi sắc bén tận dụng chính xác thời cơ trong tình huống then chốt.`
    case 'best':
      return mateAfter !== null
        ? `${san} là nước đi tối ưu nhất, mở ra đòn chiếu hết cưỡng bức.`
        : `${san} là lựa chọn tốt nhất theo tính toán của Stockfish.`
    case 'excellent':
      return `${san} là một nước đi rất chắc chắn, gần tương đương phương án mạnh nhất.`
    case 'good':
      return bestMoveBeforeSan && bestMoveBeforeSan !== san
        ? `${san} là nước đi ổn, tuy nhiên ${bestMoveBeforeSan} sẽ tạo thêm một chút áp lực.`
        : `${san} là một nước đi hợp lý và an toàn.`
    case 'book':
      return `${san} là nước khai cuộc chuẩn theo lý thuyết.`
    case 'inaccuracy':
      return bestMoveBeforeSan
        ? `${san} hơi thiếu chính xác (-${Math.round(winLoss)}% cơ hội thắng). Nên cân nhắc ${bestMoveBeforeSan}.`
        : `${san} hơi thiếu chính xác, làm giảm nhẹ lợi thế.`
    case 'mistake':
      return bestMoveBeforeSan
        ? `${san} là một sai lầm (-${Math.round(winLoss)}% cơ hội thắng). Phương án tốt hơn nhiều là ${bestMoveBeforeSan}.`
        : `${san} là một sai lầm làm đánh mất đáng kể ưu thế.`
    case 'blunder':
      return bestMoveBeforeSan
        ? `${san} là sai lầm nghiêm trọng (-${Math.round(winLoss)}% cơ hội thắng)! Đáng lẽ nên đi ${bestMoveBeforeSan}.`
        : `${san} là sai lầm nghiêm trọng làm xoay chuyển hoàn toàn cục diện ván đấu!`
  }
}

function roundTo50(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, Math.round(value / 50) * 50))
}

/**
 * Estimates single-game performance Elo across Chess.com, Lichess, and FIDE scales,
 * calibrated separately for Bullet, Blitz, Rapid, and Classical time controls.
 */
export function estimateCrossPlatformRatings(params: {
  accuracy: number
  blunder: number
  mistake: number
  brilliant: number
  great: number
  timeControl?: TimeControlCategory
}): EstimatedRatings {
  const {
    accuracy,
    blunder,
    mistake,
    brilliant,
    great,
    timeControl = 'rapid',
  } = params

  // Time-control specific calibration:
  // Faster controls tolerate more inaccuracy/blunders for the same Elo; Classical demands higher precision.
  const tcConfig: Record<
    TimeControlCategory,
    {
      accuracyBoost: number
      blunderWeight: number
      mistakeWeight: number
      lichessExtra: number
      fideShift: number
    }
  > = {
    bullet: {
      accuracyBoost: 190,
      blunderWeight: 55,
      mistakeWeight: 20,
      lichessExtra: 35,
      fideShift: -40,
    },
    blitz: {
      accuracyBoost: 95,
      blunderWeight: 70,
      mistakeWeight: 25,
      lichessExtra: 15,
      fideShift: 0,
    },
    rapid: {
      accuracyBoost: 0,
      blunderWeight: 85,
      mistakeWeight: 30,
      lichessExtra: 0,
      fideShift: 0,
    },
    classical: {
      accuracyBoost: -110,
      blunderWeight: 105,
      mistakeWeight: 38,
      lichessExtra: -20,
      fideShift: 35,
    },
  }

  const cfg = tcConfig[timeControl]

  const baseChessCom =
    420 + Math.pow(accuracy / 100, 1.9) * 2250 + cfg.accuracyBoost
  const penalty = blunder * cfg.blunderWeight + mistake * cfg.mistakeWeight
  const bonus = brilliant * 60 + great * 25
  const rawChessCom = Math.max(400, Math.min(2750, baseChessCom - penalty + bonus))

  // Lichess Glicko-2 offset narrows at master level (~2400+)
  const lichessOffset =
    (rawChessCom < 2200
      ? 280 - ((rawChessCom - 800) / 1400) * 90
      : Math.max(40, 190 - ((rawChessCom - 2200) / 550) * 150)) +
    cfg.lichessExtra
  const rawLichess = rawChessCom + lichessOffset

  // FIDE scaling (floor ~1000–1400, tighter progression above 1800)
  const rawFide =
    (rawChessCom < 1400
      ? 950 + ((rawChessCom - 400) / 1000) * 500
      : 1450 + (rawChessCom - 1400) * 0.92) + cfg.fideShift

  return {
    fide: roundTo50(rawFide, 1000, 2750),
    chesscom: roundTo50(rawChessCom, 400, 2750),
    lichess: roundTo50(rawLichess, 800, 2850),
  }
}

function computeSideSummary(
  moves: ReviewMoveInfo[],
  color: 'w' | 'b',
): SideReviewSummary {
  const sideMoves = moves.filter((m) => m.color === color)
  const summary: SideReviewSummary = {
    accuracy: 100,
    estimatedRating: 1500,
    ratings: { fide: 1500, chesscom: 1500, lichess: 1750 },
    brilliant: 0,
    great: 0,
    best: 0,
    excellent: 0,
    good: 0,
    book: 0,
    inaccuracy: 0,
    mistake: 0,
    blunder: 0,
  }

  if (sideMoves.length === 0) return summary

  let accSum = 0
  for (const m of sideMoves) {
    summary[m.classification] += 1
    const moveAcc = Math.max(
      0,
      Math.min(
        100,
        103.1668 * Math.exp(-0.04354 * Math.max(0, m.winLoss)) - 3.1669,
      ),
    )
    accSum += moveAcc
  }

  const accuracy = Math.round((accSum / sideMoves.length) * 10) / 10
  summary.accuracy = accuracy
  summary.ratings = estimateCrossPlatformRatings({
    accuracy,
    blunder: summary.blunder,
    mistake: summary.mistake,
    brilliant: summary.brilliant,
    great: summary.great,
  })
  summary.estimatedRating = summary.ratings.chesscom

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

function evaluateWithLocalWorker(
  worker: Worker,
  id: number,
  fen: string,
  style: WorkerEngineStyle,
  depth: number,
  signal: AbortSignal,
): Promise<PositionEval> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) {
      reject(new DOMException('Aborted', 'AbortError'))
      return
    }

    const onAbort = () => {
      cleanup()
      reject(new DOMException('Aborted', 'AbortError'))
    }

    const onMessage = (event: MessageEvent<ClassicalWorkerResponse>) => {
      if (event.data.id !== id) return
      cleanup()
      resolve({
        cp: event.data.result.cp,
        mate: event.data.result.mate,
        bestMove: event.data.result.bestMove,
      })
    }

    const cleanup = () => {
      worker.removeEventListener('message', onMessage)
      signal.removeEventListener('abort', onAbort)
    }

    signal.addEventListener('abort', onAbort)
    worker.addEventListener('message', onMessage)
    const req: ClassicalWorkerRequest = { id, fen, style, depth }
    worker.postMessage(req)
  })
}

/**
 * Multi-engine Chess.com-style Full Game Review.
 * Supports Stockfish 19 (d12 / d16), Classical PeSTO, Aggressive, and js-chess-engine (all via Web Workers).
 */
export async function runFullGameReview(
  startFen: string,
  moves: ReviewInputMove[],
  options: {
    engineId?: ReviewEngineId
    signal: AbortSignal
    onProgress?: (completed: number, total: number) => void
  },
): Promise<GameReviewResult> {
  const engineId: ReviewEngineId = options.engineId ?? 'stockfish-12'
  const engineMeta =
    REVIEW_ENGINES.find((e) => e.id === engineId) ?? REVIEW_ENGINES[0]
  const { signal, onProgress } = options
  const isStandardStart = startFen === DEFAULT_POSITION

  const chess = new Chess()
  if (!isStandardStart) {
    chess.load(startFen)
  }

  const startMoveNum = Number.parseInt(startFen.split(' ')[5] ?? '1', 10) || 1
  const startsBlack = startFen.split(' ')[1] === 'b'

  const snapshots: Array<{
    fen: string
    isCheckmate: boolean
    isDraw: boolean
    turn: 'w' | 'b'
    whiteMat: number
    blackMat: number
  }> = [
    {
      fen: chess.fen(),
      isCheckmate: chess.isCheckmate(),
      isDraw: chess.isDraw(),
      turn: chess.turn(),
      whiteMat: getSideMaterial(chess, 'w'),
      blackMat: getSideMaterial(chess, 'b'),
    },
  ]

  const moveMeta: Array<{
    uci: string
    from: Square
    to: Square
    san: string
    color: 'w' | 'b'
    moveNumber: number
    isSacrifice: boolean
  }> = []

  for (let idx = 0; idx < moves.length; idx++) {
    const m = moves[idx]
    const color = chess.turn()
    const myMatBefore = getSideMaterial(chess, color)
    const oppColor = color === 'w' ? 'b' : 'w'
    const oppMatBefore = getSideMaterial(chess, oppColor)

    const executed = chess.move({
      from: m.from,
      to: m.to,
      promotion: m.promotion,
    })

    // Detect tactical sacrifice: moved a non-pawn piece to a square attacked by opponent where opponent can capture for material gain
    const oppReplies = chess.moves({ verbose: true })
    const canCaptureMovedPiece = oppReplies.some(
      (r) => r.to === executed.to && r.captured,
    )
    const pieceVal = MATERIAL_VALUE[executed.piece]
    const capturedVal = executed.captured ? MATERIAL_VALUE[executed.captured] : 0
    const myMatAfter = getSideMaterial(chess, color)
    const oppMatAfter = getSideMaterial(chess, oppColor)
    const netMatDiff = myMatAfter - oppMatAfter - (myMatBefore - oppMatBefore)
    const isSacrifice =
      pieceVal >= 3 && canCaptureMovedPiece && pieceVal > capturedVal + 1 && netMatDiff <= 0

    const moveNumber = startsBlack
      ? startMoveNum + Math.floor((idx + 1) / 2)
      : startMoveNum + Math.floor(idx / 2)

    moveMeta.push({
      uci: `${m.from}${m.to}${m.promotion ?? ''}`,
      from: m.from,
      to: m.to,
      san: m.san,
      color,
      moveNumber,
      isSacrifice,
    })

    snapshots.push({
      fen: chess.fen(),
      isCheckmate: chess.isCheckmate(),
      isDraw: chess.isDraw(),
      turn: chess.turn(),
      whiteMat: getSideMaterial(chess, 'w'),
      blackMat: getSideMaterial(chess, 'b'),
    })
  }

  const isStockfish =
    engineId === 'stockfish-12' || engineId === 'stockfish-16'
  const sfDepth = engineId === 'stockfish-16' ? 16 : 12

  const worker = isStockfish
    ? new Worker(
        `${import.meta.env.BASE_URL}stockfish/stockfish-19-lite-single.js`,
      )
    : new Worker(new URL('./classicalWorker.ts', import.meta.url), {
        type: 'module',
      })

  try {
    if (isStockfish) {
      await waitForReady(worker, signal)
    }

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
      } else if (isStockfish) {
        const res = await evaluateSingleFen(worker, snap.fen, sfDepth, signal)
        evals.push(res)
      } else {
        const res = await evaluateWithLocalWorker(
          worker,
          i + 1,
          snap.fen,
          engineId,
          3,
          signal,
        )
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
      const snapAfter = snapshots[i + 1]

      const whiteWinBefore = evalToWhiteWinPercent(before.cp, before.mate)
      const whiteWinAfter = evalToWhiteWinPercent(after.cp, after.mate)

      const moverWinBefore =
        meta.color === 'w' ? whiteWinBefore : 100 - whiteWinBefore
      const moverWinAfter =
        meta.color === 'w' ? whiteWinAfter : 100 - whiteWinAfter
      const winLoss = Math.max(0, moverWinBefore - moverWinAfter)

      const prevReviewed = i > 0 ? reviewedMoves[i - 1] : null
      const wasBlunderBefore =
        prevReviewed?.classification === 'blunder' ||
        prevReviewed?.classification === 'mistake'

      const classification = classifyMove({
        ply: i + 1,
        isStandardStart,
        uci: meta.uci,
        san: meta.san,
        bestMoveBefore: before.bestMove,
        winLoss,
        moverWinBefore,
        moverWinAfter,
        isSacrifice: meta.isSacrifice,
        isCheckmate: snapAfter.isCheckmate,
        wasBlunderBefore,
      })

      const bestMoveBeforeSan = uciToSanSafe(
        snapshots[i].fen,
        before.bestMove,
      )

      const commentary = buildCoachCommentary({
        san: meta.san,
        classification,
        bestMoveBeforeSan,
        winLoss,
        isCheckmate: snapAfter.isCheckmate,
        mateAfter: after.mate,
      })

      reviewedMoves.push({
        ply: i + 1,
        moveNumber: meta.moveNumber,
        san: meta.san,
        uci: meta.uci,
        from: meta.from,
        to: meta.to,
        color: meta.color,
        cp: after.cp,
        mate: after.mate,
        whiteWinPercent: whiteWinAfter,
        bestMoveBefore: before.bestMove,
        bestMoveBeforeSan,
        winLoss,
        classification,
        commentary,
      })
    }

    return {
      engineId,
      engineLabel: engineMeta.label,
      startWinPercent,
      moves: reviewedMoves,
      white: computeSideSummary(reviewedMoves, 'w'),
      black: computeSideSummary(reviewedMoves, 'b'),
    }
  } finally {
    if (isStockfish) {
      worker.postMessage('quit')
    }
    worker.terminate()
  }
}
