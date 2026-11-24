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
  type LastMove,
  type PendingPromotion,
} from './components/ChessBoard'
import { EvaluationBar } from './components/EvaluationBar'
import { ImportModal, type ImportTab } from './components/ImportModal'
import { PlayerBar } from './components/PlayerBar'
import {
  analyzeWithLocalEngine,
  type LocalEngineResult,
} from './engine/classicalEngine'
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

type EngineMode = 'stockfish' | 'classical' | 'aggressive' | 'compare'

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
    desc: 'NNUE sâu • Top 2 biến',
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
    label: 'So sánh 2 Engine',
    desc: 'Stockfish vs PeSTO',
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
  const engineRef = useRef<StockfishService | null>(null)

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

  const needsStockfish =
    engineEnabled &&
    !isGameOver &&
    (engineMode === 'stockfish' || engineMode === 'compare')

  // Lifecycle: start Stockfish Worker once
  useEffect(() => {
    const service = new StockfishService()
    engineRef.current = service
    service.start((nextEval) => {
      setSfEvaluation(nextEval)
    })

    return () => {
      service.destroy()
      engineRef.current = null
    }
  }, [])

  // Trigger Stockfish analysis when needed
  useEffect(() => {
    const service = engineRef.current
    if (!service) return

    if (!needsStockfish) {
      service.stop()
      return
    }

    const multiPv = engineMode === 'stockfish' ? 2 : 1
    service.analyze(fen, ENGINE_DEPTH, multiPv)
  }, [fen, needsStockfish, engineMode])

  // Local Classical PeSTO / Aggressive Engine analysis (fast depth-3 alpha-beta)
  const localEngineResult: LocalEngineResult | null = useMemo(() => {
    if (!engineEnabled || isGameOver) return null
    if (engineMode === 'classical' || engineMode === 'compare') {
      return analyzeWithLocalEngine(fen, 'classical', 3)
    }
    if (engineMode === 'aggressive') {
      return analyzeWithLocalEngine(fen, 'aggressive', 3)
    }
    return null
  }, [fen, engineEnabled, engineMode, isGameOver])

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
    if (
      (engineMode === 'classical' || engineMode === 'aggressive') &&
      localEngineResult
    ) {
      return {
        ...INITIAL_EVALUATION,
        cp: localEngineResult.cp,
        mate: localEngineResult.mate,
        depth: localEngineResult.depth,
        targetDepth: localEngineResult.depth,
        bestMove: localEngineResult.bestMove,
        pv: localEngineResult.pv,
        isSearching: false,
        isReady: true,
      }
    }
    return sfEvaluation
  })()

  // Build engine suggestion arrows (supports 2 distinct colored arrows in Compare mode!)
  const engineArrows: BoardArrow[] = (() => {
    if (!engineEnabled || !showBestMoveArrow || isGameOver) return []
    const arrows: BoardArrow[] = []

    if (engineMode === 'stockfish' || engineMode === 'compare') {
      const sfBest = parseUciMove(sfEvaluation.bestMove)
      if (sfBest) {
        arrows.push({
          from: sfBest.from,
          to: sfBest.to,
          color: '#16a34a', // Green for Stockfish 19
          opacity: 0.8,
        })
      }
    }

    if (
      (engineMode === 'classical' ||
        engineMode === 'aggressive' ||
        engineMode === 'compare') &&
      localEngineResult?.bestMove
    ) {
      const localBest = parseUciMove(localEngineResult.bestMove)
      if (localBest) {
        const sameAsSf =
          arrows.length > 0 &&
          arrows[0].from === localBest.from &&
          arrows[0].to === localBest.to
        if (!sameAsSf) {
          arrows.push({
            from: localBest.from,
            to: localBest.to,
            color: engineMode === 'aggressive' ? '#f97316' : '#3b82f6', // Blue for PeSTO, Orange for Aggressive
            opacity: 0.78,
          })
        }
      }
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

  const legalMovesForSelected = selectedSquare
    ? displayGame.moves({ square: selectedSquare, verbose: true })
    : []
  const legalTargets = new Set<Square>(legalMovesForSelected.map((m) => m.to))

  const commitMove = (from: Square, to: Square, promotion?: PieceSymbol) => {
    const nextGame = buildGameAtPly(startFen, moves, viewIndex)
    const executed = nextGame.move({ from, to, promotion })
    const truncated = moves.slice(0, viewIndex)
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
    const nextMoves = moves.slice(0, viewIndex - 1)
    setMoves(nextMoves)
    setViewIndex(nextMoves.length)
    setPendingPromotion(null)
    setSelectedSquare(null)
    if (soundEnabled) chessSounds.play('move')
  }

  const handleReset = () => {
    setStartFen(DEFAULT_POSITION)
    setMoves([])
    setViewIndex(0)
    setPlayers(DEFAULT_PLAYERS)
    setGameMeta(null)
    setPendingPromotion(null)
    setSelectedSquare(null)
  }

  const handleImportFen = (loadedFen: string) => {
    setStartFen(loadedFen)
    setMoves([])
    setViewIndex(0)
    setPlayers(DEFAULT_PLAYERS)
    setGameMeta('Thế cờ tùy chỉnh (FEN)')
    setPendingPromotion(null)
    setSelectedSquare(null)
  }

  const handleImportPgn = (pgnText: string) => {
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
    setPlayers({
      white:
        headers.White && headers.White !== '?'
          ? headers.White
          : DEFAULT_PLAYERS.white,
      black:
        headers.Black && headers.Black !== '?'
          ? headers.Black
          : DEFAULT_PLAYERS.black,
    })

    const metaParts = [headers.Event, headers.Date?.slice(0, 4)].filter(
      (v) => v && v !== '?' && v !== '????',
    )
    setGameMeta(metaParts.length > 0 ? metaParts.join(' • ') : 'Ván đấu PGN')
    setPendingPromotion(null)
    setSelectedSquare(null)
  }

  const jumpToPly = (ply: number) => {
    const clamped = Math.max(0, Math.min(moves.length, ply))
    if (clamped !== viewIndex && soundEnabled) {
      chessSounds.play('move')
    }
    setViewIndex(clamped)
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

  const playUciMoveIfValid = (uci: string | null) => {
    const parsed = parseUciMove(uci)
    if (!parsed || isGameOver) return
    commitMove(parsed.from, parsed.to, parsed.promotion)
  }

  const topColor: 'w' | 'b' = orientation === 'w' ? 'b' : 'w'
  const bottomColor: 'w' | 'b' = orientation
  const isReviewingEarlier = viewIndex < moves.length

  return (
    <div className="min-h-screen bg-[#161512] text-stone-200">
      {/* Compact top navigation bar */}
      <header className="border-b border-white/5 bg-[#211f1c]">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-3 px-4 py-3">
          <div className="flex items-center gap-2.5">
            <div className="flex h-8 w-8 items-center justify-center rounded-md bg-[#81b64c] text-lg font-black text-[#161512] shadow-sm">
              ♞
            </div>
            <div>
              <h1 className="text-base leading-tight font-bold tracking-tight text-white">
                JustChess
              </h1>
              <p className="text-[11px] text-stone-400">
                {gameMeta ?? 'Bàn cờ chuẩn thi đấu • Đa Engine'}
              </p>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            {/* Sound toggle */}
            <button
              type="button"
              onClick={() => setSoundEnabled((prev) => !prev)}
              title={soundEnabled ? 'Tắt âm thanh' : 'Bật âm thanh'}
              className={[
                'rounded-lg px-2.5 py-1.5 text-xs font-semibold ring-1 transition',
                soundEnabled
                  ? 'bg-[#302e2b] text-stone-100 ring-white/10 hover:bg-[#3d3a36]'
                  : 'bg-[#161512] text-stone-500 ring-white/5 hover:text-stone-300',
              ].join(' ')}
            >
              {soundEnabled ? '🔊 Âm thanh' : '🔇 Tắt tiếng'}
            </button>

            {/* Import FEN / PGN trigger */}
            <button
              type="button"
              onClick={() => setImportModalTab('pgn')}
              className="rounded-lg bg-[#302e2b] px-3 py-1.5 text-xs font-semibold text-stone-100 ring-1 ring-white/10 transition hover:bg-[#3d3a36]"
            >
              ⇪ Import FEN / PGN
            </button>

            {/* Theme switcher */}
            <div className="flex items-center gap-1 rounded-lg bg-[#161512] p-1 ring-1 ring-white/5">
              {(Object.keys(BOARD_THEMES) as BoardThemeId[]).map((id) => {
                const t = BOARD_THEMES[id]
                const active = id === themeId
                return (
                  <button
                    key={id}
                    type="button"
                    onClick={() => setThemeId(id)}
                    title={t.name}
                    className={[
                      'flex items-center gap-1.5 rounded-md px-2.5 py-1 text-xs font-medium transition',
                      active
                        ? 'bg-[#302e2b] text-white shadow-sm'
                        : 'text-stone-400 hover:text-stone-200',
                    ].join(' ')}
                  >
                    <span className="grid h-3.5 w-3.5 grid-cols-2 overflow-hidden rounded-[2px] ring-1 ring-black/40">
                      <span style={{ backgroundColor: t.light }} />
                      <span style={{ backgroundColor: t.dark }} />
                      <span style={{ backgroundColor: t.dark }} />
                      <span style={{ backgroundColor: t.light }} />
                    </span>
                    <span className="hidden md:inline">{t.name}</span>
                  </button>
                )
              })}
            </div>
          </div>
        </div>
      </header>

      {/* Main Arena */}
      <main className="mx-auto grid max-w-6xl items-start gap-6 px-4 py-6 lg:grid-cols-[minmax(0,636px)_360px] lg:justify-center">
        {/* Left column: Evaluation Bar + Player Bars + Chessboard */}
        <section className="flex flex-col items-center gap-2.5">
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

          {/* Subtle board annotation hint */}
          <p className="w-full max-w-[636px] pl-8 text-[11px] text-stone-500 sm:pl-9">
            Chuột phải: nhấp để đánh dấu ô • kéo để vẽ mũi tên (giữ{' '}
            <span className="text-stone-400">Shift</span> xanh lá,{' '}
            <span className="text-stone-400">Alt</span> xanh dương,{' '}
            <span className="text-stone-400">Ctrl</span> vàng)
          </p>
        </section>

        {/* Right column: Lichess / Chess.com Sidebar */}
        <aside className="flex w-full flex-col overflow-hidden rounded-xl bg-[#262421] shadow-xl ring-1 ring-white/5 lg:h-[716px]">
          {/* Status Header */}
          <div
            className={[
              'flex items-center justify-between gap-2 border-b border-white/5 px-4 py-3 text-sm font-semibold',
              status.tone === 'over'
                ? 'bg-[#81b64c]/15 text-[#a3d160]'
                : status.tone === 'check'
                  ? 'bg-red-500/15 text-red-400'
                  : 'bg-[#2c2a27] text-stone-200',
            ].join(' ')}
          >
            <span className="truncate">{status.text}</span>
            {moves.length > 0 && (
              <span className="shrink-0 rounded bg-black/25 px-2 py-0.5 font-mono text-[11px] text-stone-400">
                {viewIndex}/{moves.length}
              </span>
            )}
          </div>

          {/* Multi-Engine Analysis Panel */}
          <div className="border-b border-white/5 bg-[#1e1c1a] px-3.5 py-2.5">
            <div className="flex items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                <span
                  className={[
                    'h-2 w-2 rounded-full',
                    !engineEnabled
                      ? 'bg-stone-600'
                      : sfEvaluation.error && needsStockfish
                        ? 'bg-red-500'
                        : sfEvaluation.isSearching && needsStockfish
                          ? 'animate-pulse bg-amber-400'
                          : 'bg-[#81b64c]',
                  ].join(' ')}
                />
                <span className="text-xs font-semibold text-stone-200">
                  Phân tích Engine
                </span>
              </div>

              <div className="flex items-center gap-1.5">
                {engineEnabled && (
                  <button
                    type="button"
                    onClick={() => setShowBestMoveArrow((prev) => !prev)}
                    title="Bật/tắt mũi tên gợi ý từ Engine"
                    className={[
                      'rounded px-2 py-0.5 text-[11px] font-medium transition',
                      showBestMoveArrow
                        ? 'bg-[#81b64c]/20 text-[#a3d160]'
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
                    'rounded px-2 py-0.5 text-[11px] font-semibold transition',
                    engineEnabled
                      ? 'bg-[#81b64c] text-[#161512]'
                      : 'bg-[#302e2b] text-stone-400 hover:text-stone-200',
                  ].join(' ')}
                >
                  {engineEnabled ? 'Bật' : 'Tắt'}
                </button>
              </div>
            </div>

            {engineEnabled && (
              <>
                {/* Engine Mode Selector */}
                <div className="mt-2 grid grid-cols-2 gap-1 rounded-lg bg-[#161512] p-1 ring-1 ring-white/5">
                  {ENGINE_MODES.map((m) => (
                    <button
                      key={m.id}
                      type="button"
                      onClick={() => setEngineMode(m.id)}
                      title={m.desc}
                      className={[
                        'rounded-md px-2 py-1 text-[11px] font-medium transition',
                        engineMode === m.id
                          ? 'bg-[#302e2b] text-white shadow-sm'
                          : 'text-stone-400 hover:text-stone-200',
                      ].join(' ')}
                    >
                      {m.label}
                    </button>
                  ))}
                </div>

                {/* Engine Output Area */}
                <div className="mt-2 flex flex-col gap-1.5 text-xs">
                  {sfEvaluation.error && needsStockfish ? (
                    <span className="text-red-400">{sfEvaluation.error}</span>
                  ) : isGameOver ? (
                    <span className="text-[11px] text-stone-400">
                      Ván đấu đã kết thúc.
                    </span>
                  ) : (
                    <>
                      {/* Stockfish 19 MultiPV lines */}
                      {engineMode === 'stockfish' && (
                        <div className="flex flex-col gap-1">
                          {sfEvaluation.lines.length === 0 ? (
                            <span className="text-[11px] text-stone-400">
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
                                className="flex items-center gap-2 rounded bg-[#262421] px-2 py-1 text-left transition hover:bg-[#302e2b]"
                              >
                                <span className="w-11 shrink-0 rounded bg-[#161512] py-0.5 text-center font-mono text-[11px] font-bold text-[#a3d160]">
                                  {formatEvaluationScore(line)}
                                </span>
                                <span className="truncate font-mono text-[11px] text-stone-200">
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

                      {/* Classical PeSTO or Aggressive single engine output */}
                      {(engineMode === 'classical' ||
                        engineMode === 'aggressive') &&
                        localEngineResult && (
                          <div className="flex flex-col gap-1.5 rounded bg-[#262421] p-2">
                            <div className="flex items-center justify-between gap-2">
                              <div className="flex items-center gap-2">
                                <span
                                  className={[
                                    'rounded bg-[#161512] px-2 py-0.5 font-mono text-[11px] font-bold',
                                    engineMode === 'aggressive'
                                      ? 'text-orange-400'
                                      : 'text-sky-400',
                                  ].join(' ')}
                                >
                                  {formatEvaluationScore(localEngineResult)}
                                </span>
                                <span className="text-[11px] text-stone-400">
                                  Depth {localEngineResult.depth}
                                </span>
                              </div>
                              {localEngineResult.bestMoveSan && (
                                <button
                                  type="button"
                                  onClick={() =>
                                    playUciMoveIfValid(
                                      localEngineResult.bestMove,
                                    )
                                  }
                                  className="rounded bg-[#302e2b] px-2 py-0.5 font-mono text-[11px] font-semibold text-stone-100 transition hover:bg-[#3d3a36]"
                                >
                                  Best: {localEngineResult.bestMoveSan}
                                </button>
                              )}
                            </div>
                            {localEngineResult.insights.map((note) => (
                              <p
                                key={note}
                                className="text-[11px] text-stone-400"
                              >
                                • {note}
                              </p>
                            ))}
                          </div>
                        )}

                      {/* Side-by-side Compare mode: Stockfish 19 vs Classical PeSTO */}
                      {engineMode === 'compare' && (
                        <div className="flex flex-col gap-1">
                          <div className="flex items-center justify-between gap-2 rounded bg-[#262421] px-2 py-1.5">
                            <div className="flex items-center gap-1.5">
                              <span className="h-2.5 w-2.5 rounded-full bg-green-600" />
                              <span className="text-[11px] font-semibold text-stone-200">
                                Stockfish 19
                              </span>
                              <span className="font-mono text-[10px] text-stone-500">
                                d{sfEvaluation.depth}
                              </span>
                            </div>
                            <div className="flex items-center gap-1.5">
                              <span className="font-mono text-[11px] font-bold text-[#a3d160]">
                                {formatEvaluationScore(sfEvaluation)}
                              </span>
                              {sfEvaluation.bestMove && (
                                <button
                                  type="button"
                                  onClick={() =>
                                    playUciMoveIfValid(sfEvaluation.bestMove)
                                  }
                                  className="rounded bg-[#302e2b] px-1.5 py-0.5 font-mono text-[11px] text-stone-100 hover:bg-[#3d3a36]"
                                >
                                  {uciLineToSan(fen, [sfEvaluation.bestMove], 1)}
                                </button>
                              )}
                            </div>
                          </div>

                          {localEngineResult && (
                            <div className="flex items-center justify-between gap-2 rounded bg-[#262421] px-2 py-1.5">
                              <div className="flex items-center gap-1.5">
                                <span className="h-2.5 w-2.5 rounded-full bg-blue-500" />
                                <span className="text-[11px] font-semibold text-stone-200">
                                  PeSTO Cổ điển
                                </span>
                                <span className="font-mono text-[10px] text-stone-500">
                                  d{localEngineResult.depth}
                                </span>
                              </div>
                              <div className="flex items-center gap-1.5">
                                <span className="font-mono text-[11px] font-bold text-sky-400">
                                  {formatEvaluationScore(localEngineResult)}
                                </span>
                                {localEngineResult.bestMoveSan && (
                                  <button
                                    type="button"
                                    onClick={() =>
                                      playUciMoveIfValid(
                                        localEngineResult.bestMove,
                                      )
                                    }
                                    className="rounded bg-[#302e2b] px-1.5 py-0.5 font-mono text-[11px] text-stone-100 hover:bg-[#3d3a36]"
                                  >
                                    {localEngineResult.bestMoveSan}
                                  </button>
                                )}
                              </div>
                            </div>
                          )}
                        </div>
                      )}
                    </>
                  )}
                </div>
              </>
            )}
          </div>

          {/* Reviewing banner if not at latest ply */}
          {isReviewingEarlier && (
            <div className="flex items-center justify-between border-b border-amber-500/20 bg-amber-500/10 px-4 py-1.5 text-[11px] text-amber-300">
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

          {/* Move List Table */}
          <div className="min-h-40 flex-1 overflow-y-auto px-2 py-2">
            {moveRows.length === 0 ? (
              <div className="flex h-full flex-col items-center justify-center gap-2 py-8 text-center text-stone-500">
                <p className="text-sm font-medium text-stone-400">
                  Sẵn sàng bắt đầu
                </p>
                <p className="max-w-[240px] text-xs">
                  Kéo thả quân cờ để đi, hoặc nạp thế cờ FEN / dán PGN để phân tích.
                </p>
                <div className="mt-2 flex gap-2">
                  <button
                    type="button"
                    onClick={() => setImportModalTab('fen')}
                    className="rounded-md bg-[#302e2b] px-2.5 py-1.5 text-xs font-medium text-stone-200 transition hover:bg-[#3d3a36]"
                  >
                    Tải FEN
                  </button>
                  <button
                    type="button"
                    onClick={() => setImportModalTab('pgn')}
                    className="rounded-md bg-[#302e2b] px-2.5 py-1.5 text-xs font-medium text-stone-200 transition hover:bg-[#3d3a36]"
                  >
                    Dán PGN
                  </button>
                </div>
              </div>
            ) : (
              <div className="font-mono text-sm">
                {moveRows.map((row, idx) => (
                  <div
                    key={`${row.moveNumber}-${idx}`}
                    className={[
                      'grid grid-cols-[42px_1fr_1fr] items-center rounded px-1.5 py-0.5',
                      idx % 2 === 1 ? 'bg-white/[0.025]' : '',
                    ].join(' ')}
                  >
                    <span className="text-xs text-stone-500">
                      {row.moveNumber}.
                    </span>

                    {row.white ? (
                      <button
                        ref={viewIndex === row.white.ply ? activeMoveRef : null}
                        type="button"
                        onClick={() => jumpToPly(row.white!.ply)}
                        className={[
                          'rounded px-2 py-1 text-left font-medium transition',
                          viewIndex === row.white.ply
                            ? 'bg-[#81b64c]/30 text-[#d4f2ab]'
                            : 'text-stone-200 hover:bg-white/10',
                        ].join(' ')}
                      >
                        {row.white.san}
                      </button>
                    ) : (
                      <span className="px-2 py-1 text-stone-600">...</span>
                    )}

                    {row.black ? (
                      <button
                        ref={viewIndex === row.black.ply ? activeMoveRef : null}
                        type="button"
                        onClick={() => jumpToPly(row.black!.ply)}
                        className={[
                          'rounded px-2 py-1 text-left font-medium transition',
                          viewIndex === row.black.ply
                            ? 'bg-[#81b64c]/30 text-[#d4f2ab]'
                            : 'text-stone-300 hover:bg-white/10',
                        ].join(' ')}
                      >
                        {row.black.san}
                      </button>
                    ) : (
                      <span />
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Replay Navigation Bar */}
          <div className="grid grid-cols-4 gap-1 border-t border-white/5 bg-[#1e1c1a] px-3 py-2">
            <button
              type="button"
              onClick={() => jumpToPly(0)}
              disabled={viewIndex === 0}
              title="Về đầu ván (Home)"
              className="rounded-md bg-[#2c2a27] py-1.5 text-xs font-bold text-stone-200 transition hover:bg-[#3d3a36] disabled:cursor-not-allowed disabled:opacity-35"
            >
              |&lt;
            </button>
            <button
              type="button"
              onClick={() => jumpToPly(viewIndex - 1)}
              disabled={viewIndex === 0}
              title="Nước trước (←)"
              className="rounded-md bg-[#2c2a27] py-1.5 text-xs font-bold text-stone-200 transition hover:bg-[#3d3a36] disabled:cursor-not-allowed disabled:opacity-35"
            >
              &lt;
            </button>
            <button
              type="button"
              onClick={() => jumpToPly(viewIndex + 1)}
              disabled={viewIndex >= moves.length}
              title="Nước sau (→)"
              className="rounded-md bg-[#2c2a27] py-1.5 text-xs font-bold text-stone-200 transition hover:bg-[#3d3a36] disabled:cursor-not-allowed disabled:opacity-35"
            >
              &gt;
            </button>
            <button
              type="button"
              onClick={() => jumpToPly(moves.length)}
              disabled={viewIndex >= moves.length}
              title="Về nước cuối (End)"
              className="rounded-md bg-[#2c2a27] py-1.5 text-xs font-bold text-stone-200 transition hover:bg-[#3d3a36] disabled:cursor-not-allowed disabled:opacity-35"
            >
              &gt;|
            </button>
          </div>

          {/* Action Controls */}
          <div className="border-t border-white/5 bg-[#211f1c] p-3">
            <div className="grid grid-cols-3 gap-2">
              <button
                type="button"
                onClick={() =>
                  setOrientation((prev) => (prev === 'w' ? 'b' : 'w'))
                }
                className="rounded-lg bg-[#302e2b] px-3 py-2 text-xs font-semibold text-stone-200 transition hover:bg-[#3d3a36]"
              >
                ⇅ Xoay bàn
              </button>
              <button
                type="button"
                onClick={handleUndo}
                disabled={viewIndex === 0}
                className="rounded-lg bg-[#302e2b] px-3 py-2 text-xs font-semibold text-stone-200 transition hover:bg-[#3d3a36] disabled:cursor-not-allowed disabled:opacity-40"
              >
                ↶ Hoàn tác
              </button>
              <button
                type="button"
                onClick={handleReset}
                className="rounded-lg bg-[#81b64c] px-3 py-2 text-xs font-bold text-[#161512] transition hover:bg-[#95c75d]"
              >
                Ván mới
              </button>
            </div>

            {/* Compact FEN & PGN Footer */}
            <div className="mt-3 flex items-center justify-between gap-1.5 rounded-md bg-[#161512] px-2.5 py-2 ring-1 ring-white/5">
              <code className="truncate text-[11px] text-stone-400" title={fen}>
                {fen}
              </code>
              <div className="flex shrink-0 gap-1">
                <button
                  type="button"
                  onClick={() => handleCopy('fen')}
                  className="rounded bg-[#302e2b] px-2 py-1 text-[11px] font-medium text-stone-300 transition hover:bg-[#3d3a36]"
                >
                  {copiedType === 'fen' ? 'Đã copy' : 'FEN'}
                </button>
                <button
                  type="button"
                  onClick={() => handleCopy('pgn')}
                  disabled={moves.length === 0}
                  className="rounded bg-[#302e2b] px-2 py-1 text-[11px] font-medium text-stone-300 transition hover:bg-[#3d3a36] disabled:cursor-not-allowed disabled:opacity-40"
                >
                  {copiedType === 'pgn' ? 'Đã copy' : 'PGN'}
                </button>
              </div>
            </div>
          </div>
        </aside>
      </main>

      {/* Import FEN / PGN Modal */}
      {importModalTab !== null && (
        <ImportModal
          initialTab={importModalTab}
          currentFen={fen}
          onImportFen={handleImportFen}
          onImportPgn={handleImportPgn}
          onClose={() => setImportModalTab(null)}
        />
      )}
    </div>
  )
}

export default App
