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
import {
  BotTabIcon,
  CopyIcon,
  EngineTabIcon,
  FirstMoveIcon,
  FlipIcon,
  GameTabIcon,
  LastMoveIcon,
  NextMoveIcon,
  PrevMoveIcon,
  ResetIcon,
  ReviewTabIcon,
  UndoIcon,
  UploadIcon,
  VolumeOffIcon,
  VolumeOnIcon,
} from './components/Icons'
import { ImportModal, type ImportTab } from './components/ImportModal'
import { PlayerBar } from './components/PlayerBar'
import {
  BOT_PRESETS,
  getStockfishBotMove,
  type BotPresetId,
} from './engine/botService'
import {
  CLASSIFICATION_META,
  classifyLiveMove,
  detectTimeControl,
  REVIEW_ENGINES,
  runFullGameReview,
  type GameOutcome,
  type GameReviewResult,
  type ReviewEngineId,
  type ReviewMoveInfo,
  type TimeControlCategory,
} from './engine/gameReview'
import {
  fetchLichessCloudEval,
  type LichessCloudEvalResult,
} from './engine/lichessCloudEval'
import type {
  MaiaInferenceResult,
  MaiaWorkerRequest,
  MaiaWorkerResponse,
} from './engine/maiaWorker'
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
import { chessSounds, getSoundForSan } from './utils/chessSounds'
import {
  CLASSIFICATION_LABEL,
  getInitialLanguage,
  saveLanguage,
  type Language,
} from './utils/i18n'
import {
  fetchOnlinePlayerProfile,
  type OnlineGameSummary,
} from './utils/onlineGamesApi'

type EngineMode = 'stockfish' | 'maia' | 'cloud' | 'compare'

type SidebarTab = 'game' | 'bot' | 'review' | 'engine'

const MAIA_ELO_LEVELS = [1100, 1300, 1500, 1700, 1900] as const
type MaiaEloLevel = (typeof MAIA_ELO_LEVELS)[number]

interface StoredMove {
  from: Square
  to: Square
  san: string
  promotion?: PieceSymbol
}

interface VariationBranch {
  /** Mainline ply where this variation branches off */
  branchPly: number
  moves: StoredMove[]
  /** Current ply inside variation (1 .. moves.length) */
  cursor: number
}

interface PlayerInfo {
  name: string
  title?: string
  rating?: number
  fideRating?: number
}

interface PlayersState {
  white: PlayerInfo
  black: PlayerInfo
}

const DEFAULT_PLAYERS: PlayersState = {
  white: { name: 'Quân Trắng' },
  black: { name: 'Quân Đen' },
}

const ENGINE_DEPTH = 12

