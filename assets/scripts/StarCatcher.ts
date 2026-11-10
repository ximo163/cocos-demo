import {
    _decorator, Component, Node, director, Director, Canvas, Camera, Layers, UITransform,
    Graphics, Label, Color, view, ResolutionPolicy, input, Input, EventTouch, EventMouse,
    sys, screen, HorizontalTextAlignment,
} from 'cc';

const { ccclass } = _decorator;

// 接星星：拖動籃子接住掉落的星星，避開炸彈。
// 整個場景在執行時建立，所以 main.scene 只是一個空場景。

const DESIGN_W = 720;
const DESIGN_H = 1280;
const UI = Layers.Enum.UI_2D;

type Kind = 'star' | 'bomb' | 'heart';

interface Item { kind: Kind; x: number; y: number; vy: number; r: number; rot: number; spin: number; }
interface Spark { x: number; y: number; vx: number; vy: number; life: number; max: number; color: Color; }
interface BgStar { x: number; y: number; r: number; phase: number; }

enum State { Ready, Playing, Over }

@ccclass('StarCatcher')
export class StarCatcher extends Component {
    private g: Graphics = null!;
    private scoreLabel: Label = null!;
    private livesLabel: Label = null!;
    private msgLabel: Label = null!;

    private w = DESIGN_W;
    private h = DESIGN_H;

    private state = State.Ready;
    private items: Item[] = [];
    private sparks: Spark[] = [];
    private bg: BgStar[] = [];
    private basketX = 0;
    private targetX = 0;
    private score = 0;
    private best = 0;
    private lives = 3;
    private elapsed = 0;
    private spawnTimer = 0;
    private shake = 0;
    private flash = 0;
    private time = 0;

    private readonly basketW = 170;
    private readonly basketH = 34;

    onLoad() {
        this.g = this.node.addComponent(Graphics);
        this.scoreLabel = this.makeLabel('Score', 44, HorizontalTextAlignment.LEFT);
        this.livesLabel = this.makeLabel('Lives', 44, HorizontalTextAlignment.RIGHT);
        this.msgLabel = this.makeLabel('Msg', 50, HorizontalTextAlignment.CENTER);
        this.msgLabel.lineHeight = 70;

        try { this.best = parseInt(sys.localStorage.getItem('starcatcher_best') || '0', 10) || 0; } catch { this.best = 0; }

        this.layout();
        view.on('canvas-resize', this.layout, this);
        screen.on('window-resize', this.layout, this);

        input.on(Input.EventType.TOUCH_START, this.onTouchStart, this);
        input.on(Input.EventType.TOUCH_MOVE, this.onTouchMove, this);
        input.on(Input.EventType.MOUSE_DOWN, this.onMouseDown, this);
        input.on(Input.EventType.MOUSE_MOVE, this.onMouseMove, this);

        this.showReady();
    }

    onDestroy() {
        input.off(Input.EventType.TOUCH_START, this.onTouchStart, this);
        input.off(Input.EventType.TOUCH_MOVE, this.onTouchMove, this);
        input.off(Input.EventType.MOUSE_DOWN, this.onMouseDown, this);
        input.off(Input.EventType.MOUSE_MOVE, this.onMouseMove, this);
        view.off('canvas-resize', this.layout, this);
        screen.off('window-resize', this.layout, this);
    }

    private makeLabel(name: string, size: number, align: HorizontalTextAlignment): Label {
        const n = new Node(name);
        n.layer = UI;
        this.node.addChild(n);
        n.addComponent(UITransform).setContentSize(DESIGN_W - 60, 400);
        const l = n.addComponent(Label);
        l.fontSize = size;
        l.lineHeight = size + 8;
        l.color = Color.WHITE;
        l.horizontalAlign = align;
        l.isBold = true;
        l.overflow = Label.Overflow.NONE;
        return l;
    }

    private layout() {
        const vs = view.getVisibleSize();
        this.w = vs.width;
        this.h = vs.height;
        const top = this.h / 2 - 60;
        this.scoreLabel.node.getComponent(UITransform)!.setContentSize(this.w - 60, 80);
        this.livesLabel.node.getComponent(UITransform)!.setContentSize(this.w - 60, 80);
        this.msgLabel.node.getComponent(UITransform)!.setContentSize(this.w - 60, 600);
        this.scoreLabel.node.setPosition(0, top);
        this.livesLabel.node.setPosition(0, top);
        this.msgLabel.node.setPosition(0, 60);

        this.bg = [];
        for (let i = 0; i < 70; i++) {
            this.bg.push({
                x: (Math.random() - 0.5) * this.w,
                y: (Math.random() - 0.5) * this.h,
                r: 1 + Math.random() * 2.5,
                phase: Math.random() * Math.PI * 2,
            });
        }
    }

