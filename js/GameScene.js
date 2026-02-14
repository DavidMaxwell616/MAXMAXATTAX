import { AtariFX } from "./AtariFx.js";
import Text from "./Rules.js";

const W = 960, H = 540;
/* Apple II-ish palette (approx) */
const PAL = {
    BLACK: 0x000000,
    DKBLUE: 0x0A0B2E,
    BLUE: 0x1F56FF,
    PURPLE: 0xB300FF,
    RED: 0xff0000,
    GREEN: 0x32FF6A,
    DKGREEN: 0x0D6B2E,
    YELLOW: 0xFFE35A,
    MAGENTA: 0xFF2BD6,
    WHITE: 0xFFFFFF
};

export class GameScene extends Phaser.Scene {
    constructor() { super("game"); }
    preload() {

        this.load.spritesheet("helicopter", "assets/images/helicopter.png", {
            frameWidth: 30,
            frameHeight: 11
        });
        this.load.spritesheet("bomber", "assets/images/bomber.png", {
            frameWidth: 30,
            frameHeight: 11
        });
        this.load.image('base', 'assets/images/base.png');
        this.load.image('parachute', 'assets/images/parachute.png');
        this.load.spritesheet('paratrooper', 'assets/images/paratrooper.png', {
            frameWidth: 5,
            frameHeight: 7
        });
    }
    create() {
        // bullet texture (reliable velocity)
        const gg = this.add.graphics();
        gg.fillStyle(PAL.YELLOW, 1);
        gg.fillCircle(4, 4, 4);
        gg.generateTexture("bullet", 8, 8);
        gg.destroy();

        // physics
        this.physics.world.setBounds(0, 0, W, H);

        // background
        //this.add.rectangle(W / 2, H / 2, W, H, PAL.DKBLUE);

        // ground
        this.groundY = H - 32;
        this.ground = this.add.rectangle(W / 2, this.groundY + 26, W, 12, PAL.DKGREEN);
        this.physics.add.existing(this.ground, true);

        // turret
        this.baseX = W / 2;
        this.baseHPMax = 10;
        this.baseHP = this.baseHPMax;
        this.barrel = this.add.rectangle(this.baseX, this.groundY - 24, 56, 10, PAL.YELLOW)
            .setOrigin(0.12, 0.5);
        this.base = this.add.image(this.baseX, this.groundY - 10, 'base');
        this.base.setScale(3);
        // groups
        this.bullets = this.physics.add.group();
        this.air = this.physics.add.group();
        this.troopers = this.physics.add.group();     // trooper bodies (circles)
        this.chutes = this.physics.add.group();     // shootable canopy targets
        this.bombs = this.physics.add.group();      // bomber bombs
        this.grounders = this.physics.add.group();  // ground attackers
        this.particles = this.physics.add.group();
        // collisions
        this.physics.add.overlap(this.bullets, this.air, this.hitAircraft, null, this);
        this.physics.add.overlap(this.bullets, this.troopers, this.hitTroop, null, this);
        this.physics.add.overlap(this.bullets, this.chutes, this.hitChute, null, this);
        this.physics.add.overlap(this.bullets, this.bombs, this.hitBomb, null, this);
        this.physics.add.overlap(this.bullets, this.grounders, this.hitGrounder, null, this);

        this.physics.add.collider(this.troopers, this.ground, this.trooperLanded, null, this);
        this.physics.add.collider(this.bombs, this.ground, this.bombHitGround, null, this);

        // input
        this.keys = this.input.keyboard.addKeys("SPACE,SHIFT,R");
        /* landed -> attack rule */
        this.landed = 0;               // store {x, marker} for landed troopers waiting
        this.attackThreshold = 10;      // when 10 have landed, they attack
        this.attackInProgress = false;  // prevents retrigger while attackers alive

        // UI
        this.score = 0;
        this.ui = this.add.text(12, 12, "", { font: "16px monospace", fill: "#dbe8ff" });
        this.ui2 = this.add.text(W / 2 - 50, H * .92, "", { font: "26px monospace", fill: "#dbe8ff" });
        this.nextFireTime = 0;
        this.fireRate = 100; // ms between shots
        // spawn timing (Atari-ish cadence)
        this.spawnRate = 2200;
        this.nextSpawn = 0;

        // heli drops
        this.heliDropMin = 1000;
        this.heliDropMax = 1600;

        // bomber bombs
        this.bombMin = 900;
        this.bombMax = 1500;

        // landed -> attack rule
        this.landed = 0;
        this.attackThreshold = 10;
        this.attackInProgress = false;

        // FX
        this.fx = new AtariFX(this);
        this.heliAnim = this.anims.create({
            key: "helicopter",
            frames: this.anims.generateFrameNumbers("helicopter", { start: 0, end: 3 }),
            frameRate: 18,
            repeat: -1
        });
        this.bomberAnim = this.anims.create({
            key: "bomber",
            frames: this.anims.generateFrameNumbers("bomber", { start: 0, end: 3 }),
            frameRate: 18,
            repeat: -1
        });
        this.updateUI();
    }

