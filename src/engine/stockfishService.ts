export interface EngineLine {
  multipv: number
  cp: number | null
  mate: number | null
  depth: number
  pv: string[]
}

export interface EngineEvaluation {
  /** Centipawns normalized to White's perspective (+ = White better, - = Black better) */
  cp: number | null
  /** Mate in N moves normalized to White's perspective (+ = White mates, - = Black mates) */
  mate: number | null
  depth: number
  targetDepth: number
  bestMove: string | null
  pv: string[]
  /** Top candidate lines from MultiPV (sorted by multipv 1, 2, ...) */
  lines: EngineLine[]
  isSearching: boolean
  isReady: boolean
  error: string | null
}

export const INITIAL_EVALUATION: EngineEvaluation = {
  cp: 0,
  mate: null,
  depth: 0,
  targetDepth: 12,
  bestMove: null,
  pv: [],
  lines: [],
  isSearching: false,
  isReady: false,
  error: null,
}

export function formatEvaluationScore(
  evaluation: Pick<EngineEvaluation, 'cp' | 'mate'>,
): string {
  if (evaluation.mate !== null) {
    const absMate = Math.abs(evaluation.mate)
    if (absMate === 0) return '#'
    return evaluation.mate > 0 ? `M${absMate}` : `-M${absMate}`
  }
  if (evaluation.cp === null) return '0.0'
  const pawns = evaluation.cp / 100
  if (Math.abs(pawns) < 0.05) return '0.0'
  return pawns > 0 ? `+${pawns.toFixed(1)}` : pawns.toFixed(1)
}

type EvalListener = (evaluation: EngineEvaluation) => void

export class StockfishService {
  private worker: Worker | null = null
  private listener: EvalListener | null = null
  private isReady = false
  private isSearching = false
  private multiPv = 2
  private pendingSearch: { fen: string; depth: number; multiPv: number } | null =
    null
  private currentFen: string | null = null
  private currentTurn: 'w' | 'b' = 'w'
  private lineMap = new Map<number, EngineLine>()
  private currentEval: EngineEvaluation = { ...INITIAL_EVALUATION }
  private lastEmitMs = 0
  private emitTimer: number | null = null

  public start(onUpdate: EvalListener): void {
    this.listener = onUpdate
    if (this.worker) {
      this.emit()
      return
    }

    try {
      const workerUrl = `${import.meta.env.BASE_URL}stockfish/stockfish-19-lite-single.js`
      this.worker = new Worker(workerUrl)
      this.worker.onmessage = (event: MessageEvent<string>) => {
        const line = typeof event.data === 'string' ? event.data.trim() : ''
        if (line) {
          this.handleUciLine(line)
        }
      }
      this.worker.onerror = (event: ErrorEvent) => {
        this.currentEval = {
          ...this.currentEval,
          isSearching: false,
          error: event.message || 'Không thể khởi chạy Stockfish Worker.',
        }
        this.emit()
      }

      this.send('uci')
    } catch (err) {
      this.currentEval = {
        ...this.currentEval,
        isSearching: false,
        error:
          err instanceof Error
            ? err.message
            : 'Trình duyệt không hỗ trợ Web Worker / WASM.',
      }
      this.emit()
    }
  }

  public analyze(fen: string, depth = 12, multiPv = 2): void {
    if (!this.worker) return

    this.pendingSearch = { fen, depth, multiPv }

    if (!this.isReady) {
      return
    }

    if (this.isSearching) {
      this.send('stop')
      return
    }

    this.runPendingSearch()
  }

  public stop(): void {
    this.pendingSearch = null
    if (this.worker && this.isSearching) {
      this.send('stop')
    }
  }

  public destroy(): void {
    this.pendingSearch = null
    this.listener = null
    if (this.emitTimer !== null) {
      window.clearTimeout(this.emitTimer)
      this.emitTimer = null
    }
    if (this.worker) {
      this.send('quit')
      this.worker.terminate()
      this.worker = null
    }
    this.isReady = false
    this.isSearching = false
  }

  private send(command: string): void {
    this.worker?.postMessage(command)
  }

