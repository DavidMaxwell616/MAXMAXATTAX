export class Sfx {
    constructor() { this.ctx = null; this.master = null; this.muted = false; }
    ensure() {
        if (this.ctx) return;
        const AC = window.AudioContext || window.webkitAudioContext;
        this.ctx = new AC();
        this.master = this.ctx.createGain();
        this.master.gain.value = 0.18;
        this.master.connect(this.ctx.destination);
    }
    toggle() { this.muted = !this.muted; if (this.master) this.master.gain.value = this.muted ? 0 : 0.18; }
    tone({ f = 440, d = 0.06, t = "square", v = 0.12, slide = 0 } = {}) {
        if (this.muted) return;
        this.ensure();
        const t0 = this.ctx.currentTime;
        const o = this.ctx.createOscillator();
        const g = this.ctx.createGain();
        o.type = t;
        o.frequency.setValueAtTime(f, t0);
        if (slide) o.frequency.linearRampToValueAtTime(Math.max(40, f + slide), t0 + d);
        g.gain.setValueAtTime(v, t0);
        g.gain.exponentialRampToValueAtTime(0.0009, t0 + d);
        o.connect(g); g.connect(this.master);
        o.start(t0); o.stop(t0 + d);
    }
    shoot() { this.tone({ f: 820, d: 0.05, t: "square", v: 0.10, slide: -240 }); }
    hit() { this.tone({ f: 210, d: 0.08, t: "sawtooth", v: 0.09, slide: -80 }); }
    boom() { this.tone({ f: 130, d: 0.14, t: "triangle", v: 0.12, slide: -120 }); }
    hurt() { this.tone({ f: 95, d: 0.16, t: "square", v: 0.12, slide: -50 }); }
    wave() { this.tone({ f: 520, d: 0.11, t: "triangle", v: 0.10, slide: 260 }); }
}
