import { Chess, DEFAULT_POSITION, type PieceSymbol, type Square } from 'chess.js'
import { fetchLichessCloudEval } from './lichessCloudEval'
import type { MaiaWorkerRequest, MaiaWorkerResponse } from './maiaWorker'
import {
  getStockfishWorkerUrl,
  type StockfishFlavor,
} from './stockfishFullCache'

export type ReviewEngineId =
  | 'stockfish-12'
  | 'stockfish-16'
  | 'stockfish-cloud'
  | 'maia-1500'

export const REVIEW_ENGINES: Array<{
  id: ReviewEngineId
  label: string
  shortLabel: string
  desc: string
}> = [
  {
    id: 'stockfish-12',
    label: 'Stockfish 19 (Nhanh • d12)',
    shortLabel: 'Stockfish 19 (d12)',
    desc: 'NNUE chuẩn xác (~3600+ Elo), tốc độ nhanh',
  },
  {
    id: 'stockfish-16',
    label: 'Stockfish 19 Deep (d16)',
    shortLabel: 'SF19 Deep (d16)',
    desc: 'Phân tích sâu cho ván quan trọng & tàn cuộc',
  },
  {
    id: 'stockfish-cloud',
    label: 'Lichess Cloud + SF19 Hybrid',
    shortLabel: 'Cloud + SF19',
    desc: 'Khai cuộc depth 30–60+ từ Lichess Cloud + SF19 d14',
  },
  {
    id: 'maia-1500',
    label: 'Maia-3 Human (1500 Elo)',
    shortLabel: 'Maia-3 Human',
    desc: 'Chấm điểm theo góc nhìn người thật (cần tải Maia-3)',
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
  | 'miss'
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
  /** Centipawn loss (capped at 1000 cp) for ACPL calculation */
  cpLoss: number
  /** White's win probability after this move (0–100) */
  whiteWinPercent: number
  bestMoveBefore: string | null
  bestMoveBeforeSan: string | null
  /** Human-readable SAN line of opponent's best refutation after this move */
  refutationLine?: string
  /** Human-readable SAN line of engine's recommended continuation instead of this move */
  recommendedLine?: string
  winLoss: number
  phase: GamePhase
  classification: MoveClassification
  commentary: string
}

export type GamePhase = 'opening' | 'middlegame' | 'endgame'

export type PhaseGrade = 'excellent' | 'good' | 'okay' | 'weak' | 'poor'

export interface PhaseStats {
  moveCount: number
  accuracy: number | null
  blunders: number
  mistakes: number
  grade: PhaseGrade | null
}

export interface PhaseRanges {
  openingStartPly: number | null
  middlegameStartPly: number | null
  endgameStartPly: number | null
}

export const PHASE_GRADE_META: Record<
  PhaseGrade,
  { symbol: string; label: string; color: string; bg: string }
> = {
  excellent: {
    symbol: '★',
    label: 'Xuất sắc',
    color: '#81b64c',
    bg: 'rgba(129, 182, 76, 0.2)',
  },
  good: {
    symbol: '✓',
    label: 'Tốt',
    color: '#96bc4b',
    bg: 'rgba(150, 188, 75, 0.16)',
  },
  okay: {
    symbol: '?!',
    label: 'Ổn',
    color: '#f0c15c',
    bg: 'rgba(240, 193, 92, 0.2)',
  },
  weak: {
    symbol: '?',
    label: 'Yếu',
    color: '#e6912c',
    bg: 'rgba(230, 145, 44, 0.22)',
  },
  poor: {
    symbol: '??',
    label: 'Kém',
    color: '#ca3431',
    bg: 'rgba(202, 52, 49, 0.24)',
  },
}

export interface SideReviewSummary {
  accuracy: number
  /** Average Centipawn Loss (Lichess standard metric, lower = stronger) */
  acpl: number
  /** Number of non-book moves used for rating confidence */
  evaluatedMoves: number
  estimatedRating: number
  ratings: EstimatedRatings
  phases: Record<GamePhase, PhaseStats>
  overallGrade: PhaseGrade
  brilliant: number
  great: number
  best: number
  excellent: number
  good: number
  book: number
  inaccuracy: number
  mistake: number
  miss: number
  blunder: number
}

export interface GameReviewResult {
  engineId: ReviewEngineId
  engineLabel: string
  /** White win probability at ply 0 (starting position) */
  startWinPercent: number
  moves: ReviewMoveInfo[]
  phaseRanges: PhaseRanges
  overallSummary: string
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
  'miss',
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
  miss: {
    symbol: '×',
    label: 'Bỏ lỡ (Miss)',
    color: '#ff7769',
    bg: 'rgba(255, 119, 105, 0.24)',
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
  k: 100,
}

/**
 * Static Exchange Evaluation (SEE) on a target square after a move has been played.
 * Returns the net material delta for the original mover (including any piece just captured
 * on that square) assuming both sides recapture optimally with their least valuable attacker.
 * Example:
 *  - Defended Knight on d5 traded 3-for-3 -> returns 0 (NOT a sacrifice).
 *  - Bxh7+ taking a pawn (+1) then Kxh7 (-3) with no recapture -> returns -2 (TRUE sacrifice).
 *  - Qb8+ (+0) then Nxb8 (-9) with no recapture -> returns -9 (TRUE sacrifice).
 */
function computeExchangeNetForMover(
  fenAfterMove: string,
  targetSquare: Square,
  capturedOnMove: PieceSymbol | undefined,
): number {
  const initialGain = capturedOnMove ? MATERIAL_VALUE[capturedOnMove] : 0
  const sim = new Chess()
  sim.load(fenAfterMove)

  // Recursively evaluate minimax material gain for the side to move on targetSquare
  function seeRec(depth: number): number {
    if (depth >= 8) return 0
    const captures = sim
      .moves({ verbose: true })
      .filter((m) => m.to === targetSquare && m.captured)
    if (captures.length === 0) return 0

    // Least valuable attacker first (standard SEE ordering)
    captures.sort(
      (a, b) => MATERIAL_VALUE[a.piece] - MATERIAL_VALUE[b.piece],
    )
    const bestAttacker = captures[0]
    const gain = MATERIAL_VALUE[bestAttacker.captured!]

    sim.move(bestAttacker)
    const reply = seeRec(depth + 1)
    sim.undo()

    return Math.max(0, gain - reply)
  }

  // Opponent moves first on targetSquare; their positive SEE is mover's loss
  const opponentGain = seeRec(0)
  return initialGain - opponentGain
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
  lang?: 'vi' | 'en'
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

  const cpBeforeWhite = evalToCappedCp(params.before.cp, params.before.mate)
  const cpAfterWhite = evalToCappedCp(params.after.cp, params.after.mate)
  const moverCpBefore = params.color === 'w' ? cpBeforeWhite : -cpBeforeWhite
  const moverCpAfter = params.color === 'w' ? cpAfterWhite : -cpAfterWhite
  const cpLoss = Math.max(0, Math.min(1000, moverCpBefore - moverCpAfter))

  let liveLegalCount = 20
  let liveWasInCheck = false
  let liveIsSacrifice = false
  let liveMovedPiece: PieceSymbol = 'p'
  let fenAfter = params.fenBefore
  try {
    const temp = new Chess()
    temp.load(params.fenBefore)
    liveLegalCount = temp.moves().length
    liveWasInCheck = temp.inCheck()
    const executed = temp.move({
      from: params.uci.slice(0, 2) as Square,
      to: params.uci.slice(2, 4) as Square,
      promotion: (params.uci[4] as PieceSymbol | undefined) ?? undefined,
    })
    fenAfter = temp.fen()
    liveMovedPiece = executed.piece
    if (executed.piece !== 'k' && MATERIAL_VALUE[executed.piece] >= 3 && !temp.isCheckmate()) {
      const net = computeExchangeNetForMover(
        fenAfter,
        executed.to,
        executed.captured,
      )
      liveIsSacrifice = net <= -2
    }
  } catch {
    // Fallback to defaults
  }

  const classification = classifyMove({
    ply: params.ply,
    isStandardStart: params.isStandardStart,
    uci: params.uci,
    san: params.san,
    bestMoveBefore: params.before.bestMove,
    winLoss,
    cpLoss,
    moverWinBefore,
    moverWinAfter,
    onlyMoveGap: 0,
    mateBeforeForMover:
      params.before.mate === null
        ? null
        : params.color === 'w'
          ? params.before.mate
          : -params.before.mate,
    mateAfterForMover:
      params.after.mate === null
        ? null
        : params.color === 'w'
          ? params.after.mate
          : -params.after.mate,
    isSacrifice: liveIsSacrifice,
    isCheckmate: params.isCheckmate,
    legalMoveCount: liveLegalCount,
    wasInCheckBefore: liveWasInCheck,
    isImmediateRecapture: false,
    isObviousFreeCapture: false,
    isPromotion: Boolean(params.uci[4]),
    movedPiece: liveMovedPiece,
  })

  const bestMoveBeforeSan = uciToSanSafe(
    params.fenBefore,
    params.before.bestMove,
  )

  const commentary = buildCoachCommentary({
    san: params.san,
    uci: params.uci,
    color: params.color,
    fenBefore: params.fenBefore,
    fenAfter,
    classification,
    bestMoveBefore: params.before.bestMove,
    bestMoveBeforeSan,
    winLoss,
    onlyMoveGap: 0,
    cpBefore: params.before.cp,
    mateBefore: params.before.mate,
    cpAfter: params.after.cp,
    mateAfter: params.after.mate,
    isCheckmate: params.isCheckmate,
    lang: params.lang ?? 'vi',
  })

  return { classification, winLoss, bestMoveBeforeSan, commentary }
}

function evalToCappedCp(cp: number | null, mate: number | null): number {
  if (mate !== null) {
    return mate > 0 ? 1000 : -1000
  }
  if (cp === null) return 0
  return Math.max(-1000, Math.min(1000, cp))
}

function classifyMove(params: {
  ply: number
  isStandardStart: boolean
  uci: string
  san: string
  bestMoveBefore: string | null
  winLoss: number
  cpLoss: number
  moverWinBefore: number
  moverWinAfter: number
  /** Win% gap between best move (MultiPV 1) and 2nd best move (MultiPV 2) */
  onlyMoveGap: number
  mateBeforeForMover: number | null
  mateAfterForMover: number | null
  isSacrifice: boolean
  isCheckmate: boolean
  legalMoveCount: number
  wasInCheckBefore: boolean
  isImmediateRecapture: boolean
  isObviousFreeCapture: boolean
  isPromotion: boolean
  movedPiece: PieceSymbol
}): MoveClassification {
  const {
    ply,
    isStandardStart,
    uci,
    bestMoveBefore,
    winLoss,
    cpLoss,
    moverWinBefore,
    moverWinAfter,
    onlyMoveGap,
    mateBeforeForMover,
    mateAfterForMover,
    isSacrifice,
    isCheckmate,
    legalMoveCount,
    wasInCheckBefore,
    isImmediateRecapture,
    isObviousFreeCapture,
    isPromotion,
    movedPiece,
  } = params

  const isTopChoice = Boolean(bestMoveBefore && uci === bestMoveBefore)

  if (isCheckmate) return 'best'
  // A move with only 1 legal option is forced — never an error or blunder
  if (legalMoveCount <= 1) return 'best'

  // Already in a forced checkmate sequence before moving (preparing to be mated):
  // every legal move gets mated — never punish as a Blunder or Mistake!
  if (mateBeforeForMover !== null && mateBeforeForMover < 0) {
    return isTopChoice ? 'best' : 'good'
  }

  // 1. Walking directly into a forced checkmate when position was genuinely playable
  if (
    !isTopChoice &&
    mateAfterForMover !== null &&
    mateAfterForMover < 0 &&
    (mateBeforeForMover === null || mateBeforeForMover >= 0)
  ) {
    // If already losing badly (<= 18%) or desperate defense (<= 28%), don't harshly brand as Blunder
    if (moverWinBefore <= 18) return 'inaccuracy'
    if (moverWinBefore <= 28) return 'mistake'
    return 'blunder'
  }

  // 2. Missing a forced checkmate (only if player did NOT play the engine's top move)
  if (
    !isTopChoice &&
    mateBeforeForMover !== null &&
    mateBeforeForMover > 0 &&
    mateAfterForMover === null
  ) {
    if (moverWinAfter >= 88) return 'inaccuracy'
    // Still equal or winning after missing mate -> Miss (Bỏ lỡ cơ hội), NOT Blunder!
    if (moverWinAfter >= 45) return 'miss'
    return 'blunder'
  }

  // 3. Opening book heuristic: standard opening plies with tight accuracy & balanced eval
  if (
    isStandardStart &&
    ply <= 10 &&
    winLoss <= 1.2 &&
    cpLoss <= 25 &&
    moverWinAfter >= 45 &&
    moverWinAfter <= 56
  ) {
    return 'book'
  }

  // Disqualify routine / forced / obvious moves from Brilliant (!!) and Great (!)
  const isForcedOrObvious =
    legalMoveCount <= 2 ||
    isImmediateRecapture ||
    isPromotion ||
    (wasInCheckBefore && movedPiece === 'k')

  // 4. Brilliant (!!): a genuine piece sacrifice (SEE <= -2) that does NOT lose your
  // advantage on the evaluation bar (maintains or improves eval, or forces checkmate).
  const forcesMate = mateAfterForMover !== null && mateAfterForMover > 0
  const keepsAdvantage =
    isTopChoice || (winLoss <= 2.0 && cpLoss <= 35)

  if (
    isSacrifice &&
    !isForcedOrObvious &&
    !isObviousFreeCapture &&
    keepsAdvantage &&
    ply >= 6 &&
    moverWinAfter >= 48 &&
    (moverWinBefore <= 88 || forcesMate)
  ) {
    return 'brilliant'
  }

  // 5. Great (!): genuine non-obvious "only move" (MultiPV1 vs MultiPV2 gap >= 18% win chance).
  // Never awarded for recaptures, taking hanging/free pieces, promotions, king escapes, or already-won/lost positions.
  if (
    isTopChoice &&
    winLoss <= 0.6 &&
    !isForcedOrObvious &&
    !isObviousFreeCapture &&
    ply >= 8 &&
    moverWinBefore < 82 &&
    moverWinAfter >= 35 &&
    onlyMoveGap >= 18
  ) {
    return 'great'
  }

  // 6. Authoritative Chess.com Expected Points V2 + Lichess Win% classification
  // Official Chess.com EP thresholds: Best (<=0.8%), Excellent (<=2%), Good (<=5%),
  // Inaccuracy (<=10%), Mistake (<=20%), Blunder (>20% & major eval drop >=3.0 / collapse).
  if (isTopChoice || winLoss <= 0.8) return 'best'
  if (winLoss <= 2.0) return 'excellent'
  if (winLoss <= 5.0) return 'good'

  // Safeguard: never label Mistake/Blunder when remaining clearly winning (+3.5+)
  // or already clearly lost (-4.0 or worse) without walking into a new forced mate.
  if (moverWinAfter >= 85) return 'good'
  if (moverWinAfter >= 78 || moverWinBefore <= 18) return 'inaccuracy'

  // Miss (×): missed a major winning opportunity (e.g. opponent's blunder / winning tactic)
  // while keeping the position equal or playable (>= 45%) rather than collapsing to lost.
  if (moverWinBefore >= 68 && moverWinAfter >= 45 && winLoss >= 15.0) {
    return 'miss'
  }

  // Blunder (??): severe error collapsing into a losing position (< 45%)
  // with either >= 3.0 points (300 cp) eval drop + >20% EP loss, or massive >28% EP collapse.
  if (
    moverWinAfter < 45 &&
    ((winLoss > 20.0 && cpLoss >= 300) || winLoss > 28.0)
  ) {
    return 'blunder'
  }

  if (winLoss > 10.0) return 'mistake'
  return 'inaccuracy'
}

const PIECE_NAME_VI: Record<PieceSymbol, string> = {
  p: 'Tốt',
  n: 'Mã',
  b: 'Tượng',
  r: 'Xe',
  q: 'Hậu',
  k: 'Vua',
}

const PIECE_NAME_EN: Record<PieceSymbol, string> = {
  p: 'Pawn',
  n: 'Knight',
  b: 'Bishop',
  r: 'Rook',
  q: 'Queen',
  k: 'King',
}

const CENTER_SQUARES = new Set(['d4', 'd5', 'e4', 'e5', 'c4', 'c5', 'f4', 'f5'])

function formatEvalShort(cp: number | null, mate: number | null): string {
  if (mate !== null) {
    return mate > 0 ? `+M${Math.abs(mate)}` : `-M${Math.abs(mate)}`
  }
  if (cp === null) return '0.0'
  const val = cp / 100
  if (Math.abs(val) < 0.05) return '0.0'
  return val > 0 ? `+${val.toFixed(1)}` : val.toFixed(1)
}

function pvToSanLine(fen: string, pv: string[] | undefined, maxPlies = 4): string {
  if (!pv || pv.length === 0) return ''
  try {
    const temp = new Chess()
    temp.load(fen)
    const out: string[] = []
    for (const uci of pv.slice(0, maxPlies)) {
      if (uci.length < 4) break
      const m = temp.move({
        from: uci.slice(0, 2) as Square,
        to: uci.slice(2, 4) as Square,
        promotion: (uci[4] as PieceSymbol | undefined) ?? undefined,
      })
      out.push(m.san)
    }
    return out.join(' ')
  } catch {
    return ''
  }
}

function inspectSingleUciMove(
  fen: string,
  uci: string | null | undefined,
): {
  san: string
  piece: PieceSymbol
  from: Square
  to: Square
  captured?: PieceSymbol
  isCheck: boolean
  isCastle: boolean
  promotion?: PieceSymbol
} | null {
  if (!uci || uci.length < 4) return null
  try {
    const temp = new Chess()
    temp.load(fen)
    const m = temp.move({
      from: uci.slice(0, 2) as Square,
      to: uci.slice(2, 4) as Square,
      promotion: (uci[4] as PieceSymbol | undefined) ?? undefined,
    })
    return {
      san: m.san,
      piece: m.piece,
      from: m.from,
      to: m.to,
      captured: m.captured,
      isCheck: temp.inCheck(),
      isCastle: m.san === 'O-O' || m.san === 'O-O-O',
      promotion: m.promotion,
    }
  } catch {
    return null
  }
}

function describeRecommendedReason(
  fenBefore: string,
  bestMoveUci: string | null,
  bestMoveSan: string | null,
  lang: 'vi' | 'en' = 'vi',
): string {
  if (!bestMoveSan) return ''
  const info = inspectSingleUciMove(fenBefore, bestMoveUci)
  if (lang === 'en') {
    if (!info) return `Consider ${bestMoveSan} instead.`
    if (info.promotion) {
      return `Play ${bestMoveSan} to promote into a ${PIECE_NAME_EN[info.promotion]}.`
    }
    if (info.isCastle) {
      return `Castling (${bestMoveSan}) brings the King to safety and connects the Rooks.`
    }
    if (info.captured && info.isCheck) {
      return `${bestMoveSan} wins the ${PIECE_NAME_EN[info.captured]} on ${info.to} with check.`
    }
    if (info.captured) {
      return `${bestMoveSan} captures the ${PIECE_NAME_EN[info.captured]} on ${info.to} to gain an advantage.`
    }
    if (info.isCheck) {
      return `${bestMoveSan} delivers check and seizes the initiative.`
    }
    if (CENTER_SQUARES.has(info.to) && info.piece !== 'k') {
      return `${bestMoveSan} controls the center more effectively.`
    }
    return `A stronger option was ${bestMoveSan}.`
  }

  if (!info) return `Nên đi ${bestMoveSan}.`
  if (info.promotion) {
    return `Nên đi ${bestMoveSan} để phong cấp thành ${PIECE_NAME_VI[info.promotion]}.`
  }
  if (info.isCastle) {
    return `Nên nhập thành (${bestMoveSan}) để đưa Vua về nơi an toàn và kết nối Xe.`
  }
  if (info.captured && info.isCheck) {
    return `Nên đi ${bestMoveSan} — vừa ăn ${PIECE_NAME_VI[info.captured]} ở ${info.to} vừa chiếu ép buộc.`
  }
  if (info.captured) {
    return `Nên đi ${bestMoveSan} để ăn ${PIECE_NAME_VI[info.captured]} tại ${info.to} và giành lợi thế.`
  }
  if (info.isCheck) {
    return `Nên đi ${bestMoveSan} để chiếu Vua đối phương và giành thế chủ động.`
  }
  if (CENTER_SQUARES.has(info.to) && info.piece !== 'k') {
    return `Nên đi ${bestMoveSan} để kiểm soát trung tâm tốt hơn.`
  }
  return `Phương án tối ưu hơn là ${bestMoveSan}.`
}

function buildCoachCommentary(params: {
  san: string
  uci: string
  color: 'w' | 'b'
  fenBefore: string
  fenAfter: string
  classification: MoveClassification
  bestMoveBefore: string | null
  bestMoveBeforeSan: string | null
  pvAfter?: string[]
  winLoss: number
  onlyMoveGap: number
  cpBefore: number | null
  mateBefore: number | null
  cpAfter: number | null
  mateAfter: number | null
  isCheckmate: boolean
  lang?: 'vi' | 'en'
}): string {
  const {
    san,
    uci,
    color,
    fenBefore,
    fenAfter,
    classification,
    bestMoveBefore,
    bestMoveBeforeSan,
    pvAfter,
    winLoss,
    onlyMoveGap,
    cpBefore,
    mateBefore,
    cpAfter,
    mateAfter,
    isCheckmate,
    lang = 'vi',
  } = params

  const isEn = lang === 'en'

  if (isCheckmate) {
    return isEn
      ? `${san} delivers checkmate and ends the game immediately!`
      : `${san} chiếu hết hoàn hảo, kết thúc ván đấu ngay lập tức!`
  }

  const played = inspectSingleUciMove(fenBefore, uci)
  const reply = inspectSingleUciMove(fenAfter, pvAfter?.[0])
  const evalBeforeTxt = formatEvalShort(cpBefore, mateBefore)
  const evalAfterTxt = formatEvalShort(cpAfter, mateAfter)

  const mateBeforeForMover =
    mateBefore === null ? null : color === 'w' ? mateBefore : -mateBefore
  const mateAfterForMover =
    mateAfter === null ? null : color === 'w' ? mateAfter : -mateAfter

  // 1. Brilliant (!!)
  if (classification === 'brilliant') {
    const pieceLabel = played
      ? isEn
        ? PIECE_NAME_EN[played.piece]
        : PIECE_NAME_VI[played.piece]
      : isEn
        ? 'piece'
        : 'quân'
    const targetSq = played ? played.to : ''
    if (isEn) {
      const followTxt = reply
        ? `Even against the strongest reply ${reply.san}, you keep a decisive advantage (${evalAfterTxt}).`
        : `This sacrifice unleashes an unstoppable tactical attack (${evalAfterTxt}).`
      return `${san}!! Brilliant — bold ${pieceLabel} sacrifice on ${targetSq} to shatter the opponent's defense. ${followTxt}`
    }
    const followTxt = reply
      ? `Ngay cả khi đối thủ đáp trả mạnh nhất bằng ${reply.san}, bạn vẫn duy trì ưu thế áp đảo (${evalAfterTxt}).`
      : `Nước thí này mở ra đòn chiến thuật không thể chống đỡ (${evalAfterTxt}).`
    return `${san}!! Nước đi thiên tài — táo bạo thí ${pieceLabel} tại ${targetSq} để phá vỡ phòng tuyến đối phương. ${followTxt}`
  }

  // 2. Great (!)
  if (classification === 'great') {
    if (isEn) {
      const gapTxt =
        onlyMoveGap >= 12
          ? `The only move to keep the position intact (2nd best is ${Math.round(onlyMoveGap)}% worse).`
          : 'A sharp move that punishes the opponent accurately.'
      if (played?.captured) {
        return `${san}! ${gapTxt} Capturing the ${PIECE_NAME_EN[played.captured]} on ${played.to} converts the advantage cleanly (${evalAfterTxt}).`
      }
      if (played?.isCheck) {
        return `${san}! ${gapTxt} Checking on ${played.to} forces the opponent onto the back foot.`
      }
      return `${san}! ${gapTxt}`
    }
    const gapTxt =
      onlyMoveGap >= 12
        ? `Đây là nước duy nhất giữ vững thế trận (phương án tốt thứ 2 kém hơn tới ${Math.round(onlyMoveGap)}% cơ hội thắng).`
        : 'Nước đi sắc bén tận dụng chính xác sai lầm vừa rồi của đối phương.'
    if (played?.captured) {
      return `${san}! ${gapTxt} Đòn ăn ${PIECE_NAME_VI[played.captured]} tại ${played.to} chuyển hóa lợi thế dứt khoát (${evalAfterTxt}).`
    }
    if (played?.isCheck) {
      return `${san}! ${gapTxt} Đòn chiếu tại ${played.to} buộc đối phương rơi vào thế phòng thủ bị động.`
    }
    return `${san}! ${gapTxt}`
  }

  // 3. Blunder / Miss / Mistake / Inaccuracy — concrete refutation analysis!
  if (
    classification === 'blunder' ||
    classification === 'miss' ||
    classification === 'mistake' ||
    classification === 'inaccuracy'
  ) {
    const recTxt = describeRecommendedReason(
      fenBefore,
      bestMoveBefore,
      bestMoveBeforeSan,
      lang,
    )

    if (mateAfterForMover !== null && mateAfterForMover < 0) {
      const mIn = Math.abs(mateAfterForMover)
      if (isEn) {
        const replyHint = reply ? ` starting with ${reply.san}` : ''
        return `${san} walks into a forced checkmate in ${mIn}${replyHint}! ${recTxt}`
      }
      const replyHint = reply ? ` bắt đầu bằng ${reply.san}` : ''
      return `${san} tự mở đường cho đối thủ chiếu hết cưỡng bức trong ${mIn} nước${replyHint}! ${recTxt}`
    }

    if (
      mateBeforeForMover !== null &&
      mateBeforeForMover > 0 &&
      mateAfterForMover === null
    ) {
      return isEn
        ? `${san} misses a forced checkmate in ${mateBeforeForMover} (${evalBeforeTxt} → ${evalAfterTxt}). ${recTxt}`
        : `${san} bỏ lỡ đòn chiếu hết cưỡng bức trong ${mateBeforeForMover} nước (từ ${evalBeforeTxt} về ${evalAfterTxt}). ${recTxt}`
    }

    if (classification === 'miss') {
      return isEn
        ? `${san} misses a major winning opportunity (${evalBeforeTxt} → ${evalAfterTxt}). ${recTxt}`
        : `${san} bỏ lỡ cơ hội giành ưu thế quyết định (${evalBeforeTxt} → ${evalAfterTxt}). ${recTxt}`
    }

    if (played && reply?.captured && reply.to === played.to) {
      return isEn
        ? `${san} leaves the ${PIECE_NAME_EN[played.piece]} on ${played.to} undefended — opponent captures with ${reply.san} (${evalBeforeTxt} → ${evalAfterTxt}). ${recTxt}`
        : `${san} đưa ${PIECE_NAME_VI[played.piece]} vào ô ${played.to} không đủ bảo vệ — đối thủ ăn ngay bằng ${reply.san} (${evalBeforeTxt} → ${evalAfterTxt}). ${recTxt}`
    }

    if (reply?.captured) {
      return isEn
        ? `${san} leaves the ${PIECE_NAME_EN[reply.captured]} on ${reply.to} hanging to ${reply.san} (${evalBeforeTxt} → ${evalAfterTxt}). ${recTxt}`
        : `${san} bỏ quên ${PIECE_NAME_VI[reply.captured]} tại ${reply.to}, cho phép đối thủ khai thác ngay bằng ${reply.san} (${evalBeforeTxt} → ${evalAfterTxt}). ${recTxt}`
    }

    if (reply?.isCheck) {
      return isEn
        ? `${san} exposes the King to a strong counter-check ${reply.san} (${evalBeforeTxt} → ${evalAfterTxt}). ${recTxt}`
        : `${san} làm hở Vua, để đối thủ tung đòn chiếu phản công ${reply.san} (${evalBeforeTxt} → ${evalAfterTxt}). ${recTxt}`
    }

    if (isEn) {
      const sev =
        classification === 'blunder'
          ? 'is a blunder'
          : classification === 'mistake'
            ? 'is a mistake'
            : 'is slightly inaccurate'
      const rep = reply ? ` allowing the strong reply ${reply.san}` : ''
      return `${san} ${sev}${rep}, shifting the eval from ${evalBeforeTxt} → ${evalAfterTxt} (-${Math.round(winLoss)}% win chance). ${recTxt}`
    }
    const severityLabel =
      classification === 'blunder'
        ? 'sai lầm nghiêm trọng'
        : classification === 'mistake'
          ? 'sai lầm'
          : 'hơi thiếu chính xác'
    const replyClause = reply
      ? ` vì đối thủ có nước đáp trả mạnh ${reply.san}`
      : ''
    return `${san} ${severityLabel}${replyClause}, khiến thế cờ thay đổi từ ${evalBeforeTxt} → ${evalAfterTxt} (-${Math.round(winLoss)}% cơ hội thắng). ${recTxt}`
  }

  // 4. Book
  if (classification === 'book') {
    if (isEn) {
      if (played?.isCastle) {
        return `${san} — standard opening castling, keeping the King safe.`
      }
      if (played && CENTER_SQUARES.has(played.to)) {
        return `${san} — standard opening theory fighting directly for the center.`
      }
      return `${san} — solid opening book development, keeping the position balanced (${evalAfterTxt}).`
    }
    if (played?.isCastle) {
      return `${san} — nhập thành chuẩn khai cuộc, bảo vệ Vua và kích hoạt Xe.`
    }
    if (played && CENTER_SQUARES.has(played.to)) {
      return `${san} — nước khai cuộc chuẩn lý thuyết, tranh chấp trực tiếp khu trung tâm.`
    }
    return `${san} — nước phát triển chuẩn sách khai cuộc, giữ thế trận cân bằng (${evalAfterTxt}).`
  }

  // 5. Best / Excellent / Good
  if (isEn) {
    if (played?.promotion) {
      return `${san} — promotes to a ${PIECE_NAME_EN[played.promotion]} with a decisive edge (${evalAfterTxt}).`
    }
    if (played?.isCastle) {
      return `${san} — timely castling, safeguarding the King and connecting Rooks (${evalAfterTxt}).`
    }
    if (played?.captured && played.isCheck) {
      return `${san} — sharp tactic capturing the ${PIECE_NAME_EN[played.captured]} on ${played.to} with check (${evalAfterTxt}).`
    }
    if (played?.captured) {
      return `${san} — solid capture of the ${PIECE_NAME_EN[played.captured]} on ${played.to} (${evalAfterTxt}).`
    }
    if (played?.isCheck) {
      return `${san} — active check on ${played.to}, keeping the initiative (${evalAfterTxt}).`
    }
    if (mateAfterForMover !== null && mateAfterForMover > 0) {
      return `${san} — accurate move forcing checkmate in ${mateAfterForMover}!`
    }
    if (played && CENTER_SQUARES.has(played.to) && played.piece !== 'k') {
      return `${san} — places the ${PIECE_NAME_EN[played.piece]} on ${played.to} with strong central control (${evalAfterTxt}).`
    }
    if (classification === 'good' && bestMoveBeforeSan && bestMoveBeforeSan !== san) {
      return `${san} is a solid move (${evalAfterTxt}), though ${bestMoveBeforeSan} offered slightly more pressure.`
    }
    return `${san} — accurate move improving piece activity (${evalAfterTxt}).`
  }

  if (played?.promotion) {
    return `${san} — phong cấp thành ${PIECE_NAME_VI[played.promotion]}, tạo ưu thế áp đảo (${evalAfterTxt}).`
  }
  if (played?.isCastle) {
    return `${san} — nhập thành đúng thời điểm, đưa Vua vào vị trí an toàn và kết nối cặp Xe (${evalAfterTxt}).`
  }
  if (played?.captured && played.isCheck) {
    return `${san} — đòn chiến thuật chính xác, vừa ăn ${PIECE_NAME_VI[played.captured]} tại ${played.to} vừa chiếu ép buộc (${evalAfterTxt}).`
  }
  if (played?.captured) {
    return `${san} — ăn ${PIECE_NAME_VI[played.captured]} tại ${played.to} hợp lý, duy trì thế trận thuận lợi (${evalAfterTxt}).`
  }
  if (played?.isCheck) {
    return `${san} — đòn chiếu gây áp lực tại ${played.to}, giữ quyền chủ động (${evalAfterTxt}).`
  }
  if (mateAfterForMover !== null && mateAfterForMover > 0) {
    return `${san} — nước đi chính xác mở ra đòn chiếu hết cưỡng bức trong ${mateAfterForMover} nước!`
  }
  if (played && CENTER_SQUARES.has(played.to) && played.piece !== 'k') {
    return `${san} — điều ${PIECE_NAME_VI[played.piece]} ra ${played.to} kiểm soát trung tâm chắc chắn (${evalAfterTxt}).`
  }
  if (classification === 'good' && bestMoveBeforeSan && bestMoveBeforeSan !== san) {
    return `${san} là nước đi an toàn (${evalAfterTxt}), tuy nhiên ${bestMoveBeforeSan} tạo thêm chút áp lực hơn.`
  }
  return `${san} — nước đi chính xác, cải thiện vị trí ${played ? PIECE_NAME_VI[played.piece] : 'quân'} và giữ điểm số ở mức ${evalAfterTxt}.`
}

function roundTo50(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, Math.round(value / 50) * 50))
}

