const W = 960, H = 540;

export class AtariFX {
    constructor(scene) {
        this.scene = scene;
        this.g = scene.add.graphics().setDepth(999);
        this.phase = 0;
    }
    draw() {
        this.g.clear();
        this.phase += 0.07;

        // scanlines
        this.g.lineStyle(1, 0x000000, 0.2);
        for (let y = 0; y < H; y += 3) {
            this.g.beginPath();
            this.g.moveTo(0, y);
            this.g.lineTo(W, y);
            this.g.strokePath();
        }

        // raster bar
        const ry = (Math.sin(this.phase) * 0.5 + 0.5) * H;
        this.g.fillStyle(0xffffff, 0.03);
        this.g.fillRect(0, ry, W, 10);

        // vignette
        this.g.lineStyle(8, 0x000000, 0.18);
        this.g.strokeRect(0, 0, W, H);
    }
}