import { Chess, DEFAULT_POSITION, type PieceSymbol, type Square } from 'chess.js'
import { fetchLichessCloudEval } from './lichessCloudEval'
import type { MaiaWorkerRequest, MaiaWorkerResponse } from './maiaWorker'

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
  classification: MoveClassification
  commentary: string
}

export interface SideReviewSummary {
  accuracy: number
  /** Average Centipawn Loss (Lichess standard metric, lower = stronger) */
  acpl: number
  /** Number of non-book moves used for rating confidence */
  evaluatedMoves: number
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
    isSacrifice: false,
    isCheckmate: params.isCheckmate,
    wasBlunderBefore: false,
  })

  const bestMoveBeforeSan = uciToSanSafe(
    params.fenBefore,
    params.before.bestMove,
  )
  let fenAfter = params.fenBefore
  try {
    const temp = new Chess()
    temp.load(params.fenBefore)
    temp.move({
      from: params.uci.slice(0, 2) as Square,
      to: params.uci.slice(2, 4) as Square,
      promotion: (params.uci[4] as PieceSymbol | undefined) ?? undefined,
    })
    fenAfter = temp.fen()
  } catch {
    // Fallback to fenBefore
  }

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
  moverWinBefore: number
  moverWinAfter: number
  /** Win% gap between best move (MultiPV 1) and 2nd best move (MultiPV 2) */
  onlyMoveGap: number
  mateBeforeForMover: number | null
  mateAfterForMover: number | null
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
    onlyMoveGap,
    mateBeforeForMover,
    mateAfterForMover,
    isSacrifice,
    isCheckmate,
    wasBlunderBefore,
  } = params

  const isTopChoice = Boolean(bestMoveBefore && uci === bestMoveBefore)

  if (isCheckmate) return 'best'

  // Walking directly into a forced checkmate when position was not already mated
  if (
    mateAfterForMover !== null &&
    mateAfterForMover < 0 &&
    (mateBeforeForMover === null || mateBeforeForMover >= 0)
  ) {
    return 'blunder'
  }

  // Throwing away a forced mate into a non-winning position
  if (
    mateBeforeForMover !== null &&
    mateBeforeForMover > 0 &&
    mateAfterForMover === null &&
    moverWinAfter < 75
  ) {
    return 'blunder'
  }

  // Opening book heuristic: standard opening plies with balanced eval and low loss
  if (
    isStandardStart &&
    ply <= 10 &&
    winLoss <= 1.8 &&
    moverWinAfter >= 44 &&
    moverWinAfter <= 57
  ) {
    return 'book'
  }

  // Brilliant (!!): strict Chess.com criteria:
  // 1. True material sacrifice (SEE <= -2, NOT an equal trade)
  // 2. Top / near-top move (winLoss <= 1.2%)
  // 3. Not already trivially crushing (< 88%), unless it unlocks a new forced mate
  // 4. Keeps at least equal/winning position (>= 48%)
  // 5. Meaningful tactical difficulty (onlyMoveGap >= 4% or forces mate)
  const unlocksNewMate =
    mateAfterForMover !== null &&
    mateAfterForMover > 0 &&
    (mateBeforeForMover === null || mateBeforeForMover <= 0)

  if (
    isSacrifice &&
    (isTopChoice || winLoss <= 1.2) &&
    ply >= 6 &&
    moverWinAfter >= 48 &&
    (moverWinBefore < 88 || unlocksNewMate) &&
    (onlyMoveGap >= 4 || unlocksNewMate)
  ) {
    return 'brilliant'
  }

  // Great (!): genuine "only move" (large MultiPV1 vs MultiPV2 gap >= 14% win chance)
  // OR cleanly punishing an opponent's blunder with the exact top move
  if (
    isTopChoice &&
    winLoss <= 1.0 &&
    ply >= 6 &&
    moverWinBefore < 92 &&
    (onlyMoveGap >= 14 || (wasBlunderBefore && onlyMoveGap >= 9))
  ) {
    return 'great'
  }

  if (isTopChoice || winLoss <= 1.2) return 'best'
  if (winLoss <= 3.5) return 'excellent'
  if (winLoss <= 6.5) return 'good'
  if (winLoss <= 12.0) return 'inaccuracy'
  if (winLoss <= 22.0) return 'mistake'
  return 'blunder'
}

