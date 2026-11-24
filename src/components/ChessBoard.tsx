import type { PieceSymbol, Square } from 'chess.js'
import { useRef, useState } from 'react'
import type { BoardTheme } from '../utils/boardThemes'
import { ChessPiece } from './ChessPiece'

const FILES = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'] as const
const RANKS = ['8', '7', '6', '5', '4', '3', '2', '1'] as const
const PROMOTION_PIECES: PieceSymbol[] = ['q', 'r', 'b', 'n']

export interface BoardCell {
  square: Square
  type: PieceSymbol
  color: 'w' | 'b'
}

export interface LastMove {
  from: Square
  to: Square
}

export interface PendingPromotion {
  from: Square
  to: Square
  color: 'w' | 'b'
}

interface ChessBoardProps {
  board: (BoardCell | null)[][]
  turn: 'w' | 'b'
  orientation: 'w' | 'b'
  theme: BoardTheme
  selectedSquare: Square | null
  legalTargets: Set<Square>
  lastMove: LastMove | null
  bestMoveArrow?: LastMove | null
  checkedKingSquare: Square | null
  pendingPromotion: PendingPromotion | null
  onSquareSelect: (square: Square) => void
  onMoveAttempt: (from: Square, to: Square) => void
  onSelectPromotion: (piece: PieceSymbol) => void
  onCancelPromotion: () => void
}

interface DragState {
  from: Square
  piece: BoardCell
  x: number
  y: number
  hasMoved: boolean
}