export type GameOutcome = '1-0' | '0-1' | '1/2-1/2' | null

function toCrossPlatformFromChessCom(
  rawChessCom: number,
  timeControl: TimeControlCategory,
): EstimatedRatings {
  const tcExtra: Record<
    TimeControlCategory,
    { lichessExtra: number; fideShift: number }
  > = {
    bullet: { lichessExtra: 35, fideShift: -40 },
    blitz: { lichessExtra: 15, fideShift: 0 },
    rapid: { lichessExtra: 0, fideShift: 0 },
    classical: { lichessExtra: -20, fideShift: 35 },
  }
  const extra = tcExtra[timeControl]

  const lichessOffset =
    (rawChessCom < 2200
      ? 265 - ((Math.max(400, rawChessCom) - 400) / 1800) * 115
      : Math.max(40, 150 - ((rawChessCom - 2200) / 600) * 110)) +
    extra.lichessExtra
  const rawLichess = rawChessCom + lichessOffset

  const rawFide =
    (rawChessCom < 1400
      ? 950 + ((Math.max(400, rawChessCom) - 400) / 1000) * 500
      : 1450 + (rawChessCom - 1400) * 0.94) + extra.fideShift

  return {
    fide: roundTo50(rawFide, 1000, 2850),
    chesscom: roundTo50(rawChessCom, 300, 2900),
    lichess: roundTo50(rawLichess, 700, 2950),
  }
}

