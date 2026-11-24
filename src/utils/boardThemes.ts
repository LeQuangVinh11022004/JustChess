import type { Chess, PieceSymbol } from 'chess.js'

export type BoardThemeId = 'chesscom' | 'lichess' | 'slate'

export interface BoardTheme {
  id: BoardThemeId
  name: string
  light: string
  dark: string
  coordOnLight: string
  coordOnDark: string
  lastMoveLight: string
  lastMoveDark: string
  selected: string
}

export const BOARD_THEMES: Record<BoardThemeId, BoardTheme> = {
  chesscom: {
    id: 'chesscom',
    name: 'Chess.com Green',
    light: '#eeeed2',
    dark: '#769656',
    coordOnLight: '#769656',
    coordOnDark: '#eeeed2',
    lastMoveLight: '#f6f669',
    lastMoveDark: '#baca2b',
    selected: 'rgba(246, 246, 105, 0.78)',
  },
  lichess: {
    id: 'lichess',
    name: 'Lichess Wood',
    light: '#f0d9b5',
    dark: '#b58863',
    coordOnLight: '#b58863',
    coordOnDark: '#f0d9b5',
    lastMoveLight: '#cdd26a',
    lastMoveDark: '#aaa23a',
    selected: 'rgba(20, 85, 30, 0.45)',
  },
  slate: {
    id: 'slate',
    name: 'Tournament Blue',
    light: '#dee3e6',
    dark: '#8ca2ad',
    coordOnLight: '#6b828e',
    coordOnDark: '#dee3e6',
    lastMoveLight: '#c3d8e8',
    lastMoveDark: '#6f9cb8',
    selected: 'rgba(56, 130, 200, 0.45)',
  },
}

const PIECE_VALUES: Record<PieceSymbol, number> = {
  p: 1,
  n: 3,
  b: 3,
  r: 5,
  q: 9,
  k: 0,
}

const STARTING_COUNTS: Record<PieceSymbol, number> = {
  q: 1,
  r: 2,
  b: 2,
  n: 2,
  p: 8,
  k: 1,
}

const DISPLAY_ORDER: PieceSymbol[] = ['q', 'r', 'b', 'n', 'p']

export interface MaterialSummary {
  capturedByWhite: PieceSymbol[]
  capturedByBlack: PieceSymbol[]
  whiteAdvantage: number
  blackAdvantage: number
}

export function getMaterialSummary(game: Chess): MaterialSummary {
  const remaining: Record<'w' | 'b', Record<PieceSymbol, number>> = {
    w: { p: 0, n: 0, b: 0, r: 0, q: 0, k: 0 },
    b: { p: 0, n: 0, b: 0, r: 0, q: 0, k: 0 },
  }

  for (const row of game.board()) {
    for (const cell of row) {
      if (cell) {
        remaining[cell.color][cell.type] += 1
      }
    }
  }

  const capturedByWhite: PieceSymbol[] = []
  const capturedByBlack: PieceSymbol[] = []

  for (const type of DISPLAY_ORDER) {
    const missingBlack = Math.max(0, STARTING_COUNTS[type] - remaining.b[type])
    for (let i = 0; i < missingBlack; i++) capturedByWhite.push(type)

    const missingWhite = Math.max(0, STARTING_COUNTS[type] - remaining.w[type])
    for (let i = 0; i < missingWhite; i++) capturedByBlack.push(type)
  }

  let whiteScore = 0
  let blackScore = 0
  for (const type of DISPLAY_ORDER) {
    whiteScore += remaining.w[type] * PIECE_VALUES[type]
    blackScore += remaining.b[type] * PIECE_VALUES[type]
  }

  const diff = whiteScore - blackScore
  return {
    capturedByWhite,
    capturedByBlack,
    whiteAdvantage: diff > 0 ? diff : 0,
    blackAdvantage: diff < 0 ? -diff : 0,
  }
}