export function ChessBoard({
  board,
  turn,
  orientation,
  theme,
  selectedSquare,
  legalTargets,
  lastMove,
  bestMoveArrow = null,
  checkedKingSquare,
  pendingPromotion,
  onSquareSelect,
  onMoveAttempt,
  onSelectPromotion,
  onCancelPromotion,
}: ChessBoardProps) {
  const boardRef = useRef<HTMLDivElement>(null)
  const [dragState, setDragState] = useState<DragState | null>(null)
  const [hoverSquare, setHoverSquare] = useState<Square | null>(null)
  const dragOriginRef = useRef<{ x: number; y: number } | null>(null)

  const displayRanks = orientation === 'w' ? RANKS : [...RANKS].reverse()
  const displayFiles = orientation === 'w' ? FILES : [...FILES].reverse()

  const getSquareFromPoint = (clientX: number, clientY: number): Square | null => {
    const rect = boardRef.current?.getBoundingClientRect()
    if (!rect) return null
    if (
      clientX < rect.left ||
      clientX > rect.right ||
      clientY < rect.top ||
      clientY > rect.bottom
    ) {
      return null
    }
    const col = Math.min(7, Math.max(0, Math.floor(((clientX - rect.left) / rect.width) * 8)))
    const row = Math.min(7, Math.max(0, Math.floor(((clientY - rect.top) / rect.height) * 8)))
    return `${displayFiles[col]}${displayRanks[row]}` as Square
  }

  const handlePointerDown = (
    e: React.PointerEvent<HTMLButtonElement>,
    square: Square,
    piece: BoardCell | null,
  ) => {
    if (pendingPromotion || e.button !== 0) return

    if (piece && piece.color === turn) {
      e.currentTarget.setPointerCapture(e.pointerId)
      dragOriginRef.current = { x: e.clientX, y: e.clientY }
      setDragState({
        from: square,
        piece,
        x: e.clientX,
        y: e.clientY,
        hasMoved: false,
      })
      if (selectedSquare !== square) {
        onSquareSelect(square)
      }
      return
    }

    onSquareSelect(square)
  }

  const handlePointerMove = (e: React.PointerEvent<HTMLButtonElement>) => {
    if (!dragState) return
    const origin = dragOriginRef.current
    const movedEnough =
      dragState.hasMoved ||
      (origin !== null &&
        Math.hypot(e.clientX - origin.x, e.clientY - origin.y) > 4)

    setDragState((prev) =>
      prev
        ? {
            ...prev,
            x: e.clientX,
            y: e.clientY,
            hasMoved: movedEnough,
          }
        : null,
    )

    if (movedEnough) {
      setHoverSquare(getSquareFromPoint(e.clientX, e.clientY))
    }
  }

  const handlePointerUp = (e: React.PointerEvent<HTMLButtonElement>) => {
    if (!dragState) return
    const dropSquare = getSquareFromPoint(e.clientX, e.clientY)
    const { from, hasMoved } = dragState

    setDragState(null)
    setHoverSquare(null)
    dragOriginRef.current = null

    if (hasMoved && dropSquare && dropSquare !== from) {
      onMoveAttempt(from, dropSquare)
    }
  }

  const handlePointerCancel = () => {
    setDragState(null)
    setHoverSquare(null)
    dragOriginRef.current = null
  }

  // Calculate inline promotion column position
  const promotionColIndex = pendingPromotion
    ? displayFiles.indexOf(pendingPromotion.to[0] as (typeof FILES)[number])
    : -1
  const promotionStartsAtTop =
    pendingPromotion !== null &&
    ((orientation === 'w' && pendingPromotion.color === 'w') ||
      (orientation === 'b' && pendingPromotion.color === 'b'))

  return (
    <div className="relative w-full max-w-[600px] select-none">
      <div
        ref={boardRef}
        className="relative grid aspect-square w-full grid-cols-8 overflow-hidden rounded-md shadow-[0_14px_40px_rgba(0,0,0,0.55)] ring-1 ring-black/60 touch-none"
      >
        {displayRanks.map((rank, displayRow) =>
          displayFiles.map((file, displayCol) => {
            const square = `${file}${rank}` as Square
            const boardRow = RANKS.indexOf(rank)
            const boardCol = FILES.indexOf(file)
            const piece = board[boardRow][boardCol]

            const isLight = (boardRow + boardCol) % 2 === 0
            const isSelected = selectedSquare === square
            const isLastMove =
              lastMove !== null &&
              (lastMove.from === square || lastMove.to === square)
            const isLegalTarget = legalTargets.has(square)
            const isCheckedKing = checkedKingSquare === square
            const isDragSource =
              dragState?.hasMoved && dragState.from === square
            const isDragHoverTarget =
              dragState?.hasMoved &&
              hoverSquare === square &&
              isLegalTarget

            let squareBg = isLight ? theme.light : theme.dark
            if (isLastMove) {
              squareBg = isLight ? theme.lastMoveLight : theme.lastMoveDark
            }

            return (
              <button
                key={square}
                type="button"
                aria-label={`Square ${square}`}
                onPointerDown={(e) => handlePointerDown(e, square, piece)}
                onPointerMove={handlePointerMove}
                onPointerUp={handlePointerUp}
                onPointerCancel={handlePointerCancel}
                style={{ backgroundColor: squareBg }}
                className={[
                  'relative flex aspect-square items-center justify-center p-0 focus:outline-none',
                  piece && piece.color === turn
                    ? 'cursor-grab active:cursor-grabbing'
                    : isLegalTarget
                      ? 'cursor-pointer'
                      : 'cursor-default',
                ].join(' ')}
              >
                {/* Selected square tint */}
                {isSelected && (
                  <span
                    className="pointer-events-none absolute inset-0"
                    style={{ backgroundColor: theme.selected }}
                  />
                )}

                {/* King in check Lichess-style red radial glow */}
                {isCheckedKing && (
                  <span
                    className="pointer-events-none absolute inset-0"
                    style={{
                      background:
                        'radial-gradient(ellipse at center, rgba(255,0,0,0.95) 0%, rgba(231,0,0,0.85) 30%, rgba(169,0,0,0) 88%)',
                    }}
                  />
                )}

                {/* Drag hover ring */}
                {isDragHoverTarget && (
                  <span className="pointer-events-none absolute inset-0 ring-4 ring-inset ring-white/60" />
                )}

                {/* Rank coordinates on left edge */}
                {displayCol === 0 && (
                  <span
                    className="pointer-events-none absolute top-[3px] left-[4px] text-[11px] leading-none font-bold sm:text-xs"
                    style={{
                      color: isLight ? theme.coordOnLight : theme.coordOnDark,
                    }}
                  >
                    {rank}
                  </span>
                )}

                {/* File coordinates on bottom edge */}
                {displayRow === 7 && (
                  <span
                    className="pointer-events-none absolute right-[4px] bottom-[3px] text-[11px] leading-none font-bold sm:text-xs"
                    style={{
                      color: isLight ? theme.coordOnLight : theme.coordOnDark,
                    }}
                  >
                    {file}
                  </span>
                )}

                {/* Legal move dot (empty square) */}
                {isLegalTarget && !piece && (
                  <span className="pointer-events-none z-10 h-[30%] w-[30%] rounded-full bg-black/18 transition-transform" />
                )}

                {/* Legal capture ring (occupied square) */}
                {isLegalTarget && piece && (
                  <span className="pointer-events-none absolute inset-[5%] z-10 rounded-full border-[5px] border-black/18 sm:border-[6px]" />
                )}

                {/* Chess Piece */}
                {piece && (
                  <div
                    className={[
                      'z-20 flex h-[88%] w-[88%] items-center justify-center transition-opacity duration-75',
                      isDragSource ? 'opacity-25' : 'opacity-100',
                    ].join(' ')}
                  >
                    <ChessPiece
                      type={piece.type}
                      color={piece.color}
                      className="h-full w-full"
                    />
                  </div>
                )}
              </button>
            )
          }),
        )}

        {/* Stockfish Best-Move Arrow Overlay */}
        {bestMoveArrow && (() => {
          const fromCol = displayFiles.indexOf(
            bestMoveArrow.from[0] as (typeof FILES)[number],
          )
          const fromRow = displayRanks.indexOf(
            bestMoveArrow.from[1] as (typeof RANKS)[number],
          )
          const toCol = displayFiles.indexOf(
            bestMoveArrow.to[0] as (typeof FILES)[number],
          )
          const toRow = displayRanks.indexOf(
            bestMoveArrow.to[1] as (typeof RANKS)[number],
          )
          if (fromCol < 0 || fromRow < 0 || toCol < 0 || toRow < 0) return null

          const x1 = (fromCol + 0.5) * 100
          const y1 = (fromRow + 0.5) * 100
          const x2 = (toCol + 0.5) * 100
          const y2 = (toRow + 0.5) * 100
          const dx = x2 - x1
          const dy = y2 - y1
          const len = Math.hypot(dx, dy)
          if (len === 0) return null
          // Shorten tip slightly so arrowhead lands neatly inside target square
          const endX = x2 - (dx / len) * 20
          const endY = y2 - (dy / len) * 20

          return (
            <svg
              viewBox="0 0 800 800"
              className="pointer-events-none absolute inset-0 z-25 h-full w-full opacity-80"
              aria-hidden="true"
            >
              <defs>
                <marker
                  id="stockfish-arrowhead"
                  markerWidth="4"
                  markerHeight="4"
                  refX="2.2"
                  refY="2"
                  orient="auto"
                >
                  <polygon points="0 0, 4 2, 0 4" fill="#15803d" />
                </marker>
              </defs>
              <line
                x1={x1}
                y1={y1}
                x2={endX}
                y2={endY}
                stroke="#15803d"
                strokeWidth="18"
                strokeLinecap="round"
                markerEnd="url(#stockfish-arrowhead)"
              />
            </svg>
          )
        })()}

        {/* Inline Chess.com / Lichess style Promotion Picker */}
        {pendingPromotion && promotionColIndex >= 0 && (
          <div
            className="absolute inset-0 z-30 bg-black/45 backdrop-blur-[1px]"
            onClick={onCancelPromotion}
          >
            <div
              onClick={(e) => e.stopPropagation()}
              style={{
                left: `${promotionColIndex * 12.5}%`,
                width: '12.5%',
                top: promotionStartsAtTop ? '0%' : '50%',
              }}
              className="absolute flex flex-col overflow-hidden rounded-md bg-stone-100 shadow-2xl ring-2 ring-black/40"
            >
              {(promotionStartsAtTop
                ? PROMOTION_PIECES
                : [...PROMOTION_PIECES].reverse()
              ).map((pieceType) => (
                <button
                  key={pieceType}
                  type="button"
                  onClick={() => onSelectPromotion(pieceType)}
                  className="flex aspect-square items-center justify-center bg-stone-100 p-1 transition hover:bg-amber-200"
                  aria-label={`Promote to ${pieceType}`}
                >
                  <ChessPiece
                    type={pieceType}
                    color={pendingPromotion.color}
                    className="h-full w-full"
                  />
                </button>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* Floating piece while dragging */}
      {dragState?.hasMoved && (
        <div
          className="pointer-events-none fixed z-50 h-16 w-16 -translate-x-1/2 -translate-y-1/2 sm:h-20 sm:w-20"
          style={{ left: dragState.x, top: dragState.y }}
        >
          <ChessPiece
            type={dragState.piece.type}
            color={dragState.piece.color}
            className="h-full w-full scale-110 drop-shadow-[0_10px_14px_rgba(0,0,0,0.45)]"
          />
        </div>
      )}
    </div>
  )
}
