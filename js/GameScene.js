import { AtariFX } from "./AtariFx.js";
import Text from "./Rules.js";

const W = 960, H = 540;
/* Apple II-ish palette (approx) */
const PAL = {
    BLUE: 0x605BF5,
    BLACK: 0x000000,
    DKBLUE: 0x1A0DA3,
    DKGREEN: 0x0D6B2E,
    GREEN: 0x32FF6A,
    MAGENTA: 0xFF2BD6,
    ORANGE: 0xFF0000,
    PURPLE: 0xB300FF,
    RED: 0xff0000,
    WHITE: 0xFFFFFF,
    YELLOW: 0xFFE35A,
};

export class GameScene extends Phaser.Scene {
    constructor() { super("game"); }
    preload() {
        this.load.font('fixedsys', 'assets/fonts/Fixedsys.ttf');
        this.load.spritesheet("helicopter", "assets/images/helicopter.png", {
            frameWidth: 30,
            frameHeight: 11
        });
        this.load.spritesheet("bomber", "assets/images/bomber.png", {
            frameWidth: 30,
            frameHeight: 11
        });
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
        const bb = this.add.graphics();
        bb.fillStyle(PAL.ORANGE, 1);
        bb.fillCircle(2, 2, 2);
        bb.generateTexture("bomb", 8, 8);
        bb.destroy();
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
        this.turret = this.add.circle(W / 2, this.groundY - 20, 22, PAL.BLUE);
        this.physics.add.existing(this.turret, true);
        this.base = this.add.rectangle(W / 2, this.groundY, 120, 42, PAL.DKBLUE);
        this.physics.add.existing(this.base, true);
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
        this.physics.add.overlap(this.troopers, this.base, (object, trooper) => { trooper.destroy(); }, null, this);
        this.physics.add.overlap(this.troopers, this.turret, (object, trooper) => { trooper.destroy(); }, null, this);
        this.physics.add.overlap(this.grounders, this.base, (object, grounder) => {
            grounder.destroy();
            this.baseHP--;
        }, null, this);
        this.physics.add.overlap(this.particles, this.troopers, this.hitTroop, null, this);
        this.physics.add.overlap(this.particles, this.chutes, this.hitChute, null, this);

        this.physics.add.overlap(this.troopers, this.ground, this.trooperLanded, null, this);
        this.physics.add.overlap(this.bombs, this.ground, this.bombHitGround, null, this);

        // input
        this.keys = this.input.keyboard.addKeys("SPACE,SHIFT,R");
        /* landed -> attack rule */
        this.attackThreshold = 10;      // when 10 have landed, they attack
        this.attackInProgress = false;  // prevents retrigger while attackers alive

        // UI
        this.level = 1;
        this.score = 0;
        this.enemiesHit = 0;
        this.choppersNeeded = 10;
        this.bombersNeeded = 3;
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
        this.showLevel();
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
        if (time > this.nextSpawn && !this.attackInProgress) {
            this.spawnAircraft(time);
            this.nextSpawn = time + this.spawnRate;
        }

        if (this.attackInProgress) {
            this.grounders.getChildren().forEach(grounder => {
                if (grounder.x > this.base.x) {
                    grounder.x--;
                }
                if (grounder.x < this.base.x) {
                    grounder.x++;
                }
            });
        }
        // cleanup
        this.bullets.children.iterate(b => { if (b && b.active && b.y > H + 60) b.destroy(); });
        this.air.children.iterate(a => { if (a && a.active && (a.x < -160 || a.x > W + 160)) a.destroy(); });
        this.troopers.children.iterate(t => { if (t && t.active && t.y > H + 90) t.destroy(); });      // keep deployed parachutes attached to troopers
        this.bombs.children.iterate(b => { if (b && b.active && b.y > H + 90) b.destroy(); });
        this.particles.children.iterate(b => { if (b && b.y > this.groundY) b.destroy(); });


        if (this.attackInProgress && this.baseHP === 0) {
            this.gameOver();
        }
        //if (this.attackInProgress && this.grounders.countActive(true) === 0) this.attackInProgress = false;

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
        this.score = (this.score > 0) ? 0 : this.score;

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
        else if (this.level > 3) {
            this.spawnBomber(time);
        }
    }

