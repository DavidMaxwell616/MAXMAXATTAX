import { AtariFX } from "./AtariFx.js";

const W = 960, H = 540;
/* Apple II-ish palette (approx) */
const PAL = {
    BLACK: 0x000000,
    DKBLUE: 0x0A0B2E,
    BLUE: 0x1F56FF,
    PURPLE: 0xB300FF,
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

        this.load.image('base', 'assets/images/base.png');
        this.load.image('parachute', 'assets/images/parachute.png');
        this.load.spritesheet('paratrooper', 'assets/images/paratrooper.png', {
            frameWidth: 5,
            frameHeight: 7
        });
    }
    create() {

        /* bullet texture (reliable velocity) */
        const g = this.add.graphics();
        g.fillStyle(PAL.YELLOW, 1);
        g.fillCircle(4, 4, 4);
        g.generateTexture("bullet", 8, 8);
        g.destroy();

        /* physics */
        this.physics.world.setBounds(0, 0, W, H);

        // /* background */
        // this.add.rectangle(W / 2, H / 2, W, H, PAL.BLUE);

        // /* ground */
        this.groundY = H - 32;
        this.ground = this.add.rectangle(W / 2, this.groundY + 26, W, 12, PAL.DKGREEN);
        this.physics.add.existing(this.ground, true);

        /* turret */
        this.baseX = W / 2;
        this.baseHP = 10;
        this.barrel = this.add.rectangle(this.baseX, this.groundY - 24, 56, 10, PAL.YELLOW)
            .setOrigin(0.12, 0.5);
        this.base = this.add.image(this.baseX, this.groundY - 10, 'base');
        this.base.setScale(3);

        /* groups */
        this.bullets = this.physics.add.group();
        this.helis = this.physics.add.group();
        this.bombers = this.physics.add.group();
        this.troops = this.physics.add.group();
        this.grounders = this.physics.add.group();
        this.chutes = this.physics.add.group();

        /* collisions */
        this.physics.add.overlap(this.bullets, this.helis, this.hitHeli, null, this);
        this.physics.add.overlap(this.bullets, this.bombers, this.hitBomber, null, this);
        this.physics.add.overlap(this.bullets, this.troops, this.hitTroop, null, this);
        this.physics.add.collider(this.troops, this.ground, this.troopLanded, null, this);
        this.physics.add.overlap(this.bullets, this.grounders, this.hitGrounder, null, this);
        this.physics.add.overlap(this.bullets, this.chutes, this.hitChute, null, this);

        /* input */
        this.keys = this.input.keyboard.addKeys("SPACE,SHIFT,R");
        this.input.on("pointerdown", () => this.fire(false));
        this.fireCooldown = 0;
        /* landed -> attack rule */
        this.landed = [];               // store {x, marker} for landed troops waiting
        this.attackThreshold = 10;      // when 10 have landed, they attack
        this.attackInProgress = false;  // prevents retrigger while attackers alive

        /* UI */
        this.score = 0;
        this.ui = this.add.text(12, 12, "", { font: "16px monospace", fill: "#dbe8ff" });
        this.ui2 = this.add.text(W / 2 - 50, H * .92, "", { font: "32px monospace", fill: "#dbe8ff" });

        /* spawn timing (Atari-ish) */
        this.spawnRate = 2200;
        this.nextSpawn = 0;

        /* FX */
        this.fx = new AtariFX(this);
        this.heliAnim = this.anims.create({
            key: "helicopter",
            frames: this.anims.generateFrameNumbers("helicopter", { start: 0, end: 3 }),
            frameRate: 18,
            repeat: -1
        });
        this.updateUI();
    }

    update(time) {
        if (Phaser.Input.Keyboard.JustDown(this.keys.R))
            this.scene.restart();

        /* aim */
        const p = this.input.activePointer;
        let ang = Phaser.Math.Angle.Between(
            this.barrel.x, this.barrel.y, p.worldX, p.worldY
        );
        ang = Phaser.Math.Clamp(
            ang,
            Phaser.Math.DegToRad(-170),
            Phaser.Math.DegToRad(-10)
        );
        this.barrel.rotation = ang;

        /* fire */
        if (Phaser.Input.Keyboard.JustDown(this.keys.SPACE))
            this.fire(false);
        if (this.keys.SHIFT.isDown && this.keys.SPACE.isDown)
            this.fire(true);

        /* spawn heli */
        if (time > this.nextSpawn) {
            this.spawnHeli();
            this.nextSpawn = time + this.spawnRate;
        }

        /* cleanup */
        this.bullets.children.iterate(b => {
            if (b && b.y > H + 50) b.destroy();
        });
        this.helis.children.iterate(a => {
            if (a && (a.x < -140 || a.x > W + 140)) a.destroy();
        });
        this.bombers.children.iterate(a => {
            if (a && (a.x < -140 || a.x > W + 140)) a.destroy();
        });
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

        // allow retrigger after all attackers are gone
        if (this.attackInProgress && this.grounders.countActive(true) === 0) {
            this.attackInProgress = false;
        }
        // keep deployed parachutes attached to their troopers
        this.chutes.children.iterate(ch => {
            if (!ch || !ch.active) return;
            const t = ch.trooper;
            if (!t || !t.active) {
                ch.destroy();
                return;
            }
            ch.x = t.x;
            ch.y = t.y - 16;
        });

        this.fx.draw();
    }

    hitChute(bullet, chute) {
        bullet.destroy();

        const t = chute.trooper;
        chute.destroy();

        // If trooper still alive, parachute is gone -> fast fall
        if (t && t.active) {
            t.deployed = false;
            t.chute = null;

            // Restore normal gravity and allow faster terminal speed
            t.body.setGravityY(0); // clear any custom gravity first
            t.body.setGravityY(this.G); // back to world-ish fall
            t.body.setMaxVelocity(400, 520);

            // Optional: give a little downward kick
            t.body.velocity.y = Math.max(t.body.velocity.y, 120);
        }

        // Score for popping parachute
        this.score += 40;
        this.updateUI();
    }

    hitGrounder(bullet, attacker) {
        bullet.destroy();
        attacker.destroy();
        this.score += 30;
        this.updateUI();
    }

    fire(rapid) {
        const now = this.time.now;
        const cd = rapid ? 70 : 120;
        if (now < this.fireCooldown) return;
        this.fireCooldown = now + cd;

        const ang = this.barrel.rotation;
        const x = this.barrel.x + Math.cos(ang) * 48;
        const y = this.barrel.y + Math.sin(ang) * 48;

        const b = this.physics.add.image(x, y, "bullet");
        this.bullets.add(b);
        b.body.setCircle(4, 2, 2);

        const speed = 720;
        b.body.setVelocity(
            Math.cos(ang) * speed,
            Math.sin(ang) * speed
        );

        this.time.delayedCall(1800, () => b.destroy());

        this.score = Math.max(0, this.score - 1);
        this.updateUI();
    }

    spawnHeli() {

        const left = Math.random() < 0.5;
        const x = left ? -120 : W + 120;
        const y = Phaser.Math.Between(90, 200);
        const heli = this.physics.add.sprite(x, y, 'helicopter');
        this.helis.add(heli);
        heli.anims.play(this.heliAnim);
        heli.setVelocityX(left ? 110 : -110);
        heli.setScale(left ? 3 : -3, 3);
        heli.hp = 1;

        this.time.addEvent({
            delay: Phaser.Math.Between(1000, 1600),
            loop: true,
            callback: () => {
                if (heli.active)
                    this.spawnParatrooper(heli.x, heli.y + 18, heli.body.velocity.x);
            }
        });
        this.physics.add.existing(heli);

    }

    spawnParatrooper(x, y, vx) {
        // Trooper body (physics)
        const trooper = this.physics.add.sprite(x, y, 'paratrooper');
        this.physics.add.existing(trooper);
        this.troops.add(trooper);
        //        trooper.body.setCircle(6);
        trooper.body.setCollideWorldBounds(true);
        trooper.body.setBounce(0.08);
        trooper.setScale(3);
        // Initial drift + brief freefall
        trooper.body.setVelocityX(vx * 0.45 + Phaser.Math.Between(-20, 20));
        trooper.body.setVelocityY(Phaser.Math.Between(-6, 24));

        // State
        trooper.deployed = false;
        trooper.chute = null;

        // Deploy parachute after delay: slow descent
        this.time.delayedCall(200, () => {
            if (!trooper.active) return;

            trooper.deployed = true;

            // Create shootable canopy as its own physics target
            const chute = this.physics.add.sprite(trooper.x, trooper.y - 16, 'parachute');
            chute.setScale(3);
            this.chutes.add(chute);
            chute.body.setAllowGravity(false);
            chute.body.setImmovable(true);

            // Link them
            //chute.body = trooper;
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

    hitHeli(b, heli) {
        this.explode(heli.x, heli.y);
        b.destroy();
        heli.hp--;
        if (heli.hp <= 0) {
            heli.destroy();
            this.score += 140;
            this.updateUI();
        }
    }

    hitTroop(bullet, troop) {
        bullet.destroy();

        this.explode(troop.x, troop.y);
        // If this trooper has a chute, remove it too
        if (troop.chute && troop.chute.active) troop.chute.destroy();
        troop.destroy();
        this.score += 80;
        this.updateUI();
    }

    explode(x, y) {
        // Cheap particle-ish burst
        for (let i = 0; i < 10; i++) {
            const keys = Object.keys(PAL);
            const randomIndex = Phaser.Math.Between(0, keys.length - 1);
            const color = PAL[keys[randomIndex]];
            const p = this.add.rectangle(x, y, 4, 4, color).setAlpha(0.95);
            this.physics.add.existing(p);
            p.body.setAllowGravity(true);
            p.body.setVelocity(Phaser.Math.Between(-120, 120), Phaser.Math.Between(-160, 140));
            p.body.setBounce(0.45);
            p.body.setCollideWorldBounds(true);
            this.time.delayedCall(950 + i * 20, () => p.destroy());
        }
    }
    troopLanded(troop) {
        // record landing spot, remove falling troop
        const x = troop.x;
        troop.destroy();

        // create a waiting marker on the ground (they’re “gathering”)
        const marker = this.add.rectangle(x, this.groundY - 10, 12, 12, PAL.MAGENTA).setAlpha(0.95);
        this.landed.push({ x, marker });

        // once 10 have landed, they attack (spawn marching grounders)
        if (!this.attackInProgress && this.landed.length >= this.attackThreshold) {
            this.startAttackWave();
        }
        if (troop.chute && troop.chute.active) troop.chute.destroy();

        this.updateUI();
    }
    startAttackWave() {
        this.attackInProgress = true;

        // convert exactly 10 landed markers into attackers
        const batch = this.landed.splice(0, this.attackThreshold);

        batch.forEach((entry) => {
            if (entry.marker && entry.marker.active) entry.marker.destroy();

            const a = this.add.rectangle(entry.x, this.groundY - 10, 14, 14, PAL.MAGENTA).setAlpha(0.95);
            this.physics.add.existing(a);
            a.body.setAllowGravity(false);
            a.body.setCollideWorldBounds(true);

            // slight speed variance
            a.speed = 22 + Phaser.Math.Between(-3, 3);

            // small stagger so they don’t overlap perfectly
            a.x += Phaser.Math.Between(-6, 6);

            this.grounders.add(a);
        });
    }


    updateUI() {
        const waiting = this.landed.length;
        const need = Math.max(0, this.attackThreshold - waiting);
        this.ui.setText(
            `SCORE ${this.score}\n` +
            `BASE  ${"█".repeat(this.baseHP)}\n` +
            `LANDED ${waiting} / ${this.attackThreshold}  (${need} to attack)`
        );
        this.ui2.setText('000000'
        );

    }


    gameOver() {
        this.add.text(W / 2, H / 2, "GAME OVER", { font: "40px monospace", fill: "#f88" })
            .setOrigin(0.5);
        this.scene.pause();
    }
}