/**
 * Purely objective overall match performance Elo (Chess.com scale) computed cleanly
 * from overall Accuracy, ACPL, time control, and match result — no artificial per-move
 * +/- bonuses or penalties based on move labels, and no anchoring to profile Elo.
 */
function computeRawChessComPerf(params: {
  accuracy: number
  acpl?: number
  timeControl?: TimeControlCategory
  sideResult?: 'win' | 'loss' | 'draw' | 'unknown'
}): number {
  const {
    accuracy,
    acpl = Math.max(8, Math.round((100 - accuracy) * 2.4)),
    timeControl = 'rapid',
    sideResult = 'unknown',
  } = params

  // 1. Overall Accuracy -> Elo curve (smooth monotonic calibration across 300–2800)
  const accClamped = Math.max(20, Math.min(99.5, accuracy))
  const eloFromAcc = 250 + Math.pow((accClamped - 20) / 80, 1.82) * 2550

  // 2. Overall ACPL -> Elo curve
  const acplClamped = Math.max(4, Math.min(260, acpl))
  const eloFromAcpl = 2850 * Math.exp(-0.0145 * acplClamped) + 100

  // 3. Time-control calibration
  const tcShiftMap: Record<TimeControlCategory, number> = {
    bullet: 150,
    blitz: 75,
    rapid: 0,
    classical: -80,
  }

  // 4. Small objective match-result adjustment
  const resultNudge =
    sideResult === 'win' ? 65 : sideResult === 'loss' ? -65 : 0

  const objectiveElo =
    0.55 * eloFromAcc +
    0.45 * eloFromAcpl +
    tcShiftMap[timeControl] +
    resultNudge

  return Math.max(300, Math.min(2900, objectiveElo))
}