    private get basketY() { return -this.h / 2 + 170; }

    // ---------- 輸入 ----------
    private toLocalX(uiX: number) { return uiX - this.w / 2; }

    private onTouchStart(e: EventTouch) { this.press(e.getUILocation().x); }
    private onTouchMove(e: EventTouch) { this.targetX = this.toLocalX(e.getUILocation().x); }
    private onMouseDown(e: EventMouse) { this.press(e.getUILocation().x); }
    private onMouseMove(e: EventMouse) { if (this.state === State.Playing) this.targetX = this.toLocalX(e.getUILocation().x); }

    private press(uiX: number) {
        this.targetX = this.toLocalX(uiX);
        if (this.state === State.Ready) this.startGame();
        else if (this.state === State.Over && this.elapsed > 0.8) this.startGame();
    }

    // ---------- 流程 ----------
    private showReady() {
        this.state = State.Ready;
        this.items = [];
        this.msgLabel.string = `★ 接星星 ★\n\n拖動手指移動籃子\n接住星星 +1　愛心 +命\n躲開炸彈！\n\n最高分：${this.best}\n\n點擊螢幕開始`;
        this.updateHud();
    }

    private startGame() {
        this.state = State.Playing;
        this.items = [];
        this.sparks = [];
        this.score = 0;
        this.lives = 3;
        this.elapsed = 0;
        this.spawnTimer = 0.5;
        this.basketX = this.targetX = 0;
        this.msgLabel.string = '';
        this.updateHud();
    }

    private gameOver() {
        this.state = State.Over;
        this.elapsed = 0;
        const newBest = this.score > this.best;
        if (newBest) {
            this.best = this.score;
            try { sys.localStorage.setItem('starcatcher_best', String(this.best)); } catch { /* ignore */ }
        }
        this.msgLabel.string = `遊戲結束\n\n分數：${this.score}\n${newBest ? '★ 新紀錄！★' : `最高分：${this.best}`}\n\n點擊螢幕再玩一次`;
    }

    private updateHud() {
        this.scoreLabel.string = `分數 ${this.score}`;
        this.livesLabel.string = '♥'.repeat(Math.max(0, this.lives));
        this.livesLabel.color = new Color(255, 90, 120, 255);
    }

    // ---------- 更新 ----------
    update(dt: number) {
        dt = Math.min(dt, 0.05);
        this.time += dt;
        this.elapsed += dt;
        if (this.shake > 0) this.shake = Math.max(0, this.shake - dt);
        if (this.flash > 0) this.flash = Math.max(0, this.flash - dt);

        if (this.state === State.Playing) this.stepGame(dt);
        this.stepSparks(dt);
        this.draw();
    }

    private difficulty() { return 1 + this.elapsed / 25; }

    private stepGame(dt: number) {
        const half = this.w / 2 - this.basketW / 2 - 10;
        this.targetX = Math.max(-half, Math.min(half, this.targetX));
        this.basketX += (this.targetX - this.basketX) * Math.min(1, dt * 18);

        const d = this.difficulty();
        this.spawnTimer -= dt;
        if (this.spawnTimer <= 0) {
            this.spawn(d);
            this.spawnTimer = Math.max(0.28, 0.95 / d) * (0.7 + Math.random() * 0.6);
        }

        const by = this.basketY;
        for (let i = this.items.length - 1; i >= 0; i--) {
            const it = this.items[i];
            it.y -= it.vy * dt;
            it.rot += it.spin * dt;

            const hitY = it.y - it.r <= by + this.basketH / 2 && it.y + it.r >= by - this.basketH / 2;
            const hitX = Math.abs(it.x - this.basketX) <= this.basketW / 2 + it.r * 0.5;
            if (hitY && hitX) {
                this.catchItem(it);
                this.items.splice(i, 1);
                continue;
            }
            if (it.y < -this.h / 2 - 60) this.items.splice(i, 1);
        }
    }

    private spawn(d: number) {
        const roll = Math.random();
        const bombChance = Math.min(0.42, 0.18 + d * 0.06);
        let kind: Kind = 'star';
        if (roll < bombChance) kind = 'bomb';
        else if (roll < bombChance + 0.04 && this.lives < 5) kind = 'heart';
        const r = kind === 'star' ? 30 : kind === 'bomb' ? 32 : 28;
        this.items.push({
            kind,
            x: (Math.random() - 0.5) * (this.w - r * 2 - 40),
            y: this.h / 2 + r,
            vy: (300 + Math.random() * 160) * d,
            r,
            rot: Math.random() * Math.PI,
            spin: (Math.random() - 0.5) * 4,
        });
    }

