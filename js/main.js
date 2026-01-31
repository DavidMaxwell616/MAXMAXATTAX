
import { GameScene } from "./GameScene.js";
const W = 960, H = 540;


new Phaser.Game({
    type: Phaser.AUTO,
    width: W,
    height: H,
    physics: {
        default: "arcade",
        arcade: { debug: false }
    },
    scene: GameScene
});