import { Chess, type Move, type PieceSymbol } from 'chess.js'

export type LocalEngineStyle = 'classical' | 'aggressive'

export interface LocalEngineResult {
  cp: number | null
  mate: number | null
  depth: number
  bestMove: string | null
  bestMoveSan: string | null
  pv: string[]
  insights: string[]
}

const PIECE_VALUE: Record<PieceSymbol, number> = {
  p: 100,
  n: 320,
  b: 330,
  r: 500,
  q: 900,
  k: 20000,
}

// PeSTO-inspired Middlegame Piece-Square Tables (from White's perspective, rank 8 -> rank 1)
const PST_MG: Record<PieceSymbol, number[]> = {
  p: [
    0, 0, 0, 0, 0, 0, 0, 0,
    50, 50, 50, 50, 50, 50, 50, 50,
    10, 10, 20, 30, 30, 20, 10, 10,
    5, 5, 10, 27, 27, 10, 5, 5,
    0, 0, 0, 24, 24, 0, 0, 0,
    5, -5, -10, 0, 0, -10, -5, 5,
    5, 10, 10, -22, -22, 10, 10, 5,
    0, 0, 0, 0, 0, 0, 0, 0,
  ],
  n: [
    -50, -40, -30, -30, -30, -30, -40, -50,
    -40, -20, 0, 5, 5, 0, -20, -40,
    -30, 5, 15, 20, 20, 15, 5, -30,
    -30, 5, 20, 25, 25, 20, 5, -30,
    -30, 0, 15, 22, 22, 15, 0, -30,
    -30, 5, 10, 15, 15, 10, 5, -30,
    -40, -20, 0, 5, 5, 0, -20, -40,
    -50, -40, -30, -30, -30, -30, -40, -50,
  ],
  b: [
    -20, -10, -10, -10, -10, -10, -10, -20,
    -10, 0, 0, 0, 0, 0, 0, -10,
    -10, 0, 8, 12, 12, 8, 0, -10,
    -10, 6, 8, 14, 14, 8, 6, -10,
    -10, 0, 12, 14, 14, 12, 0, -10,
    -10, 10, 10, 10, 10, 10, 10, -10,
    -10, 6, 0, 0, 0, 0, 6, -10,
    -20, -10, -10, -10, -10, -10, -10, -20,
  ],
  r: [
    0, 0, 0, 0, 0, 0, 0, 0,
    6, 12, 12, 12, 12, 12, 12, 6,
    -5, 0, 0, 0, 0, 0, 0, -5,
    -5, 0, 0, 0, 0, 0, 0, -5,
    -5, 0, 0, 0, 0, 0, 0, -5,
    -5, 0, 0, 0, 0, 0, 0, -5,
    -5, 0, 0, 0, 0, 0, 0, -5,
    0, 0, 4, 10, 10, 4, 0, 0,
  ],
  q: [
    -20, -10, -10, -5, -5, -10, -10, -20,
    -10, 0, 0, 0, 0, 0, 0, -10,
    -10, 0, 5, 5, 5, 5, 0, -10,
    -5, 0, 5, 5, 5, 5, 0, -5,
    0, 0, 5, 5, 5, 5, 0, -5,
    -10, 5, 5, 5, 5, 5, 0, -10,
    -10, 0, 5, 0, 0, 0, 0, -10,
    -20, -10, -10, -5, -5, -10, -10, -20,
  ],
  k: [
    -30, -40, -40, -50, -50, -40, -40, -30,
    -30, -40, -40, -50, -50, -40, -40, -30,
    -30, -40, -40, -50, -50, -40, -40, -30,
    -30, -40, -40, -50, -50, -40, -40, -30,
    -20, -30, -30, -40, -40, -30, -30, -20,
    -10, -20, -20, -20, -20, -20, -20, -10,
    20, 20, 0, 0, 0, 0, 20, 20,
    20, 32, 10, 0, 0, 10, 32, 20,
  ],
}

