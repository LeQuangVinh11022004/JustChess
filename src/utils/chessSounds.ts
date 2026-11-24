export type ChessSoundType =
  | 'move'
  | 'capture'
  | 'castle'
  | 'check'
  | 'promote'
  | 'gameOver'

const SOUND_FILES: Record<ChessSoundType, string> = {
  move: 'sounds/move.wav',
  capture: 'sounds/capture.wav',
  castle: 'sounds/castle.wav',
  check: 'sounds/check.wav',
  promote: 'sounds/promote.wav',
  gameOver: 'sounds/gameOver.wav',
}

const SOUND_VOLUMES: Record<ChessSoundType, number> = {
  move: 0.9,
  capture: 1.0,
  castle: 0.95,
  check: 1.0,
  promote: 0.95,
  gameOver: 1.0,
}

/**
 * Determines the exact sound effect from Standard Algebraic Notation (SAN).
 * Works identically for live moves, PGN replay, Game Review stepping, and variations.
 */
export function getSoundForSan(san: string | undefined): ChessSoundType {
  if (!san) return 'move'
  if (san.includes('#')) return 'gameOver'
  if (san.includes('+')) return 'check'
  if (san.includes('=')) return 'promote'
  if (san === 'O-O' || san === 'O-O-O') return 'castle'
  if (san.includes('x')) return 'capture'
  return 'move'
}

/**
 * Zero-latency Web Audio API sound player backed by decoded AudioBuffers.
 * Avoids HTMLAudioElement.cloneNode() dropped plays and guarantees crisp playback
 * even during rapid PGN / Game Review scrubbing.
 */
class ChessSoundManager {
  private ctx: AudioContext | null = null
  private buffers = new Map<ChessSoundType, AudioBuffer>()
  private loadingPromises = new Map<ChessSoundType, Promise<AudioBuffer | null>>()

  private getContext(): AudioContext | null {
    if (typeof window === 'undefined') return null
    if (!this.ctx) {
      const AudioCtx =
        window.AudioContext ||
        (window as unknown as { webkitAudioContext?: typeof AudioContext })
          .webkitAudioContext
      if (!AudioCtx) return null
      this.ctx = new AudioCtx()
    }
    return this.ctx
  }

  private async loadBuffer(type: ChessSoundType): Promise<AudioBuffer | null> {
    const existing = this.buffers.get(type)
    if (existing) return existing

    const inflight = this.loadingPromises.get(type)
    if (inflight) return inflight

    const ctx = this.getContext()
    if (!ctx) return null

    const promise = fetch(`${import.meta.env.BASE_URL}${SOUND_FILES[type]}`)
      .then((res) => {
        if (!res.ok) throw new Error(`HTTP ${res.status}`)
        return res.arrayBuffer()
      })
      .then((arrayBuf) => ctx.decodeAudioData(arrayBuf))
      .then((decoded) => {
        this.buffers.set(type, decoded)
        return decoded
      })
      .catch(() => null)
      .finally(() => {
        this.loadingPromises.delete(type)
      })

    this.loadingPromises.set(type, promise)
    return promise
  }

  public preloadAll(): void {
    for (const type of Object.keys(SOUND_FILES) as ChessSoundType[]) {
      void this.loadBuffer(type)
    }
  }

  public play(type: ChessSoundType): void {
    const ctx = this.getContext()
    if (!ctx) return

    const trigger = (buffer: AudioBuffer | null) => {
      if (!buffer) return
      const startSource = () => {
        const source = ctx.createBufferSource()
        source.buffer = buffer
        const gain = ctx.createGain()
        gain.gain.value = SOUND_VOLUMES[type]
        source.connect(gain)
        gain.connect(ctx.destination)
        source.start(0)
      }

      if (ctx.state === 'suspended') {
        void ctx.resume().then(startSource).catch(() => undefined)
      } else {
        startSource()
      }
    }

    const cached = this.buffers.get(type)
    if (cached) {
      trigger(cached)
    } else {
      void this.loadBuffer(type).then(trigger)
    }
  }
}

export const chessSounds = new ChessSoundManager()