/**
 * Estimates objective single-game performance Elo across Chess.com, Lichess, and FIDE scales.
 */
export function estimateCrossPlatformRatings(params: {
  accuracy: number
  acpl?: number
  timeControl?: TimeControlCategory
  sideResult?: 'win' | 'loss' | 'draw' | 'unknown'
}): EstimatedRatings {
  const tc = params.timeControl ?? 'rapid'
  const rawChessCom = computeRawChessComPerf(params)
  return toCrossPlatformFromChessCom(rawChessCom, tc)
}

/**
 * Estimates both White and Black objective game ratings together, preserving
 * logical winner > loser ordering when the winner matched or outplayed the loser.
 */
export function estimateMatchRatings(params: {
  white: SideReviewSummary
  black: SideReviewSummary
  timeControl: TimeControlCategory
  gameOutcome?: GameOutcome
}): { white: EstimatedRatings; black: EstimatedRatings } {
  const { white, black, timeControl, gameOutcome = null } = params

  const whiteSideResult =
    gameOutcome === '1-0'
      ? 'win'
      : gameOutcome === '0-1'
        ? 'loss'
        : gameOutcome === '1/2-1/2'
          ? 'draw'
          : 'unknown'
  const blackSideResult =
    gameOutcome === '0-1'
      ? 'win'
      : gameOutcome === '1-0'
        ? 'loss'
        : gameOutcome === '1/2-1/2'
          ? 'draw'
          : 'unknown'

  let wRaw = computeRawChessComPerf({
    accuracy: white.accuracy,
    acpl: white.acpl,
    timeControl,
    sideResult: whiteSideResult,
  })

  let bRaw = computeRawChessComPerf({
    accuracy: black.accuracy,
    acpl: black.acpl,
    timeControl,
    sideResult: blackSideResult,
  })

  // Enforce logical winner > loser consistency in decisive games
  if (gameOutcome === '1-0' && white.accuracy >= black.accuracy - 4) {
    if (wRaw <= bRaw + 50) {
      const mid = (wRaw + bRaw) / 2
      wRaw = Math.min(2900, Math.max(wRaw, mid + 60))
      bRaw = Math.max(300, Math.min(bRaw, wRaw - 100))
    }
  } else if (gameOutcome === '0-1' && black.accuracy >= white.accuracy - 4) {
    if (bRaw <= wRaw + 50) {
      const mid = (wRaw + bRaw) / 2
      bRaw = Math.min(2900, Math.max(bRaw, mid + 60))
      wRaw = Math.max(300, Math.min(wRaw, bRaw - 100))
    }
  }

  return {
    white: toCrossPlatformFromChessCom(wRaw, timeControl),
    black: toCrossPlatformFromChessCom(bRaw, timeControl),
  }
}

