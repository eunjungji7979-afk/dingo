class SoundEngine {
  private ctx: AudioContext | null = null;
  private muted = false;

  public setMuted(muted: boolean) {
    this.muted = muted;
  }

  public isMuted() {
    return this.muted;
  }

  private getContext(): AudioContext | null {
    if (this.muted || typeof window === 'undefined') return null;
    if (!this.ctx) {
      const AudioCtx = window.AudioContext || (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (AudioCtx) {
        this.ctx = new AudioCtx();
      }
    }
    if (this.ctx && this.ctx.state === 'suspended') {
      void this.ctx.resume();
    }
    return this.ctx;
  }

  private playTone(freq: number, duration: number, type: OscillatorType = 'triangle', delay = 0, gainVal = 0.14) {
    const ctx = this.getContext();
    if (!ctx) return;

    const now = ctx.currentTime + delay;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, now);

    gain.gain.setValueAtTime(0.001, now);
    gain.gain.exponentialRampToValueAtTime(gainVal, now + 0.015);
    gain.gain.exponentialRampToValueAtTime(0.001, now + duration);

    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start(now);
    osc.stop(now + duration + 0.02);
  }

  public playDiscardCue() {
    this.playTone(523.25, 0.14, 'triangle', 0, 0.16);
    this.playTone(659.25, 0.18, 'triangle', 0.09, 0.16);
  }

  public playCardSubmit() {
    this.playTone(392.0, 0.1, 'sine', 0, 0.12);
  }

  public playPickCue() {
    this.playTone(587.33, 0.12, 'triangle', 0, 0.15);
    this.playTone(880.0, 0.18, 'triangle', 0.08, 0.16);
  }

  public playCardPick() {
    this.playTone(740.0, 0.11, 'sine', 0, 0.13);
  }

  public playDingoFanfare() {
    const notes = [523.25, 659.25, 783.99, 1046.5];
    notes.forEach((n, idx) => {
      this.playTone(n, 0.28, 'triangle', idx * 0.09, 0.18);
    });
    this.playTone(1046.5, 0.5, 'sine', 0.36, 0.16);
  }
}

export const soundEngine = new SoundEngine();
