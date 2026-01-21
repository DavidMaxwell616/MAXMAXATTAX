import { Sfx } from "./sfx.js";
import { CrtFx, glowCircle } from "./CrtFx.js";
const W = 960, H = 540;
const PAL = {
    BLACK: 0x000000,
    WHITE: 0xFFFFFF,
    DKBLUE: 0x0A0B2E,
    BLUE: 0x1F56FF,
    PURPLE: 0xB300FF,
    MAGENTA: 0xFF2BD6,
    GREEN: 0x008000,
    LTGREEN: 0x32FF6A,
    DKGREEN: 0x0D6B2E,
    ORANGE: 0xFF8A1F,
    YELLOW: 0xFFE35A,
    GRAY: 0x8EA2B6
};

export class GameScene extends Phaser.Scene {
    constructor() { super("game"); }

    create() {
        this.G = 170; // global gravity baseline
        this.physics.world.setBounds(0, 0, W, H);
        this.physics.world.gravity.y = this.G;

        // State
        this.score = 0;
        this.baseHPMax = 10;
        this.baseHP = this.baseHPMax;
        this.wave = 1;
        this.killStreak = 0;
        this.mult = 1;
        this.shotPenalty = 1;
        this.isGameOver = false;

        // Atari-ish pacing (defaults; will ramp by wave)
        this.waveDuration = 28000;     // a bit longer, more “loop-y”
        this.waveStartAt = this.time.now;

        this.spawnRate = 2200;         // aircraft pass interval (“Atari-ish” slower than modern spam)
        this.nextSpawnAt = this.time.now + 900;

        this.heliDropMin = 1050;       // ms between drops per heli
        this.heliDropMax = 1650;

        this.bomberBombMin = 1200;
        this.bomberBombMax = 1850;

        // Apple II palette background/ground
        this.add.rectangle(W / 2, H / 2, W, H, PAL.BLUE).setDepth(-50);

        this.groundY = H - 52;
        this.ground = this.add.rectangle(W / 2, this.groundY + 26, W, 52, PAL.GREEN).setAlpha(0.95);
        this.physics.add.existing(this.ground, true);

        // “Horizon” strip (artifact-y)
        this.add.rectangle(W / 2, this.groundY - 2, W, 6, PAL.DKGREEN).setAlpha(0.85);

        // Turret/base
        this.baseX = W / 2;
        this.barrel = this.add.rectangle(this.baseX, this.groundY - 24, 58, 10, PAL.WHITE).setOrigin(0.12, 0.5).setAlpha(0.95);
        this.turretBase2 = this.add.circle(this.baseX, this.groundY - 20, 20, PAL.ORANGE);
        this.turretBase = this.add.rectangle(this.baseX, this.groundY - 10, 74, 34, PAL.WHITE);

        // Groups
        this.bullets = this.physics.add.group();
        this.helis = this.physics.add.group();
        this.bombers = this.physics.add.group();
        this.troops = this.physics.add.group();
        this.bombs = this.physics.add.group();
        this.grounders = this.physics.add.group();

        // Collisions
        this.physics.add.overlap(this.bullets, this.helis, this.hitAircraft, null, this);
        this.physics.add.overlap(this.bullets, this.bombers, this.hitAircraft, null, this);
        this.physics.add.overlap(this.bullets, this.troops, this.hitTroop, null, this);
        this.physics.add.overlap(this.bullets, this.bombs, this.hitBomb, null, this);

        this.physics.add.collider(this.troops, this.ground, this.troopLanded, null, this);
        this.physics.add.collider(this.bombs, this.ground, this.bombHitGround, null, this);

        // Input
        this.keys = this.input.keyboard.addKeys("A,D,SPACE,SHIFT,R,M");
        this.input.on("pointerdown", () => this.tryFire(false));
        this.input.keyboard.on("keydown-M", () => this.sfx.toggle());
        this.fireCooldown = 0;

        // UI
        this.ui = this.add.text(12, 10, "", {
            fontFamily: "ui-monospace, SFMono-Regular, Menlo, Consolas, monospace",
            fontSize: "16px",
            color: "#dbe8ff"
        }).setShadow(0, 2, "#000", 6);

        this.banner = this.add.text(W / 2, 72, "", {
            fontFamily: "ui-monospace, SFMono-Regular, Menlo, Consolas, monospace",
            fontSize: "28px",
            color: "#dbe8ff"
        }).setOrigin(0.5).setAlpha(0);

        this.gameOverText = this.add.text(W / 2, H / 2, "", {
            fontFamily: "ui-monospace, SFMono-Regular, Menlo, Consolas, monospace",
            fontSize: "38px",
            color: "#ffd0d0",
            align: "center"
        }).setOrigin(0.5).setVisible(false);

        // SFX + FX
        this.sfx = new Sfx();
        this.crt = new CrtFx(this);

        // Start
        this.showWaveBanner();
        this.updateUI();
    }

