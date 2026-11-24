export type ChessSoundType =
  | 'move'
  | 'capture'
  | 'castle'
  | 'check'
  | 'promote'
  | 'gameOver'

/**
 * Acoustic wooden chess piece sound synthesizer (Web Audio API).
 * Models real wooden piece impacts using short bandpass-filtered noise transients
 * layered with damped wooden board body resonance — zero external audio files needed.
 */
class ChessSoundManager {
  private ctx: AudioContext | null = null
  private noiseBuffer: AudioBuffer | null = null

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

  private getNoiseBuffer(ctx: AudioContext): AudioBuffer {
    if (this.noiseBuffer && this.noiseBuffer.sampleRate === ctx.sampleRate) {
      return this.noiseBuffer
    }
    const length = Math.floor(ctx.sampleRate * 0.12)
    const buffer = ctx.createBuffer(1, length, ctx.sampleRate)
    const data = buffer.getChannelData(0)
    for (let i = 0; i < length; i++) {
      data[i] = Math.random() * 2 - 1
    }
    this.noiseBuffer = buffer
    return buffer
  }

  public play(type: ChessSoundType): void {
    const ctx = this.getContext()
    if (!ctx) return

    const now = ctx.currentTime

    switch (type) {
      case 'move':
        // Crisp wooden piece placed cleanly on a wooden board ("tock")
        this.playWoodImpact(ctx, now, {
          clickFreq: 1150,
          clickQ: 2.2,
          clickGain: 0.42,
          bodyStartFreq: 210,
          bodyEndFreq: 95,
          bodyGain: 0.28,
          duration: 0.045,
        })
        break

      case 'capture':
        // Two-stage wooden clack: piece knocks piece, then lands firmly on board
        this.playWoodImpact(ctx, now, {
          clickFreq: 2150,
          clickQ: 3.0,
          clickGain: 0.45,
          bodyStartFreq: 340,
          bodyEndFreq: 160,
          bodyGain: 0.22,
          duration: 0.032,
        })
        this.playWoodImpact(ctx, now + 0.022, {
          clickFreq: 980,
          clickQ: 1.8,
          clickGain: 0.55,
          bodyStartFreq: 165,
          bodyEndFreq: 72,
          bodyGain: 0.36,
          duration: 0.06,
        })
        break

      case 'castle':
        // Two distinct wooden placements: King then Rook
        this.playWoodImpact(ctx, now, {
          clickFreq: 1080,
          clickQ: 2.2,
          clickGain: 0.4,
          bodyStartFreq: 195,
          bodyEndFreq: 88,
          bodyGain: 0.27,
          duration: 0.045,
        })
        this.playWoodImpact(ctx, now + 0.115, {
          clickFreq: 1320,
          clickQ: 2.4,
          clickGain: 0.44,
          bodyStartFreq: 235,
          bodyEndFreq: 108,
          bodyGain: 0.29,
          duration: 0.045,
        })
        break

      case 'promote':
        // Firm wooden placement + subtle warm marimba chime
        this.playWoodImpact(ctx, now, {
          clickFreq: 1250,
          clickQ: 2.2,
          clickGain: 0.42,
          bodyStartFreq: 220,
          bodyEndFreq: 105,
          bodyGain: 0.26,
          duration: 0.045,
        })
        this.playMarimbaNote(ctx, now + 0.035, 587.33, 0.14, 0.16)
        this.playMarimbaNote(ctx, now + 0.11, 880, 0.2, 0.18)
        break

      case 'check':
        // Sharp wooden slap + tight percussive alert knock
        this.playWoodImpact(ctx, now, {
          clickFreq: 1550,
          clickQ: 2.5,
          clickGain: 0.5,
          bodyStartFreq: 250,
          bodyEndFreq: 95,
          bodyGain: 0.3,
          duration: 0.05,
        })
        this.playMarimbaNote(ctx, now + 0.025, 520, 0.11, 0.17)
        this.playMarimbaNote(ctx, now + 0.085, 440, 0.13, 0.14)
        break

      case 'gameOver':
        // Final wooden thud + resonant two-tone wooden cadence
        this.playWoodImpact(ctx, now, {
          clickFreq: 1050,
          clickQ: 2.0,
          clickGain: 0.42,
          bodyStartFreq: 180,
          bodyEndFreq: 80,
          bodyGain: 0.3,
          duration: 0.055,
        })
        this.playMarimbaNote(ctx, now + 0.08, 440, 0.18, 0.16)
        this.playMarimbaNote(ctx, now + 0.21, 329.63, 0.32, 0.18)
        break
    }
  }

