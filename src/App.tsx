import {
  Chess,
  DEFAULT_POSITION,
  type Move,
  type PieceSymbol,
  type Square,
} from 'chess.js'
import { useEffect, useMemo, useRef, useState } from 'react'
import {
  ChessBoard,
  type BoardArrow,
  type BoardMoveBadge,
  type LastMove,
  type PendingPromotion,
} from './components/ChessBoard'
import { EvaluationBar } from './components/EvaluationBar'
import { GameReviewPanel } from './components/GameReviewPanel'
import { ImportModal, type ImportTab } from './components/ImportModal'
import { PlayerBar } from './components/PlayerBar'
import type { LocalEngineResult } from './engine/classicalEngine'
import type {
  ClassicalWorkerRequest,
  ClassicalWorkerResponse,
  WorkerEngineStyle,
} from './engine/classicalWorker'
import {
  CLASSIFICATION_META,
  classifyLiveMove,
  runFullGameReview,
  type GameReviewResult,
  type ReviewMoveInfo,
} from './engine/gameReview'
import {
  fetchLichessCloudEval,
  type LichessCloudEvalResult,
} from './engine/lichessCloudEval'
import {
  formatEvaluationScore,
  INITIAL_EVALUATION,
  StockfishService,
  type EngineEvaluation,
} from './engine/stockfishService'
import {
  BOARD_THEMES,
  getMaterialSummary,
  type BoardThemeId,
} from './utils/boardThemes'
import { chessSounds } from './utils/chessSounds'
import type { OnlineGameSummary } from './utils/onlineGamesApi'

type EngineMode =
  | 'stockfish'
  | 'cloud'
  | 'jschess'
  | 'classical'
  | 'aggressive'
  | 'compare'

type SidebarTab = 'game' | 'review' | 'engine'

interface StoredMove {
  from: Square
  to: Square
  san: string
  promotion?: PieceSymbol
}

interface PlayerNames {
  white: string
  black: string
}

const DEFAULT_PLAYERS: PlayerNames = {
  white: 'Quân Trắng',
  black: 'Quân Đen',
}

const ENGINE_DEPTH = 15

const ENGINE_MODES: Array<{ id: EngineMode; label: string; desc: string }> = [
  {
    id: 'stockfish',
    label: 'Stockfish 19',
    desc: 'NNUE WASM Local • Depth 15 • Top 2 biến',
  },
  {
    id: 'cloud',
    label: 'Lichess Cloud',
    desc: 'Stockfish Cloud siêu sâu (depth 30–60+)',
  },
  {
    id: 'jschess',
    label: 'js-chess',
    desc: 'Open-source JS Engine (MIT)',
  },
  {
    id: 'classical',
    label: 'PeSTO Cổ điển',
    desc: 'Vị trí & cấu trúc quân',
  },
  {
    id: 'aggressive',
    label: 'Tấn công',
    desc: 'Ưu tiên áp lực & chủ động',
  },
  {
    id: 'compare',
    label: 'So sánh 3 Engine',
    desc: 'Stockfish + PeSTO + js-chess',
  },
]

function buildGameAtPly(
  startFen: string,
  moves: StoredMove[],
  ply: number,
): Chess {
  const instance = new Chess()
  if (startFen !== DEFAULT_POSITION) {
    instance.load(startFen)
  }
  const limit = Math.min(ply, moves.length)
  for (let i = 0; i < limit; i++) {
    const m = moves[i]
    instance.move({
      from: m.from,
      to: m.to,
      promotion: m.promotion,
    })
  }
  return instance
}

function getGameStatus(
  game: Chess,
): { text: string; tone: 'normal' | 'check' | 'over' } {
  if (game.isCheckmate()) {
    const winner = game.turn() === 'w' ? 'Đen' : 'Trắng'
    return { text: `Chiếu hết • Quân ${winner} thắng`, tone: 'over' }
  }
  if (game.isStalemate()) return { text: 'Hòa cờ • Stalemate', tone: 'over' }
  if (game.isThreefoldRepetition()) {
    return { text: 'Hòa cờ • Lặp nước 3 lần', tone: 'over' }
  }
  if (game.isInsufficientMaterial()) {
    return { text: 'Hòa cờ • Không đủ lực lượng', tone: 'over' }
  }
  if (game.isDraw()) return { text: 'Hòa cờ', tone: 'over' }

  const turnLabel = game.turn() === 'w' ? 'Trắng' : 'Đen'
  if (game.inCheck()) {
    return { text: `Lượt ${turnLabel} • Đang bị chiếu!`, tone: 'check' }
  }
  return { text: `Lượt của quân ${turnLabel}`, tone: 'normal' }
}

function findCheckedKingSquare(game: Chess): Square | null {
  if (!game.inCheck()) return null
  const turn = game.turn()
  for (const row of game.board()) {
    for (const cell of row) {
      if (cell && cell.type === 'k' && cell.color === turn) {
        return cell.square
      }
    }
  }
  return null
}

function getInitialMoveInfo(startFen: string): {
  startNumber: number
  startsWithBlack: boolean
} {
  const parts = startFen.split(' ')
  const startsWithBlack = parts[1] === 'b'
  const parsedNumber = Number.parseInt(parts[5] ?? '1', 10)
  return {
    startNumber: Number.isNaN(parsedNumber) ? 1 : parsedNumber,
    startsWithBlack,
  }
}

function parseUciMove(
  uci: string | null,
): { from: Square; to: Square; promotion?: PieceSymbol } | null {
  if (!uci || uci.length < 4) return null
  const from = uci.slice(0, 2) as Square
  const to = uci.slice(2, 4) as Square
  const promo = uci[4] as PieceSymbol | undefined
  return { from, to, promotion: promo }
}

function uciLineToSan(fen: string, pv: string[], maxMoves = 4): string {
  const temp = new Chess()
  try {
    temp.load(fen)
  } catch {
    return pv.slice(0, maxMoves).join(' ')
  }
  const sans: string[] = []
  for (const uci of pv.slice(0, maxMoves)) {
    const parsed = parseUciMove(uci)
    if (!parsed) break
    try {
      const m = temp.move({
        from: parsed.from,
        to: parsed.to,
        promotion: parsed.promotion,
      })
      sans.push(m.san)
    } catch {
      break
    }
  }
  return sans.join(' ')
}

function playSoundForMove(executed: Move, nextGame: Chess): void {
  if (nextGame.isGameOver()) {
    chessSounds.play('gameOver')
    return
  }
  if (nextGame.inCheck()) {
    chessSounds.play('check')
    return
  }
  if (executed.promotion) {
    chessSounds.play('promote')
    return
  }
  if (executed.san === 'O-O' || executed.san === 'O-O-O') {
    chessSounds.play('castle')
    return
  }
  if (executed.captured) {
    chessSounds.play('capture')
    return
  }
  chessSounds.play('move')
}