    update(time) {
        if (this.isGameOver) {
            if (Phaser.Input.Keyboard.JustDown(this.keys.R)) this.scene.restart();
            this.crt.draw(time);
            return;
        }

        // Aim (mouse), clamp upward
        const mx = this.input.activePointer.worldX;
        const my = this.input.activePointer.worldY;
        let angle = Phaser.Math.Angle.Between(this.barrel.x, this.barrel.y, mx, my);
        angle = Phaser.Math.Clamp(angle, Phaser.Math.DegToRad(-170), Phaser.Math.DegToRad(-10));
        this.barrel.rotation = angle;

        // Fire (space + optional rapid)
        const rapid = this.keys.SHIFT.isDown;
        if (Phaser.Input.Keyboard.JustDown(this.keys.SPACE)) this.tryFire(false);
        if (rapid && (this.input.activePointer.isDown || this.keys.SPACE.isDown)) this.tryFire(true);

        // Wave progression
        if (time - this.waveStartAt > this.waveDuration) {
            this.wave++;
            this.waveStartAt = time;
            this.bumpDifficulty();
            this.showWaveBanner();
        }

        // Spawn aircraft by “Atari-ish” cadence
        if (time >= this.nextSpawnAt) {
            this.spawnAircraft(time);
            this.nextSpawnAt = time + this.spawnRate;
        }

        // March stacks toward base
        this.grounders.children.iterate(g => {
            if (!g || !g.active) return;
            const dir = (this.baseX < g.x) ? -1 : 1;
            const speed = 14 + this.wave * 1.5 + (g.stackCount || 1) * 1.4; // slower than before
            g.body.setVelocityX(dir * speed);

            if (Math.abs(g.x - this.baseX) < 34) {
                this.baseTakeDamage(1 + Math.floor((g.stackCount || 1) / 2));
                this.explode(g.x, g.y, PAL.MAGENTA);
                g.destroy();
            }
        });

        // Cleanup
        this.bullets.children.iterate(b => { if (b && b.active && (b.y > H + 60)) b.destroy(); });
        this.troops.children.iterate(t => { if (t && t.active && (t.y > H + 80)) t.destroy(); });
        this.bombs.children.iterate(b => { if (b && b.active && (b.y > H + 80)) b.destroy(); });
        this.helis.children.iterate(a => { if (a && a.active && (a.x < -160 || a.x > W + 160)) a.destroy(); });
        this.bombers.children.iterate(a => { if (a && a.active && (a.x < -160 || a.x > W + 160)) a.destroy(); });
        this.bullets.getChildren().forEach(bullet => {
            if (bullet.y < 0 || bullet.x < 0 || bullet.x > 800) {
                bullet.destroy();
            }
        });
        this.crt.draw(time);
    }

    // ---------- pacing / difficulty ----------
    bumpDifficulty() {
        // Small ramps (keep “Atari-ish”, not a bullet-hell)
        this.spawnRate = Math.max(1300, this.spawnRate - 120);
        this.heliDropMin = Math.max(700, this.heliDropMin - 60);
        this.heliDropMax = Math.max(1050, this.heliDropMax - 90);
        this.bomberBombMin = Math.max(800, this.bomberBombMin - 60);
        this.bomberBombMax = Math.max(1200, this.bomberBombMax - 90);
        this.sfx.wave();
        this.updateUI();
    }

    showWaveBanner() {
        this.banner.setText(`WAVE ${this.wave}`);
        this.tweens.killTweensOf(this.banner);
        this.banner.setAlpha(0).setScale(0.98);
        this.tweens.add({ targets: this.banner, alpha: 1, scale: 1, duration: 240, yoyo: true, hold: 900, ease: "Sine.easeOut" });
    }

    // ---------- scoring ----------
    computeMult() {
        this.mult = Math.min(6, 1 + Math.floor(this.killStreak / 7));
    }
    resetStreak() {
        this.killStreak = 0;
        this.computeMult();
    }
    addScore(base) {
        this.computeMult();
        this.score += base * this.mult;
        this.updateUI();
    }