const PIECE_NAME_VI: Record<PieceSymbol, string> = {
  p: 'Tốt',
  n: 'Mã',
  b: 'Tượng',
  r: 'Xe',
  q: 'Hậu',
  k: 'Vua',
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
): string {
  if (!bestMoveSan) return ''
  const info = inspectSingleUciMove(fenBefore, bestMoveUci)
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
  } = params

  if (isCheckmate) {
    return `${san} chiếu hết hoàn hảo, kết thúc ván đấu ngay lập tức!`
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
    const pieceLabel = played ? PIECE_NAME_VI[played.piece] : 'quân'
    const targetSq = played ? played.to : ''
    const followTxt = reply
      ? `Ngay cả khi đối thủ đáp trả mạnh nhất bằng ${reply.san}, bạn vẫn duy trì ưu thế áp đảo (${evalAfterTxt}).`
      : `Nước thí này mở ra đòn chiến thuật không thể chống đỡ (${evalAfterTxt}).`
    return `${san}!! Nước đi thiên tài — táo bạo thí ${pieceLabel} tại ${targetSq} để phá vỡ phòng tuyến đối phương. ${followTxt}`
  }

  // 2. Great (!)
  if (classification === 'great') {
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

  // 3. Blunder / Mistake / Inaccuracy — concrete refutation analysis!
  if (
    classification === 'blunder' ||
    classification === 'mistake' ||
    classification === 'inaccuracy'
  ) {
    const recTxt = describeRecommendedReason(
      fenBefore,
      bestMoveBefore,
      bestMoveBeforeSan,
    )

    // Case A: Walked into forced checkmate
    if (mateAfterForMover !== null && mateAfterForMover < 0) {
      const mIn = Math.abs(mateAfterForMover)
      const replyHint = reply ? ` bắt đầu bằng ${reply.san}` : ''
      return `${san} tự mở đường cho đối thủ chiếu hết cưỡng bức trong ${mIn} nước${replyHint}! ${recTxt}`
    }

    // Case B: Missed forced checkmate
    if (
      mateBeforeForMover !== null &&
      mateBeforeForMover > 0 &&
      mateAfterForMover === null
    ) {
      return `${san} bỏ lỡ đòn chiếu hết cưỡng bức trong ${mateBeforeForMover} nước (từ ${evalBeforeTxt} tụt về ${evalAfterTxt}). ${recTxt}`
    }

    // Case C: Hung the piece we just moved
    if (played && reply?.captured && reply.to === played.to) {
      return `${san} đưa ${PIECE_NAME_VI[played.piece]} vào ô ${played.to} không đủ bảo vệ — đối thủ ăn ngay bằng ${reply.san} (${evalBeforeTxt} → ${evalAfterTxt}). ${recTxt}`
    }

    // Case D: Left another piece hanging to opponent's reply
    if (reply?.captured) {
      return `${san} bỏ quên ${PIECE_NAME_VI[reply.captured]} tại ${reply.to}, cho phép đối thủ khai thác ngay bằng ${reply.san} (${evalBeforeTxt} → ${evalAfterTxt}). ${recTxt}`
    }

    // Case E: Allowed a strong counter-check
    if (reply?.isCheck) {
      return `${san} làm hở Vua, để đối thủ tung đòn chiếu phản công ${reply.san} (${evalBeforeTxt} → ${evalAfterTxt}). ${recTxt}`
    }

    // Case F: General positional/tactical drop with concrete refutation move
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
    if (played?.isCastle) {
      return `${san} — nhập thành chuẩn khai cuộc, bảo vệ Vua và kích hoạt Xe.`
    }
    if (played && CENTER_SQUARES.has(played.to)) {
      return `${san} — nước khai cuộc chuẩn lý thuyết, tranh chấp trực tiếp khu trung tâm.`
    }
    return `${san} — nước phát triển chuẩn sách khai cuộc, giữ thế trận cân bằng (${evalAfterTxt}).`
  }

  // 5. Best / Excellent / Good — explain what the move accomplished
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

/**
 * Converts a known rating from Lichess or Chess.com into the internal Chess.com baseline scale.
 */
function normalizeKnownEloToChessCom(
  elo: number,
  sourcePlatform: 'chesscom' | 'lichess' | 'unknown',
): number {
  if (sourcePlatform === 'lichess') {
    const offset =
      elo < 2450
        ? 260 - ((Math.max(900, elo) - 900) / 1550) * 90
        : Math.max(40, 170 - ((elo - 2450) / 500) * 130)
    return Math.max(400, elo - offset)
  }
  return elo
}

/**
 * Estimates single-game performance Elo across Chess.com, Lichess, and FIDE scales.
 * Combines:
 * 1. Lichess Volatility-Weighted Accuracy (60%) + Capped ACPL (40%)
 * 2. Game-length confidence shrinkage
 * 3. Time-control calibration (Bullet / Blitz / Rapid / Classical)
 * 4. Chess.com-style Bayesian anchoring to actual player & opponent Elo (when available)
 */
export function estimateCrossPlatformRatings(params: {
  accuracy: number
  acpl?: number
  evaluatedMoves?: number
  blunder: number
  mistake: number
  brilliant: number
  great: number
  timeControl?: TimeControlCategory
  playerRating?: number
  opponentRating?: number
  sourcePlatform?: 'chesscom' | 'lichess' | 'unknown'
}): EstimatedRatings {
  const {
    accuracy,
    acpl = Math.max(8, Math.round((100 - accuracy) * 2.4)),
    evaluatedMoves = 25,
    brilliant,
    great,
    timeControl = 'rapid',
    playerRating,
    opponentRating,
    sourcePlatform = 'unknown',
  } = params

  // 1. Accuracy-based Chess.com Rapid baseline
  const accClamped = Math.max(20, Math.min(99.5, accuracy))
  const eloFromAcc = 350 + Math.pow((accClamped - 20) / 80, 1.55) * 2350

  // 2. ACPL-based Chess.com Rapid baseline
  const acplClamped = Math.max(5, Math.min(250, acpl))
  const eloFromAcpl = 2780 * Math.exp(-0.0098 * acplClamped) + 220

  // 3. Blend Accuracy (60%) + ACPL (40%) + subtle bonus for genuine tactical gems
  const blendedBase =
    0.6 * eloFromAcc +
    0.4 * eloFromAcpl +
    Math.min(90, brilliant * 45 + great * 20)

  // 4. Time-control specific shifts
  const tcConfig: Record<
    TimeControlCategory,
    { tcShift: number; lichessExtra: number; fideShift: number }
  > = {
    bullet: { tcShift: 175, lichessExtra: 35, fideShift: -40 },
    blitz: { tcShift: 85, lichessExtra: 15, fideShift: 0 },
    rapid: { tcShift: 0, lichessExtra: 0, fideShift: 0 },
    classical: { tcShift: -95, lichessExtra: -20, fideShift: 35 },
  }

  const cfg = tcConfig[timeControl]
  const purePerfChessCom = Math.max(
    400,
    Math.min(2850, blendedBase + cfg.tcShift),
  )

  // 5. Anchor to known player & opponent Elo (Chess.com Game Rating style)
  //    If known: blend 52% match-anchored expectation + 48% pure accuracy/ACPL performance.
  //    If unknown: shrink extreme short-game estimates toward 1400 prior.
  let rawChessCom: number
  if (playerRating || opponentRating) {
    const normSelf = playerRating
      ? normalizeKnownEloToChessCom(playerRating, sourcePlatform)
      : undefined
    const normOpp = opponentRating
      ? normalizeKnownEloToChessCom(opponentRating, sourcePlatform)
      : undefined
    const matchAnchor =
      normSelf && normOpp
        ? 0.55 * normSelf + 0.45 * normOpp
        : (normSelf ?? normOpp ?? 1400)

    // Longer games give higher weight to pure accuracy performance; short games stay closer to anchor
    const perfWeight = Math.min(0.55, Math.max(0.28, (evaluatedMoves / 24) * 0.55))
    const anchored =
      matchAnchor * (1 - perfWeight) + purePerfChessCom * perfWeight
    // Cap unrealistic swing to ±450 from match anchor
    rawChessCom = Math.max(
      400,
      Math.min(2900, Math.max(matchAnchor - 450, Math.min(matchAnchor + 450, anchored))),
    )
  } else {
    const confidence = Math.min(1, Math.max(0.35, evaluatedMoves / 14))
    const stabilizedRapid = 1400 + (blendedBase - 1400) * confidence
    rawChessCom = Math.max(400, Math.min(2800, stabilizedRapid + cfg.tcShift))
  }

  // Lichess Glicko-2 offset (+270 around 1000–1600, narrowing smoothly to ~+50 above 2500)
  const lichessOffset =
    (rawChessCom < 2200
      ? 275 - ((rawChessCom - 800) / 1400) * 95
      : Math.max(40, 180 - ((rawChessCom - 2200) / 600) * 140)) +
    cfg.lichessExtra
  const rawLichess = rawChessCom + lichessOffset

  // FIDE scaling (floor ~1000–1400, stricter above 1800)
  const rawFide =
    (rawChessCom < 1400
      ? 950 + ((rawChessCom - 400) / 1000) * 500
      : 1450 + (rawChessCom - 1400) * 0.91) + cfg.fideShift

  return {
    fide: roundTo50(rawFide, 1000, 2850),
    chesscom: roundTo50(rawChessCom, 400, 2900),
    lichess: roundTo50(rawLichess, 800, 2950),
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

    const acc = Math.max(
      0,
      Math.min(
        100,
        103.1668 * Math.exp(-0.04354 * Math.max(0, m.winLoss)) - 3.1669,
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

function computeSideSummary(
  allMoves: ReviewMoveInfo[],
  startWinPercent: number,
  color: 'w' | 'b',
): SideReviewSummary {
  const sideMoves = allMoves.filter((m) => m.color === color)
  const summary: SideReviewSummary = {
    accuracy: 100,
    acpl: 0,
    evaluatedMoves: 0,
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
  summary.ratings = estimateCrossPlatformRatings({
    accuracy,
    acpl,
    evaluatedMoves,
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
  /** Full PV (top UCI continuation) for concrete tactical commentary */
  pv?: string[]
  /** 2nd best move evaluation (MultiPV 2) to detect genuine "only moves" (Great !) */
  secondCp?: number | null
  secondMate?: number | null
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

      // Ignore aspiration bound lines (upperbound / lowerbound) to avoid noisy eval spikes
      if (
        line.startsWith('info ') &&
        line.includes(' score ') &&
        !line.includes('upperbound') &&
        !line.includes('lowerbound')
      ) {
        const multipvMatch = line.match(/\bmultipv\s+(\d+)/)
        const multipv = multipvMatch ? Number.parseInt(multipvMatch[1], 10) : 1
        const cpMatch = line.match(/\bscore\s+cp\s+(-?\d+)/)
        const mateMatch = line.match(/\bscore\s+mate\s+(-?\d+)/)
        const pvMatch = line.match(/\bpv\s+(.+)$/)

        if (multipv === 1) {
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
        cleanup()
        resolve({ cp, mate, bestMove, pv, secondCp, secondMate })
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
    isSacrifice: boolean
  }> = []

  for (let idx = 0; idx < moves.length; idx++) {
    const m = moves[idx]
    const color = chess.turn()

    const executed = chess.move({
      from: m.from,
      to: m.to,
      promotion: m.promotion,
    })

    // True material sacrifice via Static Exchange Evaluation (SEE):
    // Mover must actually lose >= 2 points of material on the destination square after optimal recaptures.
    // Eliminates false positives on normal developing moves and equal trades.
    const pieceVal = MATERIAL_VALUE[executed.piece]
    const exchangeNet =
      pieceVal >= 3 && !chess.isCheckmate()
        ? computeExchangeNetForMover(chess.fen(), executed.to, executed.captured)
        : 0
    const isSacrifice = exchangeNet <= -2

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
    })
  }

  const isMaia = engineId === 'maia-1500'
  const useCloudHybrid = engineId === 'stockfish-cloud'
  const sfDepth =
    engineId === 'stockfish-16' ? 16 : useCloudHybrid ? 14 : 12

  const worker = isMaia
    ? new Worker(new URL('./maiaWorker.ts', import.meta.url), {
        type: 'module',
      })
    : new Worker(
        `${import.meta.env.BASE_URL}stockfish/stockfish-19-lite-single.js`,
      )

  try {
    if (isMaia) {
      await waitForMaiaReady(worker, signal)
    } else {
      await waitForReady(worker, signal)
    }

    const evals: PositionEval[] = []
    const total = snapshots.length
    let cloudMissStreak = 0

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
      } else if (isMaia) {
        const res = await evaluateWithMaiaWorker(
          worker,
          i + 1,
          snap.fen,
          1500,
          signal,
        )
        evals.push(res)
      } else {
        let resolved: PositionEval | null = null
        // For Hybrid mode, query Lichess Cloud Eval (depth 30-60+, MultiPV 2) while still in theory
        if (useCloudHybrid && cloudMissStreak < 2) {
          try {
            const cloud = await fetchLichessCloudEval(snap.fen, 2, signal)
            if (cloud && cloud.lines[0]) {
              cloudMissStreak = 0
              resolved = {
                cp: cloud.lines[0].cp,
                mate: cloud.lines[0].mate,
                bestMove: cloud.lines[0].moves[0] ?? null,
                pv: cloud.lines[0].moves.slice(0, 6),
                secondCp: cloud.lines[1]?.cp ?? null,
                secondMate: cloud.lines[1]?.mate ?? null,
              }
            } else {
              cloudMissStreak += 1
            }
          } catch {
            cloudMissStreak += 1
          }
        }

        if (!resolved) {
          resolved = await evaluateSingleFen(worker, snap.fen, sfDepth, signal)
        }
        evals.push(resolved)
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
        onlyMoveGap,
        mateBeforeForMover,
        mateAfterForMover,
        isSacrifice: meta.isSacrifice,
        isCheckmate: snapAfter.isCheckmate,
        wasBlunderBefore,
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
        classification,
        commentary,
      })
    }

    return {
      engineId,
      engineLabel: engineMeta.label,
      startWinPercent,
      moves: reviewedMoves,
      white: computeSideSummary(reviewedMoves, startWinPercent, 'w'),
      black: computeSideSummary(reviewedMoves, startWinPercent, 'b'),
    }
  } finally {
    if (!isMaia) {
      worker.postMessage('quit')
    }
    worker.terminate()
  }
}