    spawnHeli(time) {
        const left = Math.random() < 0.5;
        const x = left ? -120 : W + 120;
        const y = Phaser.Math.Between(90, 170);

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
            if (now >= heli.nextDrop && !this.attackInProgress) {
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
                this.spawnBomb(bomber.x, bomber.y + 28, bomber.body.velocity.x);
                bomber.nextBomb = now + Phaser.Math.Between(this.bombMin, this.bombMax);
            }
            this.time.delayedCall(120, tick);
        };
        tick();

    }

    spawnBomb(x, y, vx) {
        const bomb = this.physics.add.image(x, y, "bomb");
        this.bombs.add(bomb);

        bomb.body.setCollideWorldBounds(true);
        bomb.body.setBounce(0.08);
        bomb.body.setGravityY(200);
        bomb.setScale(3);
        bomb.body.setVelocityX(vx * 0.45 + Phaser.Math.Between(-20, 20));
        bomb.body.setVelocityY(Phaser.Math.Between(-6, 24));
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
        this.explode(craft.x, craft.y, 50, 120, 120);
        craft.hp--;
        if (craft.hp <= 0) {
            craft.destroy();
            this.enemiesHit++;
            if (this.enemiesHit > this.choppersNeeded) {
                this.levelUp();
            }
            this.score += (craft.kind === "bomber") ? 220 : 140;
            this.updateUI();
        }
    }
    levelUp() {
        this.level++;
        this.enemiesHit = 0;
        this.choppersNeeded += 5;
        this.killEverything();
    }

    killEverything() {
        this.bullets.children.iterate(b => { b.destroy(); });
        //this.air.children.iterate(a => { a.destroy(); });
        // this.troopers.children.iterate(t => {
        //     t.destroy();
        // });
        // this.bombs?.children.iterate(b => { b.destroy(); });
        // this.particles.children.iterate(b => { b.destroy(); });
    }

    hitTrooper(bullet, trooper) {
        bullet.destroy();
        this.explode(trooper.x, trooper.y, 20, 120, 120);

        if (trooper.chute && trooper.chute.active) trooper.chute.destroy();
        trooper.destroy();
        this.score += 80;
        this.updateUI();
    }

    hitBomb(bullet, bomb) {
        bullet.destroy();
        bomb.destroy();
        this.score += 90;
        this.updateUI();
    }


    bombHitGround(ground, bomb) {
        // explode + base damage if close
        this.explode(bomb.x, bomb.y, 120, 160, 0);
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
        this.hitTrooper(bullet, chute);
        // bullet.destroy();

        // const t = chute.trooper;
        // chute.destroy();
        // this.explode(chute.x, chute.y, 10, 120, 120);

        // if (t && t.active) {
        //     t.deployed = false;
        //     t.chute = null;
        //     t.body.setGravityY(this.G);
        //     t.body.setMaxVelocity(400, 520);
        //     t.body.velocity.y = Math.max(t.body.velocity.y, 120);
        // }

        // this.score += 40;
        // this.updateUI();
    }

    // ---------- landed -> wait -> attack at 10 ----------
    explode(x, y, particleCount, xv, yv) {
        // Cheap particle-ish burst
        for (let i = 0; i < particleCount; i++) {
            const keys = Object.keys(PAL);
            const randomIndex = Phaser.Math.Between(0, keys.length - 1);
            const randomSize1 = Phaser.Math.Between(2, 10);
            const randomSize2 = Phaser.Math.Between(2, 10);
            const color = PAL[keys[randomIndex]];
            const p = this.add.rectangle(x, y, randomSize1, randomSize2, color).setAlpha(0.95);
            this.physics.add.existing(p);
            this.particles.add(p);
            p.body.setAllowGravity(true);
            p.body.setVelocity(Phaser.Math.Between(-xv, xv), Phaser.Math.Between(-yv, yv));
            p.body.setGravityY(randomSize1 * randomSize2 * 8);
            p.body.setBounce(0.45);
            p.body.setCollideWorldBounds(true);
            this.time.delayedCall(950 + i * 20, () => p.destroy());
        }
    }

    trooperLanded(ground, trooper) {
        const grounder = this.physics.add.sprite(trooper.x, trooper.y, 'paratrooper');
        trooper.destroy();
        this.physics.add.existing(grounder);
        this.grounders.add(grounder);
        grounder.setScale(3);


        if (!this.attackInProgress && this.grounders.getChildren().length >= this.attackThreshold) {
            this.attackInProgress = true;
        }

        this.updateUI();
    }

    showLevel() {
        let levelText = this.add.text(W / 2, H / 3,
            `  Sortie ${this.level}\n` +
            `${this.choppersNeeded} Choppers`, {
            fontFamily: 'Fixedsys',
            fontSize: '40px',
            fill: "#f88"
        }).setOrigin(0.5);
        this.time.delayedCall(2000, () => {
            levelText.destroy();
        }, [], this);
        if (this.level > 1) this.scene.pause();
    }

    updateUI() {
        const hpBar = "█".repeat(this.baseHP) + "░".repeat(this.baseHPMax - this.baseHP);
        const waiting = this.grounders.getChildren().length;
        const need = Math.max(0, this.attackThreshold - waiting);
        this.ui.setText(
            `BASE  ${hpBar}\n` +
            `LANDED ${waiting} / ${this.attackThreshold}  (${need} to attack)\n` +
            `SORTIE  ${this.level}\n`
        );

        const zeroPad = (num, places) => String(num).padStart(places, '0')
        this.ui2.setText(zeroPad(this.score, 7));

    }

    gameOver() {
        this.attackInProgress = false;
        this.base.visible = this.turret.visible = this.barrel.visible = this.ui2.visible = false;
        this.explode(this.base.x, this.base.y, 500, 220, -500);
        let gameOverText = this.add.text(W / 2, H / 3, "GAME OVER", {
            fontFamily: 'Fixedsys',
            fontSize: '40px',
            fill: "#f88"
        }).setOrigin(0.5);
        this.time.delayedCall(2000, () => {
            gameOverText.destroy();
        }, [], this);
        this.killEverything();
    }
}