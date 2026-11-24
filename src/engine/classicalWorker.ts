import { Chess, type Square } from 'chess.js'
import { aiMove } from 'js-chess-engine'
import {
  analyzeWithLocalEngine,
  type LocalEngineResult,
  type LocalEngineStyle,
} from './classicalEngine'

export type WorkerEngineStyle = LocalEngineStyle | 'jschess'

export interface ClassicalWorkerRequest {
  id: number
  fen: string
  style: WorkerEngineStyle
  depth: number
}

export interface ClassicalWorkerResponse {
  id: number
  fen: string
  style: WorkerEngineStyle
  result: LocalEngineResult
}

function runJsChessEngine(fen: string): LocalEngineResult {
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

  try {
    const moveObj = aiMove(fen, 2)
    const entries = Object.entries(moveObj)
    if (entries.length === 0) {
      return {
        cp: 0,
        mate: null,
        depth: 2,
        bestMove: null,
        bestMoveSan: null,
        pv: [],
        insights: ['js-chess-engine không tìm thấy nước đi hợp lệ.'],
      }
    }

    const from = entries[0][0].toLowerCase() as Square
    const to = entries[0][1].toLowerCase() as Square

    // Detect promotion automatically if pawn reaches rank 1 or 8
    const piece = game.get(from)
    const isPromotion =
      piece?.type === 'p' && (to[1] === '8' || to[1] === '1')
    const executed = game.move({
      from,
      to,
      promotion: isPromotion ? 'q' : undefined,
    })

    const uci = `${executed.from}${executed.to}${executed.promotion ?? ''}`
    // Quick static score from resulting position using classical evaluator at depth 1
    const evalAfter = analyzeWithLocalEngine(game.fen(), 'classical', 1)

    return {
      cp: evalAfter.cp,
      mate: evalAfter.mate,
      depth: 2,
      bestMove: uci,
      bestMoveSan: executed.san,
      pv: [uci],
      insights: [
        'Open-source engine js-chess-engine (MIT) • Level 2 (Advanced)',
      ],
    }
  } catch {
    return {
      cp: null,
      mate: null,
      depth: 2,
      bestMove: null,
      bestMoveSan: null,
      pv: [],
      insights: ['js-chess-engine không hỗ trợ thế cờ này.'],
    }
  }
}

self.onmessage = (event: MessageEvent<ClassicalWorkerRequest>) => {
  const { id, fen, style, depth } = event.data
  const result =
    style === 'jschess'
      ? runJsChessEngine(fen)
      : analyzeWithLocalEngine(fen, style, depth)
  const response: ClassicalWorkerResponse = { id, fen, style, result }
  self.postMessage(response)
}
