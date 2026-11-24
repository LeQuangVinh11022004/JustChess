import {
  CLASSIFICATION_META,
  CLASSIFICATION_ORDER,
  type GameReviewResult,
  type ReviewMoveInfo,
} from '../engine/gameReview'
import { WinRateGraph } from './WinRateGraph'

interface GameReviewPanelProps {
  review: GameReviewResult
  whiteName: string
  blackName: string
  currentPly: number
  totalPlies: number
  showBestMoveHint: boolean
  onToggleBestMoveHint: () => void
  onSelectPly: (ply: number) => void
  onPlayBestMove: (uci: string, atPly: number) => void
  onReRunReview: () => void
}

export function GameReviewPanel({
  review,
  whiteName,
  blackName,
  currentPly,
  totalPlies,
  showBestMoveHint,
  onToggleBestMoveHint,
  onSelectPly,
  onPlayBestMove,
  onReRunReview,
}: GameReviewPanelProps) {
  const currentMove: ReviewMoveInfo | null =
    currentPly > 0 ? review.moves[currentPly - 1] ?? null : null

  const keyMoments = review.moves.filter(
    (m) =>
      m.classification === 'brilliant' ||
      m.classification === 'great' ||
      m.classification === 'mistake' ||
      m.classification === 'blunder',
  )

  const isSuboptimal =
    currentMove !== null &&
    (currentMove.classification === 'inaccuracy' ||
      currentMove.classification === 'mistake' ||
      currentMove.classification === 'blunder')

  const currentMeta = currentMove
    ? CLASSIFICATION_META[currentMove.classification]
    : null

  return (
    <div className="flex flex-1 flex-col gap-3.5 overflow-y-auto p-4">
      {/* Coach Commentary Card */}
      <div className="rounded-xl bg-[#1f1d1a] p-3.5 ring-1 ring-white/[0.08]">
        <div className="flex items-start gap-3">
          <div
            className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-lg shadow-sm ring-2"
            style={{
              backgroundColor: currentMeta ? currentMeta.bg : '#302e2b',
              borderColor: currentMeta ? currentMeta.color : '#81b64c',
            }}
          >
            {currentMeta ? (
              <span
                className="text-sm font-black"
                style={{ color: currentMeta.color }}
              >
                {currentMeta.symbol}
              </span>
            ) : (
              '🎓'
            )}
          </div>

          <div className="min-w-0 flex-1">
            {currentMove && currentMeta ? (
              <>
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-mono text-sm font-bold text-white">
                    {currentMove.moveNumber}.
                    {currentMove.color === 'b' ? '.. ' : ' '}
                    {currentMove.san}
                  </span>
                  <span
                    className="rounded-md px-2 py-0.5 text-[11px] font-bold"
                    style={{
                      backgroundColor: currentMeta.color,
                      color: currentMeta.badgeText,
                    }}
                  >
                    {currentMeta.label}
                  </span>
                </div>
                <p className="mt-1.5 text-xs leading-relaxed text-stone-300">
                  {currentMove.commentary}
                </p>
              </>
            ) : (
              <>
                <div className="text-sm font-bold text-white">
                  Tổng quan ván đấu
                </div>
                <p className="mt-1 text-xs leading-relaxed text-stone-300">
                  Ván đấu gồm {totalPlies} nước đi. Độ chính xác: Trắng{' '}
                  <strong className="text-[#a3d160]">
                    {review.white.accuracy}%
                  </strong>{' '}
                  • Đen{' '}
                  <strong className="text-[#a3d160]">
                    {review.black.accuracy}%
                  </strong>
                  . Bấm <strong>Bắt đầu xem</strong> để duyệt từng nước!
                </p>
              </>
            )}
          </div>
        </div>

        {/* Coach Action Row */}
        <div className="mt-3 flex flex-wrap items-center gap-2 border-t border-white/[0.06] pt-3">
          {isSuboptimal && currentMove?.bestMoveBefore && (
            <>
              <button
                type="button"
                onClick={onToggleBestMoveHint}
                className={[
                  'rounded-lg px-3 py-1.5 text-xs font-semibold transition',
                  showBestMoveHint
                    ? 'bg-[#81b64c]/25 text-[#c7e99b] ring-1 ring-[#81b64c]/50'
                    : 'bg-[#302e2b] text-stone-200 hover:bg-[#3d3a36]',
                ].join(' ')}
              >
                {showBestMoveHint
                  ? `Ẩn gợi ý`
                  : `Gợi ý: ${currentMove.bestMoveBeforeSan}`}
              </button>
              <button
                type="button"
                onClick={() =>
                  onPlayBestMove(currentMove.bestMoveBefore!, currentMove.ply - 1)
                }
                className="rounded-lg bg-[#302e2b] px-3 py-1.5 text-xs font-semibold text-stone-200 transition hover:bg-[#3d3a36]"
              >
                Đi thử {currentMove.bestMoveBeforeSan}
              </button>
            </>
          )}

          <button
            type="button"
            onClick={() =>
              onSelectPly(currentPly < totalPlies ? currentPly + 1 : 0)
            }
            className="ml-auto rounded-lg bg-[#81b64c] px-3.5 py-1.5 text-xs font-bold text-[#161512] shadow-xs transition hover:bg-[#95c75d]"
          >
            {currentPly === 0
              ? 'Bắt đầu xem →'
              : currentPly < totalPlies
                ? 'Nước tiếp →'
                : 'Xem lại từ đầu'}
          </button>
        </div>
      </div>

      {/* Win-Rate Graph */}
      <WinRateGraph
        review={review}
        currentPly={currentPly}
        onSelectPly={onSelectPly}
      />

      {/* Key Moments quick-jump strip */}
      {keyMoments.length > 0 && (
        <div className="rounded-xl bg-[#1f1d1a] p-3 ring-1 ring-white/[0.06]">
          <div className="mb-2 flex items-center justify-between text-xs">
            <span className="font-semibold text-stone-200">
              Bước ngoặt chính ({keyMoments.length})
            </span>
            <span className="text-[11px] text-stone-500">Nhấp để xem</span>
          </div>
          <div className="flex flex-wrap gap-1.5">
            {keyMoments.slice(0, 10).map((m) => {
              const meta = CLASSIFICATION_META[m.classification]
              const isActive = currentPly === m.ply
              return (
                <button
                  key={m.ply}
                  type="button"
                  onClick={() => onSelectPly(m.ply)}
                  className={[
                    'flex items-center gap-1 rounded-lg px-2.5 py-1 font-mono text-xs font-semibold transition',
                    isActive
                      ? 'ring-2 ring-amber-400'
                      : 'hover:brightness-110',
                  ].join(' ')}
                  style={{
                    backgroundColor: meta.bg,
                    color: meta.color,
                  }}
                >
                  <span>
                    {m.moveNumber}
                    {m.color === 'b' ? '...' : '.'}
                    {m.san}
                  </span>
                  <span className="font-black">{meta.symbol}</span>
                </button>
              )
            })}
          </div>
        </div>
      )}

      {/* White vs Black Accuracy & Estimated Elo Scorecard */}
      <div className="rounded-xl bg-[#1f1d1a] p-3.5 ring-1 ring-white/[0.06]">
        <div className="mb-3 grid grid-cols-[1fr_auto_1fr] items-center gap-2.5 text-center">
          <div className="rounded-xl bg-[#2a2824] p-2.5 ring-1 ring-white/5">
            <div className="truncate text-xs font-medium text-stone-400">
              ♔ {whiteName}
            </div>
            <div className="mt-1 text-2xl font-black text-white">
              {review.white.accuracy}%
            </div>
            <div className="mt-0.5 text-[11px] font-semibold text-[#a3d160]">
              Elo ~{review.white.estimatedRating}
            </div>
          </div>

          <span className="text-[11px] font-bold tracking-wider text-stone-500 uppercase">
            VS
          </span>

          <div className="rounded-xl bg-[#2a2824] p-2.5 ring-1 ring-white/5">
            <div className="truncate text-xs font-medium text-stone-400">
              ♚ {blackName}
            </div>
            <div className="mt-1 text-2xl font-black text-white">
              {review.black.accuracy}%
            </div>
            <div className="mt-0.5 text-[11px] font-semibold text-[#a3d160]">
              Elo ~{review.black.estimatedRating}
            </div>
          </div>
        </div>

        {/* Full 9-tier Classification Breakdown Table */}
        <div className="flex flex-col gap-1 text-xs">
          {CLASSIFICATION_ORDER.map((tier) => {
            const meta = CLASSIFICATION_META[tier]
            const wCount = review.white[tier]
            const bCount = review.black[tier]
            if (
              wCount === 0 &&
              bCount === 0 &&
              (tier === 'brilliant' || tier === 'book')
            ) {
              return null
            }

            return (
              <div
                key={tier}
                className="grid grid-cols-[40px_1fr_40px] items-center rounded-md px-2 py-1 odd:bg-white/[0.025]"
              >
                <span
                  className="text-center font-mono text-xs font-bold"
                  style={{ color: wCount > 0 ? meta.color : '#57534e' }}
                >
                  {wCount}
                </span>

                <div className="flex items-center justify-center gap-2 text-xs text-stone-300">
                  <span
                    className="flex h-4.5 w-4.5 items-center justify-center rounded-full text-[9px] font-black"
                    style={{
                      backgroundColor: meta.color,
                      color: meta.badgeText,
                    }}
                  >
                    {meta.symbol}
                  </span>
                  <span>{meta.label}</span>
                </div>

                <span
                  className="text-center font-mono text-xs font-bold"
                  style={{ color: bCount > 0 ? meta.color : '#57534e' }}
                >
                  {bCount}
                </span>
              </div>
            )
          })}
        </div>

        <button
          type="button"
          onClick={onReRunReview}
          className="mt-3 w-full rounded-lg bg-[#2e2c28] py-2 text-xs font-semibold text-stone-200 transition hover:bg-[#3d3a36]"
        >
          ↻ Phân tích lại toàn ván
        </button>
      </div>
    </div>
  )
}
