export interface CloudEvalLine {
  cp: number | null
  mate: number | null
  moves: string[]
}

export interface LichessCloudEvalResult {
  depth: number
  knodes: number
  lines: CloudEvalLine[]
}

interface LichessCloudApiResponse {
  depth?: number
  knodes?: number
  pvs?: Array<{
    cp?: number
    mate?: number
    moves?: string
  }>
}

/**
 * Fetches deep Stockfish NNUE evaluations (often depth 30–60+) from Lichess's
 * free public Cloud Eval database. Returns null if the position is not cached (404).
 */
export async function fetchLichessCloudEval(
  fen: string,
  multiPv = 3,
  signal?: AbortSignal,
): Promise<LichessCloudEvalResult | null> {
  const url = `https://lichess.org/api/cloud-eval?fen=${encodeURIComponent(fen)}&multiPv=${multiPv}`

  const res = await fetch(url, { signal })
  if (res.status === 404) {
    return null
  }
  if (!res.ok) {
    throw new Error(`Lichess Cloud Eval lỗi (${res.status}).`)
  }

  const data = (await res.json()) as LichessCloudApiResponse
  const lines: CloudEvalLine[] = (data.pvs ?? []).map((pv) => ({
    cp: typeof pv.cp === 'number' ? pv.cp : null,
    mate: typeof pv.mate === 'number' ? pv.mate : null,
    moves: pv.moves ? pv.moves.trim().split(/\s+/) : [],
  }))

  if (lines.length === 0) return null

  return {
    depth: data.depth ?? 0,
    knodes: data.knodes ?? 0,
    lines,
  }
}
