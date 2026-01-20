const W = 960, H = 540;
const PAL = {
    BLACK: 0x000000,
    WHITE: 0xFFFFFF,
    DKBLUE: 0x0A0B2E,
    BLUE: 0x1F56FF,
    PURPLE: 0xB300FF,
    MAGENTA: 0xFF2BD6,
    GREEN: 0x32FF6A,
    DKGREEN: 0x0D6B2E,
    ORANGE: 0xFF8A1F,
    YELLOW: 0xFFE35A,
    GRAY: 0x8EA2B6
};

export class CrtFx {
    constructor(scene) {
        this.scene = scene;
        this.g = scene.add.graphics().setDepth(2000);
        this.rgb = scene.add.graphics().setDepth(1999);
        this.phase = 0;
    }
    draw(time) {
        const g = this.g;
        const rgb = this.rgb;
        g.clear(); rgb.clear();

        // Scanlines (thin black lines)
        g.lineStyle(1, 0x000000, 0.17);
        for (let y = 0; y < H; y += 3) {
            g.beginPath(); g.moveTo(0, y); g.lineTo(W, y); g.strokePath();
        }

        // Vignette border
        g.lineStyle(8, 0x000000, 0.18);
        g.strokeRect(0, 0, W, H);

        // VHS band / flicker
        this.phase += 0.065;
        const bandY = (Math.sin(this.phase) * 0.5 + 0.5) * H;
        g.fillStyle(0xFFFFFF, 0.03);
        g.fillRect(0, bandY, W, 14);

        // RGB bleed (very subtle)
        const bleed = 1 + Math.floor((Math.sin(this.phase * 0.9) * 0.5 + 0.5) * 1);
        rgb.fillStyle(PAL.MAGENTA, 0.02);
        rgb.fillRect(-bleed, 0, W, H);
        rgb.fillStyle(PAL.GREEN, 0.02);
        rgb.fillRect(bleed, 0, W, H);

        // Occasional tear
        if (Math.random() < 0.028) {
            g.fillStyle(0xFFFFFF, 0.025);
            const y = Phaser.Math.Between(40, H - 80);
            g.fillRect(0, y, W, Phaser.Math.Between(6, 12));
        }
    }
}

/** Helper: make a “glow” behind a shape by drawing multiple larger copies */
export function glowCircle(scene, x, y, r, color, strength = 0.18) {
    const g = scene.add.graphics();
    g.fillStyle(color, strength);
    g.fillCircle(x, y, r + 6);
    g.fillStyle(color, strength * 0.7);
    g.fillCircle(x, y, r + 3);
    g.fillStyle(color, strength * 0.45);
    g.fillCircle(x, y, r + 1);
    scene.time.delayedCall(120, () => g.destroy());
}
