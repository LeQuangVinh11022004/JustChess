import type { PieceSymbol } from 'chess.js'
import { ChessPiece } from './ChessPiece'

interface PlayerBarProps {
  name: string
  color: 'w' | 'b'
  isTurn: boolean
  isInCheck: boolean
  capturedPieces: PieceSymbol[]
  materialAdvantage: number
}

export function PlayerBar({
  name,
  color,
  isTurn,
  isInCheck,
  capturedPieces,
  materialAdvantage,
}: PlayerBarProps) {
  const capturedColor: 'w' | 'b' = color === 'w' ? 'b' : 'w'

  return (
    <div className="flex w-full max-w-[600px] items-center justify-between gap-3 rounded-lg bg-[#262421] px-3 py-2 shadow-sm ring-1 ring-white/5">
      <div className="flex min-w-0 items-center gap-3">
        <div
          className={[
            'flex h-9 w-9 shrink-0 items-center justify-center rounded-md border',
            color === 'w'
              ? 'border-stone-500/40 bg-stone-100'
              : 'border-stone-600/60 bg-stone-800',
          ].join(' ')}
        >
          <ChessPiece type="k" color={color} className="h-7 w-7" />
        </div>

        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <span className="truncate text-sm font-semibold text-stone-100">
              {name}
            </span>
            {isInCheck && (
              <span className="rounded bg-red-600/90 px-1.5 py-0.5 text-[10px] font-bold tracking-wide text-white uppercase">
                Chiếu
              </span>
            )}
          </div>

          <div className="mt-0.5 flex min-h-4 items-center gap-0.5">
            {capturedPieces.map((piece, idx) => (
              <ChessPiece
                key={`${piece}-${idx}`}
                type={piece}
                color={capturedColor}
                className="-mr-1.5 h-4 w-4 opacity-90"
              />
            ))}
            {materialAdvantage > 0 && (
              <span className="ml-2 text-xs font-semibold text-stone-400">
                +{materialAdvantage}
              </span>
            )}
          </div>
        </div>
      </div>

      <div
        className={[
          'flex items-center gap-1.5 rounded-md px-2.5 py-1 text-xs font-semibold transition-all',
          isTurn
            ? 'bg-[#81b64c]/20 text-[#a3d160] ring-1 ring-[#81b64c]/40'
            : 'bg-stone-800/70 text-stone-500',
        ].join(' ')}
      >
        <span
          className={[
            'h-2 w-2 rounded-full',
            isTurn ? 'animate-pulse bg-[#81b64c]' : 'bg-stone-600',
          ].join(' ')}
        />
        {isTurn ? 'Đang đi' : 'Chờ lượt'}
      </div>
    </div>
  )
}