const KING_ENDGAME_PST = [
  -50, -30, -20, -20, -20, -20, -30, -50,
  -30, -10, 0, 5, 5, 0, -10, -30,
  -20, 0, 15, 22, 22, 15, 0, -20,
  -20, 5, 22, 30, 30, 22, 5, -20,
  -20, 5, 22, 30, 30, 22, 5, -20,
  -20, 0, 15, 22, 22, 15, 0, -20,
  -30, -10, 0, 5, 5, 0, -10, -30,
  -50, -30, -20, -20, -20, -20, -30, -50,
]

function evaluatePosition(game: Chess, style: LocalEngineStyle): number {
  const board = game.board()
  let score = 0
  let whiteBishops = 0
  let blackBishops = 0
  let nonPawnMaterial = 0

  for (let r = 0; r < 8; r++) {
    for (let c = 0; c < 8; c++) {
      const cell = board[r][c]
      if (!cell || cell.type === 'k' || cell.type === 'p') continue
      nonPawnMaterial += PIECE_VALUE[cell.type]
    }
  }

  const isEndgame = nonPawnMaterial <= 2600

  for (let r = 0; r < 8; r++) {
    for (let c = 0; c < 8; c++) {
      const cell = board[r][c]
      if (!cell) continue

      const idx = cell.color === 'w' ? r * 8 + c : (7 - r) * 8 + c
      const base = PIECE_VALUE[cell.type]
      let positional =
        cell.type === 'k' && isEndgame
          ? KING_ENDGAME_PST[idx]
          : PST_MG[cell.type][idx]

      if (style === 'aggressive') {
        // Reward forward piece advancement & central pressure
        const rankAdvance = cell.color === 'w' ? 7 - r : r
        if (cell.type !== 'k' && cell.type !== 'p') {
          positional += rankAdvance * 5
        }
        if (cell.type === 'p' && rankAdvance >= 4) {
          positional += (rankAdvance - 3) * 8
        }
      }

      if (cell.type === 'b') {
        if (cell.color === 'w') whiteBishops += 1
        else blackBishops += 1
      }

      const total = base + positional
      score += cell.color === 'w' ? total : -total
    }
  }

  // Bishop pair bonus
  const bishopBonus = style === 'classical' ? 35 : 25
  if (whiteBishops >= 2) score += bishopBonus
  if (blackBishops >= 2) score -= bishopBonus

  // Slight tempo / check pressure bonus for aggressive style
  if (style === 'aggressive' && game.inCheck()) {
    score += game.turn() === 'w' ? -28 : 28
  }

  return score
}

function orderMoves(moves: Move[], style: LocalEngineStyle): Move[] {
  return [...moves].sort((a, b) => {
    const scoreMove = (m: Move): number => {
      let s = 0
      if (m.captured) {
        s += 10 * PIECE_VALUE[m.captured] - PIECE_VALUE[m.piece]
      }
      if (m.promotion) s += 800
      if (m.san.includes('+')) s += style === 'aggressive' ? 120 : 40
      if (m.san === 'O-O' || m.san === 'O-O-O') s += 45
      return s
    }
    return scoreMove(b) - scoreMove(a)
  })
}

function alphaBeta(
  game: Chess,
  depth: number,
  alpha: number,
  beta: number,
  maximizingWhite: boolean,
  style: LocalEngineStyle,
): number {
  if (game.isCheckmate()) {
    // Prefer faster mates
    return maximizingWhite ? -100000 - depth * 100 : 100000 + depth * 100
  }
  if (game.isDraw()) {
    return 0
  }
  if (depth === 0) {
    return evaluatePosition(game, style)
  }

  const moves = orderMoves(game.moves({ verbose: true }), style)

  if (maximizingWhite) {
    let best = -Infinity
    for (const move of moves) {
      game.move(move)
      const val = alphaBeta(game, depth - 1, alpha, beta, false, style)
      game.undo()
      if (val > best) best = val
      if (best > alpha) alpha = best
      if (beta <= alpha) break
    }
    return best
  } else {
    let best = Infinity
    for (const move of moves) {
      game.move(move)
      const val = alphaBeta(game, depth - 1, alpha, beta, true, style)
      game.undo()
      if (val < best) best = val
      if (best < beta) beta = best
      if (beta <= alpha) break
    }
    return best
  }
}