    // ---------- firing ----------
    tryFire(rapid) {
        const now = this.time.now;
        const cd = rapid ? 70 : 120;  // slightly slower, “classic”
        if (now < this.fireCooldown) return;
        this.fireCooldown = now + cd;

        // penalty
        this.score = Math.max(0, this.score - this.shotPenalty);

        const ang = this.barrel.rotation;
        const tipX = this.barrel.x + Math.cos(ang) * 48;
        const tipY = this.barrel.y + Math.sin(ang) * 48;

        // Bullet + bloom-ish glow
        glowCircle(this, tipX, tipY, 4, PAL.YELLOW, 0.12);

        const bullet = this.add.circle(tipX, tipY, 4, PAL.YELLOW).setAlpha(0.95);
        this.physics.add.existing(bullet);
        this.bullets.add(bullet);
        bullet.body.setCircle(4);
        bullet.body.setBounce(0.25);
        bullet.body.outOfBoundsKill = true;
        const speed = 720;
        bullet.body.setVelocity(
            Math.cos(ang) * speed,
            Math.sin(ang) * speed
        );
        this.time.delayedCall(800, () => bullet.destroy());
        this.sfx.shoot();
        this.updateUI();
    }

    // ---------- spawns ----------
    spawnAircraft(time) {
        // Weighted by wave, but keeps heli common
        const r = Math.random();
        let type = "heli";
        if (this.wave >= 2 && r > 0.68) type = "bomber";
        if (this.wave >= 4 && r > 0.90) type = "jet";

        if (type === "heli") this.spawnHeli(time);
        else if (type === "bomber") this.spawnBomber(time);
        else this.spawnJet(time);
    }

    spawnHeli(time) {
        const fromLeft = Math.random() < 0.5;
        const y = Phaser.Math.Between(82, 205);
        const x = fromLeft ? 20 : W - 20;

        const body = this.add.rectangle(0, 0, 64, 18, PAL.DKBLUE).setAlpha(0.95);
        const tail = this.add.rectangle(fromLeft ? -30 : 30, 0, 26, 6, PAL.PURPLE).setAlpha(0.95);
        const rotor = this.add.rectangle(0, -13, 70, 4, PAL.WHITE).setAlpha(0.85);

        const heli = this.add.container(x, y, [tail, body, rotor]);
        heli.setSize(84, 34);
        this.physics.add.existing(heli);
        this.helis.add(heli);
        heli.body.setAllowGravity(false);

        const baseSpeed = 110 + this.wave * 10;
        heli.body.setVelocityX(fromLeft ? baseSpeed : -baseSpeed);

        heli.kind = "heli";
        heli.hp = 1;
        heli.nextDropAt = time + Phaser.Math.Between(this.heliDropMin, this.heliDropMax);

        this.tweens.add({ targets: rotor, angle: 360, duration: 250, repeat: -1 });

        const tick = () => {
            if (!heli.active || this.isGameOver) return;
            const now = this.time.now;
            if (now >= heli.nextDropAt) {
                this.spawnParatrooper(heli.x + Phaser.Math.Between(-10, 10), heli.y + 18, heli.body.velocity.x);
                heli.nextDropAt = now + Phaser.Math.Between(this.heliDropMin, this.heliDropMax);
            }
            this.time.delayedCall(120, tick);
        };
        tick();

    }

    spawnBomber(time) {
        const fromLeft = Math.random() < 0.5;
        const y = Phaser.Math.Between(92, 190);
        const x = fromLeft ? -140 : W + 140;

        const fus = this.add.rectangle(0, 0, 78, 14, PAL.ORANGE).setAlpha(0.95);
        const wing = this.add.rectangle(0, 0, 34, 26, PAL.YELLOW).setAlpha(0.85);
        const tail = this.add.rectangle(fromLeft ? -38 : 38, -2, 14, 10, PAL.WHITE).setAlpha(0.8);

        const bomber = this.add.container(x, y, [wing, fus, tail]);
        bomber.setSize(92, 34);
        this.physics.add.existing(bomber);
        this.bombers.add(bomber);
        bomber.body.setAllowGravity(false);

        const baseSpeed = 92 + this.wave * 7;
        bomber.body.setVelocityX(fromLeft ? baseSpeed : -baseSpeed);

        bomber.kind = "bomber";
        bomber.hp = 2;
        bomber.nextBombAt = time + Phaser.Math.Between(this.bomberBombMin, this.bomberBombMax);

        const tick = () => {
            if (!bomber.active || this.isGameOver) return;
            const now = this.time.now;
            if (now >= bomber.nextBombAt) {
                this.spawnBomb(bomber.x, bomber.y + 18, bomber.body.velocity.x);
                bomber.nextBombAt = now + Phaser.Math.Between(this.bomberBombMin, this.bomberBombMax);
            }
            this.time.delayedCall(120, tick);
        };
        tick();

    }

