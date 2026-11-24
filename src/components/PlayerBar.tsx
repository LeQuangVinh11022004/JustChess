import type { PieceSymbol } from 'chess.js'
import { ChessPiece } from './ChessPiece'

interface PlayerBarProps {
  name: string
  title?: string
  rating?: number
  fideRating?: number
  color: 'w' | 'b'
  isTurn: boolean
  isInCheck: boolean
  capturedPieces: PieceSymbol[]
  materialAdvantage: number
}

export function PlayerBar({
  name,
  title,
  rating,
  fideRating,
  color,
  isTurn,
  isInCheck,
  capturedPieces,
  materialAdvantage,
}: PlayerBarProps) {
  const capturedColor: 'w' | 'b' = color === 'w' ? 'b' : 'w'

  return (
    <div
      className={[
        'flex w-full max-w-[600px] items-center justify-between gap-2 rounded-xl px-2.5 py-2 transition-all sm:gap-3 sm:px-3.5 sm:py-2.5',
        isTurn
          ? 'bg-[#2a2824] shadow-md ring-1 ring-[#81b64c]/40'
          : 'bg-[#24221f] ring-1 ring-white/[0.06]',
      ].join(' ')}
    >
      <div className="flex min-w-0 items-center gap-2 sm:gap-3">
        <div
          className={[
            'flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border shadow-xs sm:h-10 sm:w-10',
            color === 'w'
              ? 'border-stone-300/60 bg-stone-100'
              : 'border-stone-600/60 bg-stone-800',
          ].join(' ')}
        >
          <ChessPiece type="k" color={color} className="h-6 w-6 sm:h-7 sm:w-7" />
        </div>

        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-1.5">
            {title && (
              <span className="rounded bg-[#a63429] px-1.5 py-0.5 text-[10px] leading-none font-black tracking-wide text-white uppercase shadow-xs">
                {title}
              </span>
            )}
            <span className="truncate text-sm font-bold text-stone-100">
              {name}
            </span>
            {rating && (
              <span className="font-mono text-xs font-semibold text-stone-400">
                ({rating})
              </span>
            )}
            {fideRating && (
              <span
                title="Hệ số FIDE chính thức"
                className="rounded bg-amber-500/15 px-1.5 py-0.5 font-mono text-[10px] font-bold text-amber-300 ring-1 ring-amber-500/30"
              >
                FIDE {fideRating}
              </span>
            )}
            {isInCheck && (
              <span className="rounded-md bg-red-600 px-1.5 py-0.5 text-[10px] font-bold tracking-wide text-white uppercase">
                Đang bị chiếu
              </span>
            )}
          </div>

          <div className="mt-0.5 flex min-h-4 items-center gap-0.5">
            {capturedPieces.length > 0 ? (
              <>
                {capturedPieces.map((piece, idx) => (
                  <ChessPiece
                    key={`${piece}-${idx}`}
                    type={piece}
                    color={capturedColor}
                    className="-mr-1.5 h-4 w-4 opacity-95"
                  />
                ))}
                {materialAdvantage > 0 && (
                  <span className="ml-2.5 rounded bg-white/5 px-1.5 py-0.2 text-[11px] font-bold text-stone-300">
                    +{materialAdvantage}
                  </span>
                )}
              </>
            ) : (
              <span className="text-[11px] text-stone-500">
                {color === 'w' ? 'Cầm quân Trắng' : 'Cầm quân Đen'}
              </span>
            )}
          </div>
        </div>
      </div>

      <div
        className={[
          'flex shrink-0 items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-semibold transition-all',
          isTurn
            ? 'bg-[#81b64c]/20 text-[#b4e07c] ring-1 ring-[#81b64c]/35'
            : 'bg-white/[0.04] text-stone-500',
        ].join(' ')}
      >
        <span
          className={[
            'h-2 w-2 rounded-full',
            isTurn ? 'animate-pulse bg-[#81b64c]' : 'bg-stone-600',
          ].join(' ')}
        />
        {isTurn ? 'Đến lượt' : 'Đang chờ'}
      </div>
    </div>
  )
}