/**
 * Official Lichess Accuracy formula:
 * 50% volatility-weighted mean + 50% harmonic mean of per-move accuracy.
 */
function computeLichessAccuracy(
  allMoves: ReviewMoveInfo[],
  startWinPercent: number,
  color: 'w' | 'b',
): number {
  const winSeries = [startWinPercent, ...allMoves.map((m) => m.whiteWinPercent)]
  const windowSize = Math.max(2, Math.min(8, Math.round(allMoves.length / 10)))

  const moveAccuracies: number[] = []
  const weights: number[] = []

  for (let i = 0; i < allMoves.length; i++) {
    const m = allMoves[i]
    if (m.color !== color) continue

    // Official Lichess AccuracyPercent.scala formula (with +1 uncertainty bonus)
    const acc =
      m.winLoss <= 0
        ? 100
        : Math.max(
            0,
            Math.min(
              100,
              103.1668 * Math.exp(-0.04354 * m.winLoss) - 3.1669 + 1,
            ),
          )

    // Sliding window standard deviation of win% = position volatility weight
    const startIdx = Math.max(0, i + 1 - windowSize)
    const slice = winSeries.slice(startIdx, i + 2)
    const mean = slice.reduce((a, b) => a + b, 0) / slice.length
    const variance =
      slice.reduce((sum, v) => sum + (v - mean) * (v - mean), 0) / slice.length
    const stdDev = Math.sqrt(variance)
    const weight = Math.max(0.5, Math.min(12, stdDev))

    moveAccuracies.push(acc)
    weights.push(weight)
  }

  if (moveAccuracies.length === 0) return 100

  let weightedSum = 0
  let weightTotal = 0
  let harmonicDenom = 0

  for (let i = 0; i < moveAccuracies.length; i++) {
    weightedSum += moveAccuracies[i] * weights[i]
    weightTotal += weights[i]
    harmonicDenom += 1 / Math.max(1, moveAccuracies[i])
  }

  const weightedMean = weightTotal > 0 ? weightedSum / weightTotal : 100
  const harmonicMean = moveAccuracies.length / harmonicDenom
  const combined = 0.5 * (weightedMean + harmonicMean)

  return Math.round(Math.max(0, Math.min(100, combined)) * 10) / 10
}

/**
 * Classifies a position's game phase (Opening / Middlegame / Endgame) monotonically
 * using remaining non-pawn material, queen presence, and move number.
 */
function detectPositionPhase(
  fen: string,
  moveNumber: number,
  prevPhase: GamePhase,
): GamePhase {
  const boardPart = fen.split(' ')[0] ?? ''
  let nonPawnMaterial = 0
  let whiteQueens = 0
  let blackQueens = 0
  let minorMajorCount = 0

  for (const ch of boardPart) {
    const lower = ch.toLowerCase()
    if (lower === 'q') {
      nonPawnMaterial += 9
      minorMajorCount += 1
      if (ch === 'Q') whiteQueens += 1
      else blackQueens += 1
    } else if (lower === 'r') {
      nonPawnMaterial += 5
      minorMajorCount += 1
    } else if (lower === 'b' || lower === 'n') {
      nonPawnMaterial += 3
      minorMajorCount += 1
    }
  }

  // Endgame: low remaining non-pawn material or queens traded with few pieces left
  const isEndgame =
    nonPawnMaterial <= 22 ||
    minorMajorCount <= 6 ||
    (whiteQueens === 0 && blackQueens === 0 && nonPawnMaterial <= 26)

  if (prevPhase === 'endgame' || isEndgame) {
    return 'endgame'
  }

  // Middlegame: after move 10, or once queens are traded, or significant exchanges (>= 12 pts off)
  const isMiddlegame =
    moveNumber > 10 ||
    whiteQueens === 0 ||
    blackQueens === 0 ||
    nonPawnMaterial <= 50

  if (prevPhase === 'middlegame' || isMiddlegame) {
    return 'middlegame'
  }

  return 'opening'
}

function gradeFromAccuracy(
  accuracy: number,
  blunders: number,
  moveCount: number,
): PhaseGrade {
  const blunderRatio = blunders / Math.max(1, moveCount)
  if (accuracy >= 88 && blunders === 0) return 'excellent'
  if (accuracy >= 76 && blunderRatio <= 0.08) return 'good'
  if (accuracy >= 62 && blunderRatio <= 0.16) return 'okay'
  if (accuracy >= 48) return 'weak'
  return 'poor'
}

function computePhaseStats(
  sideMoves: ReviewMoveInfo[],
  phase: GamePhase,
): PhaseStats {
  const phaseMoves = sideMoves.filter((m) => m.phase === phase)
  if (phaseMoves.length === 0) {
    return {
      moveCount: 0,
      accuracy: null,
      blunders: 0,
      mistakes: 0,
      grade: null,
    }
  }

  let accSum = 0
  let blunders = 0
  let mistakes = 0

  for (const m of phaseMoves) {
    // Official Lichess AccuracyPercent.scala formula (with +1 uncertainty bonus)
    const acc =
      m.winLoss <= 0
        ? 100
        : Math.max(
            0,
            Math.min(
              100,
              103.1668 * Math.exp(-0.04354 * m.winLoss) - 3.1669 + 1,
            ),
          )
    accSum += acc
    if (m.classification === 'blunder') blunders += 1
    else if (m.classification === 'mistake') mistakes += 1
  }

  const accuracy = Math.round((accSum / phaseMoves.length) * 10) / 10
  return {
    moveCount: phaseMoves.length,
    accuracy,
    blunders,
    mistakes,
    grade: gradeFromAccuracy(accuracy, blunders, phaseMoves.length),
  }
}