  private runPendingSearch(): void {
    if (!this.pendingSearch || !this.worker) return
    const { fen, depth, multiPv } = this.pendingSearch
    this.pendingSearch = null

    if (multiPv !== this.multiPv) {
      this.multiPv = multiPv
      this.send(`setoption name MultiPV value ${multiPv}`)
    }

    this.currentFen = fen
    this.currentTurn = fen.split(' ')[1] === 'b' ? 'b' : 'w'
    this.isSearching = true
    this.lineMap.clear()
    this.currentEval = {
      ...this.currentEval,
      depth: 0,
      targetDepth: depth,
      bestMove: null,
      pv: [],
      lines: [],
      isSearching: true,
      isReady: true,
      error: null,
    }
    this.emit()

    this.send(`position fen ${fen}`)
    this.send(`go depth ${depth}`)
  }

  private handleUciLine(line: string): void {
    if (line === 'uciok') {
      this.send(`setoption name MultiPV value ${this.multiPv}`)
      this.send('isready')
      return
    }

    if (line === 'readyok') {
      this.isReady = true
      this.currentEval = {
        ...this.currentEval,
        isReady: true,
        error: null,
      }
      this.emit()
      if (this.pendingSearch) {
        this.runPendingSearch()
      }
      return
    }

    // Parse UCI search info: "info depth 15 seldepth 17 multipv 1 score cp 32 ... pv e2e4 e7e5"
    if (line.startsWith('info ') && line.includes(' score ')) {
      if (this.pendingSearch) return

      const depthMatch = line.match(/\bdepth\s+(\d+)/)
      const multipvMatch = line.match(/\bmultipv\s+(\d+)/)
      const cpMatch = line.match(/\bscore\s+cp\s+(-?\d+)/)
      const mateMatch = line.match(/\bscore\s+mate\s+(-?\d+)/)
      const pvMatch = line.match(/\bpv\s+(.+)$/)

      const perspective = this.currentTurn === 'w' ? 1 : -1
      const depth = depthMatch
        ? Number.parseInt(depthMatch[1], 10)
        : this.currentEval.depth
      const multipv = multipvMatch ? Number.parseInt(multipvMatch[1], 10) : 1
      const pv = pvMatch ? pvMatch[1].trim().split(/\s+/) : []

      let cp: number | null = null
      let mate: number | null = null
      if (cpMatch) {
        cp = Number.parseInt(cpMatch[1], 10) * perspective
      } else if (mateMatch) {
        mate = Number.parseInt(mateMatch[1], 10) * perspective
      }

      if (pv.length > 0) {
        this.lineMap.set(multipv, {
          multipv,
          cp,
          mate,
          depth,
          pv,
        })
      }

      const sortedLines = Array.from(this.lineMap.values()).sort(
        (a, b) => a.multipv - b.multipv,
      )
      const topLine = sortedLines[0]

      this.currentEval = {
        ...this.currentEval,
        depth: topLine?.depth ?? depth,
        cp: topLine ? topLine.cp : cp,
        mate: topLine ? topLine.mate : mate,
        pv: topLine?.pv ?? pv,
        lines: sortedLines,
        bestMove: topLine?.pv[0] ?? this.currentEval.bestMove,
        isSearching: true,
      }
      this.emitThrottled()
      return
    }

    // Parse UCI final result: "bestmove e2e4 ponder e7e5"
    if (line.startsWith('bestmove ')) {
      const match = line.match(/^bestmove\s+(\S+)/)
      const bestMove = match && match[1] !== '(none)' ? match[1] : null

      this.isSearching = false

      if (this.pendingSearch) {
        this.runPendingSearch()
        return
      }

      if (this.currentFen) {
        this.currentEval = {
          ...this.currentEval,
          bestMove: bestMove ?? this.currentEval.bestMove,
          isSearching: false,
        }
        this.emit()
      }
    }
  }

  private emitThrottled(): void {
    const now = performance.now()
    const elapsed = now - this.lastEmitMs
    if (elapsed >= 80) {
      this.emit()
      return
    }
    if (this.emitTimer === null) {
      this.emitTimer = window.setTimeout(() => {
        this.emitTimer = null
        this.emit()
      }, 80 - elapsed)
    }
  }

  private emit(): void {
    if (this.emitTimer !== null) {
      window.clearTimeout(this.emitTimer)
      this.emitTimer = null
    }
    this.lastEmitMs = performance.now()
    this.listener?.({ ...this.currentEval })
  }
}