    private catchItem(it: Item) {
        if (it.kind === 'star') {
            this.score += 1;
            this.burst(it.x, it.y, new Color(255, 220, 80, 255), 14);
        } else if (it.kind === 'heart') {
            this.lives = Math.min(5, this.lives + 1);
            this.burst(it.x, it.y, new Color(255, 100, 140, 255), 18);
        } else {
            this.lives -= 1;
            this.shake = 0.35;
            this.flash = 0.25;
            this.burst(it.x, it.y, new Color(255, 120, 40, 255), 30);
            this.burst(it.x, it.y, new Color(90, 90, 90, 255), 12);
            if (this.lives <= 0) this.gameOver();
        }
        this.updateHud();
    }

    private burst(x: number, y: number, color: Color, n: number) {
        for (let i = 0; i < n; i++) {
            const a = Math.random() * Math.PI * 2;
            const s = 120 + Math.random() * 320;
            const life = 0.4 + Math.random() * 0.5;
            this.sparks.push({ x, y, vx: Math.cos(a) * s, vy: Math.sin(a) * s, life, max: life, color });
        }
    }

    private stepSparks(dt: number) {
        for (let i = this.sparks.length - 1; i >= 0; i--) {
            const p = this.sparks[i];
            p.life -= dt;
            if (p.life <= 0) { this.sparks.splice(i, 1); continue; }
            p.x += p.vx * dt;
            p.y += p.vy * dt;
            p.vy -= 600 * dt;
        }
    }

    // ---------- 繪圖 ----------
    private draw() {
        const g = this.g;
        g.clear();

        const sx = this.shake > 0 ? (Math.random() - 0.5) * 24 * this.shake / 0.35 : 0;
        const sy = this.shake > 0 ? (Math.random() - 0.5) * 24 * this.shake / 0.35 : 0;

        // 背景
        const top = new Color(18, 22, 58, 255);
        const bottom = new Color(48, 24, 80, 255);
        const bands = 16;
        for (let i = 0; i < bands; i++) {
            const t = i / (bands - 1);
            g.fillColor = new Color(
                top.r + (bottom.r - top.r) * t,
                top.g + (bottom.g - top.g) * t,
                top.b + (bottom.b - top.b) * t, 255);
            const bh = this.h / bands;
            g.rect(-this.w / 2, this.h / 2 - (i + 1) * bh - 1, this.w, bh + 2);
            g.fill();
        }
        for (const s of this.bg) {
            const a = 120 + 120 * Math.sin(this.time * 2 + s.phase);
            g.fillColor = new Color(255, 255, 255, Math.max(30, a));
            g.circle(s.x, s.y, s.r);
            g.fill();
        }

        // 地面
        g.fillColor = new Color(30, 14, 50, 255);
        g.rect(-this.w / 2, -this.h / 2, this.w, this.basketY - this.basketH / 2 + this.h / 2 - 20);
        g.fill();

        // 掉落物
        for (const it of this.items) {
            const x = it.x + sx, y = it.y + sy;
            if (it.kind === 'star') this.drawStar(x, y, it.r, it.rot);
            else if (it.kind === 'bomb') this.drawBomb(x, y, it.r);
            else this.drawHeart(x, y, it.r);
        }

        // 籃子
        if (this.state !== State.Ready) this.drawBasket(this.basketX + sx, this.basketY + sy);

        // 粒子
        for (const p of this.sparks) {
            const a = p.life / p.max;
            g.fillColor = new Color(p.color.r, p.color.g, p.color.b, 255 * a);
            g.circle(p.x + sx, p.y + sy, 3 + 5 * a);
            g.fill();
        }

        // 示意圖（開始畫面）
        if (this.state === State.Ready) {
            this.drawStar(-120, this.h / 2 - 260, 34, this.time);
            this.drawHeart(0, this.h / 2 - 260, 30);
            this.drawBomb(120, this.h / 2 - 260, 34);
            this.drawBasket(Math.sin(this.time * 2) * 150, this.basketY);
        }

        // 遮罩
        if (this.state !== State.Playing) {
            g.fillColor = new Color(0, 0, 0, 110);
            g.rect(-this.w / 2, -200, this.w, 520);
            g.fill();
        }

        // 受傷閃紅
        if (this.flash > 0) {
            g.fillColor = new Color(255, 40, 40, 140 * this.flash / 0.25);
            g.rect(-this.w / 2, -this.h / 2, this.w, this.h);
            g.fill();
        }
    }