function buildOverallSummary(
  white: SideReviewSummary,
  black: SideReviewSummary,
  lang: 'vi' | 'en' = 'vi',
): string {
  const isEn = lang === 'en'
  const phaseNames: Record<GamePhase, string> = isEn
    ? { opening: 'the Opening', middlegame: 'the Middlegame', endgame: 'the Endgame' }
    : { opening: 'Khai cuộc', middlegame: 'Trung cuộc', endgame: 'Tàn cuộc' }

  let biggestPhase: GamePhase = 'middlegame'
  let biggestGap = -1
  let winnerInPhase: 'w' | 'b' = 'w'

  for (const ph of ['opening', 'middlegame', 'endgame'] as GamePhase[]) {
    const wAcc = white.phases[ph].accuracy
    const bAcc = black.phases[ph].accuracy
    if (wAcc !== null && bAcc !== null) {
      const gap = Math.abs(wAcc - bAcc)
      if (gap > biggestGap) {
        biggestGap = gap
        biggestPhase = ph
        winnerInPhase = wAcc >= bAcc ? 'w' : 'b'
      }
    }
  }

  if (biggestGap >= 10) {
    const wAcc = Math.round(white.phases[biggestPhase].accuracy ?? 0)
    const bAcc = Math.round(black.phases[biggestPhase].accuracy ?? 0)
    if (isEn) {
      return `The decisive phase was ${phaseNames[biggestPhase]}, where ${winnerInPhase === 'w' ? 'White' : 'Black'} outplayed the opponent (${wAcc}% vs ${bAcc}%).`
    }
    return `Điểm nhấn quyết định nằm ở ${phaseNames[biggestPhase]} khi bên ${winnerInPhase === 'w' ? 'Trắng' : 'Đen'} chơi vượt trội (${wAcc}% vs ${bAcc}%).`
  }

  if (white.accuracy >= 85 && black.accuracy >= 85) {
    return isEn
      ? 'High-quality game from both sides with consistent accuracy across all phases.'
      : 'Ván đấu chất lượng cao, cả hai bên đều duy trì độ chính xác ổn định qua các giai đoạn.'
  }

  if (white.blunder + black.blunder >= 4) {
    const totalB = white.blunder + black.blunder
    return isEn
      ? `A wild tactical battle with ${totalB} blunders swinging the evaluation back and forth.`
      : `Thế cờ diễn biến căng thẳng với nhiều sai lầm chiến thuật (${totalB} Blunder) xoay chuyển cục diện.`
  }

  return isEn
    ? `A closely contested game (${white.accuracy}% vs ${black.accuracy}%), decided by precision in critical moments.`
    : `Hai bên bám đuổi khá sát (${white.accuracy}% vs ${black.accuracy}%), phân định bằng sự chính xác ở những nước then chốt.`
}

function computeSideSummary(
  allMoves: ReviewMoveInfo[],
  startWinPercent: number,
  color: 'w' | 'b',
): SideReviewSummary {
  const sideMoves = allMoves.filter((m) => m.color === color)
  const emptyPhase: PhaseStats = {
    moveCount: 0,
    accuracy: null,
    blunders: 0,
    mistakes: 0,
    grade: null,
  }
  const summary: SideReviewSummary = {
    accuracy: 100,
    acpl: 0,
    evaluatedMoves: 0,
    estimatedRating: 1500,
    ratings: { fide: 1500, chesscom: 1500, lichess: 1750 },
    phases: {
      opening: { ...emptyPhase },
      middlegame: { ...emptyPhase },
      endgame: { ...emptyPhase },
    },
    overallGrade: 'good',
    brilliant: 0,
    great: 0,
    best: 0,
    excellent: 0,
    good: 0,
    book: 0,
    inaccuracy: 0,
    mistake: 0,
    miss: 0,
    blunder: 0,
  }

  if (sideMoves.length === 0) return summary

  let cpLossSum = 0
  for (const m of sideMoves) {
    summary[m.classification] += 1
    cpLossSum += m.cpLoss
  }

  const evaluatedMoves = sideMoves.filter((m) => m.classification !== 'book').length
  const accuracy = computeLichessAccuracy(allMoves, startWinPercent, color)
  const acpl = Math.round(cpLossSum / sideMoves.length)

  summary.accuracy = accuracy
  summary.acpl = acpl
  summary.evaluatedMoves = evaluatedMoves
  summary.phases = {
    opening: computePhaseStats(sideMoves, 'opening'),
    middlegame: computePhaseStats(sideMoves, 'middlegame'),
    endgame: computePhaseStats(sideMoves, 'endgame'),
  }
  summary.overallGrade = gradeFromAccuracy(
    accuracy,
    summary.blunder,
    sideMoves.length,
  )
  summary.ratings = estimateCrossPlatformRatings({
    accuracy,
    acpl,
  })
  summary.estimatedRating = summary.ratings.chesscom

  return summary
}

interface PositionEval {
  cp: number | null
  mate: number | null
  bestMove: string | null
  /** Full PV (top UCI continuation) for concrete tactical commentary */
  pv?: string[]
  /** 2nd best move evaluation (MultiPV 2) to detect genuine "only moves" (Great !) */
  secondCp?: number | null
  secondMate?: number | null
}

const MAX_EVAL_CACHE = 500
const fenEvalCache = new Map<string, PositionEval>()

function normalizeFenKey(fen: string): string {
  return fen.split(' ').slice(0, 4).join(' ')
}

const DEFAULT_START_KEY = normalizeFenKey(DEFAULT_POSITION)
const DEFAULT_START_EVAL: PositionEval = {
  cp: 30,
  mate: null,
  bestMove: 'e2e4',
  pv: ['e2e4', 'e7e5', 'g1f3', 'b8c6'],
  secondCp: 25,
  secondMate: null,
}

function getCachedEval(
  flavor: StockfishFlavor,
  depth: number,
  fen: string,
): PositionEval | undefined {
  const key = normalizeFenKey(fen)
  if (key === DEFAULT_START_KEY) return DEFAULT_START_EVAL
  return fenEvalCache.get(`${flavor}:${depth}:${key}`)
}

function setCachedEval(
  flavor: StockfishFlavor,
  depth: number,
  fen: string,
  value: PositionEval,
): void {
  const key = `${flavor}:${depth}:${normalizeFenKey(fen)}`
  if (fenEvalCache.size >= MAX_EVAL_CACHE) {
    const oldest = fenEvalCache.keys().next().value
    if (oldest !== undefined) fenEvalCache.delete(oldest)
  }
  fenEvalCache.set(key, value)
}

