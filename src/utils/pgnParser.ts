import { Chess, DEFAULT_POSITION } from 'chess.js'

const FIGURINE_MAP: Record<string, string> = {
  '♔': 'K',
  '♕': 'Q',
  '♖': 'R',
  '♗': 'B',
  '♘': 'N',
  '♚': 'K',
  '♛': 'Q',
  '♜': 'R',
  '♝': 'B',
  '♞': 'N',
}

function normalizePgnText(raw: string): string {
  return raw
    .replace(/^\uFEFF/, '')
    .replace(/[\u200B-\u200D\uFEFF]/g, '')
    .replace(/\r\n?/g, '\n')
    .replace(/[♔♕♖♗♘♚♛♜♝♞]/g, (ch) => FIGURINE_MAP[ch] ?? ch)
    .replace(/[“”]/g, '"')
    .replace(/[‘’]/g, "'")
    .trim()
}

function stripNestedParens(text: string): string {
  let out = ''
  let depth = 0
  for (let i = 0; i < text.length; i++) {
    const ch = text[i]
    if (ch === '(') {
      depth += 1
    } else if (ch === ')') {
      if (depth > 0) depth -= 1
    } else if (depth === 0) {
      out += ch
    }
  }
  return out
}

export interface ParsedPgnResult {
  chess: Chess
  headers: Record<string, string>
  startFen: string
}

/**
 * Robust PGN parser that handles standard PGNs as well as real-world exports from
 * Chess.com, Lichess, ChessBase, and broadcasts (clock tags, eval comments,
 * variations, NAGs, black move numbers like `1...`, and figurine SAN).
 */
export function parsePgnRobust(rawPgn: string): ParsedPgnResult {
  const cleaned = normalizePgnText(rawPgn)
  if (!cleaned) {
    throw new Error('PGN trống.')
  }

  // Fast path: standard chess.js loadPgn
  try {
    const direct = new Chess()
    direct.loadPgn(cleaned)
    const rawHeaders = direct.getHeaders()
    const headers: Record<string, string> = {}
    for (const [k, v] of Object.entries(rawHeaders)) {
      if (typeof v === 'string') headers[k] = v
    }
    const startFen =
      headers.SetUp === '1' && headers.FEN ? headers.FEN : DEFAULT_POSITION
    if (direct.history().length > 0 || headers.FEN) {
      return { chess: direct, headers, startFen }
    }
  } catch {
    // Fall through to tolerant parser
  }

  // Tolerant fallback parser: extract headers + strip comments/variations/NAGs + replay moves
  const headers: Record<string, string> = {}
  const bodyLines: string[] = []
  for (const line of cleaned.split('\n')) {
    const trimmed = line.trim()
    const headerMatch = trimmed.match(/^\[([A-Za-z0-9_]+)\s+"(.*)"\]$/)
    if (headerMatch) {
      headers[headerMatch[1]] = headerMatch[2]
    } else if (!trimmed.startsWith(';')) {
      bodyLines.push(trimmed)
    }
  }

  let movetext = bodyLines.join(' ')
  // Remove { ... } comments (including {[%clk ...]} and {[%eval ...]})
  movetext = movetext.replace(/\{[^}]*\}/g, ' ')
  // Remove ( ... ) variations (including nested)
  movetext = stripNestedParens(movetext)
  // Remove NAGs ($1, $6, etc.)
  movetext = movetext.replace(/\$\d+/g, ' ')
  // Remove move numbers like "1.", "12...", "1.e4" -> keep SAN
  movetext = movetext.replace(/\b\d+\.+/g, ' ')

  const startFen =
    headers.SetUp === '1' && headers.FEN ? headers.FEN : DEFAULT_POSITION
  const game = new Chess()
  if (startFen !== DEFAULT_POSITION) {
    game.load(startFen)
  }

  const tokens = movetext.split(/\s+/).filter(Boolean)
  let parsedAny = false
  for (const rawToken of tokens) {
    if (
      rawToken === '1-0' ||
      rawToken === '0-1' ||
      rawToken === '1/2-1/2' ||
      rawToken === '*'
    ) {
      break
    }
    // Strip trailing annotation symbols (!, ?, !!, ?!, !?)
    const san = rawToken.replace(/[!?]+$/g, '')
    if (!san) continue
    try {
      game.move(san)
      parsedAny = true
    } catch {
      // Try castling with zeros (0-0 / 0-0-0)
      if (san === '0-0' || san === '0-0-0') {
        game.move(san.replace(/0/g, 'O'))
        parsedAny = true
      } else {
        throw new Error(`Không hiểu nước đi "${rawToken}".`)
      }
    }
  }

  if (!parsedAny && startFen === DEFAULT_POSITION) {
    throw new Error('Không tìm thấy nước đi hợp lệ trong PGN.')
  }

  return { chess: game, headers, startFen }
}