    update(time) {
        if (Phaser.Input.Keyboard.JustDown(this.keys.R)) this.scene.restart();

        // aim
        const p = this.input.activePointer;
        let ang = Phaser.Math.Angle.Between(this.barrel.x, this.barrel.y, p.worldX, p.worldY);
        ang = Phaser.Math.Clamp(ang, Phaser.Math.DegToRad(-170), Phaser.Math.DegToRad(-10));
        this.barrel.rotation = ang;

        // fire
        if (Phaser.Input.Keyboard.JustDown(this.keys.SPACE)) this.fire();
        if (this.keys.SHIFT.isDown && this.keys.SPACE.isDown) this.fire();
        if (this.input.activePointer.isDown && time > this.nextFireTime) {
            this.fire();
            this.nextFireTime = time + this.fireRate;
        }
        // spawn aircraft (heli + bomber)
        if (time > this.nextSpawn) {
            this.spawnAircraft(time);
            this.nextSpawn = time + this.spawnRate;
        }

        // cleanup
        this.bullets.children.iterate(b => { if (b && b.active && b.y > H + 60) b.destroy(); });
        this.air.children.iterate(a => { if (a && a.active && (a.x < -160 || a.x > W + 160)) a.destroy(); });
        this.troopers.children.iterate(t => { if (t && t.active && t.y > H + 90) t.destroy(); });      // keep deployed parachutes attached to troopers
        this.bombs.children.iterate(b => { if (b && b.active && b.y > H + 90) b.destroy(); });
        this.particles.children.iterate(b => { if (b && b.y > this.groundY) b.destroy(); });

        // attackers march & hit base
        this.grounders.children.iterate(a => {
            if (!a || !a.active) return;
            const dir = (this.baseX < a.x) ? -1 : 1;
            a.body.setVelocityX(dir * a.speed);
            if (Math.abs(a.x - this.baseX) < 30) {
                a.destroy();
                this.baseHP = Math.max(0, this.baseHP - 1);
                this.cameras.main.shake(110, 0.006);
                this.updateUI();
                if (this.baseHP <= 0) this.gameOver();
            }
        });

        if (this.attackInProgress && this.grounders.countActive(true) === 0) this.attackInProgress = false;

        this.chutes.children.iterate(ch => {
            if (!ch || !ch.active) return;
            const t = ch.trooper;
            if (!t || !t.active) { ch.destroy(); return; }
            ch.x = t.x;
            ch.y = t.y - 16;
        });

        this.fx.draw();
    }

    // ---------- firing ----------
    fire() {

        if (this.score > 0) {
            this.score--;
        }

        const ang = this.barrel.rotation;
        const x = this.barrel.x + Math.cos(ang) * 48;
        const y = this.barrel.y + Math.sin(ang) * 48;

        const b = this.physics.add.image(x, y, "bullet");
        this.bullets.add(b);
        b.body.setCircle(4, 2, 2);

        const speed = 720;
        b.body.setVelocity(Math.cos(ang) * speed, Math.sin(ang) * speed);

        this.time.delayedCall(1800, () => b.destroy());

        this.score = Math.max(0, this.score - 1);
        this.updateUI();
    }

    // ---------- aircraft spawns ----------
    spawnAircraft(time) {
        // Keep heli common; introduce bombers sometimes
        const r = Math.random();
        const type = (r < 0.72) ? "heli" : "bomber";
        if (type === "heli") this.spawnHeli(time);
        else this.spawnBomber(time);
    }