    spawnJet(time) {
        const fromLeft = Math.random() < 0.5;
        const y = Phaser.Math.Between(70, 150);
        const x = fromLeft ? -160 : W + 160;

        const fus = this.add.rectangle(0, 0, 68, 10, PAL.GREEN).setAlpha(0.95);
        const fin = this.add.rectangle(fromLeft ? -20 : 20, -6, 10, 14, PAL.WHITE).setAlpha(0.75);
        const nose = this.add.triangle(fromLeft ? 36 : -36, 0, 0, -6, 0, 6, fromLeft ? 16 : -16, 0, PAL.WHITE).setAlpha(0.8);

        const jet = this.add.container(x, y, [fus, fin, nose]);
        jet.setSize(92, 26);
        this.physics.add.existing(jet);
        this.jets.add(jet);
        jet.body.setAllowGravity(false);

        const baseSpeed = 220 + this.wave * 14;
        jet.body.setVelocityX(fromLeft ? baseSpeed : -baseSpeed);

        jet.kind = "jet";
        jet.hp = 1;

    }

    spawnParatrooper(x, y, airVx) {
        // Container: canopy + lines + body
        const canopy = this.add.arc(0, -10, 12, 200, -20, false, PAL.WHITE).setAlpha(0.9);
        const lineL = this.add.rectangle(-6, -2, 1.5, 12, PAL.WHITE).setAlpha(0.6);
        const lineR = this.add.rectangle(6, -2, 1.5, 12, PAL.WHITE).setAlpha(0.6);
        const body = this.add.circle(0, 8, 6, PAL.MAGENTA).setAlpha(0.95);

        const troop = this.add.container(x, y, [canopy, lineL, lineR, body]);
        troop.setSize(28, 30);

        this.physics.add.existing(troop);
        troop.body.setCircle(6);
        troop.body.setOffset(troop.width / 2 - 6, troop.height / 2 + 2); // place circle around body
        troop.body.setBounce(0.08);

        // “Atari-ish”: brief freefall, then parachute deploy slows descent
        troop.deployed = false;
        troop.canopy = canopy;
        troop.lineL = lineL;
        troop.lineR = lineR;

        // Initial fall / drift
        troop.body.setVelocityX(airVx * 0.45 + Phaser.Math.Between(-22, 22));
        troop.body.setVelocityY(Phaser.Math.Between(-6, 24));
        troop.body.setGravityY(this.G); // same as world at first

        // Hide canopy until deploy
        canopy.setAlpha(0.0);
        lineL.setAlpha(0.0);
        lineR.setAlpha(0.0);

        // Deploy after a short delay
        const deployDelay = Phaser.Math.Between(140, 240);
        this.time.delayedCall(deployDelay, () => {
            if (!troop.active) return;
            troop.deployed = true;
            canopy.setAlpha(0.9);
            lineL.setAlpha(0.55);
            lineR.setAlpha(0.55);

            // Slow descent: reduce effective gravity + clamp fall speed
            troop.body.setGravityY(55);
            troop.body.setMaxVelocity(220, 120);

            // Add gentle sway
            this.tweens.add({
                targets: troop,
                angle: { from: -6, to: 6 },
                duration: 520 + Phaser.Math.Between(-80, 120),
                yoyo: true,
                repeat: -1,
                ease: "Sine.easeInOut"
            });
        });

        this.troops.add(troop);
    }

    spawnBomb(x, y, airVx) {
        const bomb = this.add.rectangle(x, y, 10, 14, PAL.ORANGE).setAlpha(0.95);
        this.physics.add.existing(bomb);
        bomb.body.setBounce(0.03);

        // Softer initial drop for the lighter gravity
        bomb.body.setVelocityX(airVx * 0.18 + Phaser.Math.Between(-8, 8));
        bomb.body.setVelocityY(Phaser.Math.Between(0, 16));

        this.bombs.add(bomb);
    }

    // ---------- hits ----------
    hitAircraft(bullet, craft) {
        if (!bullet.active || !craft.active) return;
        bullet.destroy();

        craft.hp = (craft.hp || 1) - 1;
        this.sfx.hit();

        // tiny bloom spark
        glowCircle(this, craft.x, craft.y, 6, PAL.WHITE, 0.10);

        if (craft.hp <= 0) {
            this.explode(craft.x, craft.y, craft.kind === "bomber" ? PAL.ORANGE : (craft.kind === "jet" ? PAL.GREEN : PAL.BLUE));
            this.sfx.boom();
            craft.destroy();

            this.killStreak++;
            const pts = craft.kind === "bomber" ? 220 : (craft.kind === "jet" ? 180 : 140);
            this.addScore(pts);
        } else {
            this.updateUI();
        }
    }

