import {
  formatEvaluationScore,
  type EngineEvaluation,
} from '../engine/stockfishService'

interface EvaluationBarProps {
  evaluation: EngineEvaluation
  orientation: 'w' | 'b'
  enabled: boolean
}

/**
 * Convert centipawns / mate into White's visual bar percentage (0–100%).
 * Uses Lichess's logistic win-probability curve so small advantages are legible.
 */
function getWhitePercentage(evaluation: EngineEvaluation): number {
  if (evaluation.mate !== null) {
    return evaluation.mate > 0 ? 100 : 0
  }
  if (evaluation.cp === null) return 50
  const winChance = 2 / (1 + Math.exp(-0.00368208 * evaluation.cp)) - 1
  const percent = 50 + 50 * winChance
  return Math.max(4, Math.min(96, percent))
}

export function EvaluationBar({
  evaluation,
  orientation,
  enabled,
}: EvaluationBarProps) {
  const whitePercent = enabled ? getWhitePercentage(evaluation) : 50
  const scoreText = enabled ? formatEvaluationScore(evaluation) : '—'

  const whiteAdvantage =
    evaluation.mate !== null
      ? evaluation.mate > 0
      : (evaluation.cp ?? 0) >= 0

  // When orientation is 'w', White bar grows from bottom; when 'b', White bar grows from top.
  const whiteIsOnBottom = orientation === 'w'
  const labelAtBottom =
    (whiteIsOnBottom && whiteAdvantage) || (!whiteIsOnBottom && !whiteAdvantage)
  const labelOnLightBg = whiteAdvantage

  return (
    <div
      title={
        enabled
          ? `Stockfish 19 • Đánh giá: ${scoreText} • Depth ${evaluation.depth}/${evaluation.targetDepth}${evaluation.bestMove ? ` • Best: ${evaluation.bestMove}` : ''}`
          : 'Stockfish đang tắt'
      }
      className={[
        'relative flex w-6 shrink-0 flex-col overflow-hidden rounded-md bg-[#3c3935] shadow-inner ring-1 ring-black/60 select-none sm:w-7',
        enabled ? 'opacity-100' : 'opacity-40',
      ].join(' ')}
    >
      {/* White advantage fill */}
      <div
        className={[
          'absolute inset-x-0 bg-[#f0efe9] transition-[height] duration-500 ease-out',
          whiteIsOnBottom ? 'bottom-0' : 'top-0',
        ].join(' ')}
        style={{ height: `${whitePercent}%` }}
      />

      {/* Center 0.0 tick mark */}
      <div className="pointer-events-none absolute inset-x-0 top-1/2 z-10 h-px bg-black/25" />

      {/* Score label */}
      <span
        className={[
          'pointer-events-none absolute inset-x-0 z-20 text-center text-[10px] leading-none font-bold tracking-tighter',
          labelAtBottom ? 'bottom-1.5' : 'top-1.5',
          labelOnLightBg ? 'text-stone-900' : 'text-stone-100',
        ].join(' ')}
      >
        {scoreText}
      </span>
    </div>
  )
}
