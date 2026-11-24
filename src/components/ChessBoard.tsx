import type { PieceSymbol, Square } from 'chess.js'
import { memo, useEffect, useRef, useState } from 'react'
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

export interface BoardArrow {
  from: Square
  to: Square
  color: string
  opacity?: number
}

export interface BoardMoveBadge {
  square: Square
  symbol: string
  color: string
  textColor: string
  label: string
}

export interface PendingPromotion {
  from: Square
  to: Square
  color: 'w' | 'b'
}

interface ChessBoardProps {
  board: (BoardCell | null)[][]
  fenKey: string
  turn: 'w' | 'b'
  orientation: 'w' | 'b'
  theme: BoardTheme
  selectedSquare: Square | null
  legalTargets: Set<Square>
  lastMove: LastMove | null
  moveBadge?: BoardMoveBadge | null
  engineArrows?: BoardArrow[]
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

interface RightDragState {
  from: Square
  current: Square
  color: string
  squareColor: string
}

function getAnnotationColors(e: {
  shiftKey: boolean
  altKey: boolean
  ctrlKey: boolean
  metaKey: boolean
}): {
  arrowColor: string
  squareColor: string
} {
  if (e.shiftKey) {
    return { arrowColor: '#22c55e', squareColor: 'rgba(34, 197, 94, 0.72)' }
  }
  if (e.altKey) {
    return { arrowColor: '#3b82f6', squareColor: 'rgba(59, 130, 246, 0.72)' }
  }
  if (e.ctrlKey || e.metaKey) {
    return { arrowColor: '#eab308', squareColor: 'rgba(234, 179, 8, 0.74)' }
  }
  // Default Chess.com / Lichess style: warm amber arrow, coral-red square
  return { arrowColor: '#f59e0b', squareColor: 'rgba(235, 97, 80, 0.78)' }
}

function buildArrowHeadPoints(
  tipX: number,
  tipY: number,
  ux: number,
  uy: number,
  headLength = 34,
  headHalfWidth = 24,
): string {
  const px = -uy
  const py = ux
  const baseX = tipX - ux * headLength
  const baseY = tipY - uy * headLength

  return [
    `${tipX},${tipY}`,
    `${baseX + px * headHalfWidth},${baseY + py * headHalfWidth}`,
    `${baseX - px * headHalfWidth},${baseY - py * headHalfWidth}`,
  ].join(' ')
}

function renderArrowShape(
  key: string,
  fromCol: number,
  fromRow: number,
  toCol: number,
  toRow: number,
  color: string,
  opacity = 0.84,
) {
  const x1 = (fromCol + 0.5) * 100
  const y1 = (fromRow + 0.5) * 100
  const x2 = (toCol + 0.5) * 100
  const y2 = (toRow + 0.5) * 100

  const dCol = toCol - fromCol
  const dRow = toRow - fromRow
  const absCol = Math.abs(dCol)
  const absRow = Math.abs(dRow)
  const isKnightMove =
    (absCol === 1 && absRow === 2) || (absCol === 2 && absRow === 1)

  const headLength = 34
  const shaftWidth = 18

  if (isKnightMove) {
    // Classic Chess.com / Lichess L-shaped knight arrow:
    // travel 2 squares along the long axis, bend 90deg, then enter target square.
    const dirX = Math.sign(dCol)
    const dirY = Math.sign(dRow)

    let startX: number
    let startY: number
    let cornerX: number
    let cornerY: number
    let shaftEndX: number
    let shaftEndY: number
    let tipX: number
    let tipY: number
    let headUx: number
    let headUy: number

    if (absRow === 2) {
      // 2 squares vertical, then 1 square horizontal
      startX = x1
      startY = y1 + dirY * 22
      cornerX = x1
      cornerY = y2
      tipX = x2 - dirX * 4
      tipY = y2
      shaftEndX = tipX - dirX * (headLength - 4)
      shaftEndY = y2
      headUx = dirX
      headUy = 0
    } else {
      // 2 squares horizontal, then 1 square vertical
      startX = x1 + dirX * 22
      startY = y1
      cornerX = x2
      cornerY = y1
      tipX = x2
      tipY = y2 - dirY * 4
      shaftEndX = x2
      shaftEndY = tipY - dirY * (headLength - 4)
      headUx = 0
      headUy = dirY
    }

    return (
      <g key={key} opacity={opacity}>
        <path
          d={`M ${startX} ${startY} L ${cornerX} ${cornerY} L ${shaftEndX} ${shaftEndY}`}
          fill="none"
          stroke={color}
          strokeWidth={shaftWidth}
          strokeLinecap="round"
          strokeLinejoin="round"
        />
        <polygon
          points={buildArrowHeadPoints(tipX, tipY, headUx, headUy, headLength)}
          fill={color}
        />
      </g>
    )
  }

  // Straight / diagonal arrow
  const dx = x2 - x1
  const dy = y2 - y1
  const len = Math.hypot(dx, dy)
  if (len === 0) return null

  const ux = dx / len
  const uy = dy / len

  const startX = x1 + ux * 22
  const startY = y1 + uy * 22
  const tipX = x2 - ux * 6
  const tipY = y2 - uy * 6
  const shaftEndX = tipX - ux * (headLength - 4)
  const shaftEndY = tipY - uy * (headLength - 4)

  return (
    <g key={key} opacity={opacity}>
      <line
        x1={startX}
        y1={startY}
        x2={shaftEndX}
        y2={shaftEndY}
        stroke={color}
        strokeWidth={shaftWidth}
        strokeLinecap="round"
      />
      <polygon
        points={buildArrowHeadPoints(tipX, tipY, ux, uy, headLength)}
        fill={color}
      />
    </g>
  )
}

export const ChessBoard = memo(function ChessBoard({
  board,
  fenKey,
  turn,
  orientation,
  theme,
  selectedSquare,
  legalTargets,
  lastMove,
  moveBadge = null,
  engineArrows = [],
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

  // Right-click user annotations scoped to the current FEN (auto-resets on position change)
  const [annotations, setAnnotations] = useState<{
    fenKey: string
    highlights: Record<string, string>
    arrows: BoardArrow[]
  }>({
    fenKey,
    highlights: {},
    arrows: [],
  })
  const [rightDrag, setRightDrag] = useState<RightDragState | null>(null)
  const rightDragRef = useRef<RightDragState | null>(null)

  const userHighlights =
    annotations.fenKey === fenKey ? annotations.highlights : {}
  const userArrows = annotations.fenKey === fenKey ? annotations.arrows : []

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
    const col = Math.min(
      7,
      Math.max(0, Math.floor(((clientX - rect.left) / rect.width) * 8)),
    )
    const row = Math.min(
      7,
      Math.max(0, Math.floor(((clientY - rect.top) / rect.height) * 8)),
    )
    return `${displayFiles[col]}${displayRanks[row]}` as Square
  }

  // Track right-click drag/release on window so contextmenu/pointercancel never drops highlights or arrows
  useEffect(() => {
    const handleWindowMouseMove = (e: MouseEvent) => {
      const active = rightDragRef.current
      if (!active) return
      const rect = boardRef.current?.getBoundingClientRect()
      if (!rect) return
      if (
        e.clientX < rect.left ||
        e.clientX > rect.right ||
        e.clientY < rect.top ||
        e.clientY > rect.bottom
      ) {
        return
      }
      const ranks = orientation === 'w' ? RANKS : [...RANKS].reverse()
      const files = orientation === 'w' ? FILES : [...FILES].reverse()
      const col = Math.min(
        7,
        Math.max(0, Math.floor(((e.clientX - rect.left) / rect.width) * 8)),
      )
      const row = Math.min(
        7,
        Math.max(0, Math.floor(((e.clientY - rect.top) / rect.height) * 8)),
      )
      const target = `${files[col]}${ranks[row]}` as Square
      if (target !== active.current) {
        const updated = { ...active, current: target }
        rightDragRef.current = updated
        setRightDrag(updated)
      }
    }

    const handleWindowMouseUp = (e: MouseEvent) => {
      const active = rightDragRef.current
      if (!active || e.button !== 2) return

      rightDragRef.current = null
      setRightDrag(null)

      let dropSquare = active.current
      const rect = boardRef.current?.getBoundingClientRect()
      if (
        rect &&
        e.clientX >= rect.left &&
        e.clientX <= rect.right &&
        e.clientY >= rect.top &&
        e.clientY <= rect.bottom
      ) {
        const ranks = orientation === 'w' ? RANKS : [...RANKS].reverse()
        const files = orientation === 'w' ? FILES : [...FILES].reverse()
        const col = Math.min(
          7,
          Math.max(0, Math.floor(((e.clientX - rect.left) / rect.width) * 8)),
        )
        const row = Math.min(
          7,
          Math.max(0, Math.floor(((e.clientY - rect.top) / rect.height) * 8)),
        )
        dropSquare = `${files[col]}${ranks[row]}` as Square
      }

      const { from, color, squareColor } = active
      if (dropSquare === from) {
        setAnnotations((prev) => {
          const baseHighlights = prev.fenKey === fenKey ? prev.highlights : {}
          const baseArrows = prev.fenKey === fenKey ? prev.arrows : []
          const nextHighlights = { ...baseHighlights }
          if (nextHighlights[from] === squareColor) {
            delete nextHighlights[from]
          } else {
            nextHighlights[from] = squareColor
          }
          return { fenKey, highlights: nextHighlights, arrows: baseArrows }
        })
      } else {
        setAnnotations((prev) => {
          const baseHighlights = prev.fenKey === fenKey ? prev.highlights : {}
          const baseArrows = prev.fenKey === fenKey ? prev.arrows : []
          const exists = baseArrows.some(
            (a) => a.from === from && a.to === dropSquare && a.color === color,
          )
          const nextArrows = exists
            ? baseArrows.filter(
                (a) =>
                  !(
                    a.from === from &&
                    a.to === dropSquare &&
                    a.color === color
                  ),
              )
            : [
                ...baseArrows.filter(
                  (a) => !(a.from === from && a.to === dropSquare),
                ),
                { from, to: dropSquare, color, opacity: 0.85 },
              ]
          return { fenKey, highlights: baseHighlights, arrows: nextArrows }
        })
      }
    }

    window.addEventListener('mousemove', handleWindowMouseMove)
    window.addEventListener('mouseup', handleWindowMouseUp)
    return () => {
      window.removeEventListener('mousemove', handleWindowMouseMove)
      window.removeEventListener('mouseup', handleWindowMouseUp)
    }
  }, [fenKey, orientation])

  const handleRightMouseDown = (
    e: React.MouseEvent<HTMLButtonElement>,
    square: Square,
  ) => {
    if (pendingPromotion || e.button !== 2) return
    e.preventDefault()
    const { arrowColor, squareColor } = getAnnotationColors(e)
    const nextDrag: RightDragState = {
      from: square,
      current: square,
      color: arrowColor,
      squareColor,
    }
    rightDragRef.current = nextDrag
    setRightDrag(nextDrag)
  }

  const handlePointerDown = (
    e: React.PointerEvent<HTMLButtonElement>,
    square: Square,
    piece: BoardCell | null,
  ) => {
    if (pendingPromotion || e.button !== 0) return

    // Left-click clears user annotations just like Lichess / Chess.com
    if (Object.keys(userHighlights).length > 0 || userArrows.length > 0) {
      setAnnotations({ fenKey, highlights: {}, arrows: [] })
    }

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

  // Combine engine arrows + user arrows + live right-click preview arrow
  const allArrows: BoardArrow[] = [
    ...engineArrows,
    ...userArrows,
    ...(rightDrag && rightDrag.current !== rightDrag.from
      ? [
          {
            from: rightDrag.from,
            to: rightDrag.current,
            color: rightDrag.color,
            opacity: 0.65,
          },
        ]
      : []),
  ]

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
        onContextMenu={(e) => e.preventDefault()}
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
              dragState?.hasMoved && hoverSquare === square && isLegalTarget
            const userHighlightColor = userHighlights[square]

            let squareBg = isLight ? theme.light : theme.dark
            if (isLastMove) {
              squareBg = isLight ? theme.lastMoveLight : theme.lastMoveDark
            }

            return (
              <button
                key={square}
                type="button"
                aria-label={`Square ${square}`}
                onContextMenu={(e) => e.preventDefault()}
                onMouseDown={(e) => handleRightMouseDown(e, square)}
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

                {/* Right-click user square highlight */}
                {userHighlightColor && (
                  <span
                    className="pointer-events-none absolute inset-0 z-10"
                    style={{ backgroundColor: userHighlightColor }}
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
                    className="pointer-events-none absolute top-[3px] left-[4px] z-15 text-[11px] leading-none font-bold sm:text-xs"
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
                    className="pointer-events-none absolute right-[4px] bottom-[3px] z-15 text-[11px] leading-none font-bold sm:text-xs"
                    style={{
                      color: isLight ? theme.coordOnLight : theme.coordOnDark,
                    }}
                  >
                    {file}
                  </span>
                )}

                {/* Legal move dot (empty square) */}
                {isLegalTarget && !piece && (
                  <span className="pointer-events-none z-15 h-[30%] w-[30%] rounded-full bg-black/18 transition-transform" />
                )}

                {/* Legal capture ring (occupied square) */}
                {isLegalTarget && piece && (
                  <span className="pointer-events-none absolute inset-[5%] z-15 rounded-full border-[5px] border-black/18 sm:border-[6px]" />
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

                {/* Chess.com-style On-Board Move Classification Badge */}
                {moveBadge && moveBadge.square === square && (
                  <span
                    title={moveBadge.label}
                    style={{
                      backgroundColor: moveBadge.color,
                      color: moveBadge.textColor,
                    }}
                    className="pointer-events-none absolute top-0.5 right-0.5 z-30 flex h-6 w-6 items-center justify-center rounded-full text-[11px] leading-none font-black shadow-[0_2px_8px_rgba(0,0,0,0.6)] ring-2 ring-[#161512] sm:h-7 sm:w-7 sm:text-xs"
                  >
                    {moveBadge.symbol}
                  </span>
                )}
              </button>
            )
          }),
        )}

        {/* Engine + Right-Click User Arrows Overlay */}
        {allArrows.length > 0 && (
          <svg
            viewBox="0 0 800 800"
            className="pointer-events-none absolute inset-0 z-25 h-full w-full drop-shadow-[0_2px_3px_rgba(0,0,0,0.28)]"
            aria-hidden="true"
          >
            {allArrows.map((arrow, idx) => {
              const fromCol = displayFiles.indexOf(
                arrow.from[0] as (typeof FILES)[number],
              )
              const fromRow = displayRanks.indexOf(
                arrow.from[1] as (typeof RANKS)[number],
              )
              const toCol = displayFiles.indexOf(
                arrow.to[0] as (typeof FILES)[number],
              )
              const toRow = displayRanks.indexOf(
                arrow.to[1] as (typeof RANKS)[number],
              )
              if (fromCol < 0 || fromRow < 0 || toCol < 0 || toRow < 0) {
                return null
              }
              return renderArrowShape(
                `${arrow.from}-${arrow.to}-${arrow.color}-${idx}`,
                fromCol,
                fromRow,
                toCol,
                toRow,
                arrow.color,
                arrow.opacity ?? 0.82,
              )
            })}
          </svg>
        )}

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
})
