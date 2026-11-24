export type ChessSoundType =
  | 'move'
  | 'capture'
  | 'castle'
  | 'check'
  | 'promote'
  | 'gameOver'

class ChessSoundManager {
  private ctx: AudioContext | null = null

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
    if (this.ctx.state === 'suspended') {
      void this.ctx.resume()
    }
    return this.ctx
  }

  public play(type: ChessSoundType): void {
    const ctx = this.getContext()
    if (!ctx) return

    const now = ctx.currentTime

    switch (type) {
      case 'move':
        this.playWoodTap(ctx, now, 180, 95, 0.06, 0.22)
        break
      case 'capture':
        this.playWoodTap(ctx, now, 280, 75, 0.085, 0.32)
        this.playNoiseBurst(ctx, now, 0.045, 0.16, 1400)
        break
      case 'castle':
        this.playWoodTap(ctx, now, 185, 95, 0.055, 0.22)
        this.playWoodTap(ctx, now + 0.095, 220, 110, 0.06, 0.24)
        break
      case 'promote':
        this.playTone(ctx, now, 523.25, 0.09, 0.14, 'triangle')
        this.playTone(ctx, now + 0.07, 659.25, 0.11, 0.16, 'triangle')
        this.playTone(ctx, now + 0.14, 783.99, 0.16, 0.16, 'triangle')
        break
      case 'check':
        this.playWoodTap(ctx, now, 220, 90, 0.06, 0.22)
        this.playTone(ctx, now + 0.02, 740, 0.12, 0.16, 'sine')
        this.playTone(ctx, now + 0.1, 620, 0.14, 0.12, 'sine')
        break
      case 'gameOver':
        this.playTone(ctx, now, 440, 0.14, 0.15, 'triangle')
        this.playTone(ctx, now + 0.13, 349.23, 0.16, 0.15, 'triangle')
        this.playTone(ctx, now + 0.27, 261.63, 0.32, 0.18, 'triangle')
        break
    }
  }

  private playWoodTap(
    ctx: AudioContext,
    startTime: number,
    startFreq: number,
    endFreq: number,
    duration: number,
    volume: number,
  ): void {
    const osc = ctx.createOscillator()
    const gain = ctx.createGain()

    osc.type = 'triangle'
    osc.frequency.setValueAtTime(startFreq, startTime)
    osc.frequency.exponentialRampToValueAtTime(endFreq, startTime + duration)

    gain.gain.setValueAtTime(0.001, startTime)
    gain.gain.linearRampToValueAtTime(volume, startTime + 0.006)
    gain.gain.exponentialRampToValueAtTime(0.001, startTime + duration)

    osc.connect(gain)
    gain.connect(ctx.destination)

    osc.start(startTime)
    osc.stop(startTime + duration + 0.01)
  }

  private playNoiseBurst(
    ctx: AudioContext,
    startTime: number,
    duration: number,
    volume: number,
    filterFreq: number,
  ): void {
    const bufferSize = Math.floor(ctx.sampleRate * duration)
    const buffer = ctx.createBuffer(1, bufferSize, ctx.sampleRate)
    const data = buffer.getChannelData(0)
    for (let i = 0; i < bufferSize; i++) {
      data[i] = (Math.random() * 2 - 1) * (1 - i / bufferSize)
    }

    const source = ctx.createBufferSource()
    source.buffer = buffer

    const filter = ctx.createBiquadFilter()
    filter.type = 'bandpass'
    filter.frequency.setValueAtTime(filterFreq, startTime)

    const gain = ctx.createGain()
    gain.gain.setValueAtTime(volume, startTime)
    gain.gain.exponentialRampToValueAtTime(0.001, startTime + duration)

    source.connect(filter)
    filter.connect(gain)
    gain.connect(ctx.destination)

    source.start(startTime)
  }

  private playTone(
    ctx: AudioContext,
    startTime: number,
    freq: number,
    duration: number,
    volume: number,
    wave: OscillatorType,
  ): void {
    const osc = ctx.createOscillator()
    const gain = ctx.createGain()

    osc.type = wave
    osc.frequency.setValueAtTime(freq, startTime)

    gain.gain.setValueAtTime(0.001, startTime)
    gain.gain.linearRampToValueAtTime(volume, startTime + 0.012)
    gain.gain.exponentialRampToValueAtTime(0.001, startTime + duration)

    osc.connect(gain)
    gain.connect(ctx.destination)

    osc.start(startTime)
    osc.stop(startTime + duration + 0.01)
  }
}

export const chessSounds = new ChessSoundManager()