  private playWoodImpact(
    ctx: AudioContext,
    startTime: number,
    opts: {
      clickFreq: number
      clickQ: number
      clickGain: number
      bodyStartFreq: number
      bodyEndFreq: number
      bodyGain: number
      duration: number
    },
  ): void {
    // 1. Sharp filtered noise transient (wooden surface contact click)
    const noise = ctx.createBufferSource()
    noise.buffer = this.getNoiseBuffer(ctx)

    const bandpass = ctx.createBiquadFilter()
    bandpass.type = 'bandpass'
    bandpass.frequency.setValueAtTime(opts.clickFreq, startTime)
    bandpass.Q.setValueAtTime(opts.clickQ, startTime)

    const clickEnv = ctx.createGain()
    clickEnv.gain.setValueAtTime(0.001, startTime)
    clickEnv.gain.linearRampToValueAtTime(opts.clickGain, startTime + 0.002)
    clickEnv.gain.exponentialRampToValueAtTime(
      0.001,
      startTime + opts.duration * 0.72,
    )

    noise.connect(bandpass)
    bandpass.connect(clickEnv)
    clickEnv.connect(ctx.destination)

    noise.start(startTime)
    noise.stop(startTime + opts.duration)

    // 2. Short damped wood cavity resonance (board thud)
    const bodyOsc = ctx.createOscillator()
    bodyOsc.type = 'sine'
    bodyOsc.frequency.setValueAtTime(opts.bodyStartFreq, startTime)
    bodyOsc.frequency.exponentialRampToValueAtTime(
      opts.bodyEndFreq,
      startTime + opts.duration,
    )

    const bodyEnv = ctx.createGain()
    bodyEnv.gain.setValueAtTime(0.001, startTime)
    bodyEnv.gain.linearRampToValueAtTime(opts.bodyGain, startTime + 0.003)
    bodyEnv.gain.exponentialRampToValueAtTime(0.001, startTime + opts.duration)

    bodyOsc.connect(bodyEnv)
    bodyEnv.connect(ctx.destination)

    bodyOsc.start(startTime)
    bodyOsc.stop(startTime + opts.duration + 0.01)
  }

  private playMarimbaNote(
    ctx: AudioContext,
    startTime: number,
    freq: number,
    duration: number,
    volume: number,
  ): void {
    const osc = ctx.createOscillator()
    const harmonic = ctx.createOscillator()
    const gain = ctx.createGain()
    const harmGain = ctx.createGain()

    osc.type = 'sine'
    osc.frequency.setValueAtTime(freq, startTime)

    harmonic.type = 'sine'
    harmonic.frequency.setValueAtTime(freq * 4, startTime)

    gain.gain.setValueAtTime(0.001, startTime)
    gain.gain.linearRampToValueAtTime(volume, startTime + 0.004)
    gain.gain.exponentialRampToValueAtTime(0.001, startTime + duration)

    harmGain.gain.setValueAtTime(0.001, startTime)
    harmGain.gain.linearRampToValueAtTime(volume * 0.18, startTime + 0.002)
    harmGain.gain.exponentialRampToValueAtTime(
      0.001,
      startTime + duration * 0.25,
    )

    osc.connect(gain)
    harmonic.connect(harmGain)
    harmGain.connect(gain)
    gain.connect(ctx.destination)

    osc.start(startTime)
    harmonic.start(startTime)
    osc.stop(startTime + duration + 0.01)
    harmonic.stop(startTime + duration * 0.3 + 0.01)
  }
}

export const chessSounds = new ChessSoundManager()