    spawnHeli(time) {
        const left = Math.random() < 0.5;
        const x = left ? -120 : W + 120;
        const y = Phaser.Math.Between(90, 205);

        const heli = this.physics.add.sprite(x, y, 'helicopter');
        this.air.add(heli);
        heli.anims.play(this.heliAnim);
        this.physics.add.existing(heli);
        heli.body.setAllowGravity(false);
        heli.body.setVelocityX(left ? 110 : -110);
        heli.setScale(left ? 3 : -3, 3);
        heli.kind = "heli";
        heli.hp = 1;

        heli.nextDrop = time + Phaser.Math.Between(this.heliDropMin, this.heliDropMax);
        const tick = () => {
            if (!heli.active || this.baseHP <= 0) return;
            const now = this.time.now;
            if (now >= heli.nextDrop) {
                this.spawnParatrooper(heli.x + Phaser.Math.Between(-10, 10), heli.y + 18, heli.body.velocity.x);
                heli.nextDrop = now + Phaser.Math.Between(this.heliDropMin, this.heliDropMax);
            }
            this.time.delayedCall(120, tick);
        };
        tick();

    }

    spawnBomber(time) {
        const left = Math.random() < 0.5;
        const x = left ? -150 : W + 150;
        const y = Phaser.Math.Between(80, 175);

        const bomber = this.physics.add.sprite(x, y, 'bomber');
        bomber.anims.play(this.bomberAnim);
        bomber.setSize(92, 34);
        this.physics.add.existing(bomber);
        bomber.body.setAllowGravity(false);
        this.air.add(bomber);

        const sp = 92; // slower than heli
        bomber.body.setVelocityX(left ? sp : -sp);
        bomber.setScale(left ? 3 : -3, 3);

        bomber.kind = "bomber";
        bomber.hp = 2;

        bomber.nextBomb = time + Phaser.Math.Between(this.bombMin, this.bombMax);
        const tick = () => {
            if (!bomber.active || this.baseHP <= 0) return;
            const now = this.time.now;
            if (now >= bomber.nextBomb) {
                this.spawnBomb(bomber.x, bomber.y + 18, bomber.body.velocity.x);
                bomber.nextBomb = now + Phaser.Math.Between(this.bombMin, this.bombMax);
            }
            this.time.delayedCall(120, tick);
        };
        tick();

    }

    spawnBomb(x, y, vx) {
        const bomb = this.add.rectangle(x, y, 10, 14, PAL.ORANGE).setAlpha(0.95);
        this.bombs.add(bomb);
        this.physics.add.existing(bomb);
        bomb.body.setBounce(0.03);
        bomb.body.setCollideWorldBounds(true);
        bomb.body.setVelocityX(vx * 0.18 + Phaser.Math.Between(-8, 8));
        bomb.body.setVelocityY(Phaser.Math.Between(0, 16));
    }

    // ---------- shootable parachutes ----------
    spawnParatrooper(x, y, vx) {
        // physics body
        const trooper = this.physics.add.sprite(x, y, 'paratrooper');
        this.physics.add.existing(trooper);
        this.troopers.add(trooper);
        //        trooper.body.setCircle(6);
        trooper.body.setCollideWorldBounds(true);
        trooper.body.setBounce(0.08);
        trooper.body.setGravityY(200);
        trooper.setScale(3);
        // Initial drift + brief freefall
        trooper.body.setVelocityX(vx * 0.45 + Phaser.Math.Between(-20, 20));
        trooper.body.setVelocityY(Phaser.Math.Between(-6, 24));

        // State
        trooper.deployed = false;
        trooper.chute = null;

        // Deploy parachute after delay: slow descent
        this.time.delayedCall(800, () => {
            if (!trooper.active) return;

            trooper.deployed = true;

            // Create shootable canopy as its own physics target
            const chute = this.physics.add.sprite(trooper.x, trooper.y - 16, 'parachute');
            chute.setScale(3);
            this.chutes.add(chute);

            // Link them
            chute.trooper = trooper;
            trooper.chute = chute;

            // Slow descent (reduced gravity + terminal velocity)
            trooper.body.setGravityY(55);
            trooper.body.setMaxVelocity(220, 120);

            // Add mild sway
            this.tweens.add({
                targets: chute,
                angle: { from: -6, to: 6 },
                duration: 520 + Phaser.Math.Between(-60, 120),
                yoyo: true,
                repeat: -1,
                ease: "Sine.easeInOut"
            });

        });

        // Keep a reference for landing logic (we land the BODY)
    }
    // ---------- hits ----------
    hitAircraft(bullet, craft) {
        bullet.destroy();
        this.explode(craft.x, craft.y, 50);
        craft.hp--;
        if (craft.hp <= 0) {
            craft.destroy();
            this.score += (craft.kind === "bomber") ? 220 : 140;
            this.updateUI();
        }
    }

