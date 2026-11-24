import { Chess, DEFAULT_POSITION, type PieceSymbol, type Square } from 'chess.js'
import { useEffect, useRef, useState } from 'react'
import {
  ChessBoard,
  type LastMove,
  type PendingPromotion,
} from './components/ChessBoard'
import { ImportModal, type ImportTab } from './components/ImportModal'
import { PlayerBar } from './components/PlayerBar'
import {
  BOARD_THEMES,
  getMaterialSummary,
  type BoardThemeId,
} from './utils/boardThemes'

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

export function App() {
  const [startFen, setStartFen] = useState<string>(DEFAULT_POSITION)
  const [moves, setMoves] = useState<StoredMove[]>([])
  const [viewIndex, setViewIndex] = useState<number>(0)
  const [players, setPlayers] = useState<PlayerNames>(DEFAULT_PLAYERS)
  const [gameMeta, setGameMeta] = useState<string | null>(null)

  const [selectedSquare, setSelectedSquare] = useState<Square | null>(null)
  const [orientation, setOrientation] = useState<'w' | 'b'>('w')
  const [themeId, setThemeId] = useState<BoardThemeId>('chesscom')
  const [pendingPromotion, setPendingPromotion] =
    useState<PendingPromotion | null>(null)
  const [importModalTab, setImportModalTab] = useState<ImportTab | null>(null)
  const [copiedType, setCopiedType] = useState<'fen' | 'pgn' | null>(null)

  const activeMoveRef = useRef<HTMLButtonElement>(null)

  const displayGame = buildGameAtPly(startFen, moves, viewIndex)
  const fen = displayGame.fen()
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
        setViewIndex((prev) => Math.max(0, prev - 1))
        setSelectedSquare(null)
        setPendingPromotion(null)
      } else if (e.key === 'ArrowRight') {
        e.preventDefault()
        setViewIndex((prev) => Math.min(moves.length, prev + 1))
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
  }, [importModalTab, moves.length])

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
    setMoves(updatedMoves)
    setViewIndex(updatedMoves.length)
    setSelectedSquare(null)
    setPendingPromotion(null)
  }

  const tryMove = (from: Square, to: Square) => {
    if (displayGame.isGameOver()) return

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
    if (displayGame.isGameOver() || pendingPromotion) return

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
      white: headers.White && headers.White !== '?' ? headers.White : DEFAULT_PLAYERS.white,
      black: headers.Black && headers.Black !== '?' ? headers.Black : DEFAULT_PLAYERS.black,
    })

    const metaParts = [headers.Event, headers.Date?.slice(0, 4)].filter(
      (v) => v && v !== '?' && v !== '????',
    )
    setGameMeta(metaParts.length > 0 ? metaParts.join(' • ') : 'Ván đấu PGN')
    setPendingPromotion(null)
    setSelectedSquare(null)
  }

  const jumpToPly = (ply: number) => {
    setViewIndex(Math.max(0, Math.min(moves.length, ply)))
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
                {gameMeta ?? 'Bàn cờ chuẩn thi đấu'}
              </p>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2">
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
      <main className="mx-auto grid max-w-6xl items-start gap-6 px-4 py-6 lg:grid-cols-[minmax(0,600px)_340px] lg:justify-center">
        {/* Left column: Player Bars + Chessboard */}
        <section className="flex flex-col items-center gap-2.5">
          <PlayerBar
            name={topColor === 'w' ? players.white : players.black}
            color={topColor}
            isTurn={!displayGame.isGameOver() && turn === topColor}
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

          <ChessBoard
            board={board}
            turn={turn}
            orientation={orientation}
            theme={theme}
            selectedSquare={selectedSquare}
            legalTargets={legalTargets}
            lastMove={lastMove}
            checkedKingSquare={checkedKingSquare}
            pendingPromotion={pendingPromotion}
            onSquareSelect={handleSquareSelect}
            onMoveAttempt={tryMove}
            onSelectPromotion={handleSelectPromotion}
            onCancelPromotion={() => setPendingPromotion(null)}
          />

          <PlayerBar
            name={bottomColor === 'w' ? players.white : players.black}
            color={bottomColor}
            isTurn={!displayGame.isGameOver() && turn === bottomColor}
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
        </section>

        {/* Right column: Lichess / Chess.com Sidebar */}
        <aside className="flex w-full flex-col overflow-hidden rounded-xl bg-[#262421] shadow-xl ring-1 ring-white/5 lg:h-[696px]">
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

          {/* Reviewing banner if not at latest ply */}
          {isReviewingEarlier && (
            <div className="flex items-center justify-between border-b border-amber-500/20 bg-amber-500/10 px-4 py-1.5 text-[11px] text-amber-300">
              <span>Đang xem lại nước {viewIndex}/{moves.length}</span>
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
          <div className="min-h-56 flex-1 overflow-y-auto px-2 py-2">
            {moveRows.length === 0 ? (
              <div className="flex h-full flex-col items-center justify-center gap-2 py-12 text-center text-stone-500">
                <p className="text-sm font-medium text-stone-400">
                  Sẵn sàng bắt đầu
                </p>
                <p className="max-w-[240px] text-xs">
                  Kéo thả quân cờ để đi, hoặc nạp thế cờ FEN / dán PGN để xem lại.
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
