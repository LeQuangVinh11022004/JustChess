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

/**
 * Plays real recorded chess sound effects (from PyChess, GPL-3.0) stored in `public/sounds/`.
 * Preloads audio buffers and clones on playback so rapid moves overlap cleanly without cutoff.
 */
class ChessSoundManager {
  private cache = new Map<ChessSoundType, HTMLAudioElement>()

  private getAudio(type: ChessSoundType): HTMLAudioElement | null {
    if (typeof window === 'undefined' || typeof Audio === 'undefined') {
      return null
    }
    let base = this.cache.get(type)
    if (!base) {
      base = new Audio(`${import.meta.env.BASE_URL}${SOUND_FILES[type]}`)
      base.preload = 'auto'
      this.cache.set(type, base)
    }
    return base
  }

  public preloadAll(): void {
    for (const type of Object.keys(SOUND_FILES) as ChessSoundType[]) {
      this.getAudio(type)
    }
  }

  public play(type: ChessSoundType): void {
    const base = this.getAudio(type)
    if (!base) return

    const instance = base.cloneNode(true) as HTMLAudioElement
    instance.volume = type === 'move' ? 0.85 : 0.9
    void instance.play().catch(() => {
      // Ignore browser autoplay restrictions before first user interaction
    })
  }
}

export const chessSounds = new ChessSoundManager()