function evaluateSingleFen(
  worker: Worker,
  fen: string,
  depth: number,
  movetimeMs: number,
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
    let hasExactScore = false
    let fallbackCp: number | null = null
    let fallbackMate: number | null = null
    let bestMove: string | null = null
    let pv: string[] = []
    let secondCp: number | null = null
    let secondMate: number | null = null

    const onAbort = () => {
      cleanup()
      worker.postMessage('stop')
      reject(new DOMException('Aborted', 'AbortError'))
    }

    const onMessage = (event: MessageEvent<string>) => {
      const line = typeof event.data === 'string' ? event.data.trim() : ''
      if (!line) return

      if (line.startsWith('info ') && line.includes(' score ')) {
        const isBound =
          line.includes('upperbound') || line.includes('lowerbound')
        const multipvMatch = line.match(/\bmultipv\s+(\d+)/)
        const multipv = multipvMatch ? Number.parseInt(multipvMatch[1], 10) : 1
        const cpMatch = line.match(/\bscore\s+cp\s+(-?\d+)/)
        const mateMatch = line.match(/\bscore\s+mate\s+(-?\d+)/)
        const pvMatch = line.match(/\bpv\s+(.+)$/)

        if (isBound) {
          // Keep as fallback only in case Stockfish never emits an exact score (e.g. forced move)
          if (multipv === 1) {
            if (cpMatch) {
              fallbackCp = Number.parseInt(cpMatch[1], 10) * perspective
              fallbackMate = null
            } else if (mateMatch) {
              fallbackMate = Number.parseInt(mateMatch[1], 10) * perspective
              fallbackCp = null
            }
          }
          return
        }

        if (multipv === 1) {
          hasExactScore = true
          if (cpMatch) {
            cp = Number.parseInt(cpMatch[1], 10) * perspective
            mate = null
          } else if (mateMatch) {
            mate = Number.parseInt(mateMatch[1], 10) * perspective
            cp = null
          }
          if (pvMatch) {
            pv = pvMatch[1].trim().split(/\s+/).slice(0, 6)
            bestMove = pv[0] ?? bestMove
          }
        } else if (multipv === 2) {
          if (cpMatch) {
            secondCp = Number.parseInt(cpMatch[1], 10) * perspective
            secondMate = null
          } else if (mateMatch) {
            secondMate = Number.parseInt(mateMatch[1], 10) * perspective
            secondCp = null
          }
        }
        return
      }

      if (line.startsWith('bestmove ')) {
        const match = line.match(/^bestmove\s+(\S+)/)
        if (match && match[1] !== '(none)') {
          bestMove = match[1]
        }
        const finalCp = hasExactScore ? cp : (fallbackCp ?? cp)
        const finalMate = hasExactScore ? mate : (fallbackMate ?? mate)
        cleanup()
        resolve({
          cp: finalCp,
          mate: finalMate,
          bestMove,
          pv,
          secondCp,
          secondMate,
        })
      }
    }

    const cleanup = () => {
      worker.removeEventListener('message', onMessage)
      signal.removeEventListener('abort', onAbort)
    }

    signal.addEventListener('abort', onAbort)
    worker.addEventListener('message', onMessage)
    worker.postMessage(`position fen ${fen}`)
    worker.postMessage(`go depth ${depth} movetime ${movetimeMs}`)
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
        worker.postMessage('setoption name Hash value 32')
        worker.postMessage('setoption name MultiPV value 2')
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

function waitForMaiaReady(worker: Worker, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) {
      reject(new DOMException('Aborted', 'AbortError'))
      return
    }
    const onAbort = () => {
      cleanup()
      reject(new DOMException('Aborted', 'AbortError'))
    }
    const onMessage = (event: MessageEvent<MaiaWorkerResponse>) => {
      const msg = event.data
      if (msg.type === 'status') {
        if (msg.status === 'ready') {
          cleanup()
          resolve()
        } else if (msg.status === 'idle') {
          cleanup()
          reject(
            new Error(
              'Bạn cần tải model Maia-3 (1 lần duy nhất) trong tab 🧠 Engine trước khi dùng Maia để chấm điểm toàn ván.',
            ),
          )
        } else if (msg.status === 'error') {
          cleanup()
          reject(new Error(msg.error ?? 'Không thể khởi chạy Maia-3.'))
        }
      }
    }
    const cleanup = () => {
      worker.removeEventListener('message', onMessage)
      signal.removeEventListener('abort', onAbort)
    }
    signal.addEventListener('abort', onAbort)
    worker.addEventListener('message', onMessage)
    const req: MaiaWorkerRequest = { type: 'init' }
    worker.postMessage(req)
  })
}

function evaluateWithMaiaWorker(
  worker: Worker,
  id: number,
  fen: string,
  elo: number,
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
    const onMessage = (event: MessageEvent<MaiaWorkerResponse>) => {
      const msg = event.data
      if (msg.type === 'result' && msg.id === id) {
        cleanup()
        const p = Math.max(
          0.01,
          Math.min(0.99, msg.data.whiteWinPercent / 100),
        )
        const approxCp = Math.round(Math.log(p / (1 - p)) / 0.00368208)
        resolve({
          cp: approxCp,
          mate: null,
          bestMove: msg.data.bestMove,
        })
      } else if (msg.type === 'error' && msg.id === id) {
        cleanup()
        reject(new Error(msg.message))
      }
    }
    const cleanup = () => {
      worker.removeEventListener('message', onMessage)
      signal.removeEventListener('abort', onAbort)
    }
    signal.addEventListener('abort', onAbort)
    worker.addEventListener('message', onMessage)
    const req: MaiaWorkerRequest = { type: 'analyze', id, fen, elo }
    worker.postMessage(req)
  })
}

/**
 * Multi-engine Full Game Review:
 * - Stockfish 19 (d12 / d16)
 * - Lichess Cloud (depth 30-60+) + Stockfish 19 (d14) Hybrid
 * - Maia-3 Human (ONNX, 1500 Elo)
 */