    private drawStar(x: number, y: number, r: number, rot: number) {
        const g = this.g;
        // 光暈
        g.fillColor = new Color(255, 230, 120, 50);
        g.circle(x, y, r * 1.5);
        g.fill();
        g.fillColor = new Color(255, 214, 60, 255);
        g.strokeColor = new Color(255, 160, 20, 255);
        g.lineWidth = 3;
        for (let i = 0; i < 10; i++) {
            const a = rot + Math.PI / 2 + i * Math.PI / 5;
            const rr = i % 2 === 0 ? r : r * 0.45;
            const px = x + Math.cos(a) * rr;
            const py = y + Math.sin(a) * rr;
            if (i === 0) g.moveTo(px, py); else g.lineTo(px, py);
        }
        g.close();
        g.fill();
        g.stroke();
    }

    private drawBomb(x: number, y: number, r: number) {
        const g = this.g;
        g.fillColor = new Color(40, 40, 48, 255);
        g.circle(x, y, r);
        g.fill();
        g.fillColor = new Color(110, 110, 125, 255);
        g.circle(x - r * 0.35, y + r * 0.35, r * 0.22);
        g.fill();
        g.fillColor = new Color(80, 80, 90, 255);
        g.rect(x - 7, y + r - 4, 14, 12);
        g.fill();
        g.strokeColor = new Color(200, 160, 100, 255);
        g.lineWidth = 4;
        g.moveTo(x, y + r + 8);
        g.quadraticCurveTo(x + 10, y + r + 22, x + 18, y + r + 16);
        g.stroke();
        const f = 5 + 3 * Math.sin(this.time * 30);
        g.fillColor = new Color(255, 140, 30, 255);
        g.circle(x + 18, y + r + 16, f);
        g.fill();
        g.fillColor = new Color(255, 240, 120, 255);
        g.circle(x + 18, y + r + 16, f * 0.5);
        g.fill();
    }

    private drawHeart(x: number, y: number, r: number) {
        const g = this.g;
        g.fillColor = new Color(255, 80, 120, 255);
        g.moveTo(x, y - r);
        g.bezierCurveTo(x - r * 1.6, y + r * 0.1, x - r * 0.9, y + r * 1.3, x, y + r * 0.45);
        g.bezierCurveTo(x + r * 0.9, y + r * 1.3, x + r * 1.6, y + r * 0.1, x, y - r);
        g.close();
        g.fill();
        g.fillColor = new Color(255, 200, 215, 255);
        g.circle(x - r * 0.45, y + r * 0.45, r * 0.15);
        g.fill();
    }

    private drawBasket(x: number, y: number) {
        const g = this.g;
        const w = this.basketW, h = this.basketH;
        g.fillColor = new Color(0, 0, 0, 70);
        g.ellipse(x, y - h / 2 - 10, w / 2, 10);
        g.fill();
        g.fillColor = new Color(80, 200, 255, 255);
        g.strokeColor = new Color(220, 245, 255, 255);
        g.lineWidth = 4;
        g.moveTo(x - w / 2, y + h / 2);
        g.lineTo(x + w / 2, y + h / 2);
        g.lineTo(x + w / 2 - 18, y - h / 2);
        g.lineTo(x - w / 2 + 18, y - h / 2);
        g.close();
        g.fill();
        g.stroke();
        g.fillColor = new Color(50, 150, 220, 255);
        g.rect(x - w / 2 + 24, y - 4, w - 48, 6);
        g.fill();
    }
}

// ---------- 啟動：在空場景中建立 Canvas、相機與遊戲節點 ----------
function bootstrap() {
    const scene = director.getScene();
    if (!scene || scene.getChildByName('Canvas')) return;

    view.setDesignResolutionSize(DESIGN_W, DESIGN_H, ResolutionPolicy.FIXED_WIDTH);

    const canvasNode = new Node('Canvas');
    canvasNode.layer = UI;
    scene.addChild(canvasNode);
    canvasNode.addComponent(UITransform).setContentSize(DESIGN_W, DESIGN_H);

    const camNode = new Node('Camera');
    camNode.layer = UI;
    canvasNode.addChild(camNode);
    camNode.setPosition(0, 0, 1000);
    const cam = camNode.addComponent(Camera);
    cam.projection = Camera.ProjectionType.ORTHO;
    cam.visibility = UI;
    cam.clearFlags = Camera.ClearFlag.SOLID_COLOR;
    cam.clearColor = new Color(18, 22, 58, 255);
    cam.near = 1;
    cam.far = 2000;
    cam.orthoHeight = DESIGN_H / 2;

    const canvas = canvasNode.addComponent(Canvas);
    canvas.cameraComponent = cam;
    canvas.alignCanvasWithScreen = true;

    const gameNode = new Node('Game');
    gameNode.layer = UI;
    canvasNode.addChild(gameNode);
    gameNode.addComponent(UITransform).setContentSize(DESIGN_W, DESIGN_H);
    gameNode.addComponent(StarCatcher);
}

director.on(Director.EVENT_AFTER_SCENE_LAUNCH, bootstrap);
