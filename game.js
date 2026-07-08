(() => {
  'use strict';

  const $ = (id) => document.getElementById(id);
  const clamp = (v, a = 0, b = 1) => Math.max(a, Math.min(b, v));
  const lerp = (a, b, t) => a + (b - a) * t;
  const easeOut = (t) => 1 - Math.pow(1 - clamp(t), 3);

  class RNG {
    constructor(seed = Date.now()) { this.seed = seed >>> 0; }
    next() {
      this.seed += 0x6D2B79F5;
      let t = this.seed;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    }
    range(a, b) { return a + (b - a) * this.next(); }
    pick(items) { return items[Math.floor(this.next() * items.length)]; }
  }

  class Sound {
    constructor() {
      this.ctx = null;
      this.muted = localStorage.getItem('garlic-muted') === '1';
      this.lastTick = 0;
    }
    init() {
      if (this.ctx || this.muted) return;
      const AC = window.AudioContext || window.webkitAudioContext;
      if (AC) this.ctx = new AC();
    }
    tone(freq, duration, type = 'sine', volume = .08, delay = 0, endFreq = null) {
      if (this.muted) return;
      this.init();
      if (!this.ctx) return;
      const now = this.ctx.currentTime + delay;
      const osc = this.ctx.createOscillator();
      const gain = this.ctx.createGain();
      osc.type = type;
      osc.frequency.setValueAtTime(freq, now);
      if (endFreq) osc.frequency.exponentialRampToValueAtTime(endFreq, now + duration);
      gain.gain.setValueAtTime(.0001, now);
      gain.gain.exponentialRampToValueAtTime(volume, now + .012);
      gain.gain.exponentialRampToValueAtTime(.0001, now + duration);
      osc.connect(gain).connect(this.ctx.destination);
      osc.start(now);
      osc.stop(now + duration + .03);
    }
    tension(quality) {
      const now = performance.now();
      if (now - this.lastTick < 150) return;
      this.lastTick = now;
      this.tone(180 + quality * 150, .045, 'triangle', .025 + quality * .025);
    }
    warning() { this.tone(105, .11, 'sawtooth', .045, 0, 72); }
    release() { this.tone(190, .08, 'triangle', .035, 0, 130); }
    success(perfect) {
      this.tone(120, .18, 'sine', .12, 0, 55);
      this.tone(perfect ? 520 : 420, .38, 'triangle', .09, .08, perfect ? 1040 : 760);
      this.tone(760, .25, 'sine', .055, .25, 1150);
    }
    fail() { this.tone(180, .27, 'sawtooth', .07, 0, 70); }
    stage() {
      [330, 440, 550, 740].forEach((f, i) => this.tone(f, .18, 'triangle', .05, i * .08));
    }
  }

  class Particle {
    constructor(x, y, options, rng) {
      this.x = x; this.y = y;
      this.vx = rng.range(options.vx[0], options.vx[1]);
      this.vy = rng.range(options.vy[0], options.vy[1]);
      this.life = this.maxLife = rng.range(options.life[0], options.life[1]);
      this.size = rng.range(options.size[0], options.size[1]);
      this.color = rng.pick(options.colors);
      this.gravity = options.gravity ?? 350;
      this.shape = options.shape || 'circle';
      this.spin = rng.range(-8, 8);
      this.rotation = rng.range(0, Math.PI * 2);
    }
    update(dt) {
      this.life -= dt; this.vy += this.gravity * dt;
      this.x += this.vx * dt; this.y += this.vy * dt;
      this.rotation += this.spin * dt;
      return this.life > 0;
    }
    draw(ctx) {
      ctx.save();
      ctx.globalAlpha = clamp(this.life / this.maxLife);
      ctx.translate(this.x, this.y); ctx.rotate(this.rotation);
      ctx.fillStyle = this.color;
      if (this.shape === 'leaf') {
        ctx.beginPath(); ctx.ellipse(0, 0, this.size * 1.6, this.size * .55, 0, 0, Math.PI * 2); ctx.fill();
      } else if (this.shape === 'star') {
        ctx.beginPath();
        for (let i = 0; i < 8; i++) {
          const r = i % 2 ? this.size * .4 : this.size;
          const a = i * Math.PI / 4;
          ctx.lineTo(Math.cos(a) * r, Math.sin(a) * r);
        }
        ctx.closePath(); ctx.fill();
      } else {
        ctx.beginPath(); ctx.arc(0, 0, this.size, 0, Math.PI * 2); ctx.fill();
      }
      ctx.restore();
    }
  }

  const TYPES = {
    fresh: { name: '싱싱한 마늘쫑', color: '#4cae50', dark: '#26763f', width: 1, score: 1, pattern: 'wave' },
    stubborn: { name: '고집센 마늘쫑', color: '#3e9b4b', dark: '#1d6337', width: 1.18, score: 1.15, pattern: 'steps' },
    dancer: { name: '춤추는 마늘쫑', color: '#69b94b', dark: '#34743b', width: .92, score: 1.25, pattern: 'zigzag' },
    golden: { name: '황금 마늘쫑', color: '#e4ae32', dark: '#a87323', width: 1.08, score: 2, pattern: 'pulse' }
  };

  class Plant {
    constructor(stage, index, rng) {
      const golden = (stage * 4 + index) % 9 === 8 || rng.next() < Math.min(.06 + stage * .008, .16);
      const pool = stage < 2 ? ['fresh', 'fresh', 'stubborn'] : ['fresh', 'stubborn', 'dancer'];
      this.key = golden ? 'golden' : rng.pick(pool);
      this.type = TYPES[this.key];
      this.seed = rng.range(0, 100);
      this.difficulty = clamp((stage - 1) / 14, 0, .78);
      this.baseForce = rng.range(.39, .53) + this.difficulty * .08;
      this.band = Math.max(.105, rng.range(.155, .205) - this.difficulty * .07);
      this.danger = clamp(this.baseForce + this.band + rng.range(.14, .2), .72, .9);
      this.speed = rng.range(.72, 1.08) + this.difficulty * .75;
      this.angleStrength = rng.range(.22, .42) + this.difficulty * .14;
      if (this.key === 'dancer') this.angleStrength += .17;
      if (this.key === 'stubborn') { this.band *= .9; this.baseForce += .04; }
      if (this.key === 'golden') { this.band *= .78; this.speed *= 1.1; }
      this.progress = 0;
      this.stress = 0;
      this.peakStress = 0;
      this.accuracySum = 0;
      this.accuracyTime = 0;
      this.activeTime = 0;
      this.lastZone = false;
      this.feedback = '마늘쫑을 잡아주세요';
      this.failReason = '';
      this.resolved = false;
      this.outcomeTime = 0;
      this.perfect = false;
      this.score = 0;
      this.tremor = 0;
    }
    targetForce(t) {
      const p = t * this.speed + this.seed;
      let wave = 0;
      if (this.type.pattern === 'steps') {
        wave = Math.sin(p * 1.2) > .2 ? .075 : -.04;
      } else if (this.type.pattern === 'zigzag') {
        wave = Math.asin(Math.sin(p * 1.7)) / Math.PI * .14;
      } else if (this.type.pattern === 'pulse') {
        wave = Math.sin(p * 2.1) * .055 + Math.max(0, Math.sin(p * .72)) * .055;
      } else {
        wave = Math.sin(p * 1.18) * .06 + Math.sin(p * .42) * .035;
      }
      // Roots loosen as progress rises, then make one last short resistance surge.
      const finishKick = this.progress > .78 ? Math.sin((this.progress - .78) / .22 * Math.PI) * .07 : 0;
      return clamp(this.baseForce + wave + finishKick - this.progress * .055, .25, .72);
    }
    targetAngle(t) {
      const p = t * this.speed + this.seed * .7;
      let a;
      if (this.type.pattern === 'zigzag') a = Math.sin(p * 1.45) >= 0 ? 1 : -1;
      else if (this.type.pattern === 'steps') a = Math.sin(p * .7) * .55 + Math.sin(p * 1.8) * .25;
      else a = Math.sin(p * .82) + Math.sin(p * .31) * .35;
      return clamp(a * this.angleStrength, -.72, .72);
    }
  }

  class Game {
    constructor() {
      this.canvas = $('game');
      this.ctx = this.canvas.getContext('2d');
      this.sound = new Sound();
      this.rng = new RNG();
      this.state = 'title';
      this.stage = 1; this.plantNo = 1; this.score = 0; this.combo = 0; this.lives = 3;
      this.best = Number(localStorage.getItem('garlic-best') || 0);
      this.plant = new Plant(1, 0, this.rng);
      this.particles = [];
      this.time = 0;
      this.lastTime = performance.now();
      this.shake = 0;
      this.flash = 0;
      this.slow = 1;
      this.messageTimer = 0;
      this.warningCooldown = 0;
      this.transitionTimer = 0;
      this.stageBanner = 0;
      this.tutorialStep = -1;
      this.tutorialDone = localStorage.getItem('garlic-tutorial') === '1';
      this.input = { held: false, power: 0, angle: 0, pointerId: null, x: 0, y: 0, grabY: 0, keyboard: false };
      this.keys = new Set();
      this.bind(); this.resize(); this.updateUI();
      $('best-score').textContent = this.best.toLocaleString('ko-KR');
      $('sound-button').classList.toggle('muted', this.sound.muted);
      requestAnimationFrame((t) => this.loop(t));
    }
    bind() {
      addEventListener('resize', () => this.resize());
      $('start-button').addEventListener('click', () => this.start());
      $('retry-button').addEventListener('click', () => this.start());
      $('skip-tutorial').addEventListener('click', () => this.finishTutorial());
      $('sound-button').addEventListener('click', () => {
        this.sound.muted = !this.sound.muted;
        localStorage.setItem('garlic-muted', this.sound.muted ? '1' : '0');
        $('sound-button').classList.toggle('muted', this.sound.muted);
        if (!this.sound.muted) { this.sound.init(); this.sound.tone(440, .08, 'triangle', .05); }
      });
      this.canvas.addEventListener('pointerdown', (e) => this.pointerDown(e));
      this.canvas.addEventListener('pointermove', (e) => this.pointerMove(e));
      this.canvas.addEventListener('pointerup', (e) => this.pointerUp(e));
      this.canvas.addEventListener('pointercancel', (e) => this.pointerUp(e));
      addEventListener('keydown', (e) => {
        if (['Space','ArrowUp','ArrowDown','ArrowLeft','ArrowRight'].includes(e.code)) e.preventDefault();
        this.keys.add(e.code);
        if (e.code === 'Space' && !e.repeat && this.state === 'playing' && !this.plant.resolved) {
          this.sound.init(); this.input.held = true; this.input.keyboard = true; this.canvas.classList.add('grabbing');
        }
        if ((e.code === 'Enter' || e.code === 'Space') && this.state === 'title') this.start();
        else if ((e.code === 'Enter' || e.code === 'Space') && this.state === 'gameover') this.start();
      });
      addEventListener('keyup', (e) => {
        this.keys.delete(e.code);
        if (e.code === 'Space' && this.input.keyboard) this.releaseInput();
      });
    }
    resize() {
      const rect = this.canvas.getBoundingClientRect();
      this.w = rect.width; this.h = rect.height;
      const dpr = Math.min(devicePixelRatio || 1, 2);
      this.canvas.width = Math.round(this.w * dpr);
      this.canvas.height = Math.round(this.h * dpr);
      this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    }
    start() {
      this.sound.init();
      this.rng = new RNG(Date.now());
      this.state = 'playing'; this.stage = 1; this.plantNo = 1; this.score = 0; this.combo = 0; this.lives = 3;
      this.time = 0; this.particles.length = 0; this.transitionTimer = 0; this.stageBanner = 1.5;
      this.input.power = 0; this.input.angle = 0; this.input.held = false;
      this.plant = new Plant(this.stage, this.plantNo - 1, this.rng);
      $('overlay').classList.remove('visible');
      $('start-card').classList.add('hidden');
      $('result-card').classList.add('hidden');
      $('meter-panel').classList.remove('hidden-panel');
      if (!this.tutorialDone) this.showTutorial(0); else this.hideTutorial();
      this.updateUI();
    }
    pointerPos(e) {
      const r = this.canvas.getBoundingClientRect();
      return { x: e.clientX - r.left, y: e.clientY - r.top };
    }
    pointerDown(e) {
      if (this.state !== 'playing' || this.plant.resolved) return;
      const p = this.pointerPos(e);
      const baseX = this.w / 2;
      const tipY = this.h * .30 - this.plant.progress * Math.min(170, this.h * .25);
      if (Math.abs(p.x - baseX) > Math.min(150, this.w * .25) || p.y < tipY - 100 || p.y > this.h * .73) {
        this.toast('줄기를 잡아 당겨주세요', ''); return;
      }
      this.sound.init();
      this.input.held = true; this.input.keyboard = false; this.input.pointerId = e.pointerId;
      this.input.x = p.x; this.input.y = p.y; this.input.grabY = p.y;
      this.canvas.setPointerCapture?.(e.pointerId); this.canvas.classList.add('grabbing');
    }
    pointerMove(e) {
      if (!this.input.held || this.input.keyboard || e.pointerId !== this.input.pointerId) return;
      const p = this.pointerPos(e); this.input.x = p.x; this.input.y = p.y;
      const pullRange = Math.max(170, this.h * .38);
      this.input.power = clamp((this.input.grabY - p.y + 20) / pullRange);
      this.input.angle = clamp((p.x - this.w / 2) / Math.max(120, this.w * .23), -1, 1);
    }
    pointerUp(e) {
      if (!this.input.keyboard && (this.input.pointerId === e.pointerId || e.pointerId == null)) this.releaseInput();
    }
    releaseInput() {
      if (this.input.held && this.input.power > .35) this.sound.release();
      this.input.held = false; this.input.pointerId = null; this.canvas.classList.remove('grabbing');
    }
    showTutorial(step) {
      this.tutorialStep = step;
      const data = [
        ['꾹 잡고 위로', '줄기를 누른 채 천천히 위로 끌어 힘을 주세요.'],
        ['기우는 쪽으로', '줄기 위 화살표를 따라 좌우 각도를 맞추면 속대에서 스르륵 빠집니다.'],
        ['빨개지면 힘 빼기', '끊김 위험이 차오르면 아래로 내려 잠깐 쉬세요.']
      ][step];
      $('tutorial-step').textContent = `${step + 1} / 3`;
      $('tutorial-title').textContent = data[0]; $('tutorial-copy').textContent = data[1];
      $('tutorial').classList.remove('hidden');
    }
    finishTutorial() {
      this.tutorialDone = true; localStorage.setItem('garlic-tutorial', '1'); this.hideTutorial();
    }
    hideTutorial() { this.tutorialStep = -1; $('tutorial').classList.add('hidden'); }
    updateTutorial() {
      if (this.tutorialStep === 0 && this.input.power > .3) this.showTutorial(1);
      if (this.tutorialStep === 1 && this.plant.progress > .12) this.showTutorial(2);
      if (this.tutorialStep === 2 && this.plant.progress > .38) this.finishTutorial();
    }
    nextPlant() {
      this.plantNo++;
      if (this.plantNo > 4) {
        this.stage++; this.plantNo = 1; this.stageBanner = 1.8; this.lives = Math.min(3, this.lives + 1);
        this.sound.stage(); this.toast(`밭 ${this.stage} · 기회 +1`, 'good');
      }
      this.plant = new Plant(this.stage, this.plantNo - 1, this.rng);
      this.input.power = 0; this.input.angle *= .25; this.input.held = false;
      this.transitionTimer = 0; this.slow = 1; this.updateUI();
    }
    update(dt) {
      this.time += dt;
      this.messageTimer = Math.max(0, this.messageTimer - dt);
      this.warningCooldown = Math.max(0, this.warningCooldown - dt);
      this.flash = Math.max(0, this.flash - dt * 2.4);
      this.shake = Math.max(0, this.shake - dt * 24);
      this.stageBanner = Math.max(0, this.stageBanner - dt);
      if (this.state !== 'playing') return;
      this.updateTutorial();
      if (this.input.keyboard) {
        const dp = (this.keys.has('ArrowUp') ? 1 : 0) - (this.keys.has('ArrowDown') ? 1 : 0);
        const da = (this.keys.has('ArrowRight') ? 1 : 0) - (this.keys.has('ArrowLeft') ? 1 : 0);
        this.input.power = clamp(this.input.power + dp * dt * .75);
        this.input.angle = clamp(this.input.angle + da * dt * 1.25, -1, 1);
        if (!da) this.input.angle = lerp(this.input.angle, 0, dt * .4);
      } else if (!this.input.held) {
        this.input.power = Math.max(0, this.input.power - dt * 1.65);
        this.input.angle = lerp(this.input.angle, 0, dt * 2.2);
      }

      const p = this.plant;
      if (p.resolved) {
        p.outcomeTime += dt; this.transitionTimer += dt;
        if (this.transitionTimer > (p.failReason ? 1.45 : 1.7)) {
          if (this.lives <= 0) this.gameOver(); else this.nextPlant();
        }
        this.updateUI(); return;
      }

      p.activeTime += dt;
      const target = p.targetForce(this.time);
      const desired = p.targetAngle(this.time);
      const power = this.input.held ? this.input.power : 0;
      const forceDelta = Math.abs(power - target);
      const forceQ = clamp(1 - forceDelta / p.band);
      const angleQ = clamp(1 - Math.abs(this.input.angle - desired) / .72);
      const quality = forceQ * (.35 + .65 * angleQ);
      const inZone = this.input.held && forceQ > 0 && angleQ > .34;

      if (inZone) {
        const gain = (.085 + .115 * quality) * (1 + Math.min(this.stage, 10) * .012);
        p.progress = clamp(p.progress + gain * dt);
        p.accuracySum += quality * dt; p.accuracyTime += dt;
        p.feedback = quality > .78 ? '좋아요, 그대로!' : angleQ < .62 ? (desired < 0 ? '왼쪽으로 기울여요' : '오른쪽으로 기울여요') : '조금 더 섬세하게';
        this.sound.tension(quality);
        if (!p.lastZone && quality > .55) this.burst(this.w / 2, this.h * .665, 'soil', 5);
      } else if (this.input.held && power > .08) {
        if (power < target - p.band) p.feedback = '힘이 부족해요 · 더 위로';
        else if (power > target + p.band) p.feedback = '너무 세요! 힘을 빼세요';
        else p.feedback = desired < 0 ? '각도를 왼쪽으로' : '각도를 오른쪽으로';
        p.progress = Math.max(0, p.progress - dt * .009);
      } else {
        p.feedback = p.stress > .16 ? '쉬는 중 · 위험이 내려가요' : '잡고 천천히 당겨요';
        p.progress = Math.max(0, p.progress - dt * .005);
      }

      let stressGain = 0;
      if (this.input.held && power > target + p.band) stressGain += .23 + (power - target - p.band) * 1.65;
      if (this.input.held && power > .25 && angleQ < .3) stressGain += (.3 - angleQ) * .42;
      if (power > p.danger) stressGain += (power - p.danger) * 1.15;
      if (stressGain > 0) {
        p.stress = clamp(p.stress + stressGain * dt);
        p.tremor = Math.min(1, p.tremor + dt * 3);
        if (p.stress > .63 && this.warningCooldown <= 0) {
          this.sound.warning(); this.warningCooldown = .48; this.shake = Math.max(this.shake, 2.3);
          if (navigator.vibrate) navigator.vibrate(25);
        }
      } else {
        const recovery = power < target - .04 ? .29 : .075;
        p.stress = Math.max(0, p.stress - recovery * dt);
        p.tremor = Math.max(0, p.tremor - dt * 2.5);
      }
      p.peakStress = Math.max(p.peakStress, p.stress);
      p.lastZone = inZone;

      if (p.stress >= 1) this.fail(power > p.danger ? '너무 세게 당겨 마늘쫑이 끊어졌어요' : '반대 각도로 비틀어 속대 안에서 걸렸어요');
      else if (p.progress >= 1) this.succeed();
      this.updateUI(target);
    }
    succeed() {
      const p = this.plant; if (p.resolved) return;
      const accuracy = p.accuracyTime ? p.accuracySum / p.accuracyTime : 0;
      const speedBonus = clamp(1 - (p.activeTime - 5) / 14);
      p.perfect = accuracy > .78 && p.peakStress < .5 && p.activeTime < 13;
      this.combo++;
      const comboMult = 1 + Math.min(this.combo - 1, 10) * .14;
      const base = 450 + accuracy * 650 + speedBonus * 280 + (p.perfect ? 500 : 0);
      p.score = Math.round(base * comboMult * p.type.score / 10) * 10;
      this.score += p.score; p.resolved = true; p.outcomeTime = 0;
      this.input.held = false; this.canvas.classList.remove('grabbing');
      this.shake = p.perfect ? 14 : 9; this.flash = 1; this.slow = .25;
      this.sound.success(p.perfect);
      if (navigator.vibrate) navigator.vibrate(p.perfect ? [25, 25, 70] : [20, 20, 45]);
      this.burst(this.w / 2, this.h * .59, p.perfect ? 'perfect' : 'success', p.perfect ? 58 : 36);
      this.popScore(`${p.perfect ? '완벽 뽑기! ' : '쑤욱! '}+${p.score.toLocaleString('ko-KR')}`);
      this.toast(p.perfect ? '손맛 최고! 온전한 한 줄기' : `${p.type.name} 수확!`, 'good');
      this.saveBest(); this.updateUI();
    }
    fail(reason) {
      const p = this.plant; if (p.resolved) return;
      p.failReason = reason; p.resolved = true; p.outcomeTime = 0; this.lives--; this.combo = 0;
      this.input.held = false; this.canvas.classList.remove('grabbing'); this.shake = 8;
      this.sound.fail(); if (navigator.vibrate) navigator.vibrate(60);
      this.burst(this.w / 2, this.h * .47, 'fail', 25);
      this.toast(reason, 'bad'); this.updateUI();
    }
    gameOver() {
      this.state = 'gameover'; this.saveBest(); this.hideTutorial();
      $('result-title').textContent = this.score >= this.best && this.score > 0 ? '새로운 최고 기록!' : '오늘 수확 끝!';
      $('final-score').textContent = this.score.toLocaleString('ko-KR');
      $('result-copy').textContent = `밭 ${this.stage}까지 도착했습니다. ${this.combo > 4 ? '침착한 손끝이 제법 농부다웠어요.' : '힘을 빼는 순간까지 익히면 다음 밭은 더 멀리 갈 수 있어요.'}`;
      $('result-eyebrow').textContent = `최고 기록 ${this.best.toLocaleString('ko-KR')}`;
      $('result-card').classList.remove('hidden'); $('start-card').classList.add('hidden');
      $('overlay').classList.add('visible'); $('meter-panel').classList.add('hidden-panel');
    }
    saveBest() {
      if (this.score > this.best) { this.best = this.score; localStorage.setItem('garlic-best', String(this.best)); }
      $('best-score').textContent = this.best.toLocaleString('ko-KR');
    }
    burst(x, y, kind, count) {
      const presets = {
        soil: { vx: [-90,90], vy: [-100,-30], life: [.25,.55], size: [2,5], colors: ['#8a5432','#a96d3e','#d39755'], gravity: 360 },
        success: { vx: [-250,250], vy: [-360,-80], life: [.55,1.1], size: [3,9], colors: ['#f7d45d','#fff3a5','#69b650','#ffffff'], gravity: 420, shape: 'leaf' },
        perfect: { vx: [-330,330], vy: [-470,-100], life: [.7,1.4], size: [4,11], colors: ['#ffe25c','#fffbd0','#7be071','#ffffff','#f39e51'], gravity: 400, shape: 'star' },
        fail: { vx: [-180,180], vy: [-220,30], life: [.4,.8], size: [3,8], colors: ['#8b623e','#d9694e','#6b8d3c'], gravity: 480 }
      };
      const o = presets[kind];
      for (let i = 0; i < count; i++) this.particles.push(new Particle(x, y, o, this.rng));
    }
    toast(text, type) {
      const el = $('toast'); el.textContent = text; el.className = `toast show ${type}`;
      clearTimeout(this.toastTimeout); this.toastTimeout = setTimeout(() => el.classList.remove('show'), 1250);
    }
    popScore(text) {
      const el = $('score-pop'); el.textContent = text; el.classList.remove('go'); void el.offsetWidth; el.classList.add('go');
    }
    updateUI(target = this.plant.targetForce(this.time)) {
      const p = this.plant;
      $('stage-label').textContent = `밭 ${this.stage}`;
      $('plant-label').textContent = `${this.plantNo} / 4${p.key === 'golden' ? ' · 황금!' : ''}`;
      $('lives').textContent = `${'● '.repeat(this.lives)}${'○ '.repeat(Math.max(0, 3 - this.lives))}`.trim();
      $('score').textContent = this.score.toLocaleString('ko-KR');
      $('combo').textContent = `x${this.combo + 1}`; $('combo').classList.toggle('active', this.combo > 0);
      $('action-hint').textContent = p.resolved ? (p.failReason ? '다음 마늘쫑 준비 중…' : '기분 좋게 쑤욱!') : p.feedback;
      const lower = clamp(target - p.band); const width = clamp(p.band * 2, 0, 1 - lower);
      $('safe-band').style.left = `${lower * 100}%`; $('safe-band').style.width = `${width * 100}%`;
      $('danger-line').style.left = `${p.danger * 100}%`;
      const power = this.input.held ? this.input.power : 0;
      $('power-fill').style.width = `${power * 100}%`; $('power-needle').style.left = `${power * 100}%`;
      $('progress-fill').style.width = `${p.progress * 100}%`; $('stress-fill').style.width = `${p.stress * 100}%`;
    }
    drawBackground(ctx) {
      const w = this.w, h = this.h, ground = h * .66;
      const sky = ctx.createLinearGradient(0, 0, 0, ground);
      sky.addColorStop(0, '#9bd7ec'); sky.addColorStop(1, '#e7f3b9');
      ctx.fillStyle = sky; ctx.fillRect(0, 0, w, ground);
      ctx.fillStyle = 'rgba(255,250,216,.8)';
      const sunX = w * .82, sunY = h * .15;
      ctx.beginPath(); ctx.arc(sunX, sunY, Math.min(47, w * .06), 0, Math.PI * 2); ctx.fill();
      this.cloud(ctx, w * .18 + Math.sin(this.time * .07) * 20, h * .18, Math.min(1, w / 700));
      this.cloud(ctx, w * .64 + Math.sin(this.time * .05 + 2) * 14, h * .28, .65);
      ctx.fillStyle = '#8fbe63';
      ctx.beginPath(); ctx.moveTo(0, ground); ctx.quadraticCurveTo(w * .2, ground - 115, w * .44, ground); ctx.quadraticCurveTo(w * .72, ground - 145, w, ground - 15); ctx.lineTo(w, ground); ctx.fill();
      ctx.fillStyle = '#72a755';
      ctx.beginPath(); ctx.moveTo(0, ground); ctx.quadraticCurveTo(w * .3, ground - 68, w * .55, ground); ctx.quadraticCurveTo(w * .78, ground - 90, w, ground - 35); ctx.lineTo(w, ground); ctx.fill();
      // Distant crops
      for (let i = 0; i < 11; i++) {
        const x = (i + .35) / 11 * w, y = ground - 12 - (i % 2) * 7;
        ctx.strokeStyle = '#447e3d'; ctx.lineWidth = 3;
        ctx.beginPath(); ctx.moveTo(x, ground + 2); ctx.quadraticCurveTo(x - 5, y, x - 11, y - 11); ctx.moveTo(x, ground + 2); ctx.quadraticCurveTo(x + 4, y, x + 10, y - 15); ctx.stroke();
      }
      const soil = ctx.createLinearGradient(0, ground, 0, h);
      soil.addColorStop(0, '#a86d3c'); soil.addColorStop(.2, '#87522f'); soil.addColorStop(1, '#563722');
      ctx.fillStyle = soil; ctx.fillRect(0, ground, w, h - ground);
      ctx.fillStyle = '#c88b4b';
      ctx.beginPath(); ctx.moveTo(0, ground); for (let x = 0; x <= w; x += 25) ctx.lineTo(x, ground + Math.sin(x * .08) * 4); ctx.lineTo(w, ground + 18); ctx.lineTo(0, ground + 18); ctx.fill();
      ctx.globalAlpha = .18; ctx.strokeStyle = '#edbe73'; ctx.lineWidth = 2;
      for (let y = ground + 55; y < h; y += 47) { ctx.beginPath(); ctx.moveTo(0, y); ctx.bezierCurveTo(w * .3, y - 18, w * .65, y + 18, w, y - 3); ctx.stroke(); }
      ctx.globalAlpha = 1;
    }
    cloud(ctx, x, y, s) {
      ctx.save(); ctx.translate(x, y); ctx.scale(s, s); ctx.fillStyle = 'rgba(255,255,255,.72)';
      ctx.beginPath(); ctx.arc(-30, 5, 20, 0, Math.PI * 2); ctx.arc(0, -5, 30, 0, Math.PI * 2); ctx.arc(30, 7, 20, 0, Math.PI * 2); ctx.fill(); ctx.restore();
    }
    drawPlant(ctx) {
      const p = this.plant, w = this.w, h = this.h, ground = h * .66, x = w / 2;
      const targetA = p.targetAngle(this.time);
      const power = this.input.held ? this.input.power : 0;
      let bend = this.input.angle * Math.min(115, w * .19) * (.45 + power * .55);
      const tremble = (p.tremor * 5 + (p.stress > .65 ? 2 : 0)) * Math.sin(this.time * 54);
      bend += tremble;
      const sheathTop = ground - Math.min(84, h * .12);
      const pullLength = Math.min(170, h * .25);
      let lift = p.progress * pullLength + power * 7;
      let fly = 0, flyX = 0, rotation = 0;
      if (p.resolved && !p.failReason) {
        const t = clamp(p.outcomeTime / .9); fly = easeOut(t) * Math.min(310, h * .44); flyX = Math.sin(t * Math.PI) * (p.perfect ? 38 : 18); rotation = Math.sin(t * 5) * .12;
      }

      // The garlic plant stays planted. Its leaves and hollow sheath never move.
      ctx.save();
      ctx.fillStyle = 'rgba(44,38,24,.18)';
      ctx.beginPath(); ctx.ellipse(x, ground + 8, 68, 13, 0, 0, Math.PI * 2); ctx.fill();
      this.blade(ctx, x - 9, ground + 4, -72, -190, '#4f9f45', 24);
      this.blade(ctx, x + 8, ground + 5, 82, -215, '#5fac4c', 25);
      this.blade(ctx, x - 4, ground + 5, -118, -112, '#438f40', 22);
      this.blade(ctx, x + 5, ground + 4, 126, -125, '#6cb453', 21);
      this.blade(ctx, x, ground + 6, -30, -245, '#579f46', 19);

      // A translucent central channel makes it obvious the scape sits inside the stalk.
      const sheathGradient = ctx.createLinearGradient(x - 24, 0, x + 24, 0);
      sheathGradient.addColorStop(0, '#4c913f'); sheathGradient.addColorStop(.28, '#89c568');
      sheathGradient.addColorStop(.56, '#b7dc86'); sheathGradient.addColorStop(1, '#397c39');
      ctx.fillStyle = sheathGradient; ctx.strokeStyle = '#286b35'; ctx.lineWidth = 3;
      ctx.beginPath(); ctx.moveTo(x - 23, ground + 7); ctx.quadraticCurveTo(x - 18, ground - 40, x - 15, sheathTop);
      ctx.quadraticCurveTo(x, sheathTop - 9, x + 15, sheathTop); ctx.quadraticCurveTo(x + 18, ground - 40, x + 23, ground + 7); ctx.closePath(); ctx.fill(); ctx.stroke();
      ctx.save(); ctx.globalAlpha = .34; ctx.strokeStyle = '#245d32'; ctx.lineWidth = 8; ctx.setLineDash([5, 7]);
      ctx.beginPath(); ctx.moveTo(x, ground - 4); ctx.lineTo(x, sheathTop + 4); ctx.stroke(); ctx.setLineDash([]); ctx.restore();
      ctx.fillStyle = '#214f2d'; ctx.strokeStyle = '#d5e9a4'; ctx.lineWidth = 3;
      ctx.beginPath(); ctx.ellipse(x, sheathTop, 15, 7, 0, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
      ctx.restore();

      // Only the thin inner scape slides upward out of that fixed sheath.
      const innerBottom = ground + 7 - lift;
      const visibleBottom = Math.min(sheathTop, innerBottom);
      const topY = h * .30 - lift;
      const stalkW = 14 * p.type.width;
      ctx.save(); ctx.translate(flyX, -fly); ctx.rotate(rotation);
      ctx.lineCap = 'round';
      ctx.strokeStyle = p.type.dark; ctx.lineWidth = stalkW + 5;
      ctx.beginPath(); ctx.moveTo(x + bend * .08, visibleBottom); ctx.bezierCurveTo(x + bend * .18, lerp(visibleBottom, topY, .35), x + bend * .77, topY + 90, x + bend, topY); ctx.stroke();
      ctx.strokeStyle = p.type.color; ctx.lineWidth = stalkW;
      ctx.beginPath(); ctx.moveTo(x + bend * .08, visibleBottom); ctx.bezierCurveTo(x + bend * .18, lerp(visibleBottom, topY, .35), x + bend * .77, topY + 90, x + bend, topY); ctx.stroke();
      ctx.strokeStyle = 'rgba(255,255,255,.3)'; ctx.lineWidth = 3;
      ctx.beginPath(); ctx.moveTo(x + bend * .08 - 3, visibleBottom); ctx.bezierCurveTo(x + bend * .2 - 3, lerp(visibleBottom, topY, .35), x + bend * .7 - 3, topY + 80, x + bend - 3, topY + 8); ctx.stroke();

      // Once the end clears the sheath, show the pale snapped base of the scape.
      if (innerBottom < sheathTop - 2) {
        ctx.fillStyle = p.key === 'golden' ? '#fff0a2' : '#dff0a8'; ctx.strokeStyle = p.type.dark; ctx.lineWidth = 2;
        ctx.beginPath(); ctx.ellipse(x + bend * .08, innerBottom, stalkW * .48, 4, .08, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
        ctx.strokeStyle = 'rgba(255,250,190,.6)'; ctx.lineWidth = 2;
        for (let i = 0; i < 3; i++) {
          const yy = lerp(sheathTop - 4, innerBottom + 5, (i + 1) / 4);
          ctx.beginPath(); ctx.moveTo(x - 27 - i * 4, yy + 5); ctx.lineTo(x - 17, yy); ctx.moveTo(x + 27 + i * 4, yy + 5); ctx.lineTo(x + 17, yy); ctx.stroke();
        }
      }
      // Bud / grab point
      ctx.fillStyle = p.key === 'golden' ? '#ffd95a' : '#8bcf50'; ctx.strokeStyle = p.type.dark; ctx.lineWidth = 4;
      ctx.beginPath(); ctx.ellipse(x + bend, topY - 5, 14 * p.type.width, 24, -.25 + this.input.angle * .2, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
      if (p.failReason) {
        ctx.strokeStyle = '#f2d39a'; ctx.lineWidth = stalkW - 2; ctx.beginPath(); ctx.moveTo(x - 12, sheathTop - 18); ctx.lineTo(x + 13, sheathTop - 45); ctx.stroke();
      }
      ctx.restore();

      // Early visual callout teaches the real action without requiring text-heavy tutorial copy.
      if (p.progress < .16 && !p.resolved) {
        const side = w < 500 ? -1 : 1;
        const labelX = x + side * Math.min(130, w * .27), labelY = sheathTop + 20;
        ctx.save(); ctx.strokeStyle = 'rgba(255,249,211,.9)'; ctx.lineWidth = 2;
        ctx.beginPath(); ctx.moveTo(x + side * 17, sheathTop - 2); ctx.lineTo(labelX - side * 52, labelY - 8); ctx.stroke();
        ctx.fillStyle = 'rgba(38,74,42,.88)'; ctx.beginPath(); ctx.roundRect(labelX - 56, labelY - 24, 112, 32, 12); ctx.fill();
        ctx.fillStyle = '#fff9d9'; ctx.textAlign = 'center'; ctx.font = '800 12px sans-serif'; ctx.fillText('대 속의 마늘쫑', labelX, labelY - 4); ctx.restore();
      }

      if (!p.resolved) {
        // Direction cue: a living arrow rather than a static instruction.
        const cueX = x + targetA * Math.min(95, w * .17), cueY = h * .21;
        const pulse = 1 + Math.sin(this.time * 6) * .08;
        ctx.save(); ctx.translate(cueX, cueY); ctx.scale(pulse, pulse);
        ctx.fillStyle = Math.abs(this.input.angle - targetA) < .18 && this.input.held ? '#4fae62' : '#fff6c9';
        ctx.strokeStyle = '#355537'; ctx.lineWidth = 3;
        ctx.beginPath(); ctx.arc(0,0,23,0,Math.PI*2); ctx.fill(); ctx.stroke();
        ctx.fillStyle = '#355537'; ctx.beginPath();
        if (Math.abs(targetA) < .08) { ctx.moveTo(0,-12); ctx.lineTo(10,3); ctx.lineTo(4,3); ctx.lineTo(4,13); ctx.lineTo(-4,13); ctx.lineTo(-4,3); ctx.lineTo(-10,3); }
        else if (targetA < 0) { ctx.moveTo(-13,0); ctx.lineTo(3,-10); ctx.lineTo(3,-4); ctx.lineTo(13,-4); ctx.lineTo(13,4); ctx.lineTo(3,4); ctx.lineTo(3,10); }
        else { ctx.moveTo(13,0); ctx.lineTo(-3,-10); ctx.lineTo(-3,-4); ctx.lineTo(-13,-4); ctx.lineTo(-13,4); ctx.lineTo(-3,4); ctx.lineTo(-3,10); }
        ctx.closePath(); ctx.fill(); ctx.restore();
        // Grab halo
        if (!this.input.held) {
          ctx.strokeStyle = 'rgba(255,255,225,.8)'; ctx.lineWidth = 3; ctx.setLineDash([5,5]);
          ctx.beginPath(); ctx.arc(x, h * .30 - p.progress * pullLength, 38 + Math.sin(this.time * 4) * 4, 0, Math.PI * 2); ctx.stroke(); ctx.setLineDash([]);
        }
      }
    }
    blade(ctx, x, y, dx, dy, color, width) {
      ctx.save(); ctx.translate(x, y); ctx.fillStyle = color; ctx.strokeStyle = '#286e39'; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.moveTo(-width * .45, 0);
      ctx.bezierCurveTo(dx * .18 - width, dy * .36, dx - width * .35, dy * .82, dx, dy);
      ctx.bezierCurveTo(dx + width * .3, dy * .78, dx * .18 + width, dy * .3, width * .45, 0);
      ctx.closePath(); ctx.fill(); ctx.stroke(); ctx.restore();
    }
    drawForeground(ctx) {
      if (this.stageBanner > 0 && this.state === 'playing') {
        const a = Math.min(1, this.stageBanner * 2, (1.8 - this.stageBanner) * 3);
        ctx.save(); ctx.globalAlpha = clamp(a); ctx.textAlign = 'center';
        ctx.fillStyle = '#fff8d8'; ctx.strokeStyle = '#496540'; ctx.lineWidth = 7; ctx.font = `900 ${Math.min(48, this.w * .09)}px sans-serif`;
        ctx.strokeText(`밭 ${this.stage}`, this.w / 2, this.h * .45); ctx.fillText(`밭 ${this.stage}`, this.w / 2, this.h * .45);
        ctx.restore();
      }
      if (this.plant.key === 'golden' && !this.plant.resolved && this.state === 'playing') {
        ctx.save(); ctx.globalAlpha = .65 + Math.sin(this.time * 5) * .2; ctx.fillStyle = '#fff1a2'; ctx.textAlign = 'center'; ctx.font = '900 16px sans-serif'; ctx.fillText('✦ 황금 마늘쫑 · 점수 2배 ✦', this.w / 2, this.h * .13); ctx.restore();
      }
      if (this.flash > 0) { ctx.fillStyle = `rgba(255,255,220,${this.flash * .38})`; ctx.fillRect(0,0,this.w,this.h); }
    }
    loop(now) {
      const rawDt = Math.min(.033, (now - this.lastTime) / 1000 || .016); this.lastTime = now;
      if (this.slow < 1) this.slow = Math.min(1, this.slow + rawDt * 1.15);
      this.update(rawDt * this.slow);
      this.particles = this.particles.filter((p) => p.update(rawDt));
      const ctx = this.ctx; ctx.save();
      const sx = this.shake ? (Math.random() - .5) * this.shake : 0, sy = this.shake ? (Math.random() - .5) * this.shake : 0;
      ctx.translate(sx, sy); this.drawBackground(ctx); this.drawPlant(ctx);
      this.particles.forEach((p) => p.draw(ctx)); this.drawForeground(ctx); ctx.restore();
      requestAnimationFrame((t) => this.loop(t));
    }
  }

  new Game();
})();