export async function runFullGameReview(
  startFen: string,
  moves: ReviewInputMove[],
  options: {
    engineId?: ReviewEngineId
    stockfishFlavor?: StockfishFlavor
    lang?: 'vi' | 'en'
    signal: AbortSignal
    onProgress?: (completed: number, total: number) => void
  },
): Promise<GameReviewResult> {
  const engineId: ReviewEngineId = options.engineId ?? 'stockfish-12'
  const sfFlavor: StockfishFlavor = options.stockfishFlavor ?? 'lite'
  const lang: 'vi' | 'en' = options.lang ?? 'vi'
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
  }> = [
    {
      fen: chess.fen(),
      isCheckmate: chess.isCheckmate(),
      isDraw: chess.isDraw(),
      turn: chess.turn(),
    },
  ]

  const moveMeta: Array<{
    uci: string
    from: Square
    to: Square
    san: string
    color: 'w' | 'b'
    moveNumber: number
    phase: GamePhase
    isSacrifice: boolean
    legalMoveCount: number
    wasInCheckBefore: boolean
    isImmediateRecapture: boolean
    isObviousFreeCapture: boolean
    isPromotion: boolean
    movedPiece: PieceSymbol
  }> = []

  let currentPhase: GamePhase = isStandardStart
    ? 'opening'
    : detectPositionPhase(chess.fen(), startMoveNum, 'opening')

  const phaseRanges: PhaseRanges = {
    openingStartPly: null,
    middlegameStartPly: null,
    endgameStartPly: null,
  }

  let prevCapturedSquare: Square | null = null

  for (let idx = 0; idx < moves.length; idx++) {
    const m = moves[idx]
    const color = chess.turn()
    const moveNumber = startsBlack
      ? startMoveNum + Math.floor((idx + 1) / 2)
      : startMoveNum + Math.floor(idx / 2)

    currentPhase = detectPositionPhase(chess.fen(), moveNumber, currentPhase)
    const plyNum = idx + 1
    if (currentPhase === 'opening' && phaseRanges.openingStartPly === null) {
      phaseRanges.openingStartPly = plyNum
    } else if (
      currentPhase === 'middlegame' &&
      phaseRanges.middlegameStartPly === null
    ) {
      phaseRanges.middlegameStartPly = plyNum
    } else if (
      currentPhase === 'endgame' &&
      phaseRanges.endgameStartPly === null
    ) {
      phaseRanges.endgameStartPly = plyNum
    }

    const wasInCheckBefore = chess.inCheck()
    const legalMoveCount = chess.moves().length
    const isImmediateRecapture =
      prevCapturedSquare !== null && m.to === prevCapturedSquare

    const executed = chess.move({
      from: m.from,
      to: m.to,
      promotion: m.promotion,
    })

    // True material sacrifice via Static Exchange Evaluation (SEE):
    // Mover must actually lose >= 2 points of material on the destination square after optimal recaptures.
    // Also detect obvious free captures (taking a hanging piece with zero risk).
    const pieceVal = MATERIAL_VALUE[executed.piece]
    const exchangeNet = !chess.isCheckmate()
      ? computeExchangeNetForMover(chess.fen(), executed.to, executed.captured)
      : 0
    const isSacrifice =
      executed.piece !== 'k' && pieceVal >= 3 && exchangeNet <= -2
    const isObviousFreeCapture = Boolean(
      executed.captured &&
        exchangeNet >= MATERIAL_VALUE[executed.captured] &&
        MATERIAL_VALUE[executed.captured] >= 1,
    )

    prevCapturedSquare = executed.captured ? executed.to : null

    moveMeta.push({
      uci: `${m.from}${m.to}${m.promotion ?? ''}`,
      from: m.from,
      to: m.to,
      san: m.san,
      color,
      moveNumber,
      phase: currentPhase,
      isSacrifice,
      legalMoveCount,
      wasInCheckBefore,
      isImmediateRecapture,
      isObviousFreeCapture,
      isPromotion: Boolean(executed.promotion),
      movedPiece: executed.piece,
    })

    snapshots.push({
      fen: chess.fen(),
      isCheckmate: chess.isCheckmate(),
      isDraw: chess.isDraw(),
      turn: chess.turn(),
    })
  }

  const isMaia = engineId === 'maia-1500'
  const useCloudHybrid = engineId === 'stockfish-cloud'
  const sfDepth =
    engineId === 'stockfish-16' ? 16 : useCloudHybrid ? 14 : 12
  const sfMovetimeMs =
    engineId === 'stockfish-16' ? 1100 : useCloudHybrid ? 700 : 450

  const total = snapshots.length
  const evals: Array<PositionEval | null> = new Array(total).fill(null)
  let completedCount = 0
  const workers: Worker[] = []

  const reportProgress = () => {
    completedCount += 1
    onProgress?.(completedCount, total)
  }

  try {
    if (isMaia) {
      const maiaWorker = new Worker(
        new URL('./maiaWorker.ts', import.meta.url),
        { type: 'module' },
      )
      workers.push(maiaWorker)
      await waitForMaiaReady(maiaWorker, signal)

      for (let i = 0; i < total; i++) {
        if (signal.aborted) throw new DOMException('Aborted', 'AbortError')
        const snap = snapshots[i]
        if (snap.isCheckmate) {
          evals[i] = { cp: null, mate: snap.turn === 'w' ? -1 : 1, bestMove: null }
        } else if (snap.isDraw) {
          evals[i] = { cp: 0, mate: null, bestMove: null }
        } else {
          evals[i] = await evaluateWithMaiaWorker(
            maiaWorker,
            i + 1,
            snap.fen,
            1500,
            signal,
          )
        }
        reportProgress()
      }
    } else {
      // Pass 1: Instant resolution for checkmates, draws, start position & cached FENs
      const pendingIndices: number[] = []
      for (let i = 0; i < total; i++) {
        const snap = snapshots[i]
        if (snap.isCheckmate) {
          evals[i] = { cp: null, mate: snap.turn === 'w' ? -1 : 1, bestMove: null }
          reportProgress()
        } else if (snap.isDraw) {
          evals[i] = { cp: 0, mate: null, bestMove: null }
          reportProgress()
        } else {
          const cached = getCachedEval(sfFlavor, sfDepth, snap.fen)
          if (cached) {
            evals[i] = cached
            reportProgress()
          } else {
            pendingIndices.push(i)
          }
        }
      }

      // Pass 2: In Hybrid mode, query Lichess Cloud Eval for opening theory first
      const sfQueue: number[] = []
      if (useCloudHybrid && pendingIndices.length > 0) {
        let cloudMissStreak = 0
        for (const idx of pendingIndices) {
          if (signal.aborted) throw new DOMException('Aborted', 'AbortError')
          if (cloudMissStreak < 2) {
            try {
              const cloud = await fetchLichessCloudEval(
                snapshots[idx].fen,
                2,
                signal,
              )
              if (cloud && cloud.lines[0]) {
                cloudMissStreak = 0
                const res: PositionEval = {
                  cp: cloud.lines[0].cp,
                  mate: cloud.lines[0].mate,
                  bestMove: cloud.lines[0].moves[0] ?? null,
                  pv: cloud.lines[0].moves.slice(0, 6),
                  secondCp: cloud.lines[1]?.cp ?? null,
                  secondMate: cloud.lines[1]?.mate ?? null,
                }
                evals[idx] = res
                setCachedEval(sfFlavor, sfDepth, snapshots[idx].fen, res)
                reportProgress()
                continue
              }
              cloudMissStreak += 1
            } catch {
              cloudMissStreak += 1
            }
          }
          sfQueue.push(idx)
        }
      } else {
        sfQueue.push(...pendingIndices)
      }

      // Pass 3: Parallel Stockfish 19 WASM Worker Pool
      // Cap Full NNUE (94.5MB/worker) at 2 workers to keep RAM safe; Lite NNUE uses up to 4 workers!
      if (sfQueue.length > 0) {
        const hwCores =
          typeof navigator !== 'undefined' && navigator.hardwareConcurrency
            ? navigator.hardwareConcurrency
            : 4
        const maxPool = sfFlavor === 'full' ? 2 : 4
        const poolSize = Math.min(maxPool, Math.max(1, hwCores - 1), sfQueue.length)
        const sfUrl = getStockfishWorkerUrl(sfFlavor)

        for (let w = 0; w < poolSize; w++) {
          workers.push(new Worker(sfUrl))
        }
        await Promise.all(workers.map((w) => waitForReady(w, signal)))

        const chunkSize = Math.ceil(sfQueue.length / poolSize)
        await Promise.all(
          workers.map(async (w, workerIdx) => {
            const chunk = sfQueue.slice(
              workerIdx * chunkSize,
              (workerIdx + 1) * chunkSize,
            )
            for (const idx of chunk) {
              if (signal.aborted) {
                throw new DOMException('Aborted', 'AbortError')
              }
              const snap = snapshots[idx]
              const cached = getCachedEval(sfFlavor, sfDepth, snap.fen)
              if (cached) {
                evals[idx] = cached
                reportProgress()
                continue
              }
              const res = await evaluateSingleFen(
                w,
                snap.fen,
                sfDepth,
                sfMovetimeMs,
                signal,
              )
              evals[idx] = res
              setCachedEval(sfFlavor, sfDepth, snap.fen, res)
              reportProgress()
            }
          }),
        )
      }
    }

    const resolvedEvals: PositionEval[] = evals.map(
      (e) => e ?? { cp: 0, mate: null, bestMove: null },
    )
    const startWinPercent = evalToWhiteWinPercent(
      resolvedEvals[0].cp,
      resolvedEvals[0].mate,
    )
    const reviewedMoves: ReviewMoveInfo[] = []

    for (let i = 0; i < moveMeta.length; i++) {
      const before = resolvedEvals[i]
      const after = resolvedEvals[i + 1]
      const meta = moveMeta[i]
      const snapAfter = snapshots[i + 1]

      const whiteWinBefore = evalToWhiteWinPercent(before.cp, before.mate)
      const whiteWinAfter = evalToWhiteWinPercent(after.cp, after.mate)

      const moverWinBefore =
        meta.color === 'w' ? whiteWinBefore : 100 - whiteWinBefore
      const moverWinAfter =
        meta.color === 'w' ? whiteWinAfter : 100 - whiteWinAfter
      const winLoss = Math.max(0, moverWinBefore - moverWinAfter)

      // Compute capped Centipawn Loss (ACPL) from mover's perspective
      const cpBeforeWhite = evalToCappedCp(before.cp, before.mate)
      const cpAfterWhite = evalToCappedCp(after.cp, after.mate)
      const moverCpBefore = meta.color === 'w' ? cpBeforeWhite : -cpBeforeWhite
      const moverCpAfter = meta.color === 'w' ? cpAfterWhite : -cpAfterWhite
      const cpLoss = Math.max(0, Math.min(1000, moverCpBefore - moverCpAfter))

      // Compute MultiPV 1 vs MultiPV 2 gap to accurately identify "only moves" (Great !)
      let onlyMoveGap = 0
      if (before.secondCp !== undefined || before.secondMate !== undefined) {
        if (before.secondCp !== null || before.secondMate !== null) {
          const secondWhiteWin = evalToWhiteWinPercent(
            before.secondCp ?? null,
            before.secondMate ?? null,
          )
          const secondMoverWin =
            meta.color === 'w' ? secondWhiteWin : 100 - secondWhiteWin
          onlyMoveGap = Math.max(0, moverWinBefore - secondMoverWin)
        }
      }

      const mateBeforeForMover =
        before.mate === null
          ? null
          : meta.color === 'w'
            ? before.mate
            : -before.mate
      const mateAfterForMover =
        after.mate === null
          ? null
          : meta.color === 'w'
            ? after.mate
            : -after.mate

      const classification = classifyMove({
        ply: i + 1,
        isStandardStart,
        uci: meta.uci,
        san: meta.san,
        bestMoveBefore: before.bestMove,
        winLoss,
        cpLoss,
        moverWinBefore,
        moverWinAfter,
        onlyMoveGap,
        mateBeforeForMover,
        mateAfterForMover,
        isSacrifice: meta.isSacrifice,
        isCheckmate: snapAfter.isCheckmate,
        legalMoveCount: meta.legalMoveCount,
        wasInCheckBefore: meta.wasInCheckBefore,
        isImmediateRecapture: meta.isImmediateRecapture,
        isObviousFreeCapture: meta.isObviousFreeCapture,
        isPromotion: meta.isPromotion,
        movedPiece: meta.movedPiece,
      })

      const bestMoveBeforeSan = uciToSanSafe(
        snapshots[i].fen,
        before.bestMove,
      )

      const refutationLine = pvToSanLine(snapAfter.fen, after.pv, 4)
      const recommendedLine = pvToSanLine(snapshots[i].fen, before.pv, 4)

      const commentary = buildCoachCommentary({
        san: meta.san,
        uci: meta.uci,
        color: meta.color,
        fenBefore: snapshots[i].fen,
        fenAfter: snapAfter.fen,
        classification,
        bestMoveBefore: before.bestMove,
        bestMoveBeforeSan,
        pvAfter: after.pv,
        winLoss,
        onlyMoveGap,
        cpBefore: before.cp,
        mateBefore: before.mate,
        cpAfter: after.cp,
        mateAfter: after.mate,
        isCheckmate: snapAfter.isCheckmate,
        lang,
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
        cpLoss,
        whiteWinPercent: whiteWinAfter,
        bestMoveBefore: before.bestMove,
        bestMoveBeforeSan,
        refutationLine: refutationLine || undefined,
        recommendedLine: recommendedLine || undefined,
        winLoss,
        phase: meta.phase,
        classification,
        commentary,
      })
    }

    const whiteSummary = computeSideSummary(reviewedMoves, startWinPercent, 'w')
    const blackSummary = computeSideSummary(reviewedMoves, startWinPercent, 'b')

    return {
      engineId,
      engineLabel: engineMeta.label,
      startWinPercent,
      moves: reviewedMoves,
      phaseRanges,
      overallSummary: buildOverallSummary(whiteSummary, blackSummary, lang),
      white: whiteSummary,
      black: blackSummary,
    }
  } finally {
    for (const w of workers) {
      if (!isMaia) {
        try {
          w.postMessage('quit')
        } catch {
          // Ignore postMessage errors during teardown
        }
      }
      w.terminate()
    }
  }
}
