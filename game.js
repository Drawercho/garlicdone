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
      this.slipPulse = 0;
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
      // The inner sheath loosens as progress rises, then grips once more near the end.
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
      this.profile = this.readStored('garlic-profile', null);
      this.rankings = this.readStored('garlic-rankings', []);
      this.state = this.profile ? 'title' : 'login';
      this.stage = 1; this.plantNo = 1; this.score = 0; this.combo = 0; this.maxCombo = 0; this.harvested = 0; this.lives = 3;
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
      this.input = { held: false, power: 0, angle: 0, pointerId: null, x: 0, y: 0, grabX: 0, grabY: 0, grabAngle: 0, keyboard: false };
      this.keys = new Set();
      this.bind(); this.resize(); this.updateUI();
      $('best-score').textContent = this.best.toLocaleString('ko-KR');
      $('sound-button').classList.toggle('muted', this.sound.muted);
      if (this.profile) this.showTitle(); else this.showLogin();
      requestAnimationFrame((t) => this.loop(t));
    }
    readStored(key, fallback) {
      try {
        const value = JSON.parse(localStorage.getItem(key));
        return value ?? fallback;
      } catch { return fallback; }
    }
    showCard(id) {
      ['login-card', 'start-card', 'result-card', 'ranking-card'].forEach((cardId) => $(cardId).classList.toggle('hidden', cardId !== id));
      $('overlay').classList.add('visible'); $('meter-panel').classList.add('hidden-panel');
    }
    showLogin() {
      this.state = 'login'; this.showCard('login-card');
      $('nickname').value = this.profile?.name || '';
      $('nickname-error').textContent = '';
      $('nickname').classList.remove('invalid');
      setTimeout(() => $('nickname').focus?.(), 0);
    }
    enterFarm(name) {
      const clean = String(name || '').trim().replace(/\s+/g, ' ').slice(0, 10);
      if (!clean) {
        $('nickname-error').textContent = '한 글자 이상 입력해주세요.';
        $('nickname').classList.add('invalid'); return;
      }
      this.profile = { name: clean };
      localStorage.setItem('garlic-profile', JSON.stringify(this.profile));
      this.showTitle();
    }
    showTitle() {
      this.state = 'title'; this.showCard('start-card'); this.hideTutorial();
      const name = this.profile?.name || '농부';
      $('farmer-name').textContent = name; $('hud-player').textContent = `· ${name}`;
      $('best-score').textContent = this.best.toLocaleString('ko-KR');
    }
    showRanking(returnState = this.state) {
      this.rankReturnState = returnState === 'gameover' ? 'gameover' : 'title';
      this.state = 'ranking'; this.renderRanking(); this.showCard('ranking-card');
    }
    closeRanking() {
      if (this.rankReturnState === 'gameover') {
        this.state = 'gameover'; this.showCard('result-card');
      } else this.showTitle();
    }
    renderRanking() {
      const list = $('ranking-list');
      const rows = [...this.rankings].sort((a, b) => b.score - a.score || b.time - a.time).slice(0, 10);
      if (!rows.length) {
        list.innerHTML = '<div class="rank-empty">아직 기록이 없어요.<br>첫 번째 전설이 되어보세요!</div>'; return;
      }
      const medals = ['🥇', '🥈', '🥉'];
      const escape = (value) => String(value).replace(/[&<>'"]/g, (c) => ({ '&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;' }[c]));
      list.innerHTML = rows.map((row, index) => {
        const mine = row.name === this.profile?.name ? ' me' : '';
        const date = new Date(row.time).toLocaleDateString('ko-KR', { month: 'short', day: 'numeric' });
        return `<div class="rank-row${mine}"><span class="rank-pos">${medals[index] || index + 1}</span><span class="rank-name">${escape(row.name)}<small>밭 ${row.stage} · ${date}</small></span><strong class="rank-score">${Number(row.score).toLocaleString('ko-KR')}</strong></div>`;
      }).join('');
    }
    saveRunToRanking() {
      if (this.runSaved || !this.profile || this.score <= 0) return;
      this.runSaved = true;
      this.rankings.push({ name: this.profile.name, score: this.score, stage: this.stage, combo: this.maxCombo, time: Date.now() });
      this.rankings = this.rankings.sort((a, b) => b.score - a.score || b.time - a.time).slice(0, 50);
      localStorage.setItem('garlic-rankings', JSON.stringify(this.rankings));
    }
    bind() {
      addEventListener('resize', () => this.resize());
      $('login-form').addEventListener('submit', (e) => { e.preventDefault(); this.enterFarm($('nickname').value); });
      $('nickname').addEventListener('input', () => { $('nickname-error').textContent = ''; $('nickname').classList.remove('invalid'); });
      $('start-button').addEventListener('click', () => this.start());
      $('retry-button').addEventListener('click', () => this.start());
      $('ranking-button').addEventListener('click', () => this.showRanking('title'));
      $('result-ranking-button').addEventListener('click', () => this.showRanking('gameover'));
      $('ranking-back-button').addEventListener('click', () => this.closeRanking());
      $('change-name-button').addEventListener('click', () => this.showLogin());
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
      this.state = 'playing'; this.stage = 1; this.plantNo = 1; this.score = 0; this.combo = 0; this.maxCombo = 0; this.harvested = 0; this.lives = 3; this.runSaved = false;
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
      const tipY = this.h * .285 - this.plant.progress * Math.min(205, this.h * .29);
      if (Math.abs(p.x - baseX) > Math.min(150, this.w * .25) || p.y < tipY - 100 || p.y > this.h * .73) {
        this.toast('줄기를 잡아 당겨주세요', ''); return;
      }
      this.sound.init();
      this.input.held = true; this.input.keyboard = false; this.input.pointerId = e.pointerId;
      this.input.x = p.x; this.input.y = p.y; this.input.grabX = p.x; this.input.grabY = p.y; this.input.grabAngle = this.input.angle;
      this.canvas.setPointerCapture?.(e.pointerId); this.canvas.classList.add('grabbing');
    }
    pointerMove(e) {
      if (!this.input.held || this.input.keyboard || e.pointerId !== this.input.pointerId) return;
      const p = this.pointerPos(e); this.input.x = p.x; this.input.y = p.y;
      const pullRange = Math.max(170, this.h * .38);
      this.input.power = clamp((this.input.grabY - p.y + 20) / pullRange);
      this.input.angle = clamp(this.input.grabAngle + (p.x - this.input.grabX) / Math.max(105, this.w * .2), -1, 1);
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
        ['지금 필요한 쪽으로', '안내는 현재 위치에서 더 움직일 방향입니다. 체크가 뜨면 그대로 유지하세요.'],
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
        this.input.angle = clamp(this.input.angle + da * dt * 1.75, -1, 1);
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
        const previousStep = Math.floor(p.progress * 8);
        p.progress = clamp(p.progress + gain * dt);
        const currentStep = Math.floor(p.progress * 8);
        if (currentStep > previousStep && currentStep < 8) {
          p.slipPulse = 1; this.shake = Math.max(this.shake, 1.7);
          this.burst(this.w / 2, this.h * .54, 'fiber', 4);
        }
        p.accuracySum += quality * dt; p.accuracyTime += dt;
        const angleError = desired - this.input.angle;
        p.feedback = quality > .78 ? '맞았어요 · 그대로 유지!' : angleQ < .62 ? (angleError < 0 ? '← 지금 왼쪽으로' : '지금 오른쪽으로 →') : '힘을 미세하게 맞춰요';
        this.sound.tension(quality);
        if (!p.lastZone && quality > .55) this.burst(this.w / 2, this.h * .665, 'soil', 5);
      } else if (this.input.held && power > .08) {
        const angleError = desired - this.input.angle;
        if (power < target - p.band) p.feedback = '힘이 부족해요 · 더 위로';
        else if (power > target + p.band) p.feedback = '너무 세요! 힘을 빼세요';
        else p.feedback = angleError < 0 ? '← 지금 왼쪽으로' : '지금 오른쪽으로 →';
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
      p.slipPulse = Math.max(0, (p.slipPulse || 0) - dt * 5.5);
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
      this.maxCombo = Math.max(this.maxCombo, this.combo); this.harvested++;
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
      const isNewBest = this.score > this.best;
      this.state = 'gameover'; this.saveBest(); this.saveRunToRanking(); this.hideTutorial();
      $('result-title').textContent = isNewBest && this.score > 0 ? '새로운 최고 기록!' : '오늘 수확 끝!';
      $('final-score').textContent = this.score.toLocaleString('ko-KR');
      $('result-copy').textContent = `${this.profile?.name || '농부'}님은 마늘쫑 ${this.harvested}줄기를 수확해 밭 ${this.stage}까지 도착했습니다.`;
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
        fiber: { vx: [-75,75], vy: [-80,-20], life: [.18,.4], size: [1,3], colors: ['#e8f2b7','#c9df85','#f7f1cb'], gravity: 190 },
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
      $('hud-player').textContent = this.profile ? `· ${this.profile.name}` : '';
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
      let bend = this.input.angle * Math.min(102, w * .18) * (.38 + power * .62);
      const tremble = (p.tremor * 4.5 + (p.stress > .65 ? 2 : 0)) * Math.sin(this.time * 58);
      bend += tremble;
      const sheathTop = ground - Math.min(79, h * .115);
      const pullLength = Math.min(205, h * .29);
      let lift = p.progress * pullLength + power * 7 + (p.slipPulse || 0) * 4;
      let fly = 0, flyX = 0, rotation = 0;
      if (p.resolved && !p.failReason) {
        const t = clamp(p.outcomeTime / .9); fly = easeOut(t) * Math.min(310, h * .44); flyX = Math.sin(t * Math.PI) * (p.perfect ? 38 : 18); rotation = Math.sin(t * 5) * .12;
      }

      // The garlic plant stays in the soil: long, flat leaves wrap a pale central sheath.
      ctx.save();
      ctx.fillStyle = 'rgba(44,38,24,.18)';
      ctx.beginPath(); ctx.ellipse(x, ground + 9, 73, 14, 0, 0, Math.PI * 2); ctx.fill();
      const leafSway = targetA * 4 + Math.sin(this.time * 1.7) * .7;
      this.garlicLeaf(ctx, x - 7, ground + 5, -112 + leafSway, -150, 19, '#477f4a');
      this.garlicLeaf(ctx, x + 8, ground + 5, 118 + leafSway, -161, 18, '#568d50');
      this.garlicLeaf(ctx, x - 9, ground + 4, -71 + leafSway, -238, 21, '#397745');
      this.garlicLeaf(ctx, x + 9, ground + 5, 78 + leafSway, -255, 20, '#4c894a');
      this.garlicLeaf(ctx, x - 4, ground + 4, -35 + leafSway, -282, 17, '#5b9653');
      this.garlicLeaf(ctx, x + 3, ground + 5, 39 + leafSway, -215, 16, '#699f59');

      const sheathGradient = ctx.createLinearGradient(x - 28, 0, x + 28, 0);
      sheathGradient.addColorStop(0, '#528447'); sheathGradient.addColorStop(.18, '#8db669');
      sheathGradient.addColorStop(.5, '#d5e8a7'); sheathGradient.addColorStop(.78, '#86af61'); sheathGradient.addColorStop(1, '#3a733e');
      ctx.fillStyle = sheathGradient; ctx.strokeStyle = '#386d3c'; ctx.lineWidth = 2.5;
      ctx.beginPath(); ctx.moveTo(x - 25, ground + 7); ctx.quadraticCurveTo(x - 21, ground - 44, x - 14, sheathTop);
      ctx.quadraticCurveTo(x, sheathTop - 7, x + 14, sheathTop); ctx.quadraticCurveTo(x + 21, ground - 44, x + 25, ground + 7); ctx.closePath(); ctx.fill(); ctx.stroke();
      // Overlapping leaf bases make the outer stalk read as a wrapped sheath, not a pipe.
      ctx.strokeStyle = 'rgba(247,255,204,.55)'; ctx.lineWidth = 3;
      [-12, 10].forEach((offset, i) => {
        ctx.beginPath(); ctx.moveTo(x + offset, ground + 2); ctx.quadraticCurveTo(x + offset * .72, ground - 42, x + offset * .48, sheathTop + 8 + i * 3); ctx.stroke();
      });
      if (p.progress < .3) {
        ctx.save(); ctx.globalAlpha = .28; ctx.strokeStyle = '#315f38'; ctx.lineWidth = 7; ctx.setLineDash([4, 6]);
        ctx.beginPath(); ctx.moveTo(x, ground - 5); ctx.lineTo(x, sheathTop + 5); ctx.stroke(); ctx.setLineDash([]); ctx.restore();
      }
      ctx.fillStyle = p.stress > .65 ? '#7d4e3c' : '#284f31'; ctx.strokeStyle = '#dcecad'; ctx.lineWidth = 2.5;
      ctx.beginPath(); ctx.ellipse(x + targetA * 5, sheathTop, 13 - p.stress * 2, 5.5, targetA * .08, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
      ctx.restore();

      // The thin scape slides through the fixed sheath. Its pale-to-green gradient is
      // anchored to its real full length, so newly exposed pale stem shows progress.
      const innerBottom = ground + 7 - lift;
      const visibleBottom = Math.min(sheathTop, innerBottom);
      const topY = h * .285 - lift;
      const stemTopX = x + bend;
      const neckY = topY + 31;
      const curlSide = Math.sin(p.seed) > 0 ? 1 : -1;
      const budX = stemTopX + curlSide * 43;
      const budY = topY + 23;
      const stalkW = 11.5 * p.type.width;
      const traceScape = () => {
        ctx.moveTo(x + bend * .06, visibleBottom);
        ctx.bezierCurveTo(x + bend * .16, lerp(visibleBottom, neckY, .38), x + bend * .76, neckY + 78, stemTopX, neckY);
        ctx.bezierCurveTo(stemTopX + curlSide * 2, topY + 2, stemTopX + curlSide * 46, topY - 8, budX, budY);
      };
      ctx.save();
      ctx.translate(x + flyX, sheathTop - fly); ctx.rotate(rotation); ctx.translate(-x, -sheathTop);
      ctx.lineCap = 'round';
      ctx.strokeStyle = p.type.dark; ctx.lineWidth = stalkW + 4.5;
      ctx.beginPath(); traceScape(); ctx.stroke();
      const scapeGradient = ctx.createLinearGradient(0, innerBottom, 0, topY - 8);
      if (p.key === 'golden') {
        scapeGradient.addColorStop(0, '#fff2ae'); scapeGradient.addColorStop(.2, '#f3d768'); scapeGradient.addColorStop(.58, '#d8a431'); scapeGradient.addColorStop(1, '#9b6b20');
      } else {
        scapeGradient.addColorStop(0, '#f0f6c9'); scapeGradient.addColorStop(.12, '#d8eca2'); scapeGradient.addColorStop(.3, '#91c66c'); scapeGradient.addColorStop(.58, p.type.color); scapeGradient.addColorStop(1, p.type.dark);
      }
      ctx.strokeStyle = scapeGradient; ctx.lineWidth = stalkW;
      ctx.beginPath(); traceScape(); ctx.stroke();
      ctx.strokeStyle = 'rgba(245,255,211,.46)'; ctx.lineWidth = 2.2;
      ctx.beginPath(); traceScape(); ctx.stroke();

      // The soft, pale base and fine sheath marks appear only after it clears the plant.
      if (innerBottom < sheathTop - 2) {
        ctx.fillStyle = p.key === 'golden' ? '#fff0a2' : '#eff5c8'; ctx.strokeStyle = p.type.dark; ctx.lineWidth = 1.7;
        ctx.beginPath(); ctx.ellipse(x + bend * .06, innerBottom, stalkW * .47, 3.2, .06, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
        ctx.strokeStyle = 'rgba(77,117,55,.35)'; ctx.lineWidth = 1;
        for (let i = 1; i <= 3; i++) {
          const yy = innerBottom + i * 11;
          if (yy < sheathTop - 5) { ctx.beginPath(); ctx.moveTo(x - stalkW * .35, yy); ctx.lineTo(x + stalkW * .35, yy); ctx.stroke(); }
        }
      }

      // A pointed spathe at the end of the natural hook identifies this as garlic scape.
      ctx.save(); ctx.translate(budX, budY); ctx.rotate(curlSide * .58);
      const budGradient = ctx.createLinearGradient(0, -20, 0, 18);
      budGradient.addColorStop(0, p.key === 'golden' ? '#fff1a1' : '#b6d77a'); budGradient.addColorStop(1, p.key === 'golden' ? '#c38b25' : '#4f883f');
      ctx.fillStyle = budGradient; ctx.strokeStyle = p.type.dark; ctx.lineWidth = 2.5;
      ctx.beginPath(); ctx.moveTo(0, -22); ctx.bezierCurveTo(10, -10, 11, 7, 0, 19); ctx.bezierCurveTo(-11, 7, -9, -9, 0, -22); ctx.closePath(); ctx.fill(); ctx.stroke();
      ctx.strokeStyle = 'rgba(244,255,202,.55)'; ctx.lineWidth = 1.5; ctx.beginPath(); ctx.moveTo(-1,-16); ctx.quadraticCurveTo(4,0,0,13); ctx.stroke(); ctx.restore();
      if (p.failReason) {
        ctx.strokeStyle = '#f2d39a'; ctx.lineWidth = stalkW - 2; ctx.beginPath(); ctx.moveTo(x - 10, sheathTop - 16); ctx.lineTo(x + 11, sheathTop - 40); ctx.stroke();
      }
      ctx.restore();

      // The front lip remains over the scape, visually pinching it inside the sheath.
      ctx.save(); ctx.strokeStyle = p.stress > .65 ? '#e78467' : '#e5f0b6'; ctx.lineWidth = 3;
      ctx.beginPath(); ctx.ellipse(x + targetA * 5, sheathTop + 1, 14 - p.stress * 2, 5.5, targetA * .08, 0, Math.PI); ctx.stroke(); ctx.restore();

      // Early callout teaches that the outer garlic plant remains behind.
      if (p.progress < .16 && !p.resolved) {
        const side = w < 500 ? -1 : 1;
        const labelX = x + side * Math.min(130, w * .27), labelY = sheathTop + 20;
        ctx.save(); ctx.strokeStyle = 'rgba(255,249,211,.9)'; ctx.lineWidth = 2;
        ctx.beginPath(); ctx.moveTo(x + side * 17, sheathTop - 2); ctx.lineTo(labelX - side * 52, labelY - 8); ctx.stroke();
        ctx.fillStyle = 'rgba(38,74,42,.88)'; ctx.beginPath(); ctx.roundRect(labelX - 56, labelY - 24, 112, 32, 12); ctx.fill();
        ctx.fillStyle = '#fff9d9'; ctx.textAlign = 'center'; ctx.font = '800 12px sans-serif'; ctx.fillText('잎대 속 마늘쫑', labelX, labelY - 4); ctx.restore();
      }

      if (!p.resolved) {
        // Instant relative correction: this reacts to the current input, not absolute target side.
        const correction = targetA - this.input.angle;
        const aligned = this.input.held && Math.abs(correction) < .1;
        const cueW = aligned ? 92 : 104;
        const cueX = clamp(stemTopX + (w < 520 ? 82 : 102), cueW / 2 + 12, w - cueW / 2 - 12);
        const cueY = clamp(neckY + 17, h * .18, sheathTop - 40);
        const cuePulse = 1 + Math.min(.08, Math.abs(correction) * .08) * Math.sin(this.time * 12);
        ctx.save(); ctx.translate(cueX, cueY); ctx.scale(cuePulse, cuePulse);
        ctx.fillStyle = aligned ? 'rgba(62,145,71,.95)' : 'rgba(255,249,215,.95)';
        ctx.strokeStyle = aligned ? '#236c38' : '#496044'; ctx.lineWidth = 2.5;
        ctx.beginPath(); ctx.roundRect(-cueW / 2, -18, cueW, 36, 15); ctx.fill(); ctx.stroke();
        ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.font = '900 13px sans-serif';
        ctx.fillStyle = aligned ? '#fffde7' : '#304b34';
        if (!this.input.held) ctx.fillText('잡고 위로 ↑', 0, 1);
        else if (aligned) ctx.fillText('✓ 딱 좋아요', 0, 1);
        else ctx.fillText(correction < 0 ? '← 이쪽으로' : '이쪽으로 →', 0, 1);
        ctx.restore();
        // Grab halo
        if (!this.input.held) {
          ctx.strokeStyle = 'rgba(255,255,225,.8)'; ctx.lineWidth = 3; ctx.setLineDash([5,5]);
          ctx.beginPath(); ctx.arc(stemTopX, neckY + 15, 34 + Math.sin(this.time * 4) * 3, 0, Math.PI * 2); ctx.stroke(); ctx.setLineDash([]);
        }
      }
    }
    garlicLeaf(ctx, x, y, dx, dy, width, color) {
      ctx.save(); ctx.translate(x, y);
      const gradient = ctx.createLinearGradient(0, 0, dx, dy);
      gradient.addColorStop(0, '#9db778'); gradient.addColorStop(.18, color); gradient.addColorStop(1, '#315f43');
      ctx.fillStyle = gradient; ctx.strokeStyle = '#2b633c'; ctx.lineWidth = 1.8;
      ctx.beginPath(); ctx.moveTo(-width * .45, 0);
      ctx.bezierCurveTo(dx * .15 - width * .42, dy * .34, dx - width * .16, dy * .82, dx, dy);
      ctx.bezierCurveTo(dx + width * .14, dy * .8, dx * .14 + width * .44, dy * .3, width * .45, 0);
      ctx.closePath(); ctx.fill(); ctx.stroke();
      ctx.strokeStyle = 'rgba(222,239,174,.32)'; ctx.lineWidth = 1;
      ctx.beginPath(); ctx.moveTo(0, -3); ctx.quadraticCurveTo(dx * .42, dy * .5, dx, dy); ctx.stroke(); ctx.restore();
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