function extractPositionalInsights(
  game: Chess,
  style: LocalEngineStyle,
): string[] {
  const board = game.board()
  let whiteBishops = 0
  let blackBishops = 0
  let whiteCenter = 0
  let blackCenter = 0

  for (let r = 0; r < 8; r++) {
    for (let c = 0; c < 8; c++) {
      const cell = board[r][c]
      if (!cell) continue
      if (cell.type === 'b') {
        if (cell.color === 'w') whiteBishops += 1
        else blackBishops += 1
      }
      if (r >= 2 && r <= 5 && c >= 2 && c <= 5) {
        if (cell.color === 'w') whiteCenter += 1
        else blackCenter += 1
      }
    }
  }

  const notes: string[] = []
  if (whiteBishops >= 2 && blackBishops < 2) {
    notes.push('Trắng giữ lợi thế cặp Tượng')
  } else if (blackBishops >= 2 && whiteBishops < 2) {
    notes.push('Đen giữ lợi thế cặp Tượng')
  }

  if (whiteCenter - blackCenter >= 2) {
    notes.push('Trắng kiểm soát khu trung tâm tốt hơn')
  } else if (blackCenter - whiteCenter >= 2) {
    notes.push('Đen kiểm soát khu trung tâm tốt hơn')
  }

  if (notes.length === 0) {
    notes.push(
      style === 'aggressive'
        ? 'Ưu tiên đẩy quân chủ động & tạo áp lực tấn công'
        : 'Cân bằng thế trận, ưu tiên phát triển quân hài hòa',
    )
  }

  return notes
}

export function analyzeWithLocalEngine(
  fen: string,
  style: LocalEngineStyle,
  depth = 3,
): LocalEngineResult {
  const game = new Chess()
  game.load(fen)

  if (game.isGameOver()) {
    return {
      cp: game.isCheckmate() ? null : 0,
      mate: game.isCheckmate() ? (game.turn() === 'w' ? -1 : 1) : null,
      depth: 0,
      bestMove: null,
      bestMoveSan: null,
      pv: [],
      insights: [],
    }
  }

  const maximizingWhite = game.turn() === 'w'
  const moves = orderMoves(game.moves({ verbose: true }), style)

  let bestMove: Move | null = null
  let bestScore = maximizingWhite ? -Infinity : Infinity
  let alpha = -Infinity
  let beta = Infinity

  for (const move of moves) {
    game.move(move)
    const val = alphaBeta(
      game,
      depth - 1,
      alpha,
      beta,
      !maximizingWhite,
      style,
    )
    game.undo()

    if (maximizingWhite) {
      if (val > bestScore) {
        bestScore = val
        bestMove = move
      }
      if (bestScore > alpha) alpha = bestScore
    } else {
      if (val < bestScore) {
        bestScore = val
        bestMove = move
      }
      if (bestScore < beta) beta = bestScore
    }
  }

  const isMate = Math.abs(bestScore) > 90000
  const uci = bestMove
    ? `${bestMove.from}${bestMove.to}${bestMove.promotion ?? ''}`
    : null

  return {
    cp: isMate ? null : Math.round(bestScore),
    mate: isMate ? (bestScore > 0 ? 1 : -1) : null,
    depth,
    bestMove: uci,
    bestMoveSan: bestMove?.san ?? null,
    pv: uci ? [uci] : [],
    insights: extractPositionalInsights(game, style),
  }
}