    hitTroop(bullet, troop) {
        if (!bullet.active || !troop.active) return;
        bullet.destroy();

        const x = troop.x, y = troop.y;
        troop.destroy();

        this.explode(x, y, PAL.MAGENTA);
        this.sfx.hit();

        this.killStreak++;
        this.addScore(80);
    }

    hitBomb(bullet, bomb) {
        if (!bullet.active || !bomb.active) return;
        bullet.destroy();
        const x = bomb.x, y = bomb.y;
        bomb.destroy();

        this.explode(x, y, PAL.ORANGE);
        this.sfx.hit();

        this.killStreak++;
        this.addScore(90);
    }

    troopLanded(troop) {
        if (!troop.active) return;
        const x = troop.x;

        troop.destroy();
        this.resetStreak();

        // Stack into towers
        this.addToStackAtX(x);

        this.cameras.main.shake(70, 0.004);
        this.updateUI();
    }

    addToStackAtX(x) {
        let target = null;
        this.grounders.children.iterate(g => {
            if (!g || !g.active) return;
            if (Math.abs(g.x - x) < 26) target = g;
        });

        if (!target) {
            const g = this.add.rectangle(x, this.groundY - 12, 14, 14, PAL.MAGENTA).setAlpha(0.95);
            this.physics.add.existing(g);
            g.body.setAllowGravity(false);
            g.stackCount = 1;
            this.grounders.add(g);
            return;
        }

        target.stackCount = (target.stackCount || 1) + 1;

        // Grow tower
        const hScale = Math.min(3.2, 1 + target.stackCount * 0.18);
        target.setScale(1, hScale);
        target.y = (this.groundY - 12) - (target.displayHeight - 14) / 2;

        // Little “bloom pop”
        glowCircle(this, target.x, target.y - (target.displayHeight / 2) + 8, 6, PAL.MAGENTA, 0.10);
    }

    bombHitGround(bomb) {
        if (!bomb.active) return;
        const x = bomb.x;
        bomb.destroy();

        this.explode(x, this.groundY - 6, PAL.ORANGE);
        this.sfx.boom();

        // Bomb hurts base if close
        const dist = Math.abs(x - this.baseX);
        if (dist < 160) {
            const dmg = dist < 80 ? 2 : 1;
            this.baseTakeDamage(dmg);
        } else {
            this.resetStreak();
            this.updateUI();
        }
    }

    baseTakeDamage(dmg) {
        if (dmg <= 0) return;
        this.baseHP = Math.max(0, this.baseHP - dmg);
        this.resetStreak();
        this.sfx.hurt();

        // bloom flash on base
        glowCircle(this, this.baseX, this.groundY - 18, 18, PAL.GREEN, 0.08);

        this.tweens.add({
            targets: [this.turretBase, this.barrel],
            alpha: 0.35,
            duration: 60,
            yoyo: true,
            repeat: 2
        });

        this.cameras.main.shake(150, 0.007);
        this.updateUI();

        if (this.baseHP <= 0) this.gameOver();
    }

    // ---------- particles ----------
    explode(x, y, color) {
        // bloom-ish center
        glowCircle(this, x, y, 10, color, 0.10);

        for (let i = 0; i < 12; i++) {
            const p = this.add.rectangle(x, y, 4, 4, color).setAlpha(0.95);
            this.physics.add.existing(p);
            p.body.setAllowGravity(true);
            p.body.setVelocity(Phaser.Math.Between(-220, 220), Phaser.Math.Between(-240, -40));
            p.body.setBounce(0.40);
            this.time.delayedCall(700 + i * 12, () => p.destroy());
        }
    }

    updateUI() {
        const hpBar = "█".repeat(this.baseHP) + "░".repeat(this.baseHPMax - this.baseHP);
        this.computeMult();
        this.ui.setText(
            `SCORE ${this.score}   WAVE ${this.wave}   MULT x${this.mult}   STREAK ${this.killStreak}\n` +
            `BASE ${hpBar}   (SHOT -${this.shotPenalty})`
        );
    }

    gameOver() {
        this.isGameOver = true;
        this.gameOverText
            .setText(`GAME OVER\nSCORE ${this.score}\nWAVE ${this.wave}\n\nPress R`)
            .setVisible(true);
    }
}