const ENGINE_MODES: Array<{ id: EngineMode; label: string; desc: string }> = [
  {
    id: 'stockfish',
    label: 'Stockfish 19',
    desc: '~3600+ Elo • NNUE WASM Local',
  },
  {
    id: 'maia',
    label: 'Maia Chess',
    desc: 'Mô phỏng người thật 1100–1900',
  },
  {
    id: 'cloud',
    label: 'Lichess Cloud',
    desc: 'Stockfish Cloud depth 30–60+',
  },
  {
    id: 'compare',
    label: 'SF19 vs Maia',
    desc: 'So sánh Máy tối ưu vs Người thật',
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
  lang: Language = 'vi',
): { text: string; tone: 'normal' | 'check' | 'over' } {
  const isEn = lang === 'en'
  if (game.isCheckmate()) {
    const winner =
      game.turn() === 'w'
        ? isEn
          ? 'Black'
          : 'Đen'
        : isEn
          ? 'White'
          : 'Trắng'
    return {
      text: isEn
        ? `Checkmate • ${winner} wins`
        : `Chiếu hết • Quân ${winner} thắng`,
      tone: 'over',
    }
  }
  if (game.isStalemate()) {
    return { text: isEn ? 'Draw • Stalemate' : 'Hòa cờ • Stalemate', tone: 'over' }
  }
  if (game.isThreefoldRepetition()) {
    return {
      text: isEn ? 'Draw • Threefold Repetition' : 'Hòa cờ • Lặp nước 3 lần',
      tone: 'over',
    }
  }
  if (game.isInsufficientMaterial()) {
    return {
      text: isEn
        ? 'Draw • Insufficient Material'
        : 'Hòa cờ • Không đủ lực lượng',
      tone: 'over',
    }
  }
  if (game.isDraw()) return { text: isEn ? 'Draw' : 'Hòa cờ', tone: 'over' }

  const turnLabel =
    game.turn() === 'w'
      ? isEn
        ? 'White'
        : 'Trắng'
      : isEn
        ? 'Black'
        : 'Đen'
  if (game.inCheck()) {
    return {
      text: isEn
        ? `${turnLabel} to move • Check!`
        : `Lượt ${turnLabel} • Đang bị chiếu!`,
      tone: 'check',
    }
  }
  return {
    text: isEn ? `${turnLabel} to move` : `Lượt của quân ${turnLabel}`,
    tone: 'normal',
  }
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

const SESSION_STORAGE_KEY = 'justchess-session-v1'

interface SavedSession {
  startFen: string
  moves: StoredMove[]
  viewIndex: number
  players: PlayersState
  gameMeta: string | null
  sourcePlatform: 'chesscom' | 'lichess' | 'unknown'
  pgnResult: GameOutcome
  orientation: 'w' | 'b'
  themeId: BoardThemeId
  soundEnabled: boolean
  sidebarTab: SidebarTab
  reviewEngine: ReviewEngineId
  timeControl: TimeControlCategory
  reviewResult: GameReviewResult | null
}

function loadSavedSession(): Partial<SavedSession> {
  if (typeof window === 'undefined') return {}
  try {
    const raw = window.localStorage.getItem(SESSION_STORAGE_KEY)
    if (!raw) return {}
    const parsed = JSON.parse(raw) as Partial<SavedSession>
    if (!parsed || typeof parsed !== 'object') return {}

    // Verify startFen & moves are legally replayable so corrupt cache never crashes the app
    const safeStartFen =
      typeof parsed.startFen === 'string' && parsed.startFen.trim().length > 0
        ? parsed.startFen
        : DEFAULT_POSITION
    const safeMoves = Array.isArray(parsed.moves) ? parsed.moves : []
    buildGameAtPly(safeStartFen, safeMoves, safeMoves.length)

    const safeViewIndex =
      typeof parsed.viewIndex === 'number'
        ? Math.max(0, Math.min(safeMoves.length, parsed.viewIndex))
        : safeMoves.length

    const safeReview =
      parsed.reviewResult &&
      Array.isArray(parsed.reviewResult.moves) &&
      parsed.reviewResult.moves.length === safeMoves.length
        ? parsed.reviewResult
        : null

    return {
      ...parsed,
      startFen: safeStartFen,
      moves: safeMoves,
      viewIndex: safeViewIndex,
      reviewResult: safeReview,
    }
  } catch {
    return {}
  }
}

const INITIAL_SESSION = loadSavedSession()

export function App() {
  const [startFen, setStartFen] = useState<string>(
    INITIAL_SESSION.startFen ?? DEFAULT_POSITION,
  )
  const [moves, setMoves] = useState<StoredMove[]>(INITIAL_SESSION.moves ?? [])
  const [viewIndex, setViewIndex] = useState<number>(
    INITIAL_SESSION.viewIndex ?? 0,
  )
  const [variation, setVariation] = useState<VariationBranch | null>(null)
  const [players, setPlayers] = useState<PlayersState>(
    INITIAL_SESSION.players ?? DEFAULT_PLAYERS,
  )
  const [gameMeta, setGameMeta] = useState<string | null>(
    INITIAL_SESSION.gameMeta ?? null,
  )
  const [sourcePlatform, setSourcePlatform] = useState<
    'chesscom' | 'lichess' | 'unknown'
  >(INITIAL_SESSION.sourcePlatform ?? 'unknown')
  const [pgnResult, setPgnResult] = useState<GameOutcome>(
    INITIAL_SESSION.pgnResult ?? null,
  )

  const [selectedSquare, setSelectedSquare] = useState<Square | null>(null)
  const [orientation, setOrientation] = useState<'w' | 'b'>(
    INITIAL_SESSION.orientation ?? 'w',
  )
  const [themeId, setThemeId] = useState<BoardThemeId>(
    INITIAL_SESSION.themeId && INITIAL_SESSION.themeId in BOARD_THEMES
      ? INITIAL_SESSION.themeId
      : 'chesscom',
  )
  const [soundEnabled, setSoundEnabled] = useState<boolean>(
    INITIAL_SESSION.soundEnabled ?? true,
  )
  const [pendingPromotion, setPendingPromotion] =
    useState<PendingPromotion | null>(null)
  const [importModalTab, setImportModalTab] = useState<ImportTab | null>(null)
  const [copiedType, setCopiedType] = useState<'fen' | 'pgn' | null>(null)
  const [lang, setLang] = useState<Language>(getInitialLanguage)
  const isEn = lang === 'en'

  const handleToggleLanguage = () => {
    setLang((prev) => {
      const next: Language = prev === 'vi' ? 'en' : 'vi'
      saveLanguage(next)
      return next
    })
  }

  // Multi-Engine state
  const [engineEnabled, setEngineEnabled] = useState<boolean>(true)
  const [engineMode, setEngineMode] = useState<EngineMode>('stockfish')
  const [showBestMoveArrow, setShowBestMoveArrow] = useState<boolean>(true)
  const [sfEvaluation, setSfEvaluation] =
    useState<EngineEvaluation>(INITIAL_EVALUATION)
  // Maia-3 ONNX Human-like Engine state
  const [maiaElo, setMaiaElo] = useState<MaiaEloLevel>(1500)
  const [maiaStatus, setMaiaStatus] = useState<
    'idle' | 'downloading' | 'loading' | 'ready' | 'error'
  >('idle')
  const [maiaProgress, setMaiaProgress] = useState<number>(0)
  const [maiaError, setMaiaError] = useState<string | null>(null)
  const [maiaState, setMaiaState] = useState<{
    fen: string
    elo: number
    data: MaiaInferenceResult
  } | null>(null)
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
  const maiaWorkerRef = useRef<Worker | null>(null)
  const maiaReqIdRef = useRef<number>(0)

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

  // Play vs Bot state
  const [botActive, setBotActive] = useState<boolean>(false)
  const [botPresetId, setBotPresetId] = useState<BotPresetId>('sf-1500')
  const [playerSide, setPlayerSide] = useState<'w' | 'b'>('w')
  const [botThinking, setBotThinking] = useState<boolean>(false)
  const botAbortRef = useRef<AbortController | null>(null)
  const botMaiaCallbackRef = useRef<((uci: string | null) => void) | null>(null)
  const botMaiaReqIdRef = useRef<number | null>(null)

  // Full Game Review state (Chess.com-style Coach, Scorecard, Badges & Win-Rate Graph)
  const [sidebarTab, setSidebarTab] = useState<SidebarTab>(
    INITIAL_SESSION.sidebarTab ?? 'game',
  )
  const [reviewEngine, setReviewEngine] = useState<ReviewEngineId>(
    INITIAL_SESSION.reviewEngine ?? 'stockfish-12',
  )
  const [timeControl, setTimeControl] = useState<TimeControlCategory>(
    INITIAL_SESSION.timeControl ?? 'rapid',
  )
  const [showBestMoveHint, setShowBestMoveHint] = useState<boolean>(false)
  const [reviewResult, setReviewResult] = useState<GameReviewResult | null>(
    INITIAL_SESSION.reviewResult ?? null,
  )
  const [reviewProgress, setReviewProgress] = useState<{
    completed: number
    total: number
  } | null>(null)
  const [reviewError, setReviewError] = useState<string | null>(null)
  const reviewAbortRef = useRef<AbortController | null>(null)

  // Auto-save active game, PGN/FEN, review result & preferences to localStorage
  useEffect(() => {
    const timer = window.setTimeout(() => {
      try {
        const payload: SavedSession = {
          startFen,
          moves,
          viewIndex,
          players,
          gameMeta,
          sourcePlatform,
          pgnResult,
          orientation,
          themeId,
          soundEnabled,
          sidebarTab,
          reviewEngine,
          timeControl,
          reviewResult,
        }
        window.localStorage.setItem(
          SESSION_STORAGE_KEY,
          JSON.stringify(payload),
        )
      } catch {
        // Ignore quota / private browsing errors
      }
    }, 150)
    return () => window.clearTimeout(timer)
  }, [
    startFen,
    moves,
    viewIndex,
    players,
    gameMeta,
    sourcePlatform,
    pgnResult,
    orientation,
    themeId,
    soundEnabled,
    sidebarTab,
    reviewEngine,
    timeControl,
    reviewResult,
  ])

  const activeMoveRef = useRef<HTMLButtonElement>(null)
  const moveListContainerRef = useRef<HTMLDivElement>(null)

  const displayGame = useMemo(() => {
    if (variation) {
      const combined = [
        ...moves.slice(0, variation.branchPly),
        ...variation.moves.slice(0, variation.cursor),
      ]
      return buildGameAtPly(startFen, combined, combined.length)
    }
    return buildGameAtPly(startFen, moves, viewIndex)
  }, [startFen, moves, viewIndex, variation])
  const fen = displayGame.fen()
  const isCheckmate = displayGame.isCheckmate()
  const isGameOver = displayGame.isGameOver()
  const theme = BOARD_THEMES[themeId]
  const board = displayGame.board()
  const turn = displayGame.turn()
  const status = getGameStatus(displayGame, lang)
  const checkedKingSquare = findCheckedKingSquare(displayGame)
  const material = getMaterialSummary(displayGame)

  const lastMove: LastMove | null = variation
    ? variation.cursor > 0
      ? {
          from: variation.moves[variation.cursor - 1].from,
          to: variation.moves[variation.cursor - 1].to,
        }
      : null
    : viewIndex > 0
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
    !variation && viewIndex > 0 ? reviewMoveMap.get(viewIndex) ?? null : null

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
      lang,
    })
  })()

  const activeMoveBadge: BoardMoveBadge | null = currentReviewMove
    ? {
        square: currentReviewMove.to,
        symbol: CLASSIFICATION_META[currentReviewMove.classification].symbol,
        color: CLASSIFICATION_META[currentReviewMove.classification].color,
        textColor:
          CLASSIFICATION_META[currentReviewMove.classification].badgeText,
        label: CLASSIFICATION_LABEL[lang][currentReviewMove.classification],
      }
    : liveMoveCtx && liveMoveVerdict
      ? {
          square: liveMoveCtx.to,
          symbol: CLASSIFICATION_META[liveMoveVerdict.classification].symbol,
          color: CLASSIFICATION_META[liveMoveVerdict.classification].color,
          textColor:
            CLASSIFICATION_META[liveMoveVerdict.classification].badgeText,
          label: `${liveMoveCtx.san} — ${CLASSIFICATION_LABEL[lang][liveMoveVerdict.classification]}`,
        }
      : null

  const needsStockfish =
    engineEnabled &&
    !isGameOver &&
    reviewProgress === null &&
    (engineMode === 'stockfish' ||
      engineMode === 'compare' ||
      (liveMoveCtx !== null && liveMoveCtx.fenAfter === fen))

  // Lifecycle: preload sounds + start Stockfish 19 Worker once (Maia Worker is lazy-loaded on demand)
  useEffect(() => {
    chessSounds.preloadAll()
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

    return () => {
      service.destroy()
      engineRef.current = null
      maiaWorkerRef.current?.terminate()
      maiaWorkerRef.current = null
      reviewAbortRef.current?.abort()
      botAbortRef.current?.abort()
    }
  }, [])

  // Lazy-start Maia-3 ONNX Worker ONLY when the user visits Bots tab or selects Maia/Compare mode
  const needsMaiaWorker =
    sidebarTab === 'bot' ||
    engineMode === 'maia' ||
    engineMode === 'compare' ||
    (botActive && botPresetId.startsWith('maia'))

  useEffect(() => {
    if (!needsMaiaWorker || maiaWorkerRef.current) return
    const maiaWorker = new Worker(
      new URL('./engine/maiaWorker.ts', import.meta.url),
      { type: 'module' },
    )
    maiaWorker.onmessage = (event: MessageEvent<MaiaWorkerResponse>) => {
      const msg = event.data
      if (msg.type === 'status') {
        setMaiaStatus(msg.status)
        if (msg.error) setMaiaError(msg.error)
        else if (msg.status === 'ready') setMaiaError(null)
      } else if (msg.type === 'progress') {
        setMaiaProgress(msg.percent)
      } else if (msg.type === 'result') {
        if (
          botMaiaReqIdRef.current !== null &&
          msg.id === botMaiaReqIdRef.current
        ) {
          botMaiaReqIdRef.current = null
          const cb = botMaiaCallbackRef.current
          botMaiaCallbackRef.current = null
          const top = msg.data.topMoves
          let chosen = msg.data.bestMove
          if (top.length >= 2) {
            const r = Math.random()
            if (
              r > top[0].probability &&
              r <= top[0].probability + top[1].probability
            ) {
              chosen = top[1].uci
            }
          }
          cb?.(chosen)
          return
        }
        if (msg.id === maiaReqIdRef.current) {
          setMaiaState({ fen: msg.fen, elo: msg.elo, data: msg.data })
        }
      } else if (msg.type === 'error') {
        if (
          botMaiaReqIdRef.current !== null &&
          msg.id === botMaiaReqIdRef.current
        ) {
          botMaiaReqIdRef.current = null
          botMaiaCallbackRef.current?.(null)
          botMaiaCallbackRef.current = null
        }
        setMaiaError(msg.message)
      }
    }
    const initMsg: MaiaWorkerRequest = { type: 'init' }
    maiaWorker.postMessage(initMsg)
    maiaWorkerRef.current = maiaWorker
  }, [needsMaiaWorker])

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

  // Run Maia-3 ONNX inference in Web Worker when model is ready and Maia/Compare is active
  useEffect(() => {
    const worker = maiaWorkerRef.current
    if (
      !worker ||
      !engineEnabled ||
      isGameOver ||
      maiaStatus !== 'ready' ||
      (engineMode !== 'maia' && engineMode !== 'compare')
    ) {
      return
    }

    const timer = window.setTimeout(() => {
      const nextId = maiaReqIdRef.current + 1
      maiaReqIdRef.current = nextId
      const req: MaiaWorkerRequest = {
        type: 'analyze',
        id: nextId,
        fen,
        elo: maiaElo,
      }
      worker.postMessage(req)
    }, 55)

    return () => window.clearTimeout(timer)
  }, [fen, engineEnabled, engineMode, isGameOver, maiaStatus, maiaElo])

  const activeBotPreset =
    BOT_PRESETS.find((b) => b.id === botPresetId) ?? BOT_PRESETS[0]
  const botColor: 'w' | 'b' = playerSide === 'w' ? 'b' : 'w'
  const isBotsTurn =
    botActive &&
    !isGameOver &&
    !variation &&
    viewIndex === moves.length &&
    turn === botColor

  // Automatic Bot Move Loop
  useEffect(() => {
    if (!isBotsTurn) return

    const controller = new AbortController()
    botAbortRef.current = controller

    const timer = window.setTimeout(() => {
      setBotThinking(true)

      const finishBotMove = (uci: string | null) => {
        if (controller.signal.aborted) return
        setBotThinking(false)
        const parsed = parseUciMove(uci)
        if (!parsed) return

        const nextGame = buildGameAtPly(startFen, moves, moves.length)
        const executed = nextGame.move({
          from: parsed.from,
          to: parsed.to,
          promotion: parsed.promotion,
        })
        if (soundEnabled) playSoundForMove(executed, nextGame)

        const updated: StoredMove[] = [
          ...moves,
          {
            from: executed.from,
            to: executed.to,
            san: executed.san,
            promotion: executed.promotion,
          },
        ]
        setMoves(updated)
        setViewIndex(updated.length)
        setSelectedSquare(null)
        setPendingPromotion(null)
      }

      if (activeBotPreset.engine === 'maia') {
        if (maiaStatus !== 'ready' || !maiaWorkerRef.current) {
          setBotThinking(false)
          return
        }
        const reqId = Date.now()
        botMaiaReqIdRef.current = reqId
        botMaiaCallbackRef.current = finishBotMove
        const req: MaiaWorkerRequest = {
          type: 'analyze',
          id: reqId,
          fen,
          elo: activeBotPreset.maiaElo ?? 1500,
        }
        maiaWorkerRef.current.postMessage(req)
      } else {
        void getStockfishBotMove(
          fen,
          activeBotPreset.skillLevel ?? 6,
          activeBotPreset.depth ?? 6,
          controller.signal,
        )
          .then(finishBotMove)
          .catch(() => {
            if (!controller.signal.aborted) setBotThinking(false)
          })
      }
    }, 340)

    return () => {
      window.clearTimeout(timer)
      controller.abort()
      botMaiaReqIdRef.current = null
      botMaiaCallbackRef.current = null
      setBotThinking(false)
    }
  }, [
    isBotsTurn,
    fen,
    startFen,
    moves,
    activeBotPreset,
    maiaStatus,
    soundEnabled,
  ])

  const startBotMatch = (
    presetId: BotPresetId = botPresetId,
    side: 'w' | 'b' = playerSide,
  ) => {
    const preset = BOT_PRESETS.find((b) => b.id === presetId) ?? BOT_PRESETS[0]
    if (preset.engine === 'maia' && maiaStatus !== 'ready') {
      if (maiaStatus === 'idle' || maiaStatus === 'error') {
        triggerMaiaDownload()
      }
      return
    }

    botAbortRef.current?.abort()
    clearReview()
    setVariation(null)
    setLiveMoveCtx(null)
    setStartFen(DEFAULT_POSITION)
    setMoves([])
    setViewIndex(0)
    setOrientation(side)
    setBotPresetId(presetId)
    setPlayerSide(side)
    setBotActive(true)
    setSidebarTab('game')

    const botInfo: PlayerInfo = {
      name: `🤖 ${preset.name}`,
      title: 'BOT',
      rating: Number.parseInt(preset.eloLabel.replace(/\D/g, ''), 10) || undefined,
    }
    const humanInfo: PlayerInfo = { name: 'Bạn' }
    setPlayers(
      side === 'w'
        ? { white: humanInfo, black: botInfo }
        : { white: botInfo, black: humanInfo },
    )
    setGameMeta(`Đấu với ${preset.name} (${preset.eloLabel})`)
    setSelectedSquare(null)
    setPendingPromotion(null)
  }

  const stopBotMatch = () => {
    botAbortRef.current?.abort()
    setBotActive(false)
    setBotThinking(false)
  }

  const triggerMaiaDownload = () => {
    setMaiaError(null)
    const req: MaiaWorkerRequest = { type: 'download' }
    maiaWorkerRef.current?.postMessage(req)
  }

  const activeMaiaResult: MaiaInferenceResult | null =
    maiaState && maiaState.fen === fen && maiaState.elo === maiaElo
      ? maiaState.data
      : null
  const activeCloudResult =
    cloudState.fen === fen ? cloudState.result : null
  const isCloudLoading = cloudState.fen === fen && cloudState.loading
  const cloudError = cloudState.fen === fen ? cloudState.error : null

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
    // Keep EvaluationBar 100% in sync with Game Review eval when stepping through a reviewed game
    if (
      currentReviewMove &&
      !variation &&
      sidebarTab === 'review'
    ) {
      return {
        ...INITIAL_EVALUATION,
        cp: currentReviewMove.cp,
        mate: currentReviewMove.mate,
        depth: reviewEngine === 'stockfish-16' ? 16 : 12,
        targetDepth: reviewEngine === 'stockfish-16' ? 16 : 12,
        bestMove: currentReviewMove.bestMoveBefore,
        pv: [],
        isSearching: false,
        isReady: true,
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
    if (engineMode === 'maia' && activeMaiaResult) {
      // Convert Maia White win% (0–100) to approximate centipawn scale for EvaluationBar
      const p = Math.max(0.01, Math.min(0.99, activeMaiaResult.whiteWinPercent / 100))
      const approxCp = Math.round(Math.log(p / (1 - p)) / 0.00368208)
      return {
        ...INITIAL_EVALUATION,
        cp: approxCp,
        mate: null,
        depth: 1,
        targetDepth: 1,
        bestMove: activeMaiaResult.bestMove,
        pv: activeMaiaResult.bestMove ? [activeMaiaResult.bestMove] : [],
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
    if (engineMode === 'maia' || engineMode === 'compare') {
      pushUnique(activeMaiaResult?.bestMove ?? null, '#c026d3', 0.8) // Fuchsia/Purple: Maia Human Move
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

  // Keep active move visible ONLY inside the move list container (never scroll the page/window on mobile)
  useEffect(() => {
    const container = moveListContainerRef.current
    const activeEl = activeMoveRef.current
    if (!container || !activeEl) return

    const containerRect = container.getBoundingClientRect()
    const itemRect = activeEl.getBoundingClientRect()
    const padding = 8

    if (itemRect.top < containerRect.top + padding) {
      container.scrollTop -= containerRect.top + padding - itemRect.top
    } else if (itemRect.bottom > containerRect.bottom - padding) {
      container.scrollTop += itemRect.bottom - (containerRect.bottom - padding)
    }
  }, [viewIndex])

  // Keyboard navigation for replay (ArrowLeft / ArrowRight / ArrowUp / ArrowDown / Home / End)
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
        if (variation) {
          if (variation.cursor <= 1) {
            setViewIndex(variation.branchPly)
            setVariation(null)
            if (soundEnabled) {
              chessSounds.play(
                variation.branchPly > 0
                  ? getSoundForSan(moves[variation.branchPly - 1]?.san)
                  : 'move',
              )
            }
          } else {
            const nextCursor = variation.cursor - 1
            setVariation({ ...variation, cursor: nextCursor })
            if (soundEnabled) {
              chessSounds.play(getSoundForSan(variation.moves[nextCursor - 1]?.san))
            }
          }
        } else {
          setViewIndex((prev) => {
            const next = Math.max(0, prev - 1)
            if (next !== prev && soundEnabled) {
              chessSounds.play(
                next > 0 ? getSoundForSan(moves[next - 1]?.san) : 'move',
              )
            }
            return next
          })
        }
        setShowBestMoveHint(false)
        setSelectedSquare(null)
        setPendingPromotion(null)
      } else if (e.key === 'ArrowRight') {
        e.preventDefault()
        if (variation) {
          if (variation.cursor < variation.moves.length) {
            const nextCursor = variation.cursor + 1
            setVariation({ ...variation, cursor: nextCursor })
            if (soundEnabled) {
              chessSounds.play(getSoundForSan(variation.moves[nextCursor - 1]?.san))
            }
          }
        } else {
          setViewIndex((prev) => {
            const next = Math.min(moves.length, prev + 1)
            if (next !== prev && soundEnabled) {
              chessSounds.play(getSoundForSan(moves[next - 1]?.san))
            }
            return next
          })
        }
        setShowBestMoveHint(false)
        setSelectedSquare(null)
        setPendingPromotion(null)
      } else if (e.key === 'Home' || e.key === 'ArrowUp') {
        e.preventDefault()
        if (variation) {
          setViewIndex(variation.branchPly)
          setVariation(null)
          if (soundEnabled) chessSounds.play('move')
        } else {
          setViewIndex((prev) => {
            if (prev !== 0 && soundEnabled) chessSounds.play('move')
            return 0
          })
        }
        setShowBestMoveHint(false)
        setSelectedSquare(null)
        setPendingPromotion(null)
      } else if (e.key === 'End' || e.key === 'ArrowDown') {
        e.preventDefault()
        if (variation) {
          if (variation.cursor !== variation.moves.length) {
            setVariation({ ...variation, cursor: variation.moves.length })
            if (soundEnabled) {
              chessSounds.play(
                getSoundForSan(variation.moves[variation.moves.length - 1]?.san),
              )
            }
          }
        } else {
          setViewIndex((prev) => {
            if (prev !== moves.length && soundEnabled) {
              chessSounds.play(getSoundForSan(moves[moves.length - 1]?.san))
            }
            return moves.length
          })
        }
        setShowBestMoveHint(false)
        setSelectedSquare(null)
        setPendingPromotion(null)
      }
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [importModalTab, moves, soundEnabled, variation])

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
    engineId: ReviewEngineId = reviewEngine,
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
      let lastProgressUiMs = 0
      const result = await runFullGameReview(targetStartFen, targetMoves, {
        engineId,
        lang,
        signal: controller.signal,
        onProgress: (completed, total) => {
          const now = performance.now()
          if (completed >= total || now - lastProgressUiMs >= 65) {
            lastProgressUiMs = now
            setReviewProgress({ completed, total })
          }
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
          : isEn
            ? 'Could not complete full game review.'
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
    atPly?: number,
  ) => {
    // 1. If already inside a variation (and not jumping to a specific mainline ply), extend variation
    if (variation && atPly === undefined) {
      const prefix = [
        ...moves.slice(0, variation.branchPly),
        ...variation.moves.slice(0, variation.cursor),
      ]
      const nextGame = buildGameAtPly(startFen, prefix, prefix.length)
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
      const nextVarMoves: StoredMove[] = [
        ...variation.moves.slice(0, variation.cursor),
        {
          from: executed.from,
          to: executed.to,
          san: executed.san,
          promotion: executed.promotion,
        },
      ]

      if (soundEnabled) playSoundForMove(executed, nextGame)

      setVariation({
        branchPly: variation.branchPly,
        moves: nextVarMoves,
        cursor: nextVarMoves.length,
      })
      setLiveMoveCtx({
        fenAfter: nextGame.fen(),
        fenBefore,
        ply: variation.branchPly + nextVarMoves.length,
        to: executed.to,
        uci: `${executed.from}${executed.to}${executed.promotion ?? ''}`,
        san: executed.san,
        color: moverColor,
        isCheckmate: nextGame.isCheckmate(),
        before: beforeSnapshot,
      })
      setSelectedSquare(null)
      setPendingPromotion(null)
      return
    }

    const targetPly = atPly ?? viewIndex
    const nextGame = buildGameAtPly(startFen, moves, targetPly)
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
    const newMove: StoredMove = {
      from: executed.from,
      to: executed.to,
      san: executed.san,
      promotion: executed.promotion,
    }

    if (soundEnabled) {
      playSoundForMove(executed, nextGame)
    }

    // 2. If user played the exact next mainline move while reviewing, simply step forward along mainline
    const existingNext = moves[targetPly]
    if (
      existingNext &&
      existingNext.from === newMove.from &&
      existingNext.to === newMove.to &&
      (existingNext.promotion ?? undefined) === (newMove.promotion ?? undefined)
    ) {
      setVariation(null)
      setViewIndex(targetPly + 1)
      setShowBestMoveHint(false)
      setSelectedSquare(null)
      setPendingPromotion(null)
      return
    }

    // 3. Branch non-destructively into a variation when exploring earlier in the game,
    //    when Game Review is active, or when trying a suggested Coach move
    const shouldBranch =
      targetPly < moves.length ||
      reviewResult !== null ||
      atPly !== undefined

    if (shouldBranch) {
      setVariation({
        branchPly: targetPly,
        moves: [newMove],
        cursor: 1,
      })
      setShowBestMoveHint(false)
      setLiveMoveCtx({
        fenAfter,
        fenBefore,
        ply: targetPly + 1,
        to: executed.to,
        uci: `${executed.from}${executed.to}${executed.promotion ?? ''}`,
        san: executed.san,
        color: moverColor,
        isCheckmate: nextGame.isCheckmate(),
        before: beforeSnapshot,
      })
      setSelectedSquare(null)
      setPendingPromotion(null)
      return
    }

    // 4. Normal live play at the end of mainline
    const updatedMoves: StoredMove[] = [...moves, newMove]
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
    if (isGameOver || isBotsTurn || botThinking) return

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
    if (isGameOver || pendingPromotion || isBotsTurn || botThinking) return

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
    if (variation) {
      if (variation.cursor <= 1) {
        setViewIndex(variation.branchPly)
        setVariation(null)
      } else {
        const nextVarMoves = variation.moves.slice(0, variation.cursor - 1)
        setVariation({
          branchPly: variation.branchPly,
          moves: nextVarMoves,
          cursor: nextVarMoves.length,
        })
      }
      setPendingPromotion(null)
      setSelectedSquare(null)
      if (soundEnabled) chessSounds.play('move')
      return
    }

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
    botAbortRef.current?.abort()
    setBotActive(false)
    setBotThinking(false)
    clearReview()
    setVariation(null)
    setLiveMoveCtx(null)
    setStartFen(DEFAULT_POSITION)
    setMoves([])
    setViewIndex(0)
    setPlayers(DEFAULT_PLAYERS)
    setGameMeta(null)
    setSourcePlatform('unknown')
    setPgnResult(null)
    setPendingPromotion(null)
    setSelectedSquare(null)
  }

  const handleImportFen = (loadedFen: string) => {
    botAbortRef.current?.abort()
    setBotActive(false)
    setBotThinking(false)
    clearReview()
    setVariation(null)
    setLiveMoveCtx(null)
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
      whiteTitle?: string
      blackTitle?: string
      whiteRating?: number
      blackRating?: number
      metaOverride?: string
      explicitTimeControl?: string
      explicitResult?: '1-0' | '0-1' | '1/2-1/2' | '*'
      platform?: 'chesscom' | 'lichess' | 'unknown'
    },
  ) => {
    botAbortRef.current?.abort()
    setBotActive(false)
    setBotThinking(false)
    clearReview()
    const parsed = new Chess()
    parsed.loadPgn(pgnText)
    const headers = parsed.getHeaders()
    setTimeControl(detectTimeControl(headers, opts?.explicitTimeControl))
    const siteStr = (headers.Site ?? '').toLowerCase()
    setSourcePlatform(
      opts?.platform ??
        (siteStr.includes('lichess')
          ? 'lichess'
          : siteStr.includes('chess.com')
            ? 'chesscom'
            : 'unknown'),
    )
    const rawRes = opts?.explicitResult ?? headers.Result
    setPgnResult(
      rawRes === '1-0' || rawRes === '0-1' || rawRes === '1/2-1/2'
        ? rawRes
        : null,
    )
    const customStartFen =
      headers.SetUp === '1' && headers.FEN ? headers.FEN : DEFAULT_POSITION

    const verboseMoves = parsed.history({ verbose: true })
    const importedMoves: StoredMove[] = verboseMoves.map((m) => ({
      from: m.from,
      to: m.to,
      san: m.san,
      promotion: m.promotion,
    }))

    setVariation(null)
    setLiveMoveCtx(null)
    setStartFen(customStartFen)
    setMoves(importedMoves)
    setViewIndex(0)
    if (opts?.orientation) {
      setOrientation(opts.orientation)
    }
    const parseElo = (raw?: string): number | undefined => {
      if (!raw) return undefined
      const n = Number.parseInt(raw, 10)
      return Number.isNaN(n) || n <= 0 ? undefined : n
    }

    const whiteName =
      headers.White && headers.White !== '?'
        ? headers.White
        : opts?.fallbackWhite ?? DEFAULT_PLAYERS.white.name
    const blackName =
      headers.Black && headers.Black !== '?'
        ? headers.Black
        : opts?.fallbackBlack ?? DEFAULT_PLAYERS.black.name

    setPlayers({
      white: {
        name: whiteName,
        title: headers.WhiteTitle || opts?.whiteTitle,
        rating: parseElo(headers.WhiteElo) ?? opts?.whiteRating,
      },
      black: {
        name: blackName,
        title: headers.BlackTitle || opts?.blackTitle,
        rating: parseElo(headers.BlackElo) ?? opts?.blackRating,
      },
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
      whiteTitle: game.whiteTitle,
      blackTitle: game.blackTitle,
      whiteRating: game.whiteRating,
      blackRating: game.blackRating,
      metaOverride: meta,
      explicitTimeControl: game.timeControl,
      explicitResult: game.result,
      platform: game.platform,
    })

    // Enrich both players asynchronously with official Title & FIDE rating from platform profile API
    void Promise.all([
      fetchOnlinePlayerProfile(game.platform, game.whiteName),
      fetchOnlinePlayerProfile(game.platform, game.blackName),
    ]).then(([whiteProfile, blackProfile]) => {
      setPlayers((prev) => ({
        white:
          prev.white.name.toLowerCase() === game.whiteName.toLowerCase()
            ? {
                ...prev.white,
                title: prev.white.title ?? whiteProfile?.title,
                fideRating: whiteProfile?.fideRating ?? prev.white.fideRating,
              }
            : prev.white,
        black:
          prev.black.name.toLowerCase() === game.blackName.toLowerCase()
            ? {
                ...prev.black,
                title: prev.black.title ?? blackProfile?.title,
                fideRating: blackProfile?.fideRating ?? prev.black.fideRating,
              }
            : prev.black,
      }))
    })
  }

  const jumpToPly = (ply: number) => {
    const clamped = Math.max(0, Math.min(moves.length, ply))
    if ((clamped !== viewIndex || variation !== null) && soundEnabled) {
      chessSounds.play(
        clamped > 0 ? getSoundForSan(moves[clamped - 1]?.san) : 'move',
      )
    }
    setVariation(null)
    setViewIndex(clamped)
    setShowBestMoveHint(false)
    setSelectedSquare(null)
    setPendingPromotion(null)
  }

  const exitVariation = () => {
    if (!variation) return
    setViewIndex(variation.branchPly)
    setVariation(null)
    setSelectedSquare(null)
    setPendingPromotion(null)
    if (soundEnabled) {
      chessSounds.play(
        variation.branchPly > 0
          ? getSoundForSan(moves[variation.branchPly - 1]?.san)
          : 'move',
      )
    }
  }

  const stepPrev = () => {
    if (variation) {
      if (variation.cursor <= 1) {
        exitVariation()
      } else {
        const nextCursor = variation.cursor - 1
        setVariation({ ...variation, cursor: nextCursor })
        if (soundEnabled) {
          chessSounds.play(getSoundForSan(variation.moves[nextCursor - 1]?.san))
        }
      }
      return
    }
    jumpToPly(viewIndex - 1)
  }

  const stepNext = () => {
    if (variation) {
      if (variation.cursor < variation.moves.length) {
        const nextCursor = variation.cursor + 1
        setVariation({ ...variation, cursor: nextCursor })
        if (soundEnabled) {
          chessSounds.play(getSoundForSan(variation.moves[nextCursor - 1]?.san))
        }
      }
      return
    }
    jumpToPly(viewIndex + 1)
  }

  const stepStart = () => {
    if (variation) {
      exitVariation()
      return
    }
    jumpToPly(0)
  }

  const stepEnd = () => {
    if (variation) {
      if (variation.cursor < variation.moves.length) {
        setVariation({ ...variation, cursor: variation.moves.length })
        if (soundEnabled) {
          chessSounds.play(
            getSoundForSan(variation.moves[variation.moves.length - 1]?.san),
          )
        }
      }
      return
    }
    jumpToPly(moves.length)
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
      {/* Clean, responsive top navigation bar */}
      <header className="sticky top-0 z-40 border-b border-white/[0.07] bg-[#24221f]/95 backdrop-blur-sm">
        <div className="mx-auto flex max-w-6xl items-center justify-between gap-2 px-3 py-2.5 sm:gap-3 sm:px-4 sm:py-3">
          <div className="flex min-w-0 items-center gap-2 sm:gap-3">
            <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-[#81b64c] text-lg font-black text-[#161512] shadow-sm sm:h-9 sm:w-9 sm:text-xl">
              ♞
            </div>
            <div className="min-w-0">
              <h1 className="truncate text-sm leading-tight font-bold tracking-tight text-white sm:text-base">
                JustChess
              </h1>
              <p className="hidden truncate text-xs text-stone-400 sm:block">
                {gameMeta ??
                  (isEn
                    ? 'Play Chess & Smart Analysis'
                    : 'Chơi cờ & Phân tích thông minh')}
              </p>
            </div>
          </div>

          <div className="flex shrink-0 items-center gap-1.5 sm:gap-2.5">
            {/* Primary unified Import CTA */}
            <button
              type="button"
              onClick={() => setImportModalTab('online')}
              className="flex items-center gap-1.5 rounded-lg bg-[#81b64c] px-2.5 py-2 text-xs font-bold text-[#161512] shadow-sm transition hover:bg-[#95c75d] sm:px-3.5 sm:py-2"
            >
              <UploadIcon className="h-4 w-4 shrink-0" />
              <span>{isEn ? 'Load Game' : 'Tải ván'}</span>
              <span className="hidden sm:inline">
                {isEn ? '/ FEN' : '/ Thế cờ'}
              </span>
            </button>

            {/* Compact Theme Swatches */}
            <div
              className="flex items-center gap-0.5 rounded-lg bg-[#1a1917] p-1 ring-1 ring-white/[0.08] sm:gap-1"
              role="group"
              aria-label={isEn ? 'Board theme' : 'Chọn màu bàn cờ'}
            >
              {(Object.keys(BOARD_THEMES) as BoardThemeId[]).map((id) => {
                const t = BOARD_THEMES[id]
                const active = id === themeId
                return (
                  <button
                    key={id}
                    type="button"
                    onClick={() => setThemeId(id)}
                    title={`${isEn ? 'Board theme' : 'Màu bàn cờ'}: ${t.name}`}
                    aria-label={t.name}
                    className={[
                      'flex items-center gap-1.5 rounded-md p-1.5 text-xs font-medium transition sm:px-2',
                      active
                        ? 'bg-[#34312d] text-white shadow-xs ring-1 ring-white/10'
                        : 'text-stone-400 hover:text-stone-200',
                    ].join(' ')}
                  >
                    <span className="grid h-4 w-4 grid-cols-2 overflow-hidden rounded-[3px] ring-1 ring-black/40 sm:h-4.5 sm:w-4.5">
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

            {/* Language Switcher (VI / EN) */}
            <button
              type="button"
              onClick={handleToggleLanguage}
              title={
                isEn
                  ? 'Switch to Vietnamese (Tiếng Việt)'
                  : 'Chuyển sang tiếng Anh (English)'
              }
              aria-label={isEn ? 'Switch language' : 'Đổi ngôn ngữ'}
              className="flex h-9 items-center justify-center rounded-lg bg-[#2e2c28] px-2.5 font-mono text-xs font-bold text-stone-100 ring-1 ring-white/10 transition hover:bg-[#3d3a36] sm:h-10 sm:px-3"
            >
              {lang === 'vi' ? 'VI' : 'EN'}
            </button>

            {/* Sound toggle */}
            <button
              type="button"
              onClick={() => setSoundEnabled((prev) => !prev)}
              title={
                soundEnabled
                  ? isEn
                    ? 'Mute sound'
                    : 'Tắt âm thanh'
                  : isEn
                    ? 'Enable sound'
                    : 'Bật âm thanh'
              }
              aria-label={
                soundEnabled
                  ? isEn
                    ? 'Mute sound'
                    : 'Tắt âm thanh'
                  : isEn
                    ? 'Enable sound'
                    : 'Bật âm thanh'
              }
              className={[
                'flex h-9 w-9 items-center justify-center rounded-lg ring-1 transition sm:h-10 sm:w-10',
                soundEnabled
                  ? 'bg-[#2e2c28] text-stone-100 ring-white/10 hover:bg-[#3d3a36]'
                  : 'bg-[#1a1917] text-stone-500 ring-white/5 hover:text-stone-300',
              ].join(' ')}
            >
              {soundEnabled ? (
                <VolumeOnIcon className="h-5 w-5" />
              ) : (
                <VolumeOffIcon className="h-5 w-5" />
              )}
            </button>
          </div>
        </div>
      </header>

      {/* Main Arena (Mobile-first fluid layout -> Tablet centered -> Desktop 2-column) */}
      <main className="mx-auto grid w-full max-w-6xl flex-1 items-start gap-4 px-2 py-3 sm:gap-6 sm:px-4 sm:py-6 lg:grid-cols-[minmax(0,636px)_400px] lg:justify-center lg:gap-7">
        {/* Left column: Evaluation Bar + Player Bars + Chessboard */}
        <section className="flex flex-col items-center gap-2 sm:gap-3">
          {/* Top PlayerBar aligned with chessboard */}
          <div className="flex w-full max-w-[636px] gap-1.5 sm:gap-2.5">
            <div className="w-4.5 shrink-0 sm:w-7" aria-hidden="true" />
            <div className="min-w-0 flex-1">
              <PlayerBar
                lang={lang}
                name={
                  topColor === 'w' ? players.white.name : players.black.name
                }
                title={
                  topColor === 'w' ? players.white.title : players.black.title
                }
                rating={
                  topColor === 'w' ? players.white.rating : players.black.rating
                }
                fideRating={
                  topColor === 'w'
                    ? players.white.fideRating
                    : players.black.fideRating
                }
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
          <div className="flex w-full max-w-[636px] items-stretch gap-1.5 sm:gap-2.5">
            <EvaluationBar
              lang={lang}
              evaluation={activeEvalForBar}
              orientation={orientation}
              enabled={engineEnabled}
              gameResult={
                isCheckmate
                  ? turn === 'w'
                    ? '0-1'
                    : '1-0'
                  : isGameOver
                    ? '1/2-1/2'
                    : null
              }
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
          <div className="flex w-full max-w-[636px] gap-1.5 sm:gap-2.5">
            <div className="w-4.5 shrink-0 sm:w-7" aria-hidden="true" />
            <div className="min-w-0 flex-1">
              <PlayerBar
                lang={lang}
                name={
                  bottomColor === 'w' ? players.white.name : players.black.name
                }
                title={
                  bottomColor === 'w'
                    ? players.white.title
                    : players.black.title
                }
                rating={
                  bottomColor === 'w'
                    ? players.white.rating
                    : players.black.rating
                }
                fideRating={
                  bottomColor === 'w'
                    ? players.white.fideRating
                    : players.black.fideRating
                }
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

          {/* Mobile & Tablet touch-friendly Replay & Flip bar right under the board */}
          <div className="flex w-full max-w-[636px] gap-1.5 sm:gap-2.5 lg:hidden">
            <div className="w-4.5 shrink-0 sm:w-7" aria-hidden="true" />
            <div className="grid min-w-0 flex-1 grid-cols-5 gap-1.5 rounded-xl bg-[#24221f] p-1.5 ring-1 ring-white/[0.08]">
              <button
                type="button"
                onClick={stepStart}
                disabled={!variation && viewIndex === 0}
                title={variation ? 'Quay lại điểm rẽ nhánh' : 'Về đầu ván'}
                aria-label="Về đầu ván"
                className="flex min-h-[44px] touch-manipulation items-center justify-center rounded-lg bg-[#2e2c28] text-stone-100 transition active:scale-95 hover:bg-[#3d3a36] disabled:opacity-35"
              >
                <FirstMoveIcon className="h-5 w-5" />
              </button>
              <button
                type="button"
                onClick={stepPrev}
                disabled={!variation && viewIndex === 0}
                title="Nước trước"
                aria-label="Nước trước"
                className="flex min-h-[44px] touch-manipulation items-center justify-center rounded-lg bg-[#34312d] text-white transition active:scale-95 hover:bg-[#433f3a] disabled:opacity-35"
              >
                <PrevMoveIcon className="h-6 w-6" />
              </button>
              <button
                type="button"
                onClick={stepNext}
                disabled={
                  variation
                    ? variation.cursor >= variation.moves.length
                    : viewIndex >= moves.length
                }
                title="Nước sau"
                aria-label="Nước sau"
                className="flex min-h-[44px] touch-manipulation items-center justify-center rounded-lg bg-[#34312d] text-white transition active:scale-95 hover:bg-[#433f3a] disabled:opacity-35"
              >
                <NextMoveIcon className="h-6 w-6" />
              </button>
              <button
                type="button"
                onClick={stepEnd}
                disabled={
                  variation
                    ? variation.cursor >= variation.moves.length
                    : viewIndex >= moves.length
                }
                title="Về nước cuối"
                aria-label="Về nước cuối"
                className="flex min-h-[44px] touch-manipulation items-center justify-center rounded-lg bg-[#2e2c28] text-stone-100 transition active:scale-95 hover:bg-[#3d3a36] disabled:opacity-35"
              >
                <LastMoveIcon className="h-5 w-5" />
              </button>
              <button
                type="button"
                onClick={() =>
                  setOrientation((prev) => (prev === 'w' ? 'b' : 'w'))
                }
                title="Xoay bàn cờ"
                aria-label="Xoay bàn cờ"
                className="flex min-h-[44px] touch-manipulation items-center justify-center rounded-lg bg-[#2e2c28] text-stone-200 transition active:scale-95 hover:bg-[#3d3a36]"
              >
                <FlipIcon className="h-5 w-5" />
              </button>
            </div>
          </div>

          {/* Desktop-only subtle keyboard & right-click hint */}
          <div className="hidden w-full max-w-[636px] flex-wrap items-center justify-between gap-2 pl-9 text-[11px] text-stone-500 lg:flex">
            <span>
              {isEn
                ? 'Right-click: highlight square / draw arrows ('
                : 'Chuột phải: đánh dấu ô / kéo vẽ mũi tên ('}
              <kbd className="rounded bg-white/5 px-1 text-stone-400">
                Shift
              </kbd>{' '}
              <kbd className="rounded bg-white/5 px-1 text-stone-400">Alt</kbd>{' '}
              <kbd className="rounded bg-white/5 px-1 text-stone-400">Ctrl</kbd>
              )
            </span>
            <span>
              {isEn ? 'Keys ' : 'Phím '}
              <kbd className="rounded bg-white/5 px-1 text-stone-400">←</kbd>{' '}
              <kbd className="rounded bg-white/5 px-1 text-stone-400">→</kbd>{' '}
              {isEn ? 'step • ' : 'từng nước • '}
              <kbd className="rounded bg-white/5 px-1 text-stone-400">↑</kbd>{' '}
              <kbd className="rounded bg-white/5 px-1 text-stone-400">↓</kbd>{' '}
              {isEn ? 'start/end' : 'đầu/cuối ván'}
            </span>
          </div>
        </section>

        {/* Right column: Spacious Responsive 4-Tab Sidebar */}
        <aside className="mx-auto flex min-h-[480px] w-full max-w-[636px] flex-col overflow-hidden rounded-2xl bg-[#262421] shadow-2xl ring-1 ring-white/[0.08] lg:mx-0 lg:h-[736px] lg:max-w-none">
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
            <span className="truncate">
              {botThinking
                ? `🤖 ${activeBotPreset.name} ${isEn ? 'is thinking...' : 'đang suy nghĩ...'}`
                : status.text}
            </span>
            {moves.length > 0 && (
              <span className="shrink-0 rounded-md bg-black/30 px-2.5 py-0.5 font-mono text-xs text-stone-300">
                {viewIndex}/{moves.length}
              </span>
            )}
          </div>

          {/* Active Bot Match Banner */}
          {botActive && (
            <div className="flex items-center justify-between gap-2 border-b border-emerald-500/20 bg-emerald-500/10 px-3.5 py-1.5 text-xs">
              <span className="font-semibold text-emerald-300">
                🤖 {isEn ? 'Playing vs' : 'Đang đấu với'} {activeBotPreset.name} (
                {activeBotPreset.eloLabel})
              </span>
              <button
                type="button"
                onClick={stopBotMatch}
                className="rounded bg-white/10 px-2 py-0.5 text-[11px] font-semibold text-stone-200 hover:bg-white/20"
              >
                {isEn ? 'Stop Bot' : 'Dừng Bot'}
              </button>
            </div>
          )}

          {/* Variation Branch Banner (Non-destructive exploration) */}
          {variation && (
            <div className="border-b border-purple-500/25 bg-purple-500/12 px-3.5 py-2">
              <div className="flex items-center justify-between gap-2">
                <span className="text-xs font-bold text-purple-300">
                  🌿{' '}
                  {isEn
                    ? `Variation (from ply ${variation.branchPly})`
                    : `Nhánh biến thử (từ nước ${variation.branchPly})`}
                </span>
                <button
                  type="button"
                  onClick={exitVariation}
                  className="rounded-md bg-purple-500/25 px-2.5 py-1 text-[11px] font-bold text-purple-100 transition hover:bg-purple-500/40"
                >
                  {isEn ? '↩ Main Line' : '↩ Về ván chính'}
                </button>
              </div>
              <div className="mt-1.5 flex flex-wrap gap-1 font-mono text-[11px]">
                {variation.moves.map((vm, idx) => {
                  const step = idx + 1
                  const active = variation.cursor === step
                  return (
                    <button
                      key={`${vm.san}-${idx}`}
                      type="button"
                      onClick={() =>
                        setVariation({ ...variation, cursor: step })
                      }
                      className={[
                        'rounded px-1.5 py-0.5 transition',
                        active
                          ? 'bg-purple-500 text-white font-bold'
                          : 'bg-black/25 text-purple-200 hover:bg-purple-500/30',
                      ].join(' ')}
                    >
                      {vm.san}
                    </button>
                  )
                })}
              </div>
            </div>
          )}

          {/* 4 Clear Sidebar Tabs (Icon-over-Label, Beginner-friendly) */}
          <div className="grid grid-cols-4 gap-1 border-b border-white/[0.07] bg-[#1e1c1a] p-1.5">
            <button
              type="button"
              onClick={() => setSidebarTab('game')}
              className={[
                'flex flex-col items-center justify-center gap-1 rounded-xl py-2 text-[11px] font-semibold transition',
                sidebarTab === 'game'
                  ? 'bg-[#34312d] text-white shadow-xs ring-1 ring-white/10'
                  : 'text-stone-400 hover:bg-white/[0.04] hover:text-stone-200',
              ].join(' ')}
            >
              <GameTabIcon className="h-5 w-5" />
              <span>{isEn ? 'Game' : 'Ván đấu'}</span>
            </button>
            <button
              type="button"
              onClick={() => setSidebarTab('bot')}
              className={[
                'relative flex flex-col items-center justify-center gap-1 rounded-xl py-2 text-[11px] font-semibold transition',
                sidebarTab === 'bot'
                  ? 'bg-[#34312d] text-white shadow-xs ring-1 ring-white/10'
                  : 'text-stone-400 hover:bg-white/[0.04] hover:text-stone-200',
              ].join(' ')}
            >
              <BotTabIcon className="h-5 w-5" />
              <span>{isEn ? 'Bots' : 'Đấu Bot'}</span>
              {botActive && (
                <span className="absolute top-1.5 right-2 h-2 w-2 rounded-full bg-emerald-400 ring-2 ring-[#1e1c1a]" />
              )}
            </button>
            <button
              type="button"
              onClick={() => setSidebarTab('review')}
              className={[
                'relative flex flex-col items-center justify-center gap-1 rounded-xl py-2 text-[11px] font-semibold transition',
                sidebarTab === 'review'
                  ? 'bg-[#34312d] text-white shadow-xs ring-1 ring-white/10'
                  : 'text-stone-400 hover:bg-white/[0.04] hover:text-stone-200',
              ].join(' ')}
            >
              <ReviewTabIcon className="h-5 w-5" />
              <span>{isEn ? 'Review' : 'Đánh giá'}</span>
              {reviewResult && (
                <span className="absolute top-1.5 right-2 h-2 w-2 rounded-full bg-[#81b64c] ring-2 ring-[#1e1c1a]" />
              )}
            </button>
            <button
              type="button"
              onClick={() => setSidebarTab('engine')}
              className={[
                'relative flex flex-col items-center justify-center gap-1 rounded-xl py-2 text-[11px] font-semibold transition',
                sidebarTab === 'engine'
                  ? 'bg-[#34312d] text-white shadow-xs ring-1 ring-white/10'
                  : 'text-stone-400 hover:bg-white/[0.04] hover:text-stone-200',
              ].join(' ')}
            >
              <EngineTabIcon className="h-5 w-5" />
              <span>Engine</span>
              {engineEnabled && (
                <span className="absolute top-1.5 right-2 h-2 w-2 rounded-full bg-emerald-400 ring-2 ring-[#1e1c1a]" />
              )}
            </button>
          </div>

          {/* TAB: ĐẤU BOT (Play vs Maia / Stockfish Bot) */}
          {sidebarTab === 'bot' && (
            <div className="flex flex-1 flex-col gap-3.5 overflow-y-auto p-4">
              {/* Choose side */}
              <div className="rounded-xl bg-[#1f1d1a] p-3 ring-1 ring-white/[0.06]">
                <div className="mb-2 text-[11px] font-semibold tracking-wider text-stone-400 uppercase">
                  {isEn ? 'Choose Your Side' : 'Chọn phe của bạn'}
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <button
                    type="button"
                    onClick={() => setPlayerSide('w')}
                    className={[
                      'rounded-lg py-2 text-xs font-bold transition',
                      playerSide === 'w'
                        ? 'bg-stone-100 text-[#161512] shadow-sm'
                        : 'bg-[#2a2824] text-stone-300 hover:bg-[#34312d]',
                    ].join(' ')}
                  >
                    {isEn ? '♔ Play White' : '♔ Cầm Trắng (Đi trước)'}
                  </button>
                  <button
                    type="button"
                    onClick={() => setPlayerSide('b')}
                    className={[
                      'rounded-lg py-2 text-xs font-bold transition',
                      playerSide === 'b'
                        ? 'bg-[#3d3a36] text-white ring-1 ring-[#81b64c]'
                        : 'bg-[#2a2824] text-stone-300 hover:bg-[#34312d]',
                    ].join(' ')}
                  >
                    {isEn ? '♚ Play Black' : '♚ Cầm Đen (Đi sau)'}
                  </button>
                </div>
              </div>

              {/* Maia Human-like Bots */}
              <div className="rounded-xl bg-[#1f1d1a] p-3 ring-1 ring-white/[0.06]">
                <div className="mb-2 flex items-center justify-between">
                  <span className="text-[11px] font-semibold tracking-wider text-fuchsia-300 uppercase">
                    {isEn
                      ? 'Maia Chess (Human-like AI)'
                      : 'Maia Chess (Đánh như người thật)'}
                  </span>
                  {maiaStatus !== 'ready' && (
                    <span className="text-[10px] text-stone-400">
                      {maiaStatus === 'downloading'
                        ? `${isEn ? 'Downloading' : 'Đang tải'} ${maiaProgress}%`
                        : maiaStatus === 'loading'
                          ? isEn
                            ? 'Loading...'
                            : 'Đang nạp...'
                          : isEn
                            ? '43MB download'
                            : 'Cần tải 43MB'}
                    </span>
                  )}
                </div>
                <div className="grid grid-cols-2 gap-1.5">
                  {BOT_PRESETS.filter((b) => b.engine === 'maia').map((b) => (
                    <button
                      key={b.id}
                      type="button"
                      onClick={() => setBotPresetId(b.id)}
                      className={[
                        'flex items-center justify-between rounded-lg px-2.5 py-2 text-left transition',
                        botPresetId === b.id
                          ? 'bg-fuchsia-600/25 text-white ring-1 ring-fuchsia-500'
                          : 'bg-[#2a2824] text-stone-300 hover:bg-[#34312d]',
                      ].join(' ')}
                    >
                      <span className="text-xs font-bold">{b.name}</span>
                      <span className="font-mono text-[10px] text-fuchsia-300">
                        {b.eloLabel}
                      </span>
                    </button>
                  ))}
                </div>
              </div>

              {/* Stockfish 19 Bots */}
              <div className="rounded-xl bg-[#1f1d1a] p-3 ring-1 ring-white/[0.06]">
                <div className="mb-2 text-[11px] font-semibold tracking-wider text-[#a3d160] uppercase">
                  {isEn
                    ? 'Stockfish 19 (All Elo Levels)'
                    : 'Stockfish 19 (Đa cấp độ Elo)'}
                </div>
                <div className="flex flex-col gap-1.5">
                  {BOT_PRESETS.filter((b) => b.engine === 'stockfish').map(
                    (b) => (
                      <button
                        key={b.id}
                        type="button"
                        onClick={() => setBotPresetId(b.id)}
                        className={[
                          'flex items-center justify-between rounded-lg px-3 py-2 text-left transition',
                          botPresetId === b.id
                            ? 'bg-[#81b64c]/22 text-white ring-1 ring-[#81b64c]'
                            : 'bg-[#2a2824] text-stone-300 hover:bg-[#34312d]',
                        ].join(' ')}
                      >
                        <div>
                          <div className="text-xs font-bold">{b.name}</div>
                          <div className="text-[10px] text-stone-400">
                            {b.desc}
                          </div>
                        </div>
                        <span className="rounded bg-black/25 px-2 py-0.5 font-mono text-[11px] font-bold text-[#a3d160]">
                          {b.eloLabel}
                        </span>
                      </button>
                    ),
                  )}
                </div>
              </div>

              {/* Action CTA */}
              <div className="mt-auto flex flex-col gap-2">
                {activeBotPreset.engine === 'maia' && maiaStatus !== 'ready' ? (
                  <button
                    type="button"
                    onClick={triggerMaiaDownload}
                    disabled={
                      maiaStatus === 'downloading' || maiaStatus === 'loading'
                    }
                    className="w-full rounded-xl bg-fuchsia-600 py-2.5 text-xs font-bold text-white shadow-md transition hover:bg-fuchsia-500 disabled:opacity-50"
                  >
                    {maiaStatus === 'downloading'
                      ? `Đang tải model Maia-3 (${maiaProgress}%)...`
                      : maiaStatus === 'loading'
                        ? 'Đang nạp Maia-3...'
                        : '⬇ Tải Maia-3 để đấu với Bot Maia'}
                  </button>
                ) : (
                  <button
                    type="button"
                    onClick={() => startBotMatch(botPresetId, playerSide)}
                    className="w-full rounded-xl bg-[#81b64c] py-2.5 text-xs font-bold text-[#161512] shadow-md transition hover:bg-[#95c75d]"
                  >
                    ▶ Bắt đầu đấu với {activeBotPreset.name} (
                    {activeBotPreset.eloLabel})
                  </button>
                )}

                {botActive && (
                  <button
                    type="button"
                    onClick={stopBotMatch}
                    className="w-full rounded-xl bg-[#34312d] py-2 text-xs font-semibold text-stone-200 transition hover:bg-[#423f3a]"
                  >
                    ⏹ Dừng chế độ đấu Bot
                  </button>
                )}
              </div>
            </div>
          )}

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
              <div
                ref={moveListContainerRef}
                className="min-h-52 flex-1 overflow-y-auto px-3 py-2.5"
              >
                {moveRows.length === 0 ? (
                  <div className="flex h-full flex-col items-center justify-center gap-3 py-10 text-center">
                    <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-white/[0.04] text-2xl">
                      ♟
                    </div>
                    <div>
                      <p className="text-sm font-bold text-stone-200">
                        {isEn
                          ? 'Ready for a new game'
                          : 'Sẵn sàng bắt đầu ván mới'}
                      </p>
                      <p className="mt-1 max-w-[260px] text-xs leading-relaxed text-stone-400">
                        {isEn
                          ? 'Drag or click a White piece to play, or load an existing game to review.'
                          : 'Kéo thả hoặc nhấp chọn quân Trắng để đi, hoặc tải ván đấu có sẵn để phân tích.'}
                      </p>
                    </div>
                    <div className="mt-1 flex flex-wrap justify-center gap-2">
                      <button
                        type="button"
                        onClick={() => setImportModalTab('online')}
                        className="rounded-lg bg-[#81b64c] px-3.5 py-2 text-xs font-bold text-[#161512] transition hover:bg-[#95c75d]"
                      >
                        🔍{' '}
                        {isEn
                          ? 'Search Lichess / Chess.com'
                          : 'Tìm ván Lichess / Chess.com'}
                      </button>
                      <button
                        type="button"
                        onClick={() => setImportModalTab('pgn')}
                        className="rounded-lg bg-[#34312d] px-3.5 py-2 text-xs font-semibold text-stone-200 transition hover:bg-[#423f3a]"
                      >
                        {isEn ? 'Paste PGN / FEN' : 'Dán PGN / FEN'}
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
                    📊{' '}
                    {isEn
                      ? 'Run Full Game Review'
                      : 'Chấm điểm toàn ván (Game Review)'}
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
                  {isEn
                    ? 'Stockfish 19 is reviewing your game...'
                    : 'Stockfish 19 đang chấm điểm ván đấu...'}
                </div>
                <p className="text-xs text-stone-400">
                  {isEn ? 'Analyzing ply' : 'Đang phân tích nước'}{' '}
                  {reviewProgress.completed} / {reviewProgress.total}
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
                  {isEn ? 'Cancel Review' : 'Hủy phân tích'}
                </button>
              </div>
            ) : reviewResult ? (
              <GameReviewPanel
                lang={lang}
                review={reviewResult}
                selectedEngine={reviewEngine}
                timeControl={timeControl}
                whiteName={players.white.name}
                blackName={players.black.name}
                whiteRating={players.white.rating}
                blackRating={players.black.rating}
                sourcePlatform={sourcePlatform}
                gameOutcome={
                  pgnResult ??
                  (() => {
                    const finalGame = buildGameAtPly(
                      startFen,
                      moves,
                      moves.length,
                    )
                    if (finalGame.isCheckmate()) {
                      return finalGame.turn() === 'w' ? '0-1' : '1-0'
                    }
                    if (finalGame.isDraw()) return '1/2-1/2'
                    return null
                  })()
                }
                currentPly={viewIndex}
                totalPlies={moves.length}
                showBestMoveHint={showBestMoveHint}
                onToggleBestMoveHint={() =>
                  setShowBestMoveHint((prev) => !prev)
                }
                onSelectPly={jumpToPly}
                onPlayBestMove={(uci, atPly) => playUciMoveIfValid(uci, atPly)}
                onChangeReviewEngine={(nextEngine) =>
                  setReviewEngine(nextEngine)
                }
                onChangeTimeControl={(tc) => setTimeControl(tc)}
                onReRunReview={(nextEngine) =>
                  void startGameReview(
                    startFen,
                    moves,
                    nextEngine ?? reviewEngine,
                  )
                }
              />
            ) : (
              <div className="flex flex-1 flex-col items-center justify-center gap-3.5 px-6 py-8 text-center">
                <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-[#81b64c]/15 text-3xl ring-1 ring-[#81b64c]/30">
                  🎓
                </div>
                <div>
                  <h3 className="text-sm font-bold text-white">
                    {isEn
                      ? 'Multi-Engine Game Review'
                      : 'Đánh giá ván đấu (Đa Engine)'}
                  </h3>
                  <p className="mt-1.5 text-xs leading-relaxed text-stone-400">
                    {isEn ? (
                      <>
                        Calculate Accuracy %, estimate{' '}
                        <strong className="text-amber-300">FIDE</strong> /{' '}
                        <strong className="text-[#a3d160]">Chess.com</strong> /{' '}
                        <strong className="text-sky-300">Lichess</strong>{' '}
                        ratings, show on-board move badges, and get Coach
                        commentary.
                      </>
                    ) : (
                      <>
                        Chấm điểm Accuracy %, ước lượng Elo{' '}
                        <strong className="text-amber-300">FIDE</strong> /{' '}
                        <strong className="text-[#a3d160]">Chess.com</strong> /{' '}
                        <strong className="text-sky-300">Lichess</strong>, gắn
                        huy hiệu trực tiếp trên bàn cờ và HLV nhận xét từng nước
                        đi.
                      </>
                    )}
                  </p>
                </div>

                {/* Review Engine Selector before starting */}
                <div className="w-full max-w-[300px] rounded-xl bg-[#1f1d1a] p-2.5 text-left ring-1 ring-white/[0.06]">
                  <div className="mb-1.5 text-[10px] font-semibold tracking-wider text-stone-400 uppercase">
                    {isEn ? 'Select Review Engine' : 'Chọn Engine chấm điểm'}
                  </div>
                  <div className="grid grid-cols-2 gap-1.5">
                    {REVIEW_ENGINES.map((eng) => (
                      <button
                        key={eng.id}
                        type="button"
                        onClick={() => setReviewEngine(eng.id)}
                        title={eng.desc}
                        className={[
                          'rounded-lg px-2 py-1.5 text-left text-[11px] font-semibold transition',
                          reviewEngine === eng.id
                            ? 'bg-[#34312d] text-[#b4e07c] ring-1 ring-[#81b64c]/60'
                            : 'bg-[#262421] text-stone-300 hover:bg-[#2f2d29]',
                        ].join(' ')}
                      >
                        {eng.shortLabel}
                      </button>
                    ))}
                  </div>
                </div>

                {moves.length > 0 ? (
                  <button
                    type="button"
                    onClick={() => void startGameReview()}
                    className="rounded-lg bg-[#81b64c] px-5 py-2.5 text-xs font-bold text-[#161512] shadow-md transition hover:bg-[#95c75d]"
                  >
                    📊{' '}
                    {isEn
                      ? `Start Game Review (${moves.length} plies)`
                      : `Bắt đầu Game Review (${moves.length} nước)`}
                  </button>
                ) : (
                  <div className="flex flex-wrap justify-center gap-2">
                    <button
                      type="button"
                      onClick={() => setImportModalTab('online')}
                      className="rounded-lg bg-[#81b64c] px-3.5 py-2 text-xs font-bold text-[#161512] transition hover:bg-[#95c75d]"
                    >
                      🔍{' '}
                      {isEn
                        ? 'Load Lichess / Chess.com'
                        : 'Tải ván Lichess / Chess.com'}
                    </button>
                    <button
                      type="button"
                      onClick={() => setImportModalTab('pgn')}
                      className="rounded-lg bg-[#34312d] px-3.5 py-2 text-xs font-semibold text-stone-200 transition hover:bg-[#423f3a]"
                    >
                      {isEn ? 'Paste PGN' : 'Dán PGN'}
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
                    {isEn ? 'Engine Status' : 'Trạng thái Engine'}
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
                      {isEn ? '↗ Arrows' : '↗ Mũi tên'}
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
                    {engineEnabled
                      ? isEn
                        ? 'On'
                        : 'Đang bật'
                      : isEn
                        ? 'Off'
                        : 'Đang tắt'}
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

                        {/* Maia Chess (Maia-3 ONNX Human-like AI) */}
                        {engineMode === 'maia' && (
                          <div className="flex flex-col gap-2.5">
                            {/* Elo level selector */}
                            <div className="flex items-center justify-between gap-2">
                              <span className="text-[11px] font-semibold text-stone-400">
                                Mức Elo người thật:
                              </span>
                              <div className="flex gap-1">
                                {MAIA_ELO_LEVELS.map((lvl) => (
                                  <button
                                    key={lvl}
                                    type="button"
                                    onClick={() => setMaiaElo(lvl)}
                                    className={[
                                      'rounded px-1.5 py-0.5 font-mono text-[11px] font-bold transition',
                                      maiaElo === lvl
                                        ? 'bg-fuchsia-600 text-white'
                                        : 'bg-[#2a2824] text-stone-400 hover:text-stone-200',
                                    ].join(' ')}
                                  >
                                    {lvl}
                                  </button>
                                ))}
                              </div>
                            </div>

                            {maiaStatus === 'idle' && (
                              <div className="rounded-lg bg-[#2a2824] p-3 text-center">
                                <p className="text-xs leading-relaxed text-stone-300">
                                  <strong>Maia-3 ONNX</strong> (~43 MB) chạy trực
                                  tiếp trên trình duyệt và tự lưu cache để dùng
                                  lâu dài.
                                </p>
                                <button
                                  type="button"
                                  onClick={triggerMaiaDownload}
                                  className="mt-2.5 rounded-lg bg-fuchsia-600 px-4 py-1.5 text-xs font-bold text-white transition hover:bg-fuchsia-500"
                                >
                                  ⬇ Tải model Maia-3 (1 lần duy nhất)
                                </button>
                              </div>
                            )}

                            {maiaStatus === 'downloading' && (
                              <div className="flex flex-col gap-1.5 rounded-lg bg-[#2a2824] p-3">
                                <div className="flex justify-between text-xs text-stone-200">
                                  <span>Đang tải Maia-3 ONNX...</span>
                                  <span className="font-mono font-bold text-fuchsia-400">
                                    {maiaProgress}%
                                  </span>
                                </div>
                                <div className="h-2 overflow-hidden rounded-full bg-[#1a1917]">
                                  <div
                                    className="h-full bg-fuchsia-500 transition-[width] duration-200"
                                    style={{ width: `${maiaProgress}%` }}
                                  />
                                </div>
                              </div>
                            )}

                            {maiaStatus === 'loading' && (
                              <span className="text-xs text-stone-400">
                                Đang nạp Maia-3 vào ONNX Runtime Web...
                              </span>
                            )}

                            {maiaStatus === 'error' && (
                              <div className="rounded-lg bg-red-500/10 p-2.5 text-xs text-red-300">
                                <p>{maiaError ?? 'Không thể tải Maia-3.'}</p>
                                <button
                                  type="button"
                                  onClick={triggerMaiaDownload}
                                  className="mt-1.5 rounded bg-red-500/20 px-2.5 py-1 text-[11px] font-semibold text-red-200 hover:bg-red-500/30"
                                >
                                  Thử lại
                                </button>
                              </div>
                            )}

                            {maiaStatus === 'ready' &&
                              (activeMaiaResult ? (
                                <div className="flex flex-col gap-1.5">
                                  <div className="flex items-center justify-between text-[11px] text-stone-400">
                                    <span>
                                      Dự đoán nước đi mức{' '}
                                      <strong className="text-fuchsia-400">
                                        Maia {maiaElo}
                                      </strong>
                                    </span>
                                    <span className="font-mono">
                                      Trắng{' '}
                                      {Math.round(
                                        activeMaiaResult.whiteWinPercent,
                                      )}
                                      %
                                    </span>
                                  </div>
                                  {activeMaiaResult.topMoves.map((m) => (
                                    <button
                                      key={m.uci}
                                      type="button"
                                      onClick={() => playUciMoveIfValid(m.uci)}
                                      className="flex items-center gap-2.5 rounded-lg bg-[#2a2824] px-2.5 py-1.5 text-left transition hover:bg-[#36332e]"
                                    >
                                      <span className="w-12 shrink-0 font-mono text-xs font-bold text-white">
                                        {m.san}
                                      </span>
                                      <div className="h-2 flex-1 overflow-hidden rounded-full bg-[#1a1917]">
                                        <div
                                          className="h-full rounded-full bg-fuchsia-500"
                                          style={{
                                            width: `${Math.max(4, Math.round(m.probability * 100))}%`,
                                          }}
                                        />
                                      </div>
                                      <span className="w-10 shrink-0 text-right font-mono text-[11px] font-semibold text-fuchsia-300">
                                        {Math.round(m.probability * 100)}%
                                      </span>
                                    </button>
                                  ))}
                                </div>
                              ) : (
                                <span className="text-xs text-stone-400">
                                  Maia {maiaElo} đang suy luận...
                                </span>
                              ))}
                          </div>
                        )}

                        {/* Compare Stockfish 19 vs Maia Chess */}
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
                                <span className="h-3 w-3 rounded-full bg-fuchsia-600" />
                                <span className="text-xs font-semibold text-stone-100">
                                  Maia {maiaElo}
                                </span>
                              </div>
                              {maiaStatus === 'ready' ? (
                                <div className="flex items-center gap-2">
                                  <span className="font-mono text-xs font-bold text-fuchsia-300">
                                    {activeMaiaResult
                                      ? `${Math.round(activeMaiaResult.whiteWinPercent)}% W`
                                      : '...'}
                                  </span>
                                  {activeMaiaResult?.topMoves[0] && (
                                    <button
                                      type="button"
                                      onClick={() =>
                                        playUciMoveIfValid(
                                          activeMaiaResult.bestMove,
                                        )
                                      }
                                      className="rounded bg-[#34312d] px-2 py-0.5 font-mono text-xs font-semibold text-stone-100 hover:bg-[#423f3a]"
                                    >
                                      {activeMaiaResult.topMoves[0].san} (
                                      {Math.round(
                                        activeMaiaResult.topMoves[0]
                                          .probability * 100,
                                      )}
                                      %)
                                    </button>
                                  )}
                                </div>
                              ) : (
                                <button
                                  type="button"
                                  onClick={triggerMaiaDownload}
                                  disabled={
                                    maiaStatus === 'downloading' ||
                                    maiaStatus === 'loading'
                                  }
                                  className="rounded bg-fuchsia-600 px-2.5 py-1 text-[11px] font-bold text-white hover:bg-fuchsia-500 disabled:opacity-50"
                                >
                                  {maiaStatus === 'downloading'
                                    ? `Đang tải ${maiaProgress}%`
                                    : maiaStatus === 'loading'
                                      ? 'Đang nạp...'
                                      : 'Tải Maia-3'}
                                </button>
                              )}
                            </div>
                          </div>
                        )}
                      </>
                    )}
                  </div>

                  {/* Transparent technical note for native/GPU engines */}
                  <div className="rounded-xl bg-[#1f1d1a]/70 p-3 text-[11px] leading-relaxed text-stone-400 ring-1 ring-white/[0.04]">
                    <span className="font-semibold text-stone-300">
                      Về Lc0, Berserk, Ethereal &amp; Komodo:
                    </span>{' '}
                    Các engine này cần GPU (Lc0) hoặc binary native C/C++ trên
                    server (chưa có gói WASM nhẹ chạy trực tiếp trên trình duyệt
                    tĩnh). Hiện web chạy trực tiếp{' '}
                    <strong className="text-stone-200">Stockfish 19 WASM</strong>{' '}
                    và <strong className="text-stone-200">Maia-3 ONNX</strong>{' '}
                    ngay trên máy bạn.
                  </div>
                </>
              )}
            </div>
          )}

          {/* Large, Easy-to-Click Replay Navigation Bar */}
          <div className="grid grid-cols-4 gap-1.5 border-t border-white/[0.07] bg-[#1e1c1a] px-3.5 py-2.5">
            <button
              type="button"
              onClick={stepStart}
              disabled={!variation && viewIndex === 0}
              title={
                variation
                  ? 'Quay lại điểm rẽ nhánh (↑ hoặc Home)'
                  : 'Về đầu ván (↑ hoặc Home)'
              }
              aria-label="Về đầu ván"
              className="flex items-center justify-center rounded-xl bg-[#2d2b27] py-2.5 text-stone-100 transition hover:bg-[#3d3a36] disabled:opacity-35"
            >
              <FirstMoveIcon className="h-5 w-5" />
            </button>
            <button
              type="button"
              onClick={stepPrev}
              disabled={!variation && viewIndex === 0}
              title="Nước trước (←)"
              aria-label="Nước trước"
              className="flex items-center justify-center rounded-xl bg-[#2d2b27] py-2.5 text-stone-100 transition hover:bg-[#3d3a36] disabled:opacity-35"
            >
              <PrevMoveIcon className="h-5 w-5" />
            </button>
            <button
              type="button"
              onClick={stepNext}
              disabled={
                variation
                  ? variation.cursor >= variation.moves.length
                  : viewIndex >= moves.length
              }
              title="Nước sau (→)"
              aria-label="Nước sau"
              className="flex items-center justify-center rounded-xl bg-[#2d2b27] py-2.5 text-stone-100 transition hover:bg-[#3d3a36] disabled:opacity-35"
            >
              <NextMoveIcon className="h-5 w-5" />
            </button>
            <button
              type="button"
              onClick={stepEnd}
              disabled={
                variation
                  ? variation.cursor >= variation.moves.length
                  : viewIndex >= moves.length
              }
              title="Về nước cuối (↓ hoặc End)"
              aria-label="Về nước cuối"
              className="flex items-center justify-center rounded-xl bg-[#2d2b27] py-2.5 text-stone-100 transition hover:bg-[#3d3a36] disabled:opacity-35"
            >
              <LastMoveIcon className="h-5 w-5" />
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
                className="flex items-center justify-center gap-1.5 rounded-xl bg-[#32302c] px-3 py-2.5 text-xs font-semibold text-stone-100 transition hover:bg-[#403d38]"
              >
                <FlipIcon className="h-4 w-4 shrink-0" />
                <span>{isEn ? 'Flip' : 'Xoay bàn'}</span>
              </button>
              <button
                type="button"
                onClick={handleUndo}
                disabled={!variation && viewIndex === 0}
                className="flex items-center justify-center gap-1.5 rounded-xl bg-[#32302c] px-3 py-2.5 text-xs font-semibold text-stone-100 transition hover:bg-[#403d38] disabled:opacity-35"
              >
                <UndoIcon className="h-4 w-4 shrink-0" />
                <span>{isEn ? 'Undo' : 'Hoàn tác'}</span>
              </button>
              <button
                type="button"
                onClick={handleReset}
                className="flex items-center justify-center gap-1.5 rounded-xl bg-[#81b64c] px-3 py-2.5 text-xs font-bold text-[#161512] shadow-xs transition hover:bg-[#95c75d]"
              >
                <ResetIcon className="h-4 w-4 shrink-0" />
                <span>{isEn ? 'New Game' : 'Ván mới'}</span>
              </button>
            </div>

            <div className="mt-2.5 grid grid-cols-2 gap-2">
              <button
                type="button"
                onClick={() => handleCopy('fen')}
                title={fen}
                className="flex items-center justify-center gap-1.5 rounded-xl bg-[#1a1917] py-2 text-xs font-medium text-stone-300 ring-1 ring-white/[0.06] transition hover:bg-[#2c2a26] hover:text-white"
              >
                <CopyIcon className="h-4 w-4 shrink-0 text-stone-400" />
                <span>
                  {copiedType === 'fen'
                    ? isEn
                      ? 'FEN Copied ✓'
                      : 'Đã sao chép FEN ✓'
                    : isEn
                      ? 'Copy FEN'
                      : 'Sao chép FEN'}
                </span>
              </button>
              <button
                type="button"
                onClick={() => handleCopy('pgn')}
                disabled={moves.length === 0}
                className="flex items-center justify-center gap-1.5 rounded-xl bg-[#1a1917] py-2 text-xs font-medium text-stone-300 ring-1 ring-white/[0.06] transition hover:bg-[#2c2a26] hover:text-white disabled:opacity-35"
              >
                <CopyIcon className="h-4 w-4 shrink-0 text-stone-400" />
                <span>
                  {copiedType === 'pgn'
                    ? isEn
                      ? 'PGN Copied ✓'
                      : 'Đã sao chép PGN ✓'
                    : isEn
                      ? 'Copy PGN'
                      : 'Sao chép PGN'}
                </span>
              </button>
            </div>
          </div>
        </aside>
      </main>

      {/* Legal & Open-Source Attribution Footer (GPL-3.0 compliance) */}
      <footer className="border-t border-white/[0.06] bg-[#1e1c1a] px-4 py-3 text-center text-[11px] text-stone-500">
        {isEn ? (
          <>
            JustChess • Licensed under{' '}
            <span className="font-medium text-stone-400">GPL-3.0-or-later</span>{' '}
            • Engines: Stockfish 19 (GPL-3.0), Maia-3 ONNX (GPL-3.0), chess.js
            (BSD-2-Clause) • Independent open-source project, not affiliated
            with Lichess or Chess.com.
          </>
        ) : (
          <>
            JustChess • Giấy phép{' '}
            <span className="font-medium text-stone-400">GPL-3.0-or-later</span>{' '}
            • Engine: Stockfish 19 (GPL-3.0), Maia-3 ONNX (GPL-3.0), chess.js
            (BSD-2-Clause) • Dự án độc lập, không liên kết chính thức với
            Lichess hay Chess.com.
          </>
        )}
      </footer>

      {/* Import Online / PGN / FEN Modal */}
      {importModalTab !== null && (
        <ImportModal
          lang={lang}
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
