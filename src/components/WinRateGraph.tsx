import {
  CLASSIFICATION_META,
  type GameReviewResult,
  type MoveClassification,
} from '../engine/gameReview'
import type { Language } from '../utils/i18n'

interface WinRateGraphProps {
  lang?: Language
  review: GameReviewResult
  currentPly: number
  onSelectPly: (ply: number) => void
}

export function WinRateGraph({
  lang = 'vi',
  review,
  currentPly,
  onSelectPly,
}: WinRateGraphProps) {
  const isEn = lang === 'en'
  const points: Array<{
    ply: number
    win: number
    classification?: MoveClassification
    san?: string
  }> = [
    { ply: 0, win: review.startWinPercent },
    ...review.moves.map((m) => ({
      ply: m.ply,
      win: m.whiteWinPercent,
      classification: m.classification,
      san: m.san,
    })),
  ]

  const width = 320
  const height = 84
  const maxPly = Math.max(1, points.length - 1)

  const getX = (ply: number) => (ply / maxPly) * width
  const getY = (win: number) => height - (win / 100) * height

  const linePath = points
    .map((pt, idx) => `${idx === 0 ? 'M' : 'L'} ${getX(pt.ply).toFixed(1)} ${getY(pt.win).toFixed(1)}`)
    .join(' ')

  const whiteAreaPath = `${linePath} L ${width} ${height} L 0 ${height} Z`

  const handleClick = (e: React.MouseEvent<SVGSVGElement>) => {
    const rect = e.currentTarget.getBoundingClientRect()
    if (rect.width <= 0) return
    const ratio = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width))
    const targetPly = Math.round(ratio * maxPly)
    onSelectPly(targetPly)
  }

  const clampedPly = Math.max(0, Math.min(maxPly, currentPly))
  const currentPoint = points[clampedPly] ?? points[0]
  const cursorX = getX(currentPoint.ply)
  const cursorY = getY(currentPoint.win)

  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-center justify-between text-[11px]">
        <span className="font-semibold text-stone-300">
          {isEn
            ? 'Win-Rate Graph (White vs Black)'
            : 'Biểu đồ Win-Rate (Trắng vs Đen)'}
        </span>
        <span className="font-mono text-stone-400">
          {isEn ? 'White' : 'Trắng'} {Math.round(currentPoint.win)}%
        </span>
      </div>

      <svg
        viewBox={`0 0 ${width} ${height}`}
        onClick={handleClick}
        role="img"
        aria-label={
          isEn ? 'Win probability chart' : 'Biểu đồ diễn biến tỷ lệ thắng'
        }
        className="h-[84px] w-full cursor-pointer overflow-hidden rounded-md bg-[#2d2a26] ring-1 ring-white/10"
      >
        {/* White advantage area fill */}
        <path d={whiteAreaPath} fill="#e7e5e0" fillOpacity="0.9" />

        {/* 50% equilibrium line */}
        <line
          x1={0}
          y1={height / 2}
          x2={width}
          y2={height / 2}
          stroke="#78716c"
          strokeWidth="1"
          strokeDasharray="3 3"
          opacity="0.7"
        />

        {/* Win-rate curve stroke */}
        <path
          d={linePath}
          fill="none"
          stroke="#81b64c"
          strokeWidth="1.75"
          strokeLinejoin="round"
        />

        {/* Brilliant / Mistake / Blunder turning point dots */}
        {points.map((pt) => {
          if (
            pt.classification !== 'blunder' &&
            pt.classification !== 'mistake' &&
            pt.classification !== 'brilliant'
          ) {
            return null
          }
          const meta = CLASSIFICATION_META[pt.classification]
          return (
            <circle
              key={`mark-${pt.ply}`}
              cx={getX(pt.ply)}
              cy={getY(pt.win)}
              r={pt.classification === 'blunder' || pt.classification === 'brilliant' ? 3.6 : 2.8}
              fill={meta.color}
              stroke="#161512"
              strokeWidth="1"
            >
              <title>{`Nước ${pt.ply}: ${pt.san ?? ''} (${meta.label})`}</title>
            </circle>
          )
        })}

        {/* Active ply vertical cursor */}
        <line
          x1={cursorX}
          y1={0}
          x2={cursorX}
          y2={height}
          stroke="#f59e0b"
          strokeWidth="1.5"
        />
        <circle
          cx={cursorX}
          cy={cursorY}
          r="3.5"
          fill="#f59e0b"
          stroke="#161512"
          strokeWidth="1.2"
        />
      </svg>

      {/* Compact Accuracy & Classification summary */}
      <div className="grid grid-cols-2 gap-1.5 text-[11px]">
        <div className="flex items-center justify-between rounded bg-[#262421] px-2 py-1">
          <span className="font-medium text-stone-200">
            ♔ {review.white.accuracy}%
          </span>
          <span className="flex items-center gap-1.5 font-mono text-[10px]">
            <span className="text-[#81b64c]" title="Best">
              ★{review.white.best}
            </span>
            <span className="text-[#e6912c]" title="Mistake">
              ?{review.white.mistake}
            </span>
            <span className="text-[#e05347]" title="Blunder">
              ??{review.white.blunder}
            </span>
          </span>
        </div>

        <div className="flex items-center justify-between rounded bg-[#262421] px-2 py-1">
          <span className="font-medium text-stone-300">
            ♚ {review.black.accuracy}%
          </span>
          <span className="flex items-center gap-1.5 font-mono text-[10px]">
            <span className="text-[#81b64c]" title="Best">
              ★{review.black.best}
            </span>
            <span className="text-[#e6912c]" title="Mistake">
              ?{review.black.mistake}
            </span>
            <span className="text-[#e05347]" title="Blunder">
              ??{review.black.blunder}
            </span>
          </span>
        </div>
      </div>
    </div>
  )
}