export function App() {
  const [startFen, setStartFen] = useState<string>(DEFAULT_POSITION)
  const [moves, setMoves] = useState<StoredMove[]>([])
  const [viewIndex, setViewIndex] = useState<number>(0)
  const [players, setPlayers] = useState<PlayerNames>(DEFAULT_PLAYERS)
  const [gameMeta, setGameMeta] = useState<string | null>(null)

  const [selectedSquare, setSelectedSquare] = useState<Square | null>(null)
  const [orientation, setOrientation] = useState<'w' | 'b'>('w')
  const [themeId, setThemeId] = useState<BoardThemeId>('chesscom')
  const [soundEnabled, setSoundEnabled] = useState<boolean>(true)
  const [pendingPromotion, setPendingPromotion] =
    useState<PendingPromotion | null>(null)
  const [importModalTab, setImportModalTab] = useState<ImportTab | null>(null)
  const [copiedType, setCopiedType] = useState<'fen' | 'pgn' | null>(null)

  // Multi-Engine state
  const [engineEnabled, setEngineEnabled] = useState<boolean>(true)
  const [engineMode, setEngineMode] = useState<EngineMode>('stockfish')
  const [showBestMoveArrow, setShowBestMoveArrow] = useState<boolean>(true)
  const [sfEvaluation, setSfEvaluation] =
    useState<EngineEvaluation>(INITIAL_EVALUATION)
  const [workerResults, setWorkerResults] = useState<
    Partial<Record<WorkerEngineStyle, { fen: string; result: LocalEngineResult }>>
  >({})
  const [cloudState, setCloudState] = useState<{
    fen: string
    loading: boolean
    result: LichessCloudEvalResult | null
    error: string | null
  }>({
    fen: DEFAULT_POSITION,
    loading: false,
    result: null,
    error: null,
  })
  const engineRef = useRef<StockfishService | null>(null)
  const classicalWorkerRef = useRef<Worker | null>(null)
  const classicalReqIdRef = useRef<Record<WorkerEngineStyle, number>>({
    classical: 0,
    aggressive: 0,
    jschess: 0,
  })

  // Live per-move review context (shows badge immediately on the piece you just moved!)
  const [liveMoveCtx, setLiveMoveCtx] = useState<{
    fenAfter: string
    fenBefore: string
    ply: number
    to: Square
    uci: string
    san: string
    color: 'w' | 'b'
    isCheckmate: boolean
    before: { cp: number | null; mate: number | null; bestMove: string | null }
  } | null>(null)
  const [sfEvalFen, setSfEvalFen] = useState<string>(DEFAULT_POSITION)
  const sfEvalForFenRef = useRef<{
    fen: string
    cp: number | null
    mate: number | null
    bestMove: string | null
  }>({
    fen: DEFAULT_POSITION,
    cp: 0,
    mate: null,
    bestMove: null,
  })

  // Full Game Review state (Chess.com-style Coach, Scorecard, Badges & Win-Rate Graph)
  const [sidebarTab, setSidebarTab] = useState<SidebarTab>('game')
  const [showBestMoveHint, setShowBestMoveHint] = useState<boolean>(false)
  const [reviewResult, setReviewResult] = useState<GameReviewResult | null>(
    null,
  )
  const [reviewProgress, setReviewProgress] = useState<{
    completed: number
    total: number
  } | null>(null)
  const [reviewError, setReviewError] = useState<string | null>(null)
  const reviewAbortRef = useRef<AbortController | null>(null)

  const activeMoveRef = useRef<HTMLButtonElement>(null)

  const displayGame = useMemo(
    () => buildGameAtPly(startFen, moves, viewIndex),
    [startFen, moves, viewIndex],
  )
  const fen = displayGame.fen()
  const isCheckmate = displayGame.isCheckmate()
  const isGameOver = displayGame.isGameOver()
  const theme = BOARD_THEMES[themeId]
  const board = displayGame.board()
  const turn = displayGame.turn()
  const status = getGameStatus(displayGame)
  const checkedKingSquare = findCheckedKingSquare(displayGame)
  const material = getMaterialSummary(displayGame)

  const lastMove: LastMove | null =
    viewIndex > 0
      ? {
          from: moves[viewIndex - 1].from,
          to: moves[viewIndex - 1].to,
        }
      : null

  // Map ply -> ReviewMoveInfo for O(1) lookup in move list
  const reviewMoveMap = useMemo(() => {
    const map = new Map<number, ReviewMoveInfo>()
    if (reviewResult) {
      for (const m of reviewResult.moves) {
        map.set(m.ply, m)
      }
    }
    return map
  }, [reviewResult])

  const currentReviewMove =
    viewIndex > 0 ? reviewMoveMap.get(viewIndex) ?? null : null

  const liveMoveVerdict = (() => {
    if (currentReviewMove || !liveMoveCtx || liveMoveCtx.fenAfter !== fen) {
      return null
    }
    const readyAfter =
      isGameOver ||
      (sfEvalFen === fen &&
        (sfEvaluation.depth >= 10 || !sfEvaluation.isSearching))
    if (!readyAfter) return null

    const afterEval = isCheckmate
      ? { cp: null, mate: turn === 'w' ? -1 : 1 }
      : isGameOver
        ? { cp: 0, mate: null }
        : { cp: sfEvaluation.cp, mate: sfEvaluation.mate }

    return classifyLiveMove({
      ply: liveMoveCtx.ply,
      isStandardStart: startFen === DEFAULT_POSITION,
      uci: liveMoveCtx.uci,
      san: liveMoveCtx.san,
      color: liveMoveCtx.color,
      fenBefore: liveMoveCtx.fenBefore,
      before: liveMoveCtx.before,
      after: afterEval,
      isCheckmate: liveMoveCtx.isCheckmate,
    })
  })()

  const activeMoveBadge: BoardMoveBadge | null = currentReviewMove
    ? {
        square: currentReviewMove.to,
        symbol: CLASSIFICATION_META[currentReviewMove.classification].symbol,
        color: CLASSIFICATION_META[currentReviewMove.classification].color,
        textColor:
          CLASSIFICATION_META[currentReviewMove.classification].badgeText,
        label: CLASSIFICATION_META[currentReviewMove.classification].label,
      }
    : liveMoveCtx && liveMoveVerdict
      ? {
          square: liveMoveCtx.to,
          symbol: CLASSIFICATION_META[liveMoveVerdict.classification].symbol,
          color: CLASSIFICATION_META[liveMoveVerdict.classification].color,
          textColor:
            CLASSIFICATION_META[liveMoveVerdict.classification].badgeText,
          label: `${liveMoveCtx.san} — ${CLASSIFICATION_META[liveMoveVerdict.classification].label}`,
        }
      : null

  const needsStockfish =
    engineEnabled &&
    !isGameOver &&
    (engineMode === 'stockfish' ||
      engineMode === 'compare' ||
      (liveMoveCtx !== null && liveMoveCtx.fenAfter === fen))

  // Lifecycle: start Stockfish Worker & Classical PeSTO Web Worker once
  useEffect(() => {
    const service = new StockfishService()
    engineRef.current = service
    service.start((nextEval) => {
      setSfEvaluation(nextEval)
      sfEvalForFenRef.current = {
        fen: sfEvalForFenRef.current.fen,
        cp: nextEval.cp,
        mate: nextEval.mate,
        bestMove: nextEval.bestMove,
      }
    })

    const classicalWorker = new Worker(
      new URL('./engine/classicalWorker.ts', import.meta.url),
      { type: 'module' },
    )
    classicalWorker.onmessage = (
      event: MessageEvent<ClassicalWorkerResponse>,
    ) => {
      const { id, fen: resFen, style, result } = event.data
      if (id === classicalReqIdRef.current[style]) {
        setWorkerResults((prev) => ({
          ...prev,
          [style]: { fen: resFen, result },
        }))
      }
    }
    classicalWorkerRef.current = classicalWorker

    return () => {
      service.destroy()
      engineRef.current = null
      classicalWorker.terminate()
      classicalWorkerRef.current = null
      reviewAbortRef.current?.abort()
    }
  }, [])

  // Trigger Stockfish analysis when needed (short debounce keeps rapid PGN scrubbing smooth)
  useEffect(() => {
    const service = engineRef.current
    if (!service) return

    if (!needsStockfish) {
      service.stop()
      return
    }

    const timer = window.setTimeout(() => {
      sfEvalForFenRef.current = {
        ...sfEvalForFenRef.current,
        fen,
      }
      setSfEvalFen(fen)
      const multiPv = engineMode === 'stockfish' ? 2 : 1
      service.analyze(fen, ENGINE_DEPTH, multiPv)
    }, 45)

    return () => window.clearTimeout(timer)
  }, [fen, needsStockfish, engineMode])

  // Fetch Lichess Cloud Eval (depth 30-60+) when in 'cloud' mode
  useEffect(() => {
    if (!engineEnabled || isGameOver || engineMode !== 'cloud') return

    const controller = new AbortController()
    const timer = window.setTimeout(() => {
      setCloudState({ fen, loading: true, result: null, error: null })
      void fetchLichessCloudEval(fen, 3, controller.signal)
        .then((res) => {
          if (!controller.signal.aborted) {
            setCloudState({ fen, loading: false, result: res, error: null })
          }
        })
        .catch((err) => {
          if (controller.signal.aborted) return
          setCloudState({
            fen,
            loading: false,
            result: null,
            error:
              err instanceof Error
                ? err.message
                : 'Không thể kết nối Lichess Cloud Eval.',
          })
        })
    }, 120)

    return () => {
      window.clearTimeout(timer)
      controller.abort()
    }
  }, [fen, engineEnabled, engineMode, isGameOver])

  // Run Classical PeSTO / Aggressive / js-chess-engine asynchronously in Web Worker
  useEffect(() => {
    const worker = classicalWorkerRef.current
    if (!worker || !engineEnabled || isGameOver) return

    const stylesToRun: WorkerEngineStyle[] =
      engineMode === 'classical'
        ? ['classical']
        : engineMode === 'aggressive'
          ? ['aggressive']
          : engineMode === 'jschess'
            ? ['jschess']
            : engineMode === 'compare'
              ? ['classical', 'jschess']
              : []

    if (stylesToRun.length === 0) return

    const timer = window.setTimeout(() => {
      for (const style of stylesToRun) {
        const nextId = classicalReqIdRef.current[style] + 1
        classicalReqIdRef.current[style] = nextId
        const payload: ClassicalWorkerRequest = {
          id: nextId,
          fen,
          style,
          depth: 3,
        }
        worker.postMessage(payload)
      }
    }, 45)

    return () => window.clearTimeout(timer)
  }, [fen, engineEnabled, engineMode, isGameOver])

  const classicalResult: LocalEngineResult | null =
    workerResults.classical?.fen === fen ? workerResults.classical.result : null
  const aggressiveResult: LocalEngineResult | null =
    workerResults.aggressive?.fen === fen
      ? workerResults.aggressive.result
      : null
  const jsChessResult: LocalEngineResult | null =
    workerResults.jschess?.fen === fen ? workerResults.jschess.result : null
  const activeCloudResult =
    cloudState.fen === fen ? cloudState.result : null
  const isCloudLoading = cloudState.fen === fen && cloudState.loading
  const cloudError = cloudState.fen === fen ? cloudState.error : null

  const activeSingleLocalResult: LocalEngineResult | null =
    engineMode === 'classical'
      ? classicalResult
      : engineMode === 'aggressive'
        ? aggressiveResult
        : engineMode === 'jschess'
          ? jsChessResult
          : null

  // Choose primary evaluation for EvaluationBar based on active engine mode
  const activeEvalForBar: EngineEvaluation = (() => {
    if (isCheckmate) {
      return {
        ...sfEvaluation,
        cp: null,
        mate: turn === 'w' ? -1 : 1,
        bestMove: null,
        isSearching: false,
      }
    }
    if (isGameOver) {
      return {
        ...sfEvaluation,
        cp: 0,
        mate: null,
        bestMove: null,
        isSearching: false,
      }
    }
    if (engineMode === 'cloud' && activeCloudResult?.lines[0]) {
      const top = activeCloudResult.lines[0]
      return {
        ...INITIAL_EVALUATION,
        cp: top.cp,
        mate: top.mate,
        depth: activeCloudResult.depth,
        targetDepth: activeCloudResult.depth,
        bestMove: top.moves[0] ?? null,
        pv: top.moves,
        isSearching: false,
        isReady: true,
      }
    }
    if (activeSingleLocalResult) {
      return {
        ...INITIAL_EVALUATION,
        cp: activeSingleLocalResult.cp,
        mate: activeSingleLocalResult.mate,
        depth: activeSingleLocalResult.depth,
        targetDepth: activeSingleLocalResult.depth,
        bestMove: activeSingleLocalResult.bestMove,
        pv: activeSingleLocalResult.pv,
        isSearching: false,
        isReady: true,
      }
    }
    return sfEvaluation
  })()

  // Build engine suggestion arrows (or Coach "Best Move" hint arrow in Review tab)
  const engineArrows: BoardArrow[] = (() => {
    if (
      sidebarTab === 'review' &&
      showBestMoveHint &&
      currentReviewMove?.bestMoveBefore
    ) {
      const parsed = parseUciMove(currentReviewMove.bestMoveBefore)
      if (parsed) {
        return [
          {
            from: parsed.from,
            to: parsed.to,
            color: '#81b64c',
            opacity: 0.9,
          },
        ]
      }
    }

    if (!engineEnabled || !showBestMoveArrow || isGameOver) return []
    const arrows: BoardArrow[] = []

    const pushUnique = (uci: string | null, color: string, opacity = 0.8) => {
      const parsed = parseUciMove(uci)
      if (!parsed) return
      const duplicate = arrows.some(
        (a) => a.from === parsed.from && a.to === parsed.to,
      )
      if (!duplicate) {
        arrows.push({ from: parsed.from, to: parsed.to, color, opacity })
      }
    }

    if (engineMode === 'stockfish' || engineMode === 'compare') {
      pushUnique(sfEvaluation.bestMove, '#16a34a', 0.82) // Green: Stockfish 19
    }
    if (engineMode === 'cloud') {
      pushUnique(activeCloudResult?.lines[0]?.moves[0] ?? null, '#06b6d4', 0.84) // Cyan: Lichess Cloud
    }
    if (engineMode === 'classical' || engineMode === 'compare') {
      pushUnique(classicalResult?.bestMove ?? null, '#3b82f6', 0.78) // Blue: PeSTO
    }
    if (engineMode === 'jschess' || engineMode === 'compare') {
      pushUnique(jsChessResult?.bestMove ?? null, '#a855f7', 0.78) // Purple: js-chess-engine
    }
    if (engineMode === 'aggressive') {
      pushUnique(aggressiveResult?.bestMove ?? null, '#f97316', 0.82) // Orange: Aggressive
    }

    return arrows
  })()

  // Build move rows supporting custom starting FEN (including Black to move first)
  const { startNumber, startsWithBlack } = getInitialMoveInfo(startFen)
  const moveRows: Array<{
    moveNumber: number
    white?: { san: string; ply: number }
    black?: { san: string; ply: number }
  }> = []

  let cursor = 0
  let currentNumber = startNumber
  if (startsWithBlack && moves.length > 0) {
    moveRows.push({
      moveNumber: currentNumber,
      black: { san: moves[0].san, ply: 1 },
    })
    cursor = 1
    currentNumber += 1
  }
  while (cursor < moves.length) {
    const whiteMove = { san: moves[cursor].san, ply: cursor + 1 }
    const blackMove =
      cursor + 1 < moves.length
        ? { san: moves[cursor + 1].san, ply: cursor + 2 }
        : undefined
    moveRows.push({
      moveNumber: currentNumber,
      white: whiteMove,
      black: blackMove,
    })
    cursor += 2
    currentNumber += 1
  }

  // Keep active move visible in move list
  useEffect(() => {
    activeMoveRef.current?.scrollIntoView({ block: 'nearest' })
  }, [viewIndex])

  // Keyboard navigation for replay (ArrowLeft / ArrowRight / Home / End)
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (importModalTab !== null) return
      const target = e.target as HTMLElement | null
      if (
        target &&
        (target.tagName === 'INPUT' ||
          target.tagName === 'TEXTAREA' ||
          target.isContentEditable)
      ) {
        return
      }

      if (e.key === 'ArrowLeft') {
        e.preventDefault()
        setViewIndex((prev) => {
          const next = Math.max(0, prev - 1)
          if (next !== prev && soundEnabled) chessSounds.play('move')
          return next
        })
        setSelectedSquare(null)
        setPendingPromotion(null)
      } else if (e.key === 'ArrowRight') {
        e.preventDefault()
        setViewIndex((prev) => {
          const next = Math.min(moves.length, prev + 1)
          if (next !== prev && soundEnabled) chessSounds.play('move')
          return next
        })
        setSelectedSquare(null)
        setPendingPromotion(null)
      } else if (e.key === 'Home') {
        e.preventDefault()
        setViewIndex(0)
        setSelectedSquare(null)
        setPendingPromotion(null)
      } else if (e.key === 'End') {
        e.preventDefault()
        setViewIndex(moves.length)
        setSelectedSquare(null)
        setPendingPromotion(null)
      }
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [importModalTab, moves.length, soundEnabled])

  const cancelReview = () => {
    reviewAbortRef.current?.abort()
    reviewAbortRef.current = null
    setReviewProgress(null)
  }

  const clearReview = () => {
    cancelReview()
    setReviewResult(null)
    setReviewError(null)
  }

  const startGameReview = async (
    targetStartFen = startFen,
    targetMoves = moves,
  ) => {
    if (targetMoves.length === 0) return

    cancelReview()
    const controller = new AbortController()
    reviewAbortRef.current = controller
    setReviewError(null)
    setReviewResult(null)
    setShowBestMoveHint(false)
    setSidebarTab('review')
    setReviewProgress({ completed: 0, total: targetMoves.length + 1 })

    try {
      const result = await runFullGameReview(targetStartFen, targetMoves, {
        depth: 12,
        signal: controller.signal,
        onProgress: (completed, total) => {
          setReviewProgress({ completed, total })
        },
      })
      if (!controller.signal.aborted) {
        setReviewResult(result)
        setReviewProgress(null)
      }
    } catch (err) {
      if (err instanceof DOMException && err.name === 'AbortError') return
      setReviewError(
        err instanceof Error
          ? err.message
          : 'Không thể hoàn tất phân tích toàn ván.',
      )
      setReviewProgress(null)
    }
  }

  const legalMovesForSelected = selectedSquare
    ? displayGame.moves({ square: selectedSquare, verbose: true })
    : []
  const legalTargets = new Set<Square>(legalMovesForSelected.map((m) => m.to))

  const commitMove = (
    from: Square,
    to: Square,
    promotion?: PieceSymbol,
    atPly = viewIndex,
  ) => {
    const nextGame = buildGameAtPly(startFen, moves, atPly)
    const fenBefore = nextGame.fen()
    const moverColor = nextGame.turn()
    const beforeSnapshot =
      sfEvalForFenRef.current.fen === fenBefore
        ? {
            cp: sfEvalForFenRef.current.cp,
            mate: sfEvalForFenRef.current.mate,
            bestMove: sfEvalForFenRef.current.bestMove,
          }
        : { cp: 0, mate: null, bestMove: null }

    const executed = nextGame.move({ from, to, promotion })
    const fenAfter = nextGame.fen()
    const truncated = moves.slice(0, atPly)
    const updatedMoves: StoredMove[] = [
      ...truncated,
      {
        from: executed.from,
        to: executed.to,
        san: executed.san,
        promotion: executed.promotion,
      },
    ]

    if (soundEnabled) {
      playSoundForMove(executed, nextGame)
    }

    clearReview()
    setLiveMoveCtx({
      fenAfter,
      fenBefore,
      ply: updatedMoves.length,
      to: executed.to,
      uci: `${executed.from}${executed.to}${executed.promotion ?? ''}`,
      san: executed.san,
      color: moverColor,
      isCheckmate: nextGame.isCheckmate(),
      before: beforeSnapshot,
    })
    setMoves(updatedMoves)
    setViewIndex(updatedMoves.length)
    setSelectedSquare(null)
    setPendingPromotion(null)
  }

  const tryMove = (from: Square, to: Square) => {
    if (isGameOver) return

    const candidateMoves = displayGame
      .moves({ square: from, verbose: true })
      .filter((m) => m.to === to)

    if (candidateMoves.length === 0) {
      setSelectedSquare(null)
      return
    }

    const isPromotion = candidateMoves.some((m) => m.promotion)
    if (isPromotion) {
      setPendingPromotion({ from, to, color: displayGame.turn() })
      return
    }

    commitMove(from, to)
  }

  const handleSquareSelect = (square: Square) => {
    if (isGameOver || pendingPromotion) return

    if (selectedSquare && legalTargets.has(square)) {
      tryMove(selectedSquare, square)
      return
    }

    const piece = displayGame.get(square)
    if (piece && piece.color === displayGame.turn()) {
      setSelectedSquare(selectedSquare === square ? null : square)
    } else {
      setSelectedSquare(null)
    }
  }

  const handleSelectPromotion = (promotionPiece: PieceSymbol) => {
    if (!pendingPromotion) return
    commitMove(pendingPromotion.from, pendingPromotion.to, promotionPiece)
  }

  const handleUndo = () => {
    if (viewIndex === 0) return
    clearReview()
    const nextMoves = moves.slice(0, viewIndex - 1)
    setMoves(nextMoves)
    setViewIndex(nextMoves.length)
    setPendingPromotion(null)
    setSelectedSquare(null)
    if (soundEnabled) chessSounds.play('move')
  }

  const handleReset = () => {
    clearReview()
    setStartFen(DEFAULT_POSITION)
    setMoves([])
    setViewIndex(0)
    setPlayers(DEFAULT_PLAYERS)
    setGameMeta(null)
    setPendingPromotion(null)
    setSelectedSquare(null)
  }

  const handleImportFen = (loadedFen: string) => {
    clearReview()
    setStartFen(loadedFen)
    setMoves([])
    setViewIndex(0)
    setPlayers(DEFAULT_PLAYERS)
    setGameMeta('Thế cờ tùy chỉnh (FEN)')
    setPendingPromotion(null)
    setSelectedSquare(null)
  }

  const loadPgnInternal = (
    pgnText: string,
    opts?: {
      autoReview?: boolean
      orientation?: 'w' | 'b'
      fallbackWhite?: string
      fallbackBlack?: string
      metaOverride?: string
    },
  ) => {
    clearReview()
    const parsed = new Chess()
    parsed.loadPgn(pgnText)
    const headers = parsed.getHeaders()
    const customStartFen =
      headers.SetUp === '1' && headers.FEN ? headers.FEN : DEFAULT_POSITION

    const verboseMoves = parsed.history({ verbose: true })
    const importedMoves: StoredMove[] = verboseMoves.map((m) => ({
      from: m.from,
      to: m.to,
      san: m.san,
      promotion: m.promotion,
    }))

    setStartFen(customStartFen)
    setMoves(importedMoves)
    setViewIndex(0)
    if (opts?.orientation) {
      setOrientation(opts.orientation)
    }
    setPlayers({
      white:
        headers.White && headers.White !== '?'
          ? headers.White
          : opts?.fallbackWhite ?? DEFAULT_PLAYERS.white,
      black:
        headers.Black && headers.Black !== '?'
          ? headers.Black
          : opts?.fallbackBlack ?? DEFAULT_PLAYERS.black,
    })

    if (opts?.metaOverride) {
      setGameMeta(opts.metaOverride)
    } else {
      const metaParts = [headers.Event, headers.Date?.slice(0, 4)].filter(
        (v) => v && v !== '?' && v !== '????',
      )
      setGameMeta(metaParts.length > 0 ? metaParts.join(' • ') : 'Ván đấu PGN')
    }

    setPendingPromotion(null)
    setSelectedSquare(null)

    if (opts?.autoReview && importedMoves.length > 0) {
      void startGameReview(customStartFen, importedMoves)
    }
  }

  const handleImportPgn = (pgnText: string, autoReview = false) => {
    loadPgnInternal(pgnText, { autoReview })
  }

  const handleImportOnlineGame = (game: OnlineGameSummary) => {
    const platformLabel = game.platform === 'chesscom' ? 'Chess.com' : 'Lichess'
    const meta = [platformLabel, game.timeControl.toUpperCase(), game.dateLabel]
      .filter(Boolean)
      .join(' • ')

    loadPgnInternal(game.pgn, {
      autoReview: true,
      orientation: game.userColor,
      fallbackWhite: game.whiteName,
      fallbackBlack: game.blackName,
      metaOverride: meta,
    })
  }

  const jumpToPly = (ply: number) => {
    const clamped = Math.max(0, Math.min(moves.length, ply))
    if (clamped !== viewIndex && soundEnabled) {
      chessSounds.play('move')
    }
    setViewIndex(clamped)
    setShowBestMoveHint(false)
    setSelectedSquare(null)
    setPendingPromotion(null)
  }

  const handleCopy = async (type: 'fen' | 'pgn') => {
    try {
      const text =
        type === 'fen'
          ? fen
          : buildGameAtPly(startFen, moves, moves.length).pgn()
      await navigator.clipboard.writeText(text)
      setCopiedType(type)
      setTimeout(() => setCopiedType(null), 1500)
    } catch {
      // Ignore clipboard errors in restricted environments
    }
  }

  const playUciMoveIfValid = (uci: string | null, atPly?: number) => {
    const parsed = parseUciMove(uci)
    if (!parsed) return
    const targetPly = atPly ?? viewIndex
    if (atPly === undefined && isGameOver) return
    commitMove(parsed.from, parsed.to, parsed.promotion, targetPly)
  }

  const topColor: 'w' | 'b' = orientation === 'w' ? 'b' : 'w'
  const bottomColor: 'w' | 'b' = orientation
  const isReviewingEarlier = viewIndex < moves.length

  return (
    <div className="flex min-h-screen flex-col bg-[#1a1917] text-stone-200">
      {/* Clean, friendly top navigation bar */}
      <header className="border-b border-white/[0.07] bg-[#24221f]/95 backdrop-blur-sm">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-3 px-4 py-3">
          <div className="flex items-center gap-3">
            <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-[#81b64c] text-xl font-black text-[#161512] shadow-sm">
              ♞
            </div>
            <div>
              <h1 className="text-base leading-tight font-bold tracking-tight text-white">
                JustChess
              </h1>
              <p className="text-xs text-stone-400">
                {gameMeta ?? 'Chơi cờ & Phân tích thông minh'}
              </p>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2.5">
            {/* Primary unified Import CTA */}
            <button
              type="button"
              onClick={() => setImportModalTab('online')}
              className="flex items-center gap-1.5 rounded-lg bg-[#81b64c] px-3.5 py-2 text-xs font-bold text-[#161512] shadow-sm transition hover:bg-[#95c75d]"
            >
              <span>+ Tải ván / Thế cờ</span>
            </button>

            {/* Compact Theme Swatches */}
            <div
              className="flex items-center gap-1 rounded-lg bg-[#1a1917] p-1 ring-1 ring-white/[0.08]"
              role="group"
              aria-label="Chọn màu bàn cờ"
            >
              {(Object.keys(BOARD_THEMES) as BoardThemeId[]).map((id) => {
                const t = BOARD_THEMES[id]
                const active = id === themeId
                return (
                  <button
                    key={id}
                    type="button"
                    onClick={() => setThemeId(id)}
                    title={`Màu bàn cờ: ${t.name}`}
                    aria-label={t.name}
                    className={[
                      'flex items-center gap-1.5 rounded-md px-2 py-1.5 text-xs font-medium transition',
                      active
                        ? 'bg-[#34312d] text-white shadow-xs ring-1 ring-white/10'
                        : 'text-stone-400 hover:text-stone-200',
                    ].join(' ')}
                  >
                    <span className="grid h-4 w-4 grid-cols-2 overflow-hidden rounded-[3px] ring-1 ring-black/40">
                      <span style={{ backgroundColor: t.light }} />
                      <span style={{ backgroundColor: t.dark }} />
                      <span style={{ backgroundColor: t.dark }} />
                      <span style={{ backgroundColor: t.light }} />
                    </span>
                    <span className="hidden lg:inline">{t.name}</span>
                  </button>
                )
              })}
            </div>

            {/* Sound toggle */}
            <button
              type="button"
              onClick={() => setSoundEnabled((prev) => !prev)}
              title={soundEnabled ? 'Tắt âm thanh' : 'Bật âm thanh'}
              aria-label={soundEnabled ? 'Tắt âm thanh' : 'Bật âm thanh'}
              className={[
                'flex h-9 w-9 items-center justify-center rounded-lg text-sm ring-1 transition',
                soundEnabled
                  ? 'bg-[#2e2c28] text-stone-100 ring-white/10 hover:bg-[#3d3a36]'
                  : 'bg-[#1a1917] text-stone-500 ring-white/5 hover:text-stone-300',
              ].join(' ')}
            >
              {soundEnabled ? '🔊' : '🔇'}
            </button>
          </div>
        </div>
      </header>

      {/* Main Arena */}
      <main className="mx-auto grid w-full max-w-6xl flex-1 items-start gap-7 px-4 py-6 lg:grid-cols-[minmax(0,636px)_390px] lg:justify-center">
        {/* Left column: Evaluation Bar + Player Bars + Chessboard */}
        <section className="flex flex-col items-center gap-3">
          {/* Top PlayerBar aligned with chessboard */}
          <div className="flex w-full max-w-[636px] gap-2.5">
            <div className="w-6 shrink-0 sm:w-7" aria-hidden="true" />
            <div className="min-w-0 flex-1">
              <PlayerBar
                name={topColor === 'w' ? players.white : players.black}
                color={topColor}
                isTurn={!isGameOver && turn === topColor}
                isInCheck={displayGame.inCheck() && turn === topColor}
                capturedPieces={
                  topColor === 'w'
                    ? material.capturedByWhite
                    : material.capturedByBlack
                }
                materialAdvantage={
                  topColor === 'w'
                    ? material.whiteAdvantage
                    : material.blackAdvantage
                }
              />
            </div>
          </div>

          {/* Evaluation Bar + Chessboard row */}
          <div className="flex w-full max-w-[636px] items-stretch gap-2.5">
            <EvaluationBar
              evaluation={activeEvalForBar}
              orientation={orientation}
              enabled={engineEnabled}
            />
            <div className="min-w-0 flex-1">
              <ChessBoard
                board={board}
                fenKey={fen}
                turn={turn}
                orientation={orientation}
                theme={theme}
                selectedSquare={selectedSquare}
                legalTargets={legalTargets}
                lastMove={lastMove}
                moveBadge={activeMoveBadge}
                engineArrows={engineArrows}
                checkedKingSquare={checkedKingSquare}
                pendingPromotion={pendingPromotion}
                onSquareSelect={handleSquareSelect}
                onMoveAttempt={tryMove}
                onSelectPromotion={handleSelectPromotion}
                onCancelPromotion={() => setPendingPromotion(null)}
              />
            </div>
          </div>

          {/* Bottom PlayerBar aligned with chessboard */}
          <div className="flex w-full max-w-[636px] gap-2.5">
            <div className="w-6 shrink-0 sm:w-7" aria-hidden="true" />
            <div className="min-w-0 flex-1">
              <PlayerBar
                name={bottomColor === 'w' ? players.white : players.black}
                color={bottomColor}
                isTurn={!isGameOver && turn === bottomColor}
                isInCheck={displayGame.inCheck() && turn === bottomColor}
                capturedPieces={
                  bottomColor === 'w'
                    ? material.capturedByWhite
                    : material.capturedByBlack
                }
                materialAdvantage={
                  bottomColor === 'w'
                    ? material.whiteAdvantage
                    : material.blackAdvantage
                }
              />
            </div>
          </div>

          {/* Friendly subtle interaction hint */}
          <div className="flex w-full max-w-[636px] flex-wrap items-center justify-between gap-2 pl-8 text-[11px] text-stone-500 sm:pl-9">
            <span>
              Chuột phải: đánh dấu ô / kéo vẽ mũi tên (
              <kbd className="rounded bg-white/5 px-1 text-stone-400">
                Shift
              </kbd>{' '}
              <kbd className="rounded bg-white/5 px-1 text-stone-400">Alt</kbd>{' '}
              <kbd className="rounded bg-white/5 px-1 text-stone-400">Ctrl</kbd>
              )
            </span>
            <span>
              Phím{' '}
              <kbd className="rounded bg-white/5 px-1 text-stone-400">←</kbd>{' '}
              <kbd className="rounded bg-white/5 px-1 text-stone-400">→</kbd>{' '}
              tua nước đi
            </span>
          </div>
        </section>

        {/* Right column: Spacious 3-Tab Sidebar */}
        <aside className="flex w-full flex-col overflow-hidden rounded-2xl bg-[#262421] shadow-2xl ring-1 ring-white/[0.08] lg:h-[736px]">
          {/* Status Header */}
          <div
            className={[
              'flex items-center justify-between gap-2 border-b border-white/[0.07] px-4 py-3 text-sm font-bold',
              status.tone === 'over'
                ? 'bg-[#81b64c]/18 text-[#b4e07c]'
                : status.tone === 'check'
                  ? 'bg-red-500/18 text-red-300'
                  : 'bg-[#2c2a26] text-stone-100',
            ].join(' ')}
          >
            <span className="truncate">{status.text}</span>
            {moves.length > 0 && (
              <span className="shrink-0 rounded-md bg-black/30 px-2.5 py-0.5 font-mono text-xs text-stone-300">
                Nước {viewIndex}/{moves.length}
              </span>
            )}
          </div>

          {/* 3 Clear Sidebar Tabs */}
          <div className="grid grid-cols-3 gap-1 border-b border-white/[0.07] bg-[#1e1c1a] p-1.5">
            <button
              type="button"
              onClick={() => setSidebarTab('game')}
              className={[
                'rounded-lg py-2 text-xs font-semibold transition',
                sidebarTab === 'game'
                  ? 'bg-[#34312d] text-white shadow-xs'
                  : 'text-stone-400 hover:text-stone-200',
              ].join(' ')}
            >
              ♟ Ván đấu
            </button>
            <button
              type="button"
              onClick={() => setSidebarTab('review')}
              className={[
                'flex items-center justify-center gap-1.5 rounded-lg py-2 text-xs font-semibold transition',
                sidebarTab === 'review'
                  ? 'bg-[#34312d] text-white shadow-xs'
                  : 'text-stone-400 hover:text-stone-200',
              ].join(' ')}
            >
              <span>📊 Đánh giá</span>
              {reviewResult && (
                <span className="h-2 w-2 rounded-full bg-[#81b64c]" />
              )}
            </button>
            <button
              type="button"
              onClick={() => setSidebarTab('engine')}
              className={[
                'flex items-center justify-center gap-1.5 rounded-lg py-2 text-xs font-semibold transition',
                sidebarTab === 'engine'
                  ? 'bg-[#34312d] text-white shadow-xs'
                  : 'text-stone-400 hover:text-stone-200',
              ].join(' ')}
            >
              <span>🧠 Engine</span>
              {engineEnabled && (
                <span className="h-1.5 w-1.5 rounded-full bg-emerald-400" />
              )}
            </button>
          </div>

          {/* TAB 1: VÁN ĐẤU (Clean Move List + Live Move Feedback + Quick Review CTA) */}
          {sidebarTab === 'game' && (
            <div className="flex min-h-0 flex-1 flex-col">
              {/* Live instant feedback strip for the move just played */}
              {liveMoveCtx && liveMoveVerdict && (
                <div
                  className="border-b border-white/[0.07] px-4 py-2.5"
                  style={{
                    backgroundColor:
                      CLASSIFICATION_META[liveMoveVerdict.classification].bg,
                  }}
                >
                  <div className="flex items-center gap-2 text-xs">
                    <span
                      className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-[10px] font-black"
                      style={{
                        backgroundColor:
                          CLASSIFICATION_META[liveMoveVerdict.classification]
                            .color,
                        color:
                          CLASSIFICATION_META[liveMoveVerdict.classification]
                            .badgeText,
                      }}
                    >
                      {
                        CLASSIFICATION_META[liveMoveVerdict.classification]
                          .symbol
                      }
                    </span>
                    <span className="font-mono font-bold text-white">
                      {liveMoveCtx.san}
                    </span>
                    <span
                      className="font-bold"
                      style={{
                        color:
                          CLASSIFICATION_META[liveMoveVerdict.classification]
                            .color,
                      }}
                    >
                      {
                        CLASSIFICATION_META[liveMoveVerdict.classification]
                          .label
                      }
                    </span>
                  </div>
                  <p className="mt-1 text-xs leading-relaxed text-stone-200">
                    {liveMoveVerdict.commentary}
                  </p>
                </div>
              )}

              {/* Compact 1-line Quick Engine Bar */}
              {engineEnabled && !isGameOver && (
                <div className="flex items-center justify-between gap-2 border-b border-white/[0.06] bg-[#1f1d1a] px-4 py-2 text-xs">
                  <div className="flex items-center gap-2">
                    <span className="rounded bg-[#2e2c28] px-2 py-0.5 font-mono text-xs font-bold text-[#a3d160]">
                      {formatEvaluationScore(activeEvalForBar)}
                    </span>
                    <span className="text-stone-400">
                      {ENGINE_MODES.find((m) => m.id === engineMode)?.label}
                    </span>
                  </div>
                  {activeEvalForBar.bestMove && (
                    <button
                      type="button"
                      onClick={() =>
                        playUciMoveIfValid(activeEvalForBar.bestMove)
                      }
                      className="rounded-md bg-[#2e2c28] px-2.5 py-1 font-mono text-xs font-semibold text-stone-100 transition hover:bg-[#3d3a36]"
                    >
                      Gợi ý:{' '}
                      {uciLineToSan(fen, [activeEvalForBar.bestMove], 1)}
                    </button>
                  )}
                </div>
              )}

              {/* Reviewing earlier ply banner */}
              {isReviewingEarlier && (
                <div className="flex items-center justify-between border-b border-amber-500/20 bg-amber-500/10 px-4 py-1.5 text-xs text-amber-300">
                  <span>
                    Đang xem lại nước {viewIndex}/{moves.length}
                  </span>
                  <button
                    type="button"
                    onClick={() => jumpToPly(moves.length)}
                    className="font-semibold underline hover:text-amber-200"
                  >
                    Tới nước cuối
                  </button>
                </div>
              )}

              {/* Spacious 2-column Move List */}
              <div className="min-h-52 flex-1 overflow-y-auto px-3 py-2.5">
                {moveRows.length === 0 ? (
                  <div className="flex h-full flex-col items-center justify-center gap-3 py-10 text-center">
                    <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-white/[0.04] text-2xl">
                      ♟
                    </div>
                    <div>
                      <p className="text-sm font-bold text-stone-200">
                        Sẵn sàng bắt đầu ván mới
                      </p>
                      <p className="mt-1 max-w-[260px] text-xs leading-relaxed text-stone-400">
                        Kéo thả hoặc nhấp chọn quân Trắng để đi, hoặc tải ván đấu
                        có sẵn để phân tích.
                      </p>
                    </div>
                    <div className="mt-1 flex flex-wrap justify-center gap-2">
                      <button
                        type="button"
                        onClick={() => setImportModalTab('online')}
                        className="rounded-lg bg-[#81b64c] px-3.5 py-2 text-xs font-bold text-[#161512] transition hover:bg-[#95c75d]"
                      >
                        🔍 Tìm ván Lichess / Chess.com
                      </button>
                      <button
                        type="button"
                        onClick={() => setImportModalTab('pgn')}
                        className="rounded-lg bg-[#34312d] px-3.5 py-2 text-xs font-semibold text-stone-200 transition hover:bg-[#423f3a]"
                      >
                        Dán PGN / FEN
                      </button>
                    </div>
                  </div>
                ) : (
                  <div className="font-mono text-sm">
                    {moveRows.map((row, idx) => {
                      const whiteReview = row.white
                        ? reviewMoveMap.get(row.white.ply)
                        : undefined
                      const blackReview = row.black
                        ? reviewMoveMap.get(row.black.ply)
                        : undefined

                      return (
                        <div
                          key={`${row.moveNumber}-${idx}`}
                          className={[
                            'grid grid-cols-[42px_1fr_1fr] items-center rounded-lg px-2 py-0.5',
                            idx % 2 === 1 ? 'bg-white/[0.025]' : '',
                          ].join(' ')}
                        >
                          <span className="text-xs text-stone-500">
                            {row.moveNumber}.
                          </span>

                          {row.white ? (
                            <button
                              ref={
                                viewIndex === row.white.ply
                                  ? activeMoveRef
                                  : null
                              }
                              type="button"
                              onClick={() => jumpToPly(row.white!.ply)}
                              className={[
                                'flex items-center justify-between gap-1 rounded-md px-2.5 py-1.5 text-left font-medium transition',
                                viewIndex === row.white.ply
                                  ? 'bg-[#81b64c]/30 text-[#dcf7b7]'
                                  : 'text-stone-100 hover:bg-white/10',
                              ].join(' ')}
                            >
                              <span>{row.white.san}</span>
                              {whiteReview &&
                                whiteReview.classification !== 'good' && (
                                  <span
                                    title={
                                      CLASSIFICATION_META[
                                        whiteReview.classification
                                      ].label
                                    }
                                    style={{
                                      color:
                                        CLASSIFICATION_META[
                                          whiteReview.classification
                                        ].color,
                                    }}
                                    className="text-xs font-black"
                                  >
                                    {
                                      CLASSIFICATION_META[
                                        whiteReview.classification
                                      ].symbol
                                    }
                                  </span>
                                )}
                            </button>
                          ) : (
                            <span className="px-2.5 py-1.5 text-stone-600">
                              ...
                            </span>
                          )}

                          {row.black ? (
                            <button
                              ref={
                                viewIndex === row.black.ply
                                  ? activeMoveRef
                                  : null
                              }
                              type="button"
                              onClick={() => jumpToPly(row.black!.ply)}
                              className={[
                                'flex items-center justify-between gap-1 rounded-md px-2.5 py-1.5 text-left font-medium transition',
                                viewIndex === row.black.ply
                                  ? 'bg-[#81b64c]/30 text-[#dcf7b7]'
                                  : 'text-stone-300 hover:bg-white/10',
                              ].join(' ')}
                            >
                              <span>{row.black.san}</span>
                              {blackReview &&
                                blackReview.classification !== 'good' && (
                                  <span
                                    title={
                                      CLASSIFICATION_META[
                                        blackReview.classification
                                      ].label
                                    }
                                    style={{
                                      color:
                                        CLASSIFICATION_META[
                                          blackReview.classification
                                        ].color,
                                    }}
                                    className="text-xs font-black"
                                  >
                                    {
                                      CLASSIFICATION_META[
                                        blackReview.classification
                                      ].symbol
                                    }
                                  </span>
                                )}
                            </button>
                          ) : (
                            <span />
                          )}
                        </div>
                      )
                    })}
                  </div>
                )}
              </div>

              {/* Quick Game Review banner when game has moves but not yet reviewed */}
              {moves.length >= 2 && !reviewResult && !reviewProgress && (
                <div className="border-t border-white/[0.06] bg-[#1f1d1a] px-4 py-2.5">
                  <button
                    type="button"
                    onClick={() => void startGameReview()}
                    className="w-full rounded-lg bg-[#81b64c]/18 py-2 text-xs font-bold text-[#b4e07c] ring-1 ring-[#81b64c]/35 transition hover:bg-[#81b64c]/28"
                  >
                    📊 Chấm điểm toàn ván (Game Review)
                  </button>
                </div>
              )}
            </div>
          )}

          {/* TAB 2: ĐÁNH GIÁ (Chess.com-style Game Review) */}
          {sidebarTab === 'review' &&
            (reviewProgress ? (
              <div className="flex flex-1 flex-col items-center justify-center gap-3 px-6 py-10 text-center">
                <div className="text-4xl">🎓</div>
                <div className="text-sm font-bold text-white">
                  Stockfish 19 đang chấm điểm ván đấu...
                </div>
                <p className="text-xs text-stone-400">
                  Đang phân tích nước {reviewProgress.completed} /{' '}
                  {reviewProgress.total}
                </p>
                <div className="h-2.5 w-full max-w-[260px] overflow-hidden rounded-full bg-[#34312d]">
                  <div
                    className="h-full bg-[#81b64c] transition-[width] duration-200"
                    style={{
                      width: `${Math.round((reviewProgress.completed / Math.max(1, reviewProgress.total)) * 100)}%`,
                    }}
                  />
                </div>
                <button
                  type="button"
                  onClick={cancelReview}
                  className="mt-1 rounded-lg bg-[#34312d] px-4 py-2 text-xs font-semibold text-stone-200 hover:bg-[#423f3a]"
                >
                  Hủy phân tích
                </button>
              </div>
            ) : reviewResult ? (
              <GameReviewPanel
                review={reviewResult}
                whiteName={players.white}
                blackName={players.black}
                currentPly={viewIndex}
                totalPlies={moves.length}
                showBestMoveHint={showBestMoveHint}
                onToggleBestMoveHint={() =>
                  setShowBestMoveHint((prev) => !prev)
                }
                onSelectPly={jumpToPly}
                onPlayBestMove={(uci, atPly) => playUciMoveIfValid(uci, atPly)}
                onReRunReview={() => void startGameReview()}
              />
            ) : (
              <div className="flex flex-1 flex-col items-center justify-center gap-3.5 px-6 py-10 text-center">
                <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-[#81b64c]/15 text-3xl ring-1 ring-[#81b64c]/30">
                  🎓
                </div>
                <div>
                  <h3 className="text-sm font-bold text-white">
                    Game Review kiểu Chess.com
                  </h3>
                  <p className="mt-1.5 text-xs leading-relaxed text-stone-400">
                    Chấm điểm Accuracy %, Elo ước tính, gắn huy hiệu{' '}
                    <span className="font-bold text-[#1baca6]">!!</span>{' '}
                    <span className="font-bold text-[#81b64c]">★</span>{' '}
                    <span className="font-bold text-[#e6912c]">?</span>{' '}
                    <span className="font-bold text-[#ca3431]">??</span> trực tiếp
                    trên bàn cờ và HLV nhận xét từng nước đi.
                  </p>
                </div>

                {moves.length > 0 ? (
                  <button
                    type="button"
                    onClick={() => void startGameReview()}
                    className="rounded-lg bg-[#81b64c] px-5 py-2.5 text-xs font-bold text-[#161512] shadow-md transition hover:bg-[#95c75d]"
                  >
                    📊 Bắt đầu Game Review ({moves.length} nước)
                  </button>
                ) : (
                  <div className="flex flex-wrap justify-center gap-2">
                    <button
                      type="button"
                      onClick={() => setImportModalTab('online')}
                      className="rounded-lg bg-[#81b64c] px-3.5 py-2 text-xs font-bold text-[#161512] transition hover:bg-[#95c75d]"
                    >
                      🔍 Tải ván Lichess / Chess.com
                    </button>
                    <button
                      type="button"
                      onClick={() => setImportModalTab('pgn')}
                      className="rounded-lg bg-[#34312d] px-3.5 py-2 text-xs font-semibold text-stone-200 transition hover:bg-[#423f3a]"
                    >
                      Dán PGN
                    </button>
                  </div>
                )}

                {reviewError && (
                  <p className="text-xs text-red-400">{reviewError}</p>
                )}
              </div>
            ))}

          {/* TAB 3: ĐA ENGINE (Dedicated Spacious Analysis Lab) */}
          {sidebarTab === 'engine' && (
            <div className="flex flex-1 flex-col gap-3.5 overflow-y-auto p-4">
              <div className="flex items-center justify-between gap-2 rounded-xl bg-[#1f1d1a] px-3.5 py-2.5 ring-1 ring-white/[0.06]">
                <div className="flex items-center gap-2">
                  <span
                    className={[
                      'h-2.5 w-2.5 rounded-full',
                      !engineEnabled
                        ? 'bg-stone-600'
                        : sfEvaluation.error && needsStockfish
                          ? 'bg-red-500'
                          : sfEvaluation.isSearching && needsStockfish
                            ? 'animate-pulse bg-amber-400'
                            : 'bg-[#81b64c]',
                    ].join(' ')}
                  />
                  <span className="text-xs font-bold text-stone-100">
                    Trạng thái Engine
                  </span>
                </div>

                <div className="flex items-center gap-2">
                  {engineEnabled && (
                    <button
                      type="button"
                      onClick={() => setShowBestMoveArrow((prev) => !prev)}
                      className={[
                        'rounded-md px-2.5 py-1 text-xs font-semibold transition',
                        showBestMoveArrow
                          ? 'bg-[#81b64c]/20 text-[#b4e07c]'
                          : 'bg-[#302e2b] text-stone-400 hover:text-stone-200',
                      ].join(' ')}
                    >
                      ↗ Mũi tên
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={() => setEngineEnabled((prev) => !prev)}
                    className={[
                      'rounded-md px-3 py-1 text-xs font-bold transition',
                      engineEnabled
                        ? 'bg-[#81b64c] text-[#161512]'
                        : 'bg-[#302e2b] text-stone-300 hover:bg-[#3d3a36]',
                    ].join(' ')}
                  >
                    {engineEnabled ? 'Đang bật' : 'Đang tắt'}
                  </button>
                </div>
              </div>

              {engineEnabled && (
                <>
                  {/* Engine Mode Cards */}
                  <div className="grid grid-cols-2 gap-2">
                    {ENGINE_MODES.map((m) => (
                      <button
                        key={m.id}
                        type="button"
                        onClick={() => setEngineMode(m.id)}
                        className={[
                          'flex flex-col items-start rounded-xl px-3 py-2 text-left transition',
                          engineMode === m.id
                            ? 'bg-[#34312d] text-white shadow-sm ring-1 ring-[#81b64c]/60'
                            : 'bg-[#1f1d1a] text-stone-300 ring-1 ring-white/[0.05] hover:bg-[#2c2a26]',
                        ].join(' ')}
                      >
                        <span className="text-xs font-bold">{m.label}</span>
                        <span className="mt-0.5 text-[10px] text-stone-400">
                          {m.desc}
                        </span>
                      </button>
                    ))}
                  </div>

                  {/* Engine Output Area */}
                  <div className="flex flex-col gap-2 rounded-xl bg-[#1f1d1a] p-3 ring-1 ring-white/[0.06]">
                    {sfEvaluation.error && needsStockfish ? (
                      <span className="text-xs text-red-400">
                        {sfEvaluation.error}
                      </span>
                    ) : isGameOver ? (
                      <span className="text-xs text-stone-400">
                        Ván đấu đã kết thúc.
                      </span>
                    ) : (
                      <>
                        {/* Stockfish 19 MultiPV lines */}
                        {engineMode === 'stockfish' && (
                          <div className="flex flex-col gap-1.5">
                            {sfEvaluation.lines.length === 0 ? (
                              <span className="text-xs text-stone-400">
                                {sfEvaluation.isReady
                                  ? 'Stockfish 19 đang tính toán...'
                                  : 'Đang tải Stockfish WASM...'}
                              </span>
                            ) : (
                              sfEvaluation.lines.map((line) => (
                                <button
                                  key={line.multipv}
                                  type="button"
                                  onClick={() =>
                                    playUciMoveIfValid(line.pv[0] ?? null)
                                  }
                                  title="Nhấp để đi nước đầu tiên của nhánh này"
                                  className="flex items-center gap-2.5 rounded-lg bg-[#2a2824] px-2.5 py-2 text-left transition hover:bg-[#36332e]"
                                >
                                  <span className="w-12 shrink-0 rounded bg-[#1a1917] py-1 text-center font-mono text-xs font-bold text-[#a3d160]">
                                    {formatEvaluationScore(line)}
                                  </span>
                                  <span className="truncate font-mono text-xs text-stone-200">
                                    {uciLineToSan(fen, line.pv, 5)}
                                  </span>
                                  <span className="ml-auto shrink-0 font-mono text-[10px] text-stone-500">
                                    d{line.depth}
                                  </span>
                                </button>
                              ))
                            )}
                          </div>
                        )}

                        {/* Lichess Cloud Eval */}
                        {engineMode === 'cloud' && (
                          <div className="flex flex-col gap-1.5">
                            {isCloudLoading ? (
                              <span className="text-xs text-stone-400">
                                Đang tra cứu Lichess Cloud Eval...
                              </span>
                            ) : cloudError ? (
                              <span className="text-xs text-red-400">
                                {cloudError}
                              </span>
                            ) : !activeCloudResult ? (
                              <div className="text-xs leading-relaxed text-stone-400">
                                Thế cờ này chưa có trong bộ nhớ Cloud của
                                Lichess. Chuyển sang{' '}
                                <button
                                  type="button"
                                  onClick={() => setEngineMode('stockfish')}
                                  className="font-semibold text-[#a3d160] underline"
                                >
                                  Stockfish 19
                                </button>{' '}
                                để phân tích cục bộ.
                              </div>
                            ) : (
                              <>
                                <div className="flex items-center justify-between text-[11px] text-stone-400">
                                  <span>
                                    Lichess Cloud • Depth{' '}
                                    <strong className="text-cyan-400">
                                      {activeCloudResult.depth}
                                    </strong>
                                  </span>
                                  <span className="font-mono">
                                    {Math.round(
                                      activeCloudResult.knodes / 1000,
                                    )}
                                    M nodes
                                  </span>
                                </div>
                                {activeCloudResult.lines.map((line, idx) => (
                                  <button
                                    key={idx}
                                    type="button"
                                    onClick={() =>
                                      playUciMoveIfValid(line.moves[0] ?? null)
                                    }
                                    className="flex items-center gap-2.5 rounded-lg bg-[#2a2824] px-2.5 py-2 text-left transition hover:bg-[#36332e]"
                                  >
                                    <span className="w-12 shrink-0 rounded bg-[#1a1917] py-1 text-center font-mono text-xs font-bold text-cyan-400">
                                      {formatEvaluationScore(line)}
                                    </span>
                                    <span className="truncate font-mono text-xs text-stone-200">
                                      {uciLineToSan(fen, line.moves, 5)}
                                    </span>
                                  </button>
                                ))}
                              </>
                            )}
                          </div>
                        )}

                        {/* Single local worker engine output */}
                        {(engineMode === 'classical' ||
                          engineMode === 'aggressive' ||
                          engineMode === 'jschess') &&
                          (activeSingleLocalResult ? (
                            <div className="flex flex-col gap-2">
                              <div className="flex items-center justify-between gap-2">
                                <div className="flex items-center gap-2">
                                  <span
                                    className={[
                                      'rounded bg-[#1a1917] px-2.5 py-1 font-mono text-xs font-bold',
                                      engineMode === 'aggressive'
                                        ? 'text-orange-400'
                                        : engineMode === 'jschess'
                                          ? 'text-purple-400'
                                          : 'text-sky-400',
                                    ].join(' ')}
                                  >
                                    {formatEvaluationScore(
                                      activeSingleLocalResult,
                                    )}
                                  </span>
                                  <span className="text-xs text-stone-400">
                                    Depth {activeSingleLocalResult.depth}
                                  </span>
                                </div>
                                {activeSingleLocalResult.bestMoveSan && (
                                  <button
                                    type="button"
                                    onClick={() =>
                                      playUciMoveIfValid(
                                        activeSingleLocalResult.bestMove,
                                      )
                                    }
                                    className="rounded-lg bg-[#34312d] px-3 py-1 font-mono text-xs font-bold text-stone-100 transition hover:bg-[#423f3a]"
                                  >
                                    Đi {activeSingleLocalResult.bestMoveSan}
                                  </button>
                                )}
                              </div>
                              {activeSingleLocalResult.insights.map((note) => (
                                <p
                                  key={note}
                                  className="text-xs leading-relaxed text-stone-300"
                                >
                                  • {note}
                                </p>
                              ))}
                            </div>
                          ) : (
                            <span className="text-xs text-stone-400">
                              Đang tính toán trên Web Worker...
                            </span>
                          ))}

                        {/* Compare 3 Engines side-by-side */}
                        {engineMode === 'compare' && (
                          <div className="flex flex-col gap-2">
                            <div className="flex items-center justify-between gap-2 rounded-lg bg-[#2a2824] px-3 py-2">
                              <div className="flex items-center gap-2">
                                <span className="h-3 w-3 rounded-full bg-green-600" />
                                <span className="text-xs font-semibold text-stone-100">
                                  Stockfish 19
                                </span>
                                <span className="font-mono text-[11px] text-stone-500">
                                  d{sfEvaluation.depth}
                                </span>
                              </div>
                              <div className="flex items-center gap-2">
                                <span className="font-mono text-xs font-bold text-[#a3d160]">
                                  {formatEvaluationScore(sfEvaluation)}
                                </span>
                                {sfEvaluation.bestMove && (
                                  <button
                                    type="button"
                                    onClick={() =>
                                      playUciMoveIfValid(sfEvaluation.bestMove)
                                    }
                                    className="rounded bg-[#34312d] px-2 py-0.5 font-mono text-xs font-semibold text-stone-100 hover:bg-[#423f3a]"
                                  >
                                    {uciLineToSan(
                                      fen,
                                      [sfEvaluation.bestMove],
                                      1,
                                    )}
                                  </button>
                                )}
                              </div>
                            </div>

                            <div className="flex items-center justify-between gap-2 rounded-lg bg-[#2a2824] px-3 py-2">
                              <div className="flex items-center gap-2">
                                <span className="h-3 w-3 rounded-full bg-blue-500" />
                                <span className="text-xs font-semibold text-stone-100">
                                  PeSTO Cổ điển
                                </span>
                                <span className="font-mono text-[11px] text-stone-500">
                                  d3
                                </span>
                              </div>
                              <div className="flex items-center gap-2">
                                <span className="font-mono text-xs font-bold text-sky-400">
                                  {classicalResult
                                    ? formatEvaluationScore(classicalResult)
                                    : '...'}
                                </span>
                                {classicalResult?.bestMoveSan && (
                                  <button
                                    type="button"
                                    onClick={() =>
                                      playUciMoveIfValid(
                                        classicalResult.bestMove,
                                      )
                                    }
                                    className="rounded bg-[#34312d] px-2 py-0.5 font-mono text-xs font-semibold text-stone-100 hover:bg-[#423f3a]"
                                  >
                                    {classicalResult.bestMoveSan}
                                  </button>
                                )}
                              </div>
                            </div>

                            <div className="flex items-center justify-between gap-2 rounded-lg bg-[#2a2824] px-3 py-2">
                              <div className="flex items-center gap-2">
                                <span className="h-3 w-3 rounded-full bg-purple-500" />
                                <span className="text-xs font-semibold text-stone-100">
                                  js-chess-engine
                                </span>
                                <span className="font-mono text-[11px] text-stone-500">
                                  MIT
                                </span>
                              </div>
                              <div className="flex items-center gap-2">
                                <span className="font-mono text-xs font-bold text-purple-400">
                                  {jsChessResult
                                    ? formatEvaluationScore(jsChessResult)
                                    : '...'}
                                </span>
                                {jsChessResult?.bestMoveSan && (
                                  <button
                                    type="button"
                                    onClick={() =>
                                      playUciMoveIfValid(jsChessResult.bestMove)
                                    }
                                    className="rounded bg-[#34312d] px-2 py-0.5 font-mono text-xs font-semibold text-stone-100 hover:bg-[#423f3a]"
                                  >
                                    {jsChessResult.bestMoveSan}
                                  </button>
                                )}
                              </div>
                            </div>
                          </div>
                        )}
                      </>
                    )}
                  </div>
                </>
              )}
            </div>
          )}

          {/* Large, Easy-to-Click Replay Navigation Bar */}
          <div className="grid grid-cols-4 gap-1.5 border-t border-white/[0.07] bg-[#1e1c1a] px-3.5 py-2.5">
            <button
              type="button"
              onClick={() => jumpToPly(0)}
              disabled={viewIndex === 0}
              title="Về đầu ván (Home)"
              aria-label="Về đầu ván"
              className="rounded-lg bg-[#2d2b27] py-2 text-sm font-bold text-stone-200 transition hover:bg-[#3d3a36] disabled:opacity-35"
            >
              ⏮
            </button>
            <button
              type="button"
              onClick={() => jumpToPly(viewIndex - 1)}
              disabled={viewIndex === 0}
              title="Nước trước (←)"
              aria-label="Nước trước"
              className="rounded-lg bg-[#2d2b27] py-2 text-sm font-bold text-stone-200 transition hover:bg-[#3d3a36] disabled:opacity-35"
            >
              ◀
            </button>
            <button
              type="button"
              onClick={() => jumpToPly(viewIndex + 1)}
              disabled={viewIndex >= moves.length}
              title="Nước sau (→)"
              aria-label="Nước sau"
              className="rounded-lg bg-[#2d2b27] py-2 text-sm font-bold text-stone-200 transition hover:bg-[#3d3a36] disabled:opacity-35"
            >
              ▶
            </button>
            <button
              type="button"
              onClick={() => jumpToPly(moves.length)}
              disabled={viewIndex >= moves.length}
              title="Về nước cuối (End)"
              aria-label="Về nước cuối"
              className="rounded-lg bg-[#2d2b27] py-2 text-sm font-bold text-stone-200 transition hover:bg-[#3d3a36] disabled:opacity-35"
            >
              ⏭
            </button>
          </div>

          {/* Primary Action Controls & Clean Copy Row */}
          <div className="border-t border-white/[0.07] bg-[#22201d] p-3.5">
            <div className="grid grid-cols-3 gap-2">
              <button
                type="button"
                onClick={() =>
                  setOrientation((prev) => (prev === 'w' ? 'b' : 'w'))
                }
                className="rounded-lg bg-[#32302c] px-3 py-2.5 text-xs font-semibold text-stone-100 transition hover:bg-[#403d38]"
              >
                ⇅ Xoay bàn
              </button>
              <button
                type="button"
                onClick={handleUndo}
                disabled={viewIndex === 0}
                className="rounded-lg bg-[#32302c] px-3 py-2.5 text-xs font-semibold text-stone-100 transition hover:bg-[#403d38] disabled:opacity-35"
              >
                ↶ Hoàn tác
              </button>
              <button
                type="button"
                onClick={handleReset}
                className="rounded-lg bg-[#81b64c] px-3 py-2.5 text-xs font-bold text-[#161512] shadow-xs transition hover:bg-[#95c75d]"
              >
                ↻ Ván mới
              </button>
            </div>

            <div className="mt-2.5 grid grid-cols-2 gap-2">
              <button
                type="button"
                onClick={() => handleCopy('fen')}
                title={fen}
                className="rounded-lg bg-[#1a1917] py-1.5 text-xs font-medium text-stone-400 ring-1 ring-white/[0.06] transition hover:bg-[#2c2a26] hover:text-stone-200"
              >
                {copiedType === 'fen' ? '✓ Đã sao chép FEN' : '📋 Sao chép FEN'}
              </button>
              <button
                type="button"
                onClick={() => handleCopy('pgn')}
                disabled={moves.length === 0}
                className="rounded-lg bg-[#1a1917] py-1.5 text-xs font-medium text-stone-400 ring-1 ring-white/[0.06] transition hover:bg-[#2c2a26] hover:text-stone-200 disabled:opacity-35"
              >
                {copiedType === 'pgn' ? '✓ Đã sao chép PGN' : '📋 Sao chép PGN'}
              </button>
            </div>
          </div>
        </aside>
      </main>

      {/* Legal & Open-Source Attribution Footer (GPL-3.0 compliance) */}
      <footer className="border-t border-white/[0.06] bg-[#1e1c1a] px-4 py-3 text-center text-[11px] text-stone-500">
        JustChess • Giấy phép{' '}
        <span className="font-medium text-stone-400">GPL-3.0-or-later</span> •
        Engine: Stockfish 19 (GPL-3.0), js-chess-engine (MIT), chess.js
        (BSD-2-Clause) • Dự án độc lập, không liên kết chính thức với Lichess
        hay Chess.com.
      </footer>

      {/* Import Online / PGN / FEN Modal */}
      {importModalTab !== null && (
        <ImportModal
          initialTab={importModalTab}
          currentFen={fen}
          onImportFen={handleImportFen}
          onImportPgn={handleImportPgn}
          onImportOnlineGame={handleImportOnlineGame}
          onClose={() => setImportModalTab(null)}
        />
      )}
    </div>
  )
}

export default App