    hitTroop(bullet, troop) {
        bullet.destroy();
        this.explode(troop.x, troop.y, 20);

        if (troop.chute && troop.chute.active) troop.chute.destroy();
        troop.destroy();
        this.score += 80;
        this.updateUI();
    }

    hitBomb(bullet, bomb) {
        bullet.destroy();
        bomb.destroy();
        this.score += 90;
        this.updateUI();
    }

    hitGrounder(bullet, attacker) {
        bullet.destroy();
        attacker.destroy();
        this.score += 30;
        this.updateUI();
    }

    bombHitGround(bomb) {
        // explode + base damage if close
        this.explode(bomb.x, bomb.y, 20);
        const x = bomb.x;
        bomb.destroy();

        const dist = Math.abs(x - this.baseX);
        if (dist < 160) {
            const dmg = (dist < 80) ? 2 : 1;
            this.baseHP = Math.max(0, this.baseHP - dmg);
            this.cameras.main.shake(140, 0.007);
            this.updateUI();
            if (this.baseHP <= 0) this.gameOver();
        }
    }
    hitChute(bullet, chute) {
        bullet.destroy();

        const t = chute.trooper;
        chute.destroy();
        this.explode(chute.x, chute.y, 10);

        if (t && t.active) {
            t.deployed = false;
            t.chute = null;
            t.body.setGravityY(this.G);
            t.body.setMaxVelocity(400, 520);
            t.body.velocity.y = Math.max(t.body.velocity.y, 120);
        }

        this.score += 40;
        this.updateUI();
    }

    // ---------- landed -> wait -> attack at 10 ----------
    explode(x, y, size) {
        // Cheap particle-ish burst
        for (let i = 0; i < size; i++) {
            const keys = Object.keys(PAL);
            const randomIndex = Phaser.Math.Between(0, keys.length - 1);
            const color = PAL[keys[randomIndex]];
            const p = this.add.rectangle(x, y, 4, 4, color).setAlpha(0.95);
            this.physics.add.existing(p);
            this.particles.add(p);
            p.body.setAllowGravity(true);
            p.body.setVelocity(Phaser.Math.Between(-120, 120), Phaser.Math.Between(-130, 160));
            p.body.setGravityY(200);
            p.body.setBounce(0.45);
            p.body.setCollideWorldBounds(true);
            this.time.delayedCall(950 + i * 20, () => p.destroy());
        }
    }
    trooperLanded(ground, trooper) {
        trooper.chute.destroy();
        trooper.setVelocity(0, 0);
        this.landed++;
        if (!this.attackInProgress && this.landed >= this.attackThreshold) {
            this.startAttackWave();
        }

        this.updateUI();
    }
    startAttackWave() {
        this.attackInProgress = true;

        // convert exactly 10 landed markers into attackers
        //const batch = this.landed.splice(0, this.attackThreshold);

        //     batch.forEach((entry) => {

        //         const a = this.add.rectangle(entry.x, this.groundY - 10, 14, 14, PAL.MAGENTA).setAlpha(0.95);
        //         this.physics.add.existing(a);
        //         a.body.setAllowGravity(false);
        //         a.body.setCollideWorldBounds(true);

        //         // slight speed variance
        //         a.speed = 22 + Phaser.Math.Between(-3, 3);

        //         // small stagger so they don’t overlap perfectly
        //         a.x += Phaser.Math.Between(-6, 6);

        //         this.grounders.add(a);
        //     });
    }



    updateUI() {
        const hpBar = "█".repeat(this.baseHP) + "░".repeat(this.baseHPMax - this.baseHP);
        const waiting = this.landed;
        const need = Math.max(0, this.attackThreshold - waiting);
        this.ui.setText(
            `BASE  ${"█".repeat(this.baseHP)}\n` +
            `LANDED ${waiting} / ${this.attackThreshold}  (${need} to attack)`
        );

        const zeroPad = (num, places) => String(num).padStart(places, '0')
        this.ui2.setText(zeroPad(this.score, 7));

    }

    gameOver() {
        this.add.text(W / 2, H / 2, "GAME OVER", { font: "40px monospace", fill: "#f88" }).setOrigin(0.5);
        this.scene.pause();
    }
}