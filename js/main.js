
import { GameScene } from "./GameScene.js";
const W = 960, H = 540;

new Phaser.Game({
    type: Phaser.AUTO,
    width: W,
    height: H,
    backgroundColor: "#000000",
    physics: {
        default: "arcade",
        arcade: {
            gravity: { y: 100 }, // global gravity (matches this.G)
            debug: false
        }
    },
    scene: [GameScene]
});
