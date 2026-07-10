(() => {
  'use strict';

  const $ = (id) => document.getElementById(id);
  const clamp = (v, a = 0, b = 1) => Math.max(a, Math.min(b, v));
  const lerp = (a, b, t) => a + (b - a) * t;
  const mixRgb = (t, from, to) => `rgb(${Math.round(lerp(from[0], to[0], t))}, ${Math.round(lerp(from[1], to[1], t))}, ${Math.round(lerp(from[2], to[2], t))})`;
  const easeOut = (t) => 1 - Math.pow(1 - clamp(t), 3);
  const START_LIVES = 2;
  const MAX_LIVES = 2;
  const PLANTS_PER_STAGE = 3;
  const MAX_STAGE = 3;
  const MAX_LEVEL = 10;
  const CHALLENGE_SECONDS = 60;
  const LEVEL_THRESHOLDS = [0, 90, 195, 330, 490, 675, 885, 1125, 1395, 1690];
  const RELEASE_HARVEST_MIN = .68;
  const AUTO_HARVEST_PROGRESS = 1;
  const FIELD_CLEAR_DURATION = 2.2;
  const SUCCESS_ADVANCE_DELAY = .68;
  const FAIL_ADVANCE_DELAY = 1.05;
  const CHALLENGE_PULL_SPEED = 1.5;
  const VISUAL_ASSET_PATHS = {
    building: [
      'assets/wemade-building.png',
      'assets/wemade-building-mid.png',
      'assets/wemade-building-final.png'
    ],
    friend: {
      idle: 'assets/support-friend-idle.png',
      good: 'assets/support-friend-good.png',
      fail: 'assets/support-friend-fail.png',
      max: 'assets/support-friend-max.png'
    }
  };
  const FIRST_PLAY_LESSONS = [
    null,
    { title: '첫 줄기는 손맛부터', short: '잡고 위로 쭉!', copy: '손 아이콘처럼 위로 당겨보세요. 초록 구간이 넓어서 거의 바로 쑤욱 뽑혀요.' },
    { title: '힘은 초록 안에', short: '초록 힘 맞추기', copy: '바늘이 초록 구간에 있으면 마늘쫑이 올라와요. 빨간선 가까우면 힘을 살짝 빼세요.' },
    { title: '저항을 따라가기', short: '화살표 따라가기', copy: '줄기가 흔들리면 짧은 화살표만 따라가세요. 실패 전에는 먼저 경고해줘요.' }
  ];
  const formatCm = (value) => `${Number(value || 0).toLocaleString('ko-KR', { minimumFractionDigits: 1, maximumFractionDigits: 1 })}cm`;
  const scoreValue = (row) => Number(row?.cm ?? row?.score ?? 0);
  const formatTime = (seconds) => `${Math.max(0, seconds || 0).toFixed(1)}초`;
  const levelFromXp = (xp) => {
    let level = 1;
    for (let i = 1; i < MAX_LEVEL; i++) if (xp >= LEVEL_THRESHOLDS[i]) level = i + 1;
    return level;
  };

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

  class VisualAssets {
    constructor(paths) {
      this.paths = paths;
      this.images = {};
      if (typeof Image !== 'function') return;
      this.images.building = paths.building.map((src) => this.load(src));
      this.images.friend = {};
      Object.entries(paths.friend).forEach(([key, src]) => { this.images.friend[key] = this.load(src); });
    }
    load(src) {
      const image = new Image();
      image.decoding = 'async';
      image.src = src;
      return image;
    }
    ready(image) {
      return Boolean(image && image.complete && image.naturalWidth > 0);
    }
    building(growth = 0) {
      const list = this.images.building || [];
      if (!list.length) return null;
      const index = Math.min(list.length - 1, Math.floor(clamp(growth, 0, .999) * list.length));
      return list[index] || list[0];
    }
    friend(mood) {
      return this.images.friend?.[mood] || this.images.friend?.idle;
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
    fresh: { name: '싱싱한 마늘쫑', color: '#4cae50', dark: '#26763f', width: 1, cmBonus: 1, pattern: 'wave' },
    stubborn: { name: '고집센 마늘쫑', color: '#3e9b4b', dark: '#1d6337', width: 1.18, cmBonus: 1.05, pattern: 'steps' },
    dancer: { name: '춤추는 마늘쫑', color: '#69b94b', dark: '#34743b', width: .92, cmBonus: 1.08, pattern: 'zigzag' },
    golden: { name: '황금 마늘쫑', color: '#e4ae32', dark: '#a87323', width: 1.08, cmBonus: 1.35, pattern: 'pulse' }
  };

  const STAGE_THEMES = [
    { skyTop: '#9bd7ec', skyBottom: '#e7f3b9', sun: '#fffad8', cloud: 'rgba(255,255,255,.72)', hillA: '#8fbe63', hillB: '#72a755', soilA: '#a86d3c', soilB: '#87522f', soilC: '#563722', ridge: '#c88b4b', crop: '#447e3d', sign: '#7a532f', prop: 'sprouts', label: '새벽 밭' },
    { skyTop: '#81c9f1', skyBottom: '#ffe0a8', sun: '#fff0b6', cloud: 'rgba(255,248,225,.76)', hillA: '#a4ca63', hillB: '#7fad53', soilA: '#ba7840', soilB: '#945d34', soilC: '#603c25', ridge: '#d79a53', crop: '#3f8542', sign: '#8a5d34', prop: 'flowers', label: '햇살 밭' },
    { skyTop: '#c09de6', skyBottom: '#ffe0ae', sun: '#ffd78a', cloud: 'rgba(255,235,200,.68)', hillA: '#b8b95d', hillB: '#8e9a4a', soilA: '#9b6540', soilB: '#754b31', soilC: '#4c3325', ridge: '#c9874f', crop: '#586f35', sign: '#76482d', prop: 'crates', label: '노을 밭' },
    { skyTop: '#6f9fd0', skyBottom: '#cfd99c', sun: '#f5f7d1', cloud: 'rgba(240,248,255,.56)', hillA: '#74895a', hillB: '#596f4c', soilA: '#7a5638', soilB: '#5b3f2d', soilC: '#36281f', ridge: '#a56e42', crop: '#315b37', sign: '#5e3d28', prop: 'flags', label: '고수 밭' },
    { skyTop: '#344c84', skyBottom: '#b8d49a', sun: '#f9f2b5', cloud: 'rgba(245,249,255,.46)', hillA: '#61764e', hillB: '#435d3e', soilA: '#6e4a35', soilB: '#4e362a', soilC: '#2b211b', ridge: '#9a643d', crop: '#b4ca67', sign: '#523623', prop: 'festival', label: '축제 밭' }
  ];

  class Plant {
    constructor(stage, index, rng) {
      this.lesson = stage === 1 && index < 3 ? index + 1 : 0;
      const golden = !this.lesson && ((stage * 4 + index) % 9 === 8 || rng.next() < Math.min(.06 + stage * .008, .16));
      const pool = stage < 2 ? ['fresh', 'fresh', 'stubborn'] : ['fresh', 'stubborn', 'dancer'];
      this.key = this.lesson === 3 ? 'dancer' : golden ? 'golden' : rng.pick(pool);
      this.type = TYPES[this.key];
      this.seed = rng.range(0, 100);
      this.difficulty = clamp((stage - 1) / Math.max(1, MAX_STAGE - 1), 0, .82);
      this.assist = this.lesson === 1 ? .92 : this.lesson === 2 ? .62 : this.lesson === 3 ? .42 : clamp(.24 - (stage - 1) * .075 - index * .025, 0, .24);
      const globalIndex = (stage - 1) * PLANTS_PER_STAGE + index;
      if (!this.lesson && globalIndex === 3) this.assist = Math.max(this.assist, .28);
      this.baseForce = rng.range(.39, .53) + this.difficulty * .08;
      this.band = Math.max(.105, rng.range(.155, .205) - this.difficulty * .07);
      this.danger = clamp(this.baseForce + this.band + rng.range(.14, .2), .72, .9);
      this.speed = rng.range(.72, 1.08) + this.difficulty * .75;
      this.angleStrength = rng.range(.22, .42) + this.difficulty * .14;
      this.lengthCm = rng.range(31, 43) + Math.min(stage - 1, MAX_STAGE - 1) * rng.range(.55, 1.05);
      if (this.key === 'stubborn') this.lengthCm += 2.2;
      if (this.key === 'dancer') this.lengthCm += 1.1;
      if (this.key === 'golden') this.lengthCm += 4.5;
      if (this.key === 'dancer') this.angleStrength += .17;
      if (this.key === 'stubborn') { this.band *= .9; this.baseForce += .04; }
      if (this.key === 'golden') { this.band *= .78; this.speed *= 1.1; }
      if (this.lesson === 1) {
        this.key = 'fresh'; this.type = TYPES.fresh;
        this.baseForce = .34; this.band = .36; this.danger = .98; this.speed = .42; this.angleStrength = .02; this.lengthCm = 34;
      } else if (this.lesson === 2) {
        this.key = 'fresh'; this.type = TYPES.fresh;
        this.baseForce = .47; this.band = .25; this.danger = .94; this.speed = .62; this.angleStrength = .1; this.lengthCm = 36;
      } else if (this.lesson === 3) {
        this.key = 'dancer'; this.type = TYPES.dancer;
        this.baseForce = .48; this.band = .2; this.danger = .91; this.speed = .84; this.angleStrength = .29; this.lengthCm = 38;
      }
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
      this.cm = 0;
      this.releaseReady = false;
      this.releaseQuality = 0;
      this.tremor = 0;
      this.slipPulse = 0;
      this.warningPulse = 0;
      this.graceWarnings = this.lesson === 1 ? 3 : this.lesson === 2 ? 2 : this.lesson === 3 ? 1 : this.assist > .14 ? 1 : 0;
      this.signalKind = 'idle';
      this.signalText = '';
      this.nearPullPulse = 0;
      this.nearAnnounced = false;
      this.failTip = '';
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

  class SupabaseRanking {
    constructor(config = {}) {
      this.url = String(config.url || '').replace(/\/+$/, '');
      this.anonKey = String(config.anonKey || config.key || '');
      this.table = String(config.table || 'garlic_rankings');
      this.enabled = /^https:\/\/[a-z0-9-]+\.supabase\.co$/i.test(this.url) && this.anonKey.length > 20;
      this.lastError = '';
    }
    endpoint(query = '') {
      return `${this.url}/rest/v1/${encodeURIComponent(this.table)}${query}`;
    }
    headers(extra = {}) {
      return {
        apikey: this.anonKey,
        Authorization: `Bearer ${this.anonKey}`,
        'Content-Type': 'application/json',
        ...extra
      };
    }
    normalize(row) {
      return {
        name: String(row.name || '농부').slice(0, 10),
        cm: Number(row.cm ?? row.score ?? 0),
        stage: Number(row.stage || 1),
        combo: Number(row.combo || 0),
        harvested: Number(row.harvested || 0),
        perfectCount: Number(row.perfect_count ?? row.perfectCount ?? 0),
        time: row.created_at ? new Date(row.created_at).getTime() : Number(row.time || Date.now())
      };
    }
    async fetchTop() {
      if (!this.enabled) return { ok: false, rows: [], error: 'Supabase 설정이 아직 비어 있어요.' };
      try {
        const params = '?select=name,cm,stage,combo,harvested,perfect_count,created_at&order=cm.desc,created_at.asc&limit=30';
        const res = await fetch(this.endpoint(params), { headers: this.headers({ Accept: 'application/json' }) });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const rows = await res.json();
        this.lastError = '';
        return { ok: true, rows: rows.map((row) => this.normalize(row)), error: '' };
      } catch (err) {
        this.lastError = err?.message || '랭킹을 불러오지 못했어요.';
        return { ok: false, rows: [], error: this.lastError };
      }
    }
    async submit(entry) {
      if (!this.enabled) return { ok: false, error: 'Supabase 설정이 아직 비어 있어요.' };
      const body = {
        name: String(entry.name || '농부').trim().slice(0, 10),
        cm: Number(Number(entry.cm || 0).toFixed(1)),
        stage: Math.max(1, Math.min(MAX_STAGE, Number(entry.stage || 1))),
        combo: Math.max(0, Math.min(PLANTS_PER_STAGE * MAX_STAGE, Number(entry.combo || 0))),
        harvested: Math.max(0, Math.min(PLANTS_PER_STAGE * MAX_STAGE, Number(entry.harvested || 0))),
        perfect_count: Math.max(0, Math.min(PLANTS_PER_STAGE * MAX_STAGE, Number(entry.perfectCount || 0)))
      };
      try {
        const res = await fetch(this.endpoint(), {
          method: 'POST',
          headers: this.headers({ Prefer: 'return=minimal' }),
          body: JSON.stringify(body)
        });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        this.lastError = '';
        return { ok: true, error: '' };
      } catch (err) {
        this.lastError = err?.message || '기록을 저장하지 못했어요.';
        return { ok: false, error: this.lastError };
      }
    }
  }

  class Game {
    constructor() {
      this.canvas = $('game');
      this.ctx = this.canvas.getContext('2d');
      this.sound = new Sound();
      this.visualAssets = new VisualAssets(VISUAL_ASSET_PATHS);
      this.rng = new RNG();
      this.profile = this.readStored('garlic-profile', null) || { name: '농부' };
      this.worldRanking = new SupabaseRanking(globalThis.GARLIC_WORLD_RANKING || globalThis.window?.GARLIC_WORLD_RANKING || {});
      this.rankings = this.readStored('garlic-world-cache', this.readStored('garlic-rankings', []));
      this.rankingStatus = this.worldRanking.enabled ? '월드 랭킹을 불러오는 중…' : 'Supabase 연결 대기 중';
      this.lastRunEntry = null;
      this.lastShareText = '';
      this.resultPlayerTitle = null;
      this.installPrompt = null;
      this.state = this.profile ? 'title' : 'login';
      this.stage = 1; this.plantNo = 1; this.score = 0; this.combo = 0; this.maxCombo = 0; this.harvested = 0; this.perfectCount = 0; this.lives = START_LIVES;
      this.level = 1; this.levelXp = 0; this.levelMaxed = false; this.levelMaxTime = 0; this.runTime = 0; this.levelPulse = 0; this.maxLevelBanner = 0; this.challengeSurgeShown = false;
      this.best = Number(localStorage.getItem('garlic-best') || 0);
      this.bestCombo = Number(localStorage.getItem('garlic-best-combo') || 0);
      this.bestPerfect = Number(localStorage.getItem('garlic-best-perfect') || 0);
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
      this.fieldClearTimer = 0;
      this.fieldClearStage = 0;
      this.friendMood = 'idle';
      this.friendMoodTimer = 0;
      this.tutorialStep = -1;
      this.tutorialDone = localStorage.getItem('garlic-tutorial') === '1';
      this.input = { held: false, power: 0, angle: 0, pointerId: null, x: 0, y: 0, grabX: 0, grabY: 0, grabAngle: 0, keyboard: false };
      this.keys = new Set();
      this.bind(); this.resize(); this.updateUI(); this.registerServiceWorker(); this.updateInstallButton();
      $('best-score').textContent = formatCm(this.best);
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
      $('best-score').textContent = formatCm(this.best);
      this.updateInstallButton();
    }
    showRanking(returnState = this.state) {
      this.rankReturnState = returnState === 'gameover' ? 'gameover' : 'title';
      this.state = 'ranking'; this.renderRanking(); this.showCard('ranking-card'); this.refreshWorldRanking();
    }
    closeRanking() {
      if (this.rankReturnState === 'gameover') {
        this.state = 'gameover'; this.showCard('result-card');
      } else this.showTitle();
    }
    levelProgress() {
      if (this.level >= MAX_LEVEL) return 1;
      const prev = LEVEL_THRESHOLDS[this.level - 1] || 0;
      const next = LEVEL_THRESHOLDS[this.level] || LEVEL_THRESHOLDS[MAX_LEVEL - 1];
      return clamp((this.levelXp - prev) / Math.max(1, next - prev));
    }
    successLevelXp(p, handling, speedBonus) {
      const comboBoost = Math.min(this.combo, 8) * 5;
      const timeAssist = this.runTime > 38 && !this.levelMaxed ? Math.min(42, (this.runTime - 38) * 1.45) : 0;
      const lessonBoost = p.lesson ? 18 : 0;
      const rareBoost = p.key === 'golden' ? 35 : 0;
      return Math.round(100 + handling * 30 + speedBonus * 12 + comboBoost + lessonBoost + rareBoost + (p.perfect ? 32 : 0) + timeAssist);
    }
    failLevelXp(p) {
      const timeAssist = this.runTime > 42 && !this.levelMaxed ? Math.min(28, (this.runTime - 42) * 1.25) : 0;
      return Math.round(34 + p.progress * 48 + (p.lesson ? 18 : 0) + timeAssist);
    }
    awardLevelXp(amount, mood = 'good') {
      if (this.levelMaxed || amount <= 0) return;
      const before = this.level;
      const cap = LEVEL_THRESHOLDS[MAX_LEVEL - 1];
      this.levelXp = Math.min(cap, this.levelXp + amount);
      this.level = levelFromXp(this.levelXp);
      if (this.level > before) {
        this.levelPulse = 1;
        this.friendMood = mood === 'fail' ? 'cheer' : 'good';
        this.friendMoodTimer = 1.5;
        this.burst(this.w / 2, this.h * .22, 'level', Math.min(12 + this.level * 2, 30));
        if (this.level < MAX_LEVEL) {
          this.sound.stage();
          this.toast(`Lv.${this.level} 숙련도 상승!`, 'good');
        }
      }
      if (this.level >= MAX_LEVEL) this.reachMaxLevel();
    }
    reachMaxLevel() {
      if (this.levelMaxed) return;
      this.level = MAX_LEVEL;
      this.levelXp = LEVEL_THRESHOLDS[MAX_LEVEL - 1];
      this.levelMaxed = true;
      this.levelMaxTime = this.runTime;
      this.maxLevelBanner = 3.1;
      this.levelPulse = 1;
      this.friendMood = 'max';
      this.friendMoodTimer = 3.2;
      this.shake = Math.max(this.shake, 22);
      this.flash = Math.max(this.flash, 1.25);
      this.slow = Math.min(this.slow, .18);
      this.sound.stage();
      this.sound.success(true);
      if (navigator.vibrate) navigator.vibrate([35, 30, 90]);
      this.burst(this.w / 2, this.h * .32, 'perfect', 90);
      this.burst(this.w * .28, this.h * .56, 'level', 34);
      this.burst(this.w * .72, this.h * .56, 'level', 34);
      this.popScore('마늘쫑 장인 달성! MAX LEVEL!');
      this.toast(`MAX LEVEL · ${formatTime(this.levelMaxTime)} 달성!`, 'good');
    }
    isStandalone() {
      const media = typeof matchMedia === 'function' ? matchMedia('(display-mode: standalone)') : null;
      return Boolean(media?.matches || globalThis.navigator?.standalone);
    }
    updateInstallButton() {
      const button = $('install-button');
      button.classList.toggle('hidden', !(this.installPrompt && !this.isStandalone()));
    }
    async installApp() {
      if (!this.installPrompt) {
        this.toast(this.isStandalone() ? '이미 앱처럼 실행 중이에요' : '브라우저 메뉴에서 홈 화면에 추가할 수 있어요', this.isStandalone() ? 'good' : '');
        return;
      }
      const prompt = this.installPrompt;
      this.installPrompt = null;
      prompt.prompt();
      let outcome = 'dismissed';
      try {
        const choice = await prompt.userChoice;
        outcome = choice?.outcome || outcome;
      } catch {}
      this.updateInstallButton();
      this.toast(outcome === 'accepted' ? '설치가 시작됐어요!' : '설치는 언제든 다시 할 수 있어요', outcome === 'accepted' ? 'good' : '');
    }
    registerServiceWorker() {
      const nav = globalThis.navigator;
      const protocol = globalThis.location?.protocol || '';
      if (!nav?.serviceWorker || protocol === 'file:') return;
      addEventListener('load', () => {
        nav.serviceWorker.register('./sw.js').catch(() => {});
      });
    }
    renderRanking() {
      const list = $('ranking-list');
      const status = $('ranking-status');
      if (status) status.textContent = this.rankingStatus;
      const rows = (this.worldRanking.enabled ? [...this.rankings] : [])
        .sort((a, b) => scoreValue(b) - scoreValue(a) || b.time - a.time)
        .slice(0, 10);
      if (!rows.length) {
        list.innerHTML = `<div class="rank-empty">${this.worldRanking.enabled ? '아직 기록이 없어요.<br>첫 번째 세계 기록을 남겨보세요!' : 'Supabase 연결을 기다리는 중이에요.<br>설정 후 월드 랭킹이 열립니다.'}</div>`; return;
      }
      const medals = ['🥇', '🥈', '🥉'];
      const escape = (value) => String(value).replace(/[&<>'"]/g, (c) => ({ '&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;' }[c]));
      list.innerHTML = rows.map((row, index) => {
        const mine = row.name === this.profile?.name ? ' me' : '';
        const date = new Date(row.time).toLocaleDateString('ko-KR', { month: 'short', day: 'numeric' });
        return `<div class="rank-row${mine}"><span class="rank-pos">${medals[index] || index + 1}</span><span class="rank-name">${escape(row.name)}<small>밭 ${row.stage} · ${row.harvested || 0}줄기 · 완벽 ${row.perfectCount || 0} · ${date}</small></span><strong class="rank-score">${formatCm(scoreValue(row))}</strong></div>`;
      }).join('');
    }
    escapeHtml(value) {
      return String(value).replace(/[&<>'"]/g, (c) => ({ '&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;' }[c]));
    }
    sameRankingEntry(row, entry) {
      if (!row || !entry) return false;
      return String(row.name || '') === String(entry.name || '')
        && Math.abs(scoreValue(row) - scoreValue(entry)) < .05
        && Number(row.harvested || 0) === Number(entry.harvested || 0)
        && Number(row.combo || 0) === Number(entry.combo || 0)
        && Number(row.perfectCount || 0) === Number(entry.perfectCount || 0);
    }
    resultRankingRows() {
      const entry = this.lastRunEntry;
      const rows = Array.isArray(this.rankings) ? [...this.rankings] : [];
      if (entry && !rows.some((row) => this.sameRankingEntry(row, entry))) rows.push(entry);
      return rows.sort((a, b) => scoreValue(b) - scoreValue(a) || b.time - a.time);
    }
    currentResultRank() {
      const entry = this.lastRunEntry;
      if (!entry || scoreValue(entry) <= 0) return { entry: null, rows: [], rank: 0, total: 0, ahead: null, behind: null };
      const rows = this.resultRankingRows();
      const index = rows.findIndex((row) => this.sameRankingEntry(row, entry));
      return {
        entry,
        rows,
        rank: index >= 0 ? index + 1 : 0,
        total: rows.length,
        ahead: index > 0 ? rows[index - 1] : null,
        behind: index >= 0 && index < rows.length - 1 ? rows[index + 1] : null
      };
    }
    resultTitleData() {
      const summary = this.currentResultRank();
      return {
        score: this.score,
        level: this.level,
        levelMaxed: this.levelMaxed,
        rank: summary.rank,
        total: summary.total,
        time: this.levelMaxed ? this.levelMaxTime : this.runTime,
        combo: this.maxCombo,
        perfectCount: this.perfectCount,
        harvested: this.harvested,
        completed: this.completed
      };
    }
    calculateResultTitle(data = this.resultTitleData()) {
      const score = Number(data.score || 0);
      const level = Number(data.level || 1);
      const rank = Number(data.rank || 0);
      const total = Number(data.total || 0);
      const time = Number(data.time || 0);
      const combo = Number(data.combo || 0);
      const perfectCount = Number(data.perfectCount || 0);
      const harvested = Number(data.harvested || 0);
      const levelMaxed = Boolean(data.levelMaxed);
      const completed = Boolean(data.completed);
      const topRank = rank > 0 && (rank <= 3 || (total >= 10 && rank / total <= .1));

      if (score >= 440 && levelMaxed && completed && time > 0 && time <= 50) {
        return { title: '마늘쫑계의 부르즈 칼리파', description: '높이도 기록도 하늘을 찔렀습니다. 오늘 밭의 랜드마크예요.', tier: 'myth' };
      }
      if (score >= 420 && levelMaxed && (topRank || combo >= PLANTS_PER_STAGE * MAX_STAGE)) {
        return { title: '갓 뽑기의 신', description: '이 정도면 랭킹판에 이름 새겨도 됩니다.', tier: 'legend' };
      }
      if (score >= 395 && completed && time > 0 && time <= 55) {
        return { title: '속전속결 수확왕', description: '빠른데 섬세합니다. 마늘쫑이 도망갈 틈이 없었어요.', tier: 'speed' };
      }
      if (score >= 370 && (combo >= 7 || perfectCount >= 4)) {
        return { title: '콤보 폭주 기관차', description: '한 번 리듬 타면 밭 끝까지 밀고 가는 손맛입니다.', tier: 'combo' };
      }
      if (score >= 340 || levelMaxed) {
        return { title: '마늘쫑 장인', description: '힘 조절과 타이밍을 제법 몸으로 익혔습니다.', tier: 'master' };
      }
      if (score >= 280 || level >= 8 || topRank) {
        return { title: '랭킹 노려볼 만한 실력', description: '조금만 더 다듬으면 상위권 문패가 보입니다.', tier: 'pro' };
      }
      if (score >= 210 || level >= 6) {
        return { title: '위메이드플레이 루키', description: '감은 확실히 잡았습니다. 이제 손끝 디테일 싸움이에요.', tier: 'rookie' };
      }
      if (score >= 100 || harvested >= 3) {
        return { title: '마늘쫑 견습생', description: '쑥 뽑히는 감각을 익히는 중입니다.', tier: 'apprentice' };
      }
      return { title: '아직 손맛 보는 중', description: '오늘은 예열만 했다 치죠. 다음 판에 바로 감 옵니다.', tier: 'sprout' };
    }
    renderResultPlayerTitle() {
      const box = $('result-player-title');
      if (!box) return;
      const badge = this.resultPlayerTitle || this.calculateResultTitle();
      box.innerHTML = `<span>🏅 칭호</span><strong>${this.escapeHtml(badge.title)}</strong><p>${this.escapeHtml(badge.description)}</p>`;
    }
    renderResultRanking() {
      const box = $('result-ranking-summary');
      if (!box) return;
      const summary = this.currentResultRank();
      if (!summary.entry) {
        box.textContent = this.score > 0 ? (this.rankingStatus || '랭킹을 불러오는 중...') : '아직 랭킹 정보가 없습니다.';
        return;
      }
      const rankText = summary.rank ? `${summary.rank}위` : '계산 중';
      const totalText = summary.total ? `${summary.total}개 기록 기준` : '집계 중';
      const nearby = [];
      if (summary.ahead) nearby.push(`앞순위 ${summary.rank - 1}위 ${this.escapeHtml(summary.ahead.name)} ${formatCm(scoreValue(summary.ahead))}`);
      if (summary.behind) nearby.push(`다음 ${summary.rank + 1}위 ${this.escapeHtml(summary.behind.name)} ${formatCm(scoreValue(summary.behind))}`);
      const note = [this.rankingStatus || '랭킹 정보 계산 완료', nearby.join(' · ')].filter(Boolean).join(' · ');
      box.innerHTML = [
        '<div class="result-rank-grid">',
        `<span>현재 내 순위<strong>${rankText}</strong></span>`,
        `<span>내 기록<strong>${formatCm(scoreValue(summary.entry))}</strong></span>`,
        `<span>랭킹 기준<strong>${totalText}</strong></span>`,
        '</div>',
        `<div class="result-rank-note">${this.escapeHtml(note)}</div>`
      ].join('');
    }
    resultRankText() {
      const summary = this.currentResultRank();
      return summary.rank ? `현재 순위는 ${summary.rank}위` : '현재 순위는 집계 중';
    }
    buildShareText() {
      const name = this.profile?.name || '농부';
      const time = this.levelMaxed ? formatTime(this.levelMaxTime) : formatTime(this.runTime);
      const badge = this.resultPlayerTitle || this.calculateResultTitle();
      return `🎮 마늘쫑 뽑기 완료! ${name}님의 수확 기록은 ${formatCm(this.score)}, ${this.resultRankText()}, 칭호는 "${badge.title}"입니다! Lv.${this.level}/${MAX_LEVEL} · ${time} · 완벽 ${this.perfectCount}줄 · 최대 콤보 x${this.maxCombo}`;
    }
    shareCardData() {
      const summary = this.currentResultRank();
      const badge = this.resultPlayerTitle || this.calculateResultTitle();
      return {
        name: this.profile?.name || '농부',
        title: this.levelMaxed ? '마늘쫑 장인 달성!' : this.completed ? `${MAX_STAGE}개 밭 완주!` : '오늘 수확 끝!',
        badge: this.levelMaxed ? 'WEMADE PLAY FARM CHALLENGE · MAX LEVEL' : 'WEMADE PLAY FARM CHALLENGE',
        score: formatCm(this.score),
        playerTitle: badge.title,
        titleDescription: badge.description,
        rank: summary.rank ? `${summary.rank}위` : '집계 중',
        total: summary.total ? `전체 ${summary.total}개 기록` : '랭킹 집계 중',
        level: this.levelMaxed ? 'MAX' : `Lv.${this.level}`,
        time: this.levelMaxed ? formatTime(this.levelMaxTime) : formatTime(this.runTime),
        perfect: `${this.perfectCount}줄`,
        combo: `x${this.maxCombo}`,
        harvested: `${this.harvested}줄`,
        message: this.buildShareText()
      };
    }
    roundedRectPath(ctx, x, y, w, h, r) {
      const radius = Math.min(r, w / 2, h / 2);
      ctx.beginPath();
      ctx.moveTo(x + radius, y);
      ctx.lineTo(x + w - radius, y);
      ctx.quadraticCurveTo(x + w, y, x + w, y + radius);
      ctx.lineTo(x + w, y + h - radius);
      ctx.quadraticCurveTo(x + w, y + h, x + w - radius, y + h);
      ctx.lineTo(x + radius, y + h);
      ctx.quadraticCurveTo(x, y + h, x, y + h - radius);
      ctx.lineTo(x, y + radius);
      ctx.quadraticCurveTo(x, y, x + radius, y);
      ctx.closePath();
    }
    wrapCanvasText(ctx, text, x, y, maxWidth, lineHeight, maxLines = 2) {
      const words = String(text).split(' ');
      const lines = [];
      let line = '';
      words.forEach((word) => {
        const next = line ? `${line} ${word}` : word;
        if (ctx.measureText(next).width <= maxWidth || !line) line = next;
        else { lines.push(line); line = word; }
      });
      if (line) lines.push(line);
      lines.slice(0, maxLines).forEach((value, index) => ctx.fillText(value, x, y + index * lineHeight));
      return Math.min(lines.length, maxLines) * lineHeight;
    }
    buildResultCardCanvas() {
      const doc = globalThis.document;
      if (!doc?.createElement) return null;
      const data = this.shareCardData();
      const canvas = doc.createElement('canvas');
      canvas.width = 1200;
      canvas.height = 720;
      const ctx = canvas.getContext?.('2d');
      if (!ctx) return null;

      const bg = ctx.createLinearGradient(0, 0, 0, canvas.height);
      bg.addColorStop(0, '#d9f0c9');
      bg.addColorStop(.54, '#f4e6ad');
      bg.addColorStop(1, '#9a7545');
      ctx.fillStyle = bg;
      ctx.fillRect(0, 0, canvas.width, canvas.height);

      ctx.globalAlpha = .28;
      ctx.fillStyle = '#ffffff';
      ctx.beginPath(); ctx.arc(1020, 116, 72, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = '#7fb56b';
      ctx.beginPath(); ctx.ellipse(210, 585, 240, 42, 0, 0, Math.PI * 2); ctx.fill();
      ctx.beginPath(); ctx.ellipse(955, 590, 230, 40, 0, 0, Math.PI * 2); ctx.fill();
      ctx.globalAlpha = 1;

      ctx.save();
      ctx.shadowColor = 'rgba(70, 55, 32, .25)';
      ctx.shadowBlur = 30;
      ctx.shadowOffsetY = 14;
      this.roundedRectPath(ctx, 170, 70, 860, 580, 34);
      ctx.fillStyle = '#fffdf0';
      ctx.fill();
      ctx.restore();
      this.roundedRectPath(ctx, 170, 70, 860, 580, 34);
      ctx.strokeStyle = '#8b6b39';
      ctx.lineWidth = 6;
      ctx.stroke();

      ctx.textAlign = 'center';
      ctx.fillStyle = '#315f38';
      ctx.font = '900 27px sans-serif';
      this.roundedRectPath(ctx, 378, 106, 444, 44, 22);
      ctx.fillStyle = '#edf3c8';
      ctx.fill();
      ctx.fillStyle = '#315f38';
      ctx.fillText(data.badge, 600, 136);

      ctx.fillStyle = '#34492f';
      ctx.font = '950 58px sans-serif';
      ctx.fillText(data.title, 600, 220);
      ctx.fillStyle = '#e07938';
      ctx.font = '950 90px sans-serif';
      ctx.fillText(data.score, 600, 325);
      ctx.fillStyle = '#db7438';
      ctx.font = '950 32px sans-serif';
      ctx.fillText(`🏅 ${data.playerTitle}`, 600, 366);
      ctx.fillStyle = '#667153';
      ctx.font = '850 18px sans-serif';
      this.wrapCanvasText(ctx, data.titleDescription, 600, 394, 720, 22, 1);

      const chips = [
        ['현재 내 순위', data.rank],
        ['랭킹 기준', data.total],
        ['도달 레벨', data.level],
        ['챌린지 시간', data.time],
        ['완벽 수확', data.perfect],
        ['최대 콤보', data.combo]
      ];
      chips.forEach(([label, value], index) => {
        const col = index % 3;
        const row = Math.floor(index / 3);
        const x = 236 + col * 244;
        const y = 414 + row * 72;
        this.roundedRectPath(ctx, x, y, 216, 64, 18);
        ctx.fillStyle = '#f4f0ce';
        ctx.fill();
        ctx.fillStyle = '#667153';
        ctx.font = '900 19px sans-serif';
        ctx.fillText(label, x + 108, y + 24);
        ctx.fillStyle = '#db7438';
        ctx.font = '950 27px sans-serif';
        ctx.fillText(value, x + 108, y + 53);
      });

      ctx.fillStyle = '#526246';
      ctx.font = '850 25px sans-serif';
      ctx.fillText(`${data.name}님의 마늘쫑 수확 카드`, 600, 592);
      ctx.fillStyle = '#778163';
      ctx.font = '800 19px sans-serif';
      this.wrapCanvasText(ctx, data.message, 600, 632, 760, 26, 2);
      return canvas;
    }
    canvasToBlob(canvas) {
      return new Promise((resolve) => canvas.toBlob ? canvas.toBlob(resolve, 'image/png') : resolve(null));
    }
    async copyResultCardImage() {
      const nav = globalThis.navigator;
      const ClipboardItemCtor = globalThis.ClipboardItem;
      if (!nav?.clipboard?.write || typeof ClipboardItemCtor !== 'function') return false;
      const canvas = this.buildResultCardCanvas();
      if (!canvas) return false;
      const blob = await this.canvasToBlob(canvas);
      if (!blob) return false;
      await nav.clipboard.write([new ClipboardItemCtor({ 'image/png': blob })]);
      return true;
    }
    async copyShareText(text) {
      const nav = globalThis.navigator;
      if (nav?.clipboard?.writeText) {
        await nav.clipboard.writeText(text);
        return true;
      }
      const doc = globalThis.document;
      if (!doc?.createElement || !doc?.body) return false;
      const textarea = doc.createElement('textarea');
      textarea.value = text;
      textarea.setAttribute('readonly', '');
      textarea.style.position = 'fixed';
      textarea.style.left = '-9999px';
      doc.body.appendChild(textarea);
      textarea.select();
      let copied = false;
      try { copied = Boolean(doc.execCommand?.('copy')); }
      finally { doc.body.removeChild(textarea); }
      return copied;
    }
    async shareResultToSlack() {
      const text = this.buildShareText();
      this.lastShareText = text;
      const button = $('result-share-button');
      const originalLabel = button?.textContent || '슬랙으로 내 성과 공유하기';
      // 슬랙 웹훅/토큰 같은 민감 정보는 코드에 저장하지 않고, 결과 카드 PNG를 클립보드에 복사해 Slack에 붙여넣게 합니다.
      try {
        const copiedImage = await this.copyResultCardImage();
        if (copiedImage) {
          if (button) {
            button.textContent = '✅ 결과 카드 복사 완료';
            setTimeout(() => { button.textContent = originalLabel; }, 1700);
          }
          this.toast('결과 카드가 복사됐어요. Slack에 붙여넣으세요!', 'good');
          return;
        }
        const copied = await this.copyShareText(text);
        if (copied) {
          if (button) {
            button.textContent = '✅ 공유 문구 복사 완료';
            setTimeout(() => { button.textContent = originalLabel; }, 1600);
          }
          this.toast('이미지 복사가 막혀 성과 문구를 복사했어요', 'good');
        } else {
          this.toast('공유 문구를 만들었어요. 브라우저 복사가 막혀 있어요', '');
        }
      } catch (err) {
        if (err?.name === 'AbortError') return;
        try {
          const copied = await this.copyShareText(text);
          this.toast(copied ? '슬랙에 붙여넣을 성과 문구를 복사했어요' : '공유 문구를 만들었어요. 브라우저 복사가 막혀 있어요', copied ? 'good' : '');
        } catch {
          this.toast('공유 문구를 만들었지만 복사 권한이 막혀 있어요', '');
        }
      }
    }
    async refreshWorldRanking() {
      if (!this.worldRanking.enabled) {
        this.rankingStatus = 'Supabase URL과 anon public key를 넣으면 월드 랭킹으로 전환됩니다.';
        if (this.state === 'ranking') this.renderRanking();
        if (this.state === 'gameover') this.renderResultRanking();
        return;
      }
      this.rankingStatus = '월드 랭킹을 불러오는 중…';
      if (this.state === 'ranking') this.renderRanking();
      if (this.state === 'gameover') this.renderResultRanking();
      const result = await this.worldRanking.fetchTop();
      if (result.ok) {
        this.rankings = result.rows;
        localStorage.setItem('garlic-world-cache', JSON.stringify(this.rankings));
        this.rankingStatus = '전 세계 농부 기록';
      } else {
        this.rankingStatus = `월드 랭킹 연결 실패 · ${result.error}`;
      }
      if (this.state === 'ranking') this.renderRanking();
      if (this.state === 'gameover') this.renderResultRanking();
    }
    saveRunToRanking() {
      if (this.runSaved || !this.profile || this.score <= 0) return;
      this.runSaved = true;
      const entry = {
        name: this.profile.name,
        cm: Number(this.score.toFixed(1)),
        stage: this.stage,
        combo: this.maxCombo,
        harvested: this.harvested,
        perfectCount: this.perfectCount,
        time: Date.now()
      };
      this.lastRunEntry = entry;
      this.rankings.push(entry);
      this.rankings = this.rankings.sort((a, b) => scoreValue(b) - scoreValue(a) || b.time - a.time).slice(0, 50);
      localStorage.setItem('garlic-world-cache', JSON.stringify(this.rankings));
      this.renderResultRanking();
      if (!this.worldRanking.enabled) {
        this.rankingStatus = 'Supabase 설정 전이라 이 기록은 임시로 이 기기에만 보관됐어요.';
        this.renderResultRanking();
        return;
      }
      this.rankingStatus = '월드 랭킹에 기록을 올리는 중…';
      this.renderResultRanking();
      this.worldRanking.submit(entry).then(async (result) => {
        this.rankingStatus = result.ok ? '월드 랭킹에 기록이 올라갔어요.' : `월드 랭킹 저장 실패 · ${result.error}`;
        if (result.ok) await this.refreshWorldRanking();
        else if (this.state === 'ranking') this.renderRanking();
        this.renderResultRanking();
      });
    }
    bind() {
      addEventListener('resize', () => this.resize());
      $('login-form').addEventListener('submit', (e) => { e.preventDefault(); this.enterFarm($('nickname').value); });
      $('nickname').addEventListener('input', () => { $('nickname-error').textContent = ''; $('nickname').classList.remove('invalid'); });
      $('start-button').addEventListener('click', () => this.start());
      $('retry-button').addEventListener('click', () => this.start());
      $('ranking-button').addEventListener('click', () => this.showRanking('title'));
      $('install-button').addEventListener('click', () => this.installApp());
      $('result-share-button').addEventListener('click', () => this.shareResultToSlack());
      $('ranking-back-button').addEventListener('click', () => this.closeRanking());
      $('change-name-button').addEventListener('click', () => this.showLogin());
      $('skip-tutorial').addEventListener('click', () => this.finishTutorial());
      addEventListener('beforeinstallprompt', (e) => {
        e.preventDefault();
        this.installPrompt = e;
        this.updateInstallButton();
        if (this.state === 'title') this.toast('홈 화면에 설치할 수 있어요', 'good');
      });
      addEventListener('appinstalled', () => {
        this.installPrompt = null;
        localStorage.setItem('garlic-pwa-installed', '1');
        this.updateInstallButton();
        this.toast('마늘밭 앱 설치 완료!', 'good');
      });
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
      this.state = 'playing'; this.stage = 1; this.plantNo = 1; this.score = 0; this.combo = 0; this.maxCombo = 0; this.harvested = 0; this.perfectCount = 0; this.lives = START_LIVES; this.runSaved = false; this.completed = false;
      this.lastRunEntry = null; this.lastShareText = ''; this.resultPlayerTitle = null;
      this.level = 1; this.levelXp = 0; this.levelMaxed = false; this.levelMaxTime = 0; this.runTime = 0; this.levelPulse = 0; this.maxLevelBanner = 0; this.challengeSurgeShown = false; this.friendMood = 'idle'; this.friendMoodTimer = 0;
      this.time = 0; this.particles.length = 0; this.transitionTimer = 0; this.stageBanner = 1.5; this.fieldClearTimer = 0; this.fieldClearStage = 0;
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
      const grabWidth = Math.min(150 + this.plant.assist * 90, this.w * (.25 + this.plant.assist * .1));
      if (Math.abs(p.x - baseX) > grabWidth || p.y < tipY - 112 - this.plant.assist * 35 || p.y > this.h * (.73 + this.plant.assist * .04)) {
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
      const shouldResolve = this.state === 'playing' && this.input.held && !this.plant.resolved && (this.input.power > .12 || this.plant.progress > .08);
      if (this.input.held && this.input.power > .35) this.sound.release();
      if (shouldResolve) this.releaseHarvest();
      this.input.held = false; this.input.pointerId = null; this.canvas.classList.remove('grabbing');
      if (this.state === 'playing') this.updateUI();
    }
    lessonData() {
      return FIRST_PLAY_LESSONS[this.plant?.lesson || 0] || null;
    }
    effectiveBand(p) {
      return p.band * (1 + p.assist * .78);
    }
    angleTolerance(p) {
      return .72 + p.assist * .46;
    }
    assistedPower(power, target, p) {
      return this.input.held ? lerp(power, target, p.assist * .66) : power;
    }
    assistedAngle(angle, desired, p) {
      return this.input.held ? lerp(angle, desired, p.assist * .58) : angle;
    }
    coachSignal(p, target, desired, power, forceQ, angleQ) {
      if (!this.input.held) return { kind: 'idle', text: this.lessonData()?.short || '잡고 천천히 당겨요' };
      if (p.warningPulse > 0 || p.stress > .72 || power > p.danger) return { kind: 'danger', text: '힘 빼기!' };
      if (power < target - this.effectiveBand(p) * .55) return { kind: 'low', text: '더 위로' };
      if (power > target + this.effectiveBand(p) * .55) return { kind: 'high', text: '힘 빼기' };
      const angleError = desired - this.input.angle;
      if (angleQ < .7 && Math.abs(angleError) > .14) return { kind: angleError < 0 ? 'left' : 'right', text: angleError < 0 ? '왼쪽' : '오른쪽' };
      if (p.releaseReady || p.progress > .82) return { kind: 'ready', text: '쑤욱!' };
      if (forceQ > .72 && angleQ > .72) return { kind: 'good', text: '좋아요' };
      return { kind: 'steady', text: '유지' };
    }
    failAdvice(reason) {
      if (reason.includes('너무 세게') || reason.includes('힘이 너무')) return '힘이 빨간선 근처까지 올라갔어요. 다음엔 초록 구간 끝에서 살짝 빼세요.';
      if (reason.includes('각도') || reason.includes('반대 각도') || reason.includes('비틀')) return '줄기가 기우는 쪽과 손 방향이 어긋났어요. 화살표가 뜨면 그쪽으로 짧게 보정하세요.';
      if (reason.includes('약해') || reason.includes('미끄러')) return '마지막 힘이 부족했어요. 초록 구간 안에서 조금 더 버티면 빠져나옵니다.';
      if (reason.includes('아직')) return '마늘쫑 노출 게이지가 덜 찼어요. 조금 더 올라온 뒤 놓아보세요.';
      return '힘, 각도, 놓는 타이밍 중 하나가 흐트러졌어요. 화면의 짧은 문구를 따라 다시 잡아보세요.';
    }
    softCoach(text, type = '') {
      const p = this.plant;
      p.warningPulse = 1;
      p.feedback = text;
      p.stress = Math.min(p.stress, .64);
      p.tremor = Math.min(1, p.tremor + .35);
      this.warningCooldown = .45;
      this.shake = Math.max(this.shake, type === 'bad' ? 4 : 2.4);
      this.sound.warning();
      if (navigator.vibrate) navigator.vibrate(type === 'bad' ? 35 : 18);
      this.toast(text, type);
      this.updateUI();
    }
    releaseHarvest() {
      const p = this.plant;
      if (p.resolved) return;
      const target = p.targetForce(this.time);
      const desired = p.targetAngle(this.time);
      const power = this.input.power;
      const judgedPower = this.assistedPower(power, target, p);
      const judgedAngle = this.assistedAngle(this.input.angle, desired, p);
      const forceQ = clamp(1 - Math.abs(judgedPower - target) / this.effectiveBand(p));
      const angleQ = clamp(1 - Math.abs(judgedAngle - desired) / this.angleTolerance(p));
      const quality = forceQ * (.35 + .65 * angleQ);
      const releaseMin = Math.max(.18, RELEASE_HARVEST_MIN - p.assist * .24);
      const releaseThreshold = Math.max(.24, .42 - p.assist * .2);
      p.releaseQuality = quality;

      if (p.lesson === 1 && (p.progress > .06 || power > .18)) {
        p.progress = Math.max(p.progress, .9);
        p.releaseQuality = Math.max(quality, .72);
        this.succeed();
      } else if (p.lesson === 1) {
        this.softCoach('손 아이콘처럼 위로 쭉!', '');
      } else if (p.progress >= AUTO_HARVEST_PROGRESS) {
        this.succeed();
      } else if (p.progress < releaseMin) {
        if (p.graceWarnings > 0 && p.assist > 0) {
          p.graceWarnings--;
          this.softCoach('조금 더 올라온 뒤 놓아보세요', '');
        } else this.fail(`아직 ${formatCm(p.progress * p.lengthCm)}밖에 안 빠졌어요 · 조금 더 풀어낸 뒤 놓으세요`);
      } else if (power > p.danger + .035 || p.stress > .92) {
        if (p.graceWarnings > 0 && p.assist > 0) {
          p.graceWarnings--;
          this.softCoach('위험! 놓기 전 힘을 살짝 빼세요', 'bad');
        } else this.fail('놓는 순간 힘이 너무 세서 마늘쫑이 끊어졌어요');
      } else if (quality < releaseThreshold) {
        if (p.graceWarnings > 0 && p.assist > 0) {
          p.graceWarnings--;
          this.softCoach(angleQ < .45 ? '화살표 방향으로 조금만 맞춰요' : '초록 힘 구간에 바늘을 맞춰요', '');
        } else if (angleQ < .45) this.fail('마지막 각도가 틀어져 잎대 안에서 걸렸어요');
        else if (power < target - this.effectiveBand(p)) this.fail('마지막 힘이 약해 다시 안쪽으로 미끄러졌어요');
        else this.fail('마지막 힘이 거칠어 마늘쫑이 상했어요');
      } else {
        this.succeed();
      }
    }
    showTutorial(step) {
      this.tutorialStep = step;
      const data = FIRST_PLAY_LESSONS[step + 1] || FIRST_PLAY_LESSONS[1];
      $('tutorial-step').textContent = `${step + 1} / 3`;
      $('tutorial-title').textContent = data.title; $('tutorial-copy').textContent = data.copy;
      $('tutorial').classList.remove('hidden');
    }
    finishTutorial() {
      this.tutorialDone = true; localStorage.setItem('garlic-tutorial', '1'); this.hideTutorial();
    }
    hideTutorial() { this.tutorialStep = -1; $('tutorial').classList.add('hidden'); }
    updateTutorial() {
      if (this.tutorialDone) return;
      if (this.stage === 1 && this.plantNo <= 3) {
        const step = this.plantNo - 1;
        if (this.tutorialStep !== step) this.showTutorial(step);
      } else this.finishTutorial();
    }
    nextPlant() {
      const clearedStage = this.stage;
      this.plantNo++;
      if (this.plantNo > PLANTS_PER_STAGE) {
        if (this.stage >= MAX_STAGE) {
          this.completed = true;
          this.gameOver();
          return;
        }
        this.stage++; this.plantNo = 1; this.stageBanner = 1.8; this.fieldClearTimer = FIELD_CLEAR_DURATION; this.fieldClearStage = clearedStage; this.lives = Math.min(MAX_LIVES, this.lives + 1);
        this.sound.stage(); this.toast(`밭 ${clearedStage} 클리어 · 다음 밭!`, 'good');
        this.burst(this.w / 2, this.h * .42, 'perfect', 24);
        this.burst(this.w * .28, this.h * .64, 'success', 12);
        this.burst(this.w * .72, this.h * .64, 'success', 12);
      }
      this.plant = new Plant(this.stage, this.plantNo - 1, this.rng);
      this.input.power = 0; this.input.angle *= .25; this.input.held = false;
      if (!this.tutorialDone) this.updateTutorial();
      this.transitionTimer = 0; this.slow = 1; this.updateUI();
    }
    update(dt) {
      this.time += dt;
      if (this.state === 'playing') this.runTime += dt;
      this.messageTimer = Math.max(0, this.messageTimer - dt);
      this.warningCooldown = Math.max(0, this.warningCooldown - dt);
      this.flash = Math.max(0, this.flash - dt * 2.4);
      this.shake = Math.max(0, this.shake - dt * 24);
      this.stageBanner = Math.max(0, this.stageBanner - dt);
      this.fieldClearTimer = Math.max(0, this.fieldClearTimer - dt);
      this.levelPulse = Math.max(0, this.levelPulse - dt * 2.6);
      this.maxLevelBanner = Math.max(0, this.maxLevelBanner - dt);
      this.friendMoodTimer = Math.max(0, this.friendMoodTimer - dt);
      if (this.friendMoodTimer <= 0 && this.friendMood !== 'max') this.friendMood = 'idle';
      if (this.state !== 'playing') return;
      if (!this.levelMaxed && this.runTime > 50 && this.level >= 8) {
        if (!this.challengeSurgeShown) {
          this.challengeSurgeShown = true;
          this.friendMood = 'good';
          this.friendMoodTimer = 1.6;
          this.toast('WEMADE PLAY 응원 타임 · 마지막 스퍼트!', 'good');
        }
        this.awardLevelXp((this.level >= 9 ? 45 : 26) * dt, 'good');
      }
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
        if (this.transitionTimer > (p.failReason ? FAIL_ADVANCE_DELAY : SUCCESS_ADVANCE_DELAY)) {
          if (this.lives <= 0) this.gameOver(); else this.nextPlant();
        }
        this.updateUI(); return;
      }

      p.activeTime += dt;
      const target = p.targetForce(this.time);
      const desired = p.targetAngle(this.time);
      const power = this.input.held ? this.input.power : 0;
      const effectiveBand = this.effectiveBand(p);
      const judgedPower = this.assistedPower(power, target, p);
      const judgedAngle = this.assistedAngle(this.input.angle, desired, p);
      const forceDelta = Math.abs(judgedPower - target);
      const forceQ = clamp(1 - forceDelta / effectiveBand);
      const angleQ = clamp(1 - Math.abs(judgedAngle - desired) / this.angleTolerance(p));
      const quality = forceQ * (.35 + .65 * angleQ);
      const inZone = this.input.held && forceQ > 0 && angleQ > .34;
      const signal = this.coachSignal(p, target, desired, power, forceQ, angleQ);
      p.signalKind = signal.kind;
      p.signalText = signal.text;

      if (inZone) {
        const lessonBoost = p.lesson === 1 ? .11 : p.lesson === 2 ? .045 : p.lesson === 3 ? .02 : 0;
        const gain = (.085 + .115 * quality + lessonBoost) * CHALLENGE_PULL_SPEED * (1 + Math.min(this.stage, 10) * .012);
        const previousStep = Math.floor(p.progress * 8);
        p.progress = clamp(p.progress + gain * dt, 0, AUTO_HARVEST_PROGRESS);
        const currentStep = Math.floor(p.progress * 8);
        if (currentStep > previousStep && currentStep < 8) {
          p.slipPulse = 1; this.shake = Math.max(this.shake, 1.7);
          this.burst(this.w / 2, this.h * .54, 'fiber', 4);
        }
        p.accuracySum += quality * dt; p.accuracyTime += dt;
        const angleError = desired - this.input.angle;
        p.releaseReady = p.progress >= RELEASE_HARVEST_MIN - p.assist * .2 && p.progress < AUTO_HARVEST_PROGRESS && quality > .48 - p.assist * .12;
        if (p.lesson === 1) p.feedback = p.progress > .88 ? '좋아요 · 놓아도 쑤욱!' : '그대로 위로 쭉!';
        else if (p.lesson === 2) p.feedback = quality > .7 ? '초록 힘 딱 좋아요!' : power > target ? '살짝만 힘 빼기' : '조금 더 위로';
        else if (p.lesson === 3) p.feedback = angleQ < .72 ? (angleError < 0 ? '← 저항 따라 왼쪽' : '저항 따라 오른쪽 →') : '흔들림 대응 좋아요!';
        else p.feedback = p.progress > .96 ? '끝까지 올라왔어요 · 쑤욱!' : p.releaseReady ? '덜 뽑혔지만 지금 놓아도 돼요' : quality > .78 ? '맞았어요 · 그대로 유지!' : angleQ < .62 ? (angleError < 0 ? '← 지금 왼쪽으로' : '지금 오른쪽으로 →') : '힘을 미세하게 맞춰요';
        this.sound.tension(quality);
        if (!p.lastZone && quality > .55) this.burst(this.w / 2, this.h * .665, 'soil', 5);
      } else if (this.input.held && power > .08) {
        const angleError = desired - this.input.angle;
        if (p.lesson === 1) p.feedback = '괜찮아요 · 위로 조금 더';
        else if (power < target - effectiveBand) p.feedback = '힘이 부족해요 · 더 위로';
        else if (power > target + effectiveBand) p.feedback = '너무 세요! 힘을 빼세요';
        else p.feedback = angleError < 0 ? '← 지금 왼쪽으로' : '지금 오른쪽으로 →';
        p.releaseReady = false;
        p.progress = Math.max(0, p.progress - dt * (.009 * (1 - p.assist * .55)));
      } else {
        p.releaseReady = false;
        p.feedback = this.lessonData()?.short || (p.stress > .16 ? '쉬는 중 · 위험이 내려가요' : '잡고 천천히 당겨요');
        p.progress = Math.max(0, p.progress - dt * .005);
      }

      let stressGain = 0;
      if (this.input.held && power > target + effectiveBand) stressGain += .23 + (power - target - effectiveBand) * 1.65;
      if (this.input.held && power > .25 && angleQ < .3) stressGain += (.3 - angleQ) * .42;
      if (power > p.danger) stressGain += (power - p.danger) * 1.15;
      stressGain *= (1 - p.assist * .62);
      if (stressGain > 0) {
        p.stress = clamp(p.stress + stressGain * dt);
        p.tremor = Math.min(1, p.tremor + dt * 3);
        if (p.stress > .63 && this.warningCooldown <= 0) {
          p.warningPulse = Math.max(p.warningPulse, .55);
          this.sound.warning(); this.warningCooldown = .48; this.shake = Math.max(this.shake, 2.3);
          if (navigator.vibrate) navigator.vibrate(25);
        }
      } else {
        const recovery = power < target - .04 ? .29 : .075;
        p.stress = Math.max(0, p.stress - (recovery + p.assist * .18) * dt);
        p.tremor = Math.max(0, p.tremor - dt * 2.5);
      }
      p.peakStress = Math.max(p.peakStress, p.stress);
      p.slipPulse = Math.max(0, (p.slipPulse || 0) - dt * 5.5);
      p.warningPulse = Math.max(0, (p.warningPulse || 0) - dt * 2.3);
      if (!p.resolved && p.progress > .78) {
        p.nearPullPulse = Math.min(1, p.nearPullPulse + dt * 2.8);
        if (!p.nearAnnounced && p.progress > .84) {
          p.nearAnnounced = true;
          this.shake = Math.max(this.shake, 3);
          this.burst(this.w / 2, this.h * .51, 'fiber', 12);
        }
      } else p.nearPullPulse = Math.max(0, p.nearPullPulse - dt * 3);
      p.lastZone = inZone;

      if (p.stress >= 1) {
        if (p.graceWarnings > 0) {
          p.graceWarnings--;
          this.softCoach(power > p.danger ? '위험! 힘을 빼면 살릴 수 있어요' : '위험! 화살표 방향으로 돌려요', 'bad');
        } else this.fail(power > p.danger ? '너무 세게 당겨 마늘쫑이 끊어졌어요' : '반대 각도로 비틀어 잎대 안에서 걸렸어요');
      }
      else if (p.progress >= AUTO_HARVEST_PROGRESS) { p.releaseQuality = quality; this.succeed(); }
      this.updateUI(target);
    }
    succeed() {
      const p = this.plant; if (p.resolved) return;
      const accuracy = p.accuracyTime ? p.accuracySum / p.accuracyTime : 0;
      const finishQuality = p.releaseQuality || accuracy;
      const handling = clamp(accuracy * .54 + finishQuality * .46);
      const speedBonus = clamp(1 - (p.activeTime - 5) / 14);
      p.perfect = handling > .8 && p.peakStress < .5 && p.activeTime < 13 && p.progress > .88;
      this.combo++;
      this.maxCombo = Math.max(this.maxCombo, this.combo); this.harvested++;
      if (p.perfect) this.perfectCount++;
      const comboCm = Math.min(this.combo - 1, 12) * .35;
      const usableLength = p.lengthCm * (.82 + handling * .18);
      const finishCm = speedBonus * 1.1 + (p.perfect ? 3.2 : 0);
      p.cm = Math.round((usableLength * p.type.cmBonus + comboCm + finishCm) * 10) / 10;
      this.score = Math.round((this.score + p.cm) * 10) / 10; p.resolved = true; p.outcomeTime = 0;
      this.input.held = false; this.canvas.classList.remove('grabbing');
      const streakPop = this.combo > 0 && this.combo % 4 === 0;
      this.shake = p.perfect ? 18 : streakPop ? 13 : 9; this.flash = p.perfect ? 1.15 : 1; this.slow = p.perfect ? .18 : .25;
      this.sound.success(p.perfect);
      if (navigator.vibrate) navigator.vibrate(p.perfect ? [25, 25, 70] : [20, 20, 45]);
      this.burst(this.w / 2, this.h * .59, p.perfect ? 'perfect' : 'success', p.perfect ? 76 : streakPop ? 48 : 36);
      if (streakPop) this.burst(this.w / 2, this.h * .34, 'perfect', 18);
      this.popScore(`${p.perfect ? '완벽 뽑기! ' : streakPop ? `${this.combo}콤보 쑤욱! ` : '쑤욱! '}+${formatCm(p.cm)}`);
      this.toast(p.perfect ? '손맛 최고! 온전한 한 줄기' : streakPop ? `${this.combo}연속 수확! 감 잡았어요` : `${p.type.name} 수확!`, 'good');
      this.friendMood = p.perfect || streakPop ? 'max' : 'good'; this.friendMoodTimer = p.perfect || streakPop ? 1.9 : 1.25;
      this.awardLevelXp(this.successLevelXp(p, handling, speedBonus), p.perfect ? 'max' : 'good');
      this.saveBest(); this.updateUI();
    }
    fail(reason) {
      const p = this.plant; if (p.resolved) return;
      const xp = this.failLevelXp(p);
      p.failReason = reason; p.failTip = this.failAdvice(reason); p.resolved = true; p.outcomeTime = 0; this.lives--; this.combo = 0;
      this.lastFailReason = reason; this.lastFailTip = p.failTip;
      this.input.held = false; this.canvas.classList.remove('grabbing'); this.shake = 8;
      this.sound.fail(); if (navigator.vibrate) navigator.vibrate(60);
      this.burst(this.w / 2, this.h * .47, 'fail', 25);
      this.friendMood = 'fail'; this.friendMoodTimer = 1.5;
      this.awardLevelXp(xp, 'fail');
      this.toast(reason, 'bad'); this.updateUI();
    }
    masteryGrade() {
      const perfectRate = this.harvested ? this.perfectCount / this.harvested : 0;
      if (this.levelMaxed && perfectRate >= .45 && this.maxCombo >= 8) return '마늘쫑 장인';
      if (this.levelMaxed) return 'Lv.10 농부';
      if (this.completed && perfectRate >= .55 && this.maxCombo >= 10) return '쑥 장인';
      if (this.completed) return '완주 농부';
      if (this.stage >= 4 || this.maxCombo >= 8) return '숙련 농부';
      if (this.harvested >= 6 || this.maxCombo >= 4) return '감 잡은 농부';
      return '새싹 농부';
    }
    nextGoalText(isNewBest) {
      if (this.levelMaxed && !this.completed) return `만렙 이후 목표: 남은 밭을 완주하며 ${formatCm(Math.max(this.best, this.score) + 20)} 이상 수확하기.`;
      if (!this.levelMaxed) return `다음 목표: 60초 안에 Lv.${MAX_LEVEL} 마늘쫑 장인 달성하기. 지금은 Lv.${this.level}/${MAX_LEVEL}!`;
      if (this.completed && this.perfectCount < Math.ceil(this.harvested * .5)) return '다음 목표: 만렙 완주 유지하면서 완벽 뽑기 비율 50% 넘기기.';
      if (this.completed && this.maxCombo < PLANTS_PER_STAGE * MAX_STAGE) return `다음 목표: 끊기지 않고 ${PLANTS_PER_STAGE * MAX_STAGE}연속 콤보 완주하기.`;
      if (this.completed) return isNewBest ? '월드 랭킹용 기록감이에요. 이제 완벽 수확 수로 자기 자신과 싸워볼 차례!' : `만렙 이후 목표: 최고 cm, 완벽 수확, ${PLANTS_PER_STAGE * MAX_STAGE}콤보를 동시에 노려보세요.`;
      if (this.lastFailTip) return `다음 목표: ${this.lastFailTip}`;
      return `다음 목표: 밭 ${Math.min(MAX_STAGE, this.stage + 1)}까지 안정적으로 가기. 초록 구간에서 버티는 시간이 실력입니다.`;
    }
    gameOver() {
      const isNewBest = this.score > this.best;
      this.state = 'gameover'; this.saveBest(); this.saveBestStats(); this.saveRunToRanking(); this.hideTutorial();
      $('result-title').textContent = this.levelMaxed ? '마늘쫑 장인 달성!' : this.completed ? `${MAX_STAGE}개 밭 완주!` : isNewBest && this.score > 0 ? '새로운 최고 기록!' : '오늘 수확 끝!';
      $('final-score').textContent = formatCm(this.score);
      $('result-copy').textContent = `${this.profile?.name || '농부'}님은 ${formatTime(this.runTime)} 동안 마늘쫑 ${this.harvested}줄기를 ${formatCm(this.score)} 수확해 Lv.${this.level}/${MAX_LEVEL}, 밭 ${this.stage}/${MAX_STAGE}까지 도착했습니다.`;
      $('result-stats').innerHTML = [
        `<span>도달 레벨<strong>${this.levelMaxed ? 'MAX' : `Lv.${this.level}`}</strong></span>`,
        `<span>챌린지 시간<strong>${this.levelMaxed ? formatTime(this.levelMaxTime) : formatTime(this.runTime)}</strong></span>`,
        `<span>완벽 수확<strong>${this.perfectCount}줄</strong></span>`,
        `<span>최대 콤보<strong>x${this.maxCombo}</strong></span>`
      ].join('');
      $('result-event-badge').textContent = this.levelMaxed ? 'WEMADE PLAY FARM CHALLENGE · MAX LEVEL' : 'WEMADE PLAY FARM CHALLENGE';
      $('result-goal').textContent = this.nextGoalText(isNewBest);
      $('result-eyebrow').textContent = `최고 기록 ${formatCm(this.best)}`;
      this.resultPlayerTitle = this.calculateResultTitle();
      this.renderResultPlayerTitle();
      $('result-share-button').textContent = '슬랙으로 내 성과 공유하기';
      this.renderResultRanking();
      $('result-card').classList.remove('hidden'); $('start-card').classList.add('hidden');
      $('overlay').classList.add('visible'); $('meter-panel').classList.add('hidden-panel');
    }
    saveBest() {
      if (this.score > this.best) { this.best = this.score; localStorage.setItem('garlic-best', String(this.best)); }
      $('best-score').textContent = formatCm(this.best);
    }
    saveBestStats() {
      if (this.maxCombo > this.bestCombo) { this.bestCombo = this.maxCombo; localStorage.setItem('garlic-best-combo', String(this.bestCombo)); }
      if (this.perfectCount > this.bestPerfect) { this.bestPerfect = this.perfectCount; localStorage.setItem('garlic-best-perfect', String(this.bestPerfect)); }
    }
    burst(x, y, kind, count) {
      const presets = {
        soil: { vx: [-90,90], vy: [-100,-30], life: [.25,.55], size: [2,5], colors: ['#8a5432','#a96d3e','#d39755'], gravity: 360 },
        fiber: { vx: [-75,75], vy: [-80,-20], life: [.18,.4], size: [1,3], colors: ['#e8f2b7','#c9df85','#f7f1cb'], gravity: 190 },
        success: { vx: [-250,250], vy: [-360,-80], life: [.55,1.1], size: [3,9], colors: ['#f7d45d','#fff3a5','#69b650','#ffffff'], gravity: 420, shape: 'leaf' },
        perfect: { vx: [-330,330], vy: [-470,-100], life: [.7,1.4], size: [4,11], colors: ['#ffe25c','#fffbd0','#7be071','#ffffff','#f39e51'], gravity: 400, shape: 'star' },
        level: { vx: [-290,290], vy: [-390,-70], life: [.55,1.15], size: [3,10], colors: ['#fff16c','#ffcf53','#7edc67','#ffffff','#77b8ff'], gravity: 360, shape: 'star' },
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
      $('stage-label').textContent = `밭 ${this.stage}/${MAX_STAGE}`;
      $('plant-label').textContent = `${this.plantNo} / ${PLANTS_PER_STAGE}${p.key === 'golden' ? ' · 황금!' : ''}`;
      $('lives').textContent = `${'● '.repeat(this.lives)}${'○ '.repeat(Math.max(0, MAX_LIVES - this.lives))}`.trim();
      $('score').textContent = formatCm(this.score);
      $('hud-player').textContent = this.profile ? `· ${this.profile.name}` : '';
      $('level-label').textContent = this.levelMaxed ? `MAX Lv.${MAX_LEVEL}` : `Lv.${this.level} / ${MAX_LEVEL}`;
      $('timer-label').textContent = this.levelMaxed ? `${formatTime(this.levelMaxTime)} 달성` : `남은 ${Math.max(0, Math.ceil(CHALLENGE_SECONDS - this.runTime))}초`;
      $('xp-fill').style.width = `${this.levelProgress() * 100}%`;
      $('level-wrap').classList.toggle('maxed', this.levelMaxed);
      $('level-wrap').classList.toggle('rush', !this.levelMaxed && this.runTime > 45);
      $('combo').textContent = `x${this.combo + 1}`; $('combo').classList.toggle('active', this.combo > 0);
      $('action-hint').textContent = p.resolved ? (p.failReason ? '다음 마늘쫑 준비 중…' : '기분 좋게 쑤욱!') : p.feedback;
      $('meter-panel').classList.toggle('lesson-mode', Boolean(p.lesson && !p.resolved));
      $('meter-panel').classList.toggle('warning-mode', Boolean(!p.resolved && (p.warningPulse > 0 || p.stress > .62)));
      const band = this.effectiveBand(p);
      const lower = clamp(target - band); const width = clamp(band * 2, 0, 1 - lower);
      $('safe-band').style.left = `${lower * 100}%`; $('safe-band').style.width = `${width * 100}%`;
      $('danger-line').style.left = `${p.danger * 100}%`;
      const power = this.input.held ? this.input.power : 0;
      $('power-fill').style.width = `${power * 100}%`; $('power-needle').style.left = `${power * 100}%`;
      $('progress-fill').style.width = `${p.progress * 100}%`; $('stress-fill').style.width = `${p.stress * 100}%`;
    }
    stageTheme() {
      const progress = MAX_STAGE <= 1 ? 0 : (this.stage - 1) / (MAX_STAGE - 1);
      const index = Math.min(STAGE_THEMES.length - 1, Math.max(0, Math.round(progress * (STAGE_THEMES.length - 1))));
      return STAGE_THEMES[index];
    }
    drawBackground(ctx) {
      const w = this.w, h = this.h, ground = h * .66;
      const theme = this.stageTheme();
      const sky = ctx.createLinearGradient(0, 0, 0, ground);
      sky.addColorStop(0, theme.skyTop); sky.addColorStop(1, theme.skyBottom);
      ctx.fillStyle = sky; ctx.fillRect(0, 0, w, ground);
      ctx.fillStyle = theme.sun;
      const sunX = w * .82, sunY = h * .15;
      ctx.beginPath(); ctx.arc(sunX, sunY, Math.min(47, w * .06), 0, Math.PI * 2); ctx.fill();
      if (this.stage >= MAX_STAGE) {
        ctx.save(); ctx.globalAlpha = .3; ctx.strokeStyle = '#fffbe0'; ctx.lineWidth = 2;
        for (let i = 0; i < 9; i++) {
          const sx = (i * 97 + 33) % w, sy = h * (.12 + (i % 4) * .07);
          ctx.beginPath(); ctx.arc(sx, sy, 1.5 + (i % 3), 0, Math.PI * 2); ctx.stroke();
        }
        ctx.restore();
      }
      this.cloud(ctx, w * .18 + Math.sin(this.time * .07) * 20, h * .18, Math.min(1, w / 700), theme.cloud);
      this.cloud(ctx, w * .64 + Math.sin(this.time * .05 + 2) * 14, h * .28, .65, theme.cloud);
      ctx.fillStyle = theme.hillA;
      ctx.beginPath(); ctx.moveTo(0, ground); ctx.quadraticCurveTo(w * .2, ground - 115, w * .44, ground); ctx.quadraticCurveTo(w * .72, ground - 145, w, ground - 15); ctx.lineTo(w, ground); ctx.fill();
      ctx.fillStyle = theme.hillB;
      ctx.beginPath(); ctx.moveTo(0, ground); ctx.quadraticCurveTo(w * .3, ground - 68, w * .55, ground); ctx.quadraticCurveTo(w * .78, ground - 90, w, ground - 35); ctx.lineTo(w, ground); ctx.fill();
      this.drawWemadePlayCampus(ctx, theme, ground);
      this.drawStageProps(ctx, theme, ground);
      // Distant crops
      for (let i = 0; i < 11; i++) {
        const x = (i + .35) / 11 * w, y = ground - 12 - (i % 2) * 7;
        ctx.strokeStyle = theme.crop; ctx.lineWidth = 3;
        ctx.beginPath(); ctx.moveTo(x, ground + 2); ctx.quadraticCurveTo(x - 5, y, x - 11, y - 11); ctx.moveTo(x, ground + 2); ctx.quadraticCurveTo(x + 4, y, x + 10, y - 15); ctx.stroke();
      }
      const soil = ctx.createLinearGradient(0, ground, 0, h);
      soil.addColorStop(0, theme.soilA); soil.addColorStop(.2, theme.soilB); soil.addColorStop(1, theme.soilC);
      ctx.fillStyle = soil; ctx.fillRect(0, ground, w, h - ground);
      ctx.fillStyle = theme.ridge;
      ctx.beginPath(); ctx.moveTo(0, ground); for (let x = 0; x <= w; x += 25) ctx.lineTo(x, ground + Math.sin(x * .08) * 4); ctx.lineTo(w, ground + 18); ctx.lineTo(0, ground + 18); ctx.fill();
      ctx.globalAlpha = .2; ctx.strokeStyle = theme.ridge; ctx.lineWidth = 2;
      for (let y = ground + 55; y < h; y += 47) { ctx.beginPath(); ctx.moveTo(0, y); ctx.bezierCurveTo(w * .3, y - 18, w * .65, y + 18, w, y - 3); ctx.stroke(); }
      ctx.globalAlpha = 1;
    }
    drawWemadePlayCampus(ctx, theme, ground) {
      const w = this.w, h = this.h;
      const totalPlants = PLANTS_PER_STAGE * MAX_STAGE;
      const growth = clamp((this.harvested || 0) / totalPlants, 0, 1);
      const baseScale = clamp(w / 820, .62, 1);
      const scale = baseScale * lerp(.72, 1.28, growth);
      const hillSeat = Math.min(74, h * .095);
      const x = Math.min(w - 104 * scale, w * .86);
      const y = ground - hillSeat - 136 * scale;
      const columns = clamp((growth - .3) / .3, 0, 1);
      const grandeur = clamp((growth - .55) / .3, 0, 1);
      const opulence = clamp((growth - .8) / .2, 0, 1);
      ctx.save();
      ctx.globalAlpha = lerp(w < 520 ? .48 : .66, w < 520 ? .82 : 1, growth);
      ctx.translate(x, y);
      ctx.scale(scale, scale);

      ctx.fillStyle = 'rgba(70, 96, 98, .18)';
      ctx.beginPath(); ctx.ellipse(8, 118, 118, 16, 0, 0, Math.PI * 2); ctx.fill();

      const buildingImage = this.visualAssets.building(growth);
      if (this.visualAssets.ready(buildingImage)) {
        ctx.drawImage(buildingImage, -96, -22, 192, 158);
        ctx.restore();
        return;
      }

      if (grandeur > 0) {
        ctx.fillStyle = `rgba(${Math.round(lerp(60, 210, grandeur))}, ${Math.round(lerp(70, 165, grandeur))}, ${Math.round(lerp(70, 90, grandeur))}, ${lerp(0, .45, grandeur)})`;
        ctx.beginPath(); ctx.ellipse(-84, 112, 12, lerp(2, 12, grandeur), 0, 0, Math.PI * 2); ctx.fill();
        ctx.beginPath(); ctx.ellipse(84, 112, 12, lerp(2, 12, grandeur), 0, 0, Math.PI * 2); ctx.fill();
      }

      ctx.fillStyle = mixRgb(growth, [82, 111, 112], [231, 217, 189]);
      ctx.strokeStyle = mixRgb(growth, [255, 250, 220], [201, 158, 74]);
      ctx.lineWidth = lerp(2, 3, growth);
      ctx.beginPath(); ctx.roundRect(-58, 20, 116, 96, 10); ctx.fill(); ctx.stroke();

      if (grandeur > 0) {
        ctx.fillStyle = mixRgb(grandeur, [190, 190, 190], [225, 176, 74]);
        ctx.beginPath(); ctx.roundRect(-64, 14 - grandeur * 4, 128, 8, 4); ctx.fill();
      }

      const litWindows = Math.round(lerp(2, 12, growth));
      let windowIndex = 0;
      for (let row = 0; row < 3; row++) {
        for (let col = 0; col < 4; col++) {
          const lit = windowIndex++ < litWindows;
          ctx.fillStyle = lit ? mixRgb(growth, [255, 241, 170], [255, 214, 120]) : 'rgba(150, 170, 172, .4)';
          ctx.beginPath(); ctx.roundRect(-42 + col * 27, 36 + row * 20, 14, 10, 3); ctx.fill();
          if (lit && grandeur > .5) { ctx.strokeStyle = 'rgba(201, 158, 74, .6)'; ctx.lineWidth = 1; ctx.stroke(); }
        }
      }

      if (columns > 0) {
        ctx.fillStyle = mixRgb(columns, [140, 148, 150], [246, 240, 224]);
        ctx.strokeStyle = mixRgb(columns, [110, 118, 120], [201, 158, 74]);
        ctx.lineWidth = 1.5;
        ctx.beginPath(); ctx.roundRect(-34, 92, 8, 24, 2); ctx.fill(); ctx.stroke();
        ctx.beginPath(); ctx.roundRect(26, 92, 8, 24, 2); ctx.fill(); ctx.stroke();
        ctx.fillStyle = opulence > 0 ? mixRgb(opulence, [140, 51, 46], [156, 38, 42]) : 'rgba(90, 70, 60, .5)';
        ctx.beginPath(); ctx.roundRect(-16, 98, 32, 18, [8, 8, 0, 0]); ctx.fill();
      }

      if (opulence > 0) {
        ctx.fillStyle = `rgba(178, 58, 58, ${lerp(0, .85, opulence)})`;
        ctx.beginPath(); ctx.moveTo(-9, 116); ctx.lineTo(9, 116); ctx.lineTo(15, 133); ctx.lineTo(-15, 133); ctx.fill();
      }

      ctx.fillStyle = 'rgba(255, 249, 218, .94)';
      ctx.strokeStyle = theme.sign;
      ctx.lineWidth = 2.5;
      ctx.beginPath(); ctx.roundRect(-70, -2, 140, 30, 12); ctx.fill(); ctx.stroke();
      ctx.fillStyle = '#315f38';
      ctx.textAlign = 'center';
      ctx.font = '950 13px sans-serif';
      ctx.fillText('WEMADE PLAY', 0, 18);
      ctx.fillStyle = '#f1c54f';
      ctx.beginPath(); ctx.arc(-52, 13, 5, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = '#66b95d';
      ctx.beginPath(); ctx.arc(52, 13, 5, 0, Math.PI * 2); ctx.fill();

      if (grandeur > 0) {
        ctx.fillStyle = `rgba(225, 184, 74, ${lerp(0, 1, grandeur)})`;
        ctx.beginPath(); ctx.arc(-70, -2, lerp(0, 4.5, grandeur), 0, Math.PI * 2); ctx.fill();
        ctx.beginPath(); ctx.arc(70, -2, lerp(0, 4.5, grandeur), 0, Math.PI * 2); ctx.fill();
      }

      if (growth >= 1) {
        ctx.strokeStyle = '#8a6a2e'; ctx.lineWidth = 2;
        ctx.beginPath(); ctx.moveTo(0, -2); ctx.lineTo(0, -34); ctx.stroke();
        ctx.fillStyle = '#f1c54f';
        ctx.beginPath(); ctx.moveTo(0, -34); ctx.lineTo(22, -27); ctx.lineTo(0, -20); ctx.fill();
      }
      ctx.restore();
    }
    drawStageProps(ctx, theme, ground) {
      const w = this.w, h = this.h;
      ctx.save();
      ctx.fillStyle = theme.sign; ctx.strokeStyle = 'rgba(56,38,23,.45)'; ctx.lineWidth = 2;
      const signX = w * .12, signY = ground - 62;
      ctx.beginPath(); ctx.roundRect(signX - 34, signY - 18, 68, 35, 8); ctx.fill(); ctx.stroke();
      ctx.fillStyle = '#fff0bd'; ctx.textAlign = 'center'; ctx.font = '900 12px sans-serif'; ctx.fillText(theme.label, signX, signY - 1);
      ctx.strokeStyle = theme.sign; ctx.lineWidth = 5; ctx.beginPath(); ctx.moveTo(signX, signY + 16); ctx.lineTo(signX, ground + 8); ctx.stroke();

      if (theme.prop === 'flowers') {
        for (let i = 0; i < 7; i++) {
          const x = w * (.68 + i * .035), y = ground - 5 - (i % 2) * 7;
          ctx.strokeStyle = '#4f7e3f'; ctx.lineWidth = 2;
          ctx.beginPath(); ctx.moveTo(x, ground + 3); ctx.lineTo(x, y - 12); ctx.stroke();
          ctx.fillStyle = ['#ffd95a', '#f28b6a', '#f6f0a0'][i % 3];
          ctx.beginPath(); ctx.arc(x, y - 17, 6, 0, Math.PI * 2); ctx.fill();
        }
      } else if (theme.prop === 'crates') {
        for (let i = 0; i < 3; i++) {
          const x = w * .73 + i * 33, y = ground - 31 + (i % 2) * 9;
          ctx.fillStyle = '#9b6137'; ctx.strokeStyle = '#604026'; ctx.lineWidth = 2;
          ctx.beginPath(); ctx.roundRect(x, y, 42, 29, 5); ctx.fill(); ctx.stroke();
          ctx.strokeStyle = '#d69b5c'; ctx.beginPath(); ctx.moveTo(x + 7, y + 14); ctx.lineTo(x + 35, y + 14); ctx.stroke();
        }
      } else if (theme.prop === 'flags') {
        for (let i = 0; i < 5; i++) {
          const x = w * (.62 + i * .055), y = ground - 72 - (i % 2) * 16;
          ctx.strokeStyle = '#4e3b2b'; ctx.lineWidth = 3; ctx.beginPath(); ctx.moveTo(x, ground); ctx.lineTo(x, y); ctx.stroke();
          ctx.fillStyle = ['#f3d35c', '#e77b5f', '#75b86c'][i % 3];
          ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x + 26, y + 8); ctx.lineTo(x, y + 16); ctx.closePath(); ctx.fill();
        }
      } else if (theme.prop === 'festival') {
        ctx.strokeStyle = 'rgba(255,236,150,.65)'; ctx.lineWidth = 3;
        ctx.beginPath(); ctx.moveTo(w * .58, ground - 100); ctx.quadraticCurveTo(w * .74, ground - 139, w * .92, ground - 96); ctx.stroke();
        for (let i = 0; i < 6; i++) {
          const x = w * (.59 + i * .062), y = ground - 93 - Math.sin(i * .9) * 19;
          ctx.strokeStyle = '#4c3929'; ctx.lineWidth = 2; ctx.beginPath(); ctx.moveTo(x, y - 13); ctx.lineTo(x, y - 2); ctx.stroke();
          ctx.fillStyle = ['#ffe36d', '#f28b6a', '#b9e46d'][i % 3]; ctx.strokeStyle = '#6b4b2f';
          ctx.beginPath(); ctx.ellipse(x, y + 6, 8, 13, 0, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
        }
        for (let i = 0; i < 7; i++) {
          const x = w * (.66 + i * .037), y = ground - 5 - (i % 2) * 5;
          ctx.fillStyle = '#c9d46b'; ctx.beginPath(); ctx.arc(x, y - 18, 3, 0, Math.PI * 2); ctx.fill();
          ctx.strokeStyle = '#b4ca67'; ctx.lineWidth = 2;
          ctx.beginPath(); ctx.moveTo(x, y + 4); ctx.quadraticCurveTo(x + 8, y - 10, x + 16, y - 17); ctx.stroke();
        }
      } else {
        for (let i = 0; i < 6; i++) {
          const x = w * (.68 + i * .043), y = ground - 4;
          ctx.strokeStyle = '#4b823f'; ctx.lineWidth = 3;
          ctx.beginPath(); ctx.moveTo(x, y + 6); ctx.quadraticCurveTo(x - 7, y - 13, x - 16, y - 20); ctx.moveTo(x, y + 6); ctx.quadraticCurveTo(x + 6, y - 15, x + 14, y - 24); ctx.stroke();
        }
      }
      ctx.restore();
    }
    cloud(ctx, x, y, s, color = 'rgba(255,255,255,.72)') {
      ctx.save(); ctx.translate(x, y); ctx.scale(s, s); ctx.fillStyle = color;
      ctx.beginPath(); ctx.arc(-30, 5, 20, 0, Math.PI * 2); ctx.arc(0, -5, 30, 0, Math.PI * 2); ctx.arc(30, 7, 20, 0, Math.PI * 2); ctx.fill(); ctx.restore();
    }
    drawWaitingScapes(ctx) {
      if (this.state !== 'playing' && this.state !== 'gameover') return;
      const w = this.w, h = this.h, ground = h * .66;
      ctx.save();
      ctx.globalAlpha = .34;
      ctx.strokeStyle = '#fff2b9'; ctx.lineWidth = 5; ctx.lineCap = 'round';
      ctx.beginPath(); ctx.moveTo(Math.max(44, w * .08), ground + 20); ctx.quadraticCurveTo(w / 2, ground + 41, Math.min(w - 44, w * .92), ground + 20); ctx.stroke();
      ctx.globalAlpha = 1;
      const queue = [];
      for (let n = 1; n <= PLANTS_PER_STAGE; n++) {
        if (n === this.plantNo) continue;
        const relative = n - this.plantNo;
        const direction = Math.sign(relative);
        const rank = Math.abs(relative);
        const baseDistance = Math.min(w * .19, 150);
        const stepDistance = Math.min(w * .12, 86);
        const distance = baseDistance + (rank - 1) * stepDistance;
        const scaleBase = rank === 1 ? .78 : rank === 2 ? .65 : .55;
        queue.push({
          n,
          rank,
          x: clamp(w / 2 + direction * distance, 46, w - 46),
          scale: scaleBase * (w < 520 ? .88 : 1),
          status: n < this.plantNo ? 'done' : 'waiting'
        });
      }
      queue.sort((a, b) => b.rank - a.rank).forEach((slot) => this.drawWaitingScape(ctx, slot.x, ground, slot.scale, slot.n, slot.status));
      ctx.restore();
    }
    drawWaitingScape(ctx, x, ground, scale, number, status) {
      const done = status === 'done';
      const bob = Math.sin(this.time * 1.7 + number * 1.3) * (done ? 1 : 2.4);
      ctx.save();
      ctx.translate(x, ground + 7 + bob);
      ctx.scale(scale, scale);
      ctx.globalAlpha = done ? .64 : .9;

      ctx.fillStyle = 'rgba(33,27,18,.18)';
      ctx.beginPath(); ctx.ellipse(0, 10, 54, 12, 0, 0, Math.PI * 2); ctx.fill();

      const leafSway = Math.sin(this.time * 1.2 + number) * 3;
      this.garlicLeaf(ctx, -6, 6, -66 + leafSway, -83, 12, done ? '#698454' : '#558a4c');
      this.garlicLeaf(ctx, 7, 6, 66 + leafSway, -91, 12, done ? '#78905a' : '#67a158');
      this.garlicLeaf(ctx, -2, 5, -25 + leafSway, -119, 10, done ? '#6e8754' : '#73aa5e');
      this.garlicLeaf(ctx, 3, 5, 27 + leafSway, -108, 10, done ? '#7d9360' : '#80b968');

      const sheath = ctx.createLinearGradient(-17, 0, 17, 0);
      sheath.addColorStop(0, done ? '#5f7446' : '#568948');
      sheath.addColorStop(.5, done ? '#c7d89a' : '#d5e8a7');
      sheath.addColorStop(1, done ? '#536d42' : '#3d753e');
      ctx.fillStyle = sheath; ctx.strokeStyle = done ? '#50643d' : '#386d3c'; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.moveTo(-17, 9); ctx.quadraticCurveTo(-13, -26, -8, -69); ctx.quadraticCurveTo(0, -75, 8, -69); ctx.quadraticCurveTo(13, -26, 17, 9); ctx.closePath(); ctx.fill(); ctx.stroke();
      ctx.fillStyle = done ? '#725642' : '#294f31'; ctx.strokeStyle = '#e8efb4'; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.ellipse(0, -70, 9, 4, 0, 0, Math.PI * 2); ctx.fill(); ctx.stroke();

      if (done) {
        ctx.strokeStyle = '#e9efb6'; ctx.lineWidth = 5; ctx.lineCap = 'round';
        ctx.beginPath(); ctx.moveTo(-4, -74); ctx.quadraticCurveTo(4, -88, 16, -101); ctx.stroke();
        ctx.strokeStyle = '#7d5a3e'; ctx.lineWidth = 2;
        ctx.beginPath(); ctx.moveTo(-8, -79); ctx.lineTo(12, -96); ctx.stroke();
      } else {
        const side = number % 2 ? -1 : 1;
        const trace = () => {
          ctx.moveTo(0, -70);
          ctx.bezierCurveTo(4 * side, -112, 26 * side, -130, 42 * side, -112);
          ctx.bezierCurveTo(52 * side, -101, 44 * side, -85, 30 * side, -80);
        };
        ctx.lineCap = 'round';
        ctx.strokeStyle = '#205c36'; ctx.lineWidth = 9;
        ctx.beginPath(); trace(); ctx.stroke();
        const stem = ctx.createLinearGradient(0, -70, 0, -136);
        stem.addColorStop(0, '#eef6bc'); stem.addColorStop(.35, '#93cb67'); stem.addColorStop(1, '#3f8d43');
        ctx.strokeStyle = stem; ctx.lineWidth = 6;
        ctx.beginPath(); trace(); ctx.stroke();
        ctx.strokeStyle = 'rgba(255,255,226,.72)'; ctx.lineWidth = 1.3;
        ctx.beginPath(); trace(); ctx.stroke();
        ctx.save(); ctx.translate(30 * side, -80); ctx.rotate(side * .55);
        ctx.fillStyle = '#7caf50'; ctx.strokeStyle = '#285f36'; ctx.lineWidth = 1.8;
        ctx.beginPath(); ctx.moveTo(0, -15); ctx.bezierCurveTo(7, -7, 7, 8, 0, 17); ctx.bezierCurveTo(-7, 8, -7, -7, 0, -15); ctx.closePath(); ctx.fill(); ctx.stroke();
        ctx.restore();
      }

      ctx.globalAlpha = 1;
      ctx.fillStyle = done ? 'rgba(255,241,191,.9)' : 'rgba(255,250,218,.94)';
      ctx.strokeStyle = done ? '#7a6841' : '#477345'; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.roundRect(-34, 22, 68, 28, 12); ctx.fill(); ctx.stroke();
      ctx.fillStyle = done ? '#6a5a3e' : '#315e38'; ctx.textAlign = 'center'; ctx.font = '900 11px sans-serif';
      ctx.fillText(`${number}번 ${done ? '수확' : '대기'}`, 0, 40);
      ctx.restore();
    }
    drawLessonCoach(ctx, stemTopX, neckY, sheathTop) {
      const p = this.plant;
      const lesson = this.lessonData();
      if (!lesson || p.resolved) return;
      const w = this.w, h = this.h;
      const bubbleW = Math.min(250, w - 34);
      const bubbleX = clamp(stemTopX - (w < 540 ? 0 : 150), bubbleW / 2 + 12, w - bubbleW / 2 - 12);
      const bubbleY = clamp(neckY - 84, h * .15, sheathTop - 62);
      const pulse = 1 + Math.sin(this.time * 6) * .018;

      ctx.save();
      ctx.translate(bubbleX, bubbleY);
      ctx.scale(pulse, pulse);
      ctx.fillStyle = p.warningPulse > 0 ? 'rgba(255,238,213,.97)' : 'rgba(255,252,225,.96)';
      ctx.strokeStyle = p.warningPulse > 0 ? '#e46c4f' : '#5c8f49';
      ctx.lineWidth = 3;
      ctx.beginPath(); ctx.roundRect(-bubbleW / 2, -24, bubbleW, 48, 17); ctx.fill(); ctx.stroke();
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillStyle = p.warningPulse > 0 ? '#c84f3f' : '#335b35';
      ctx.font = '950 15px sans-serif';
      ctx.fillText(p.warningPulse > 0 ? '위험! 힘을 살짝 빼요' : lesson.short, 0, -2);
      ctx.restore();

      if (!this.input.held || p.lesson === 1) {
        const handTravel = (Math.sin(this.time * 3.2) + 1) * .5;
        const handX = clamp(stemTopX - (w < 540 ? 64 : 90), 46, w - 46);
        const handY = neckY + 58 - handTravel * 42;
        ctx.save();
        ctx.globalAlpha = .78 + Math.sin(this.time * 5) * .12;
        ctx.strokeStyle = '#fff5bd'; ctx.lineWidth = 5; ctx.lineCap = 'round';
        ctx.beginPath(); ctx.moveTo(handX, neckY + 68); ctx.lineTo(handX, neckY + 14); ctx.stroke();
        ctx.fillStyle = '#fff5bd'; ctx.beginPath(); ctx.moveTo(handX, neckY + 8); ctx.lineTo(handX - 9, neckY + 22); ctx.lineTo(handX + 9, neckY + 22); ctx.closePath(); ctx.fill();
        ctx.font = `${w < 500 ? 30 : 36}px "Apple Color Emoji", "Segoe UI Emoji", sans-serif`;
        ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
        ctx.fillText('☝️', handX, handY);
        ctx.fillStyle = '#fff8d5'; ctx.strokeStyle = '#375c33'; ctx.lineWidth = 4; ctx.font = '900 12px sans-serif';
        ctx.strokeText('위로 당기기', handX, neckY + 90);
        ctx.fillText('위로 당기기', handX, neckY + 90);
        ctx.restore();
      }
    }
    drawPullHandle(ctx, stemTopX, neckY, sheathTop) {
      const p = this.plant;
      if (p.resolved) return;
      const demo = p.lesson && !this.input.held;
      if (!this.input.held && !demo) return;
      const w = this.w;
      const power = this.input.held ? this.input.power : .28 + Math.sin(this.time * 3) * .04;
      const angle = this.input.held ? this.input.angle : p.targetAngle(this.time) * .35;
      const hx = clamp(stemTopX + angle * Math.min(96, w * .18), 36, w - 36);
      const hy = clamp(neckY + 74 - power * 110, this.h * .12, sheathTop + 82);
      const colors = {
        danger: ['#e35b4d', '#fff0dc'],
        high: ['#e8843d', '#fff4bf'],
        low: ['#e0ad41', '#fff7c6'],
        left: ['#5a9ed4', '#e8f7ff'],
        right: ['#5a9ed4', '#e8f7ff'],
        ready: ['#5ec95d', '#fffbd2'],
        good: ['#4fb85a', '#f4ffd5'],
        steady: ['#79a65a', '#fffbd2'],
        idle: ['#79a65a', '#fffbd2']
      };
      const [line, fill] = colors[p.signalKind] || colors.steady;
      const tension = clamp(power * .65 + p.stress * .5 + p.progress * .25);
      ctx.save();
      ctx.lineCap = 'round';
      ctx.strokeStyle = line;
      ctx.lineWidth = 4 + tension * 4;
      ctx.globalAlpha = .72 + tension * .22;
      ctx.beginPath();
      ctx.moveTo(stemTopX, neckY + 12);
      ctx.quadraticCurveTo(lerp(stemTopX, hx, .5), lerp(neckY, hy, .5) + Math.sin(this.time * 12) * tension * 4, hx, hy);
      ctx.stroke();
      ctx.globalAlpha = 1;
      ctx.fillStyle = fill; ctx.strokeStyle = line; ctx.lineWidth = 3;
      ctx.beginPath(); ctx.roundRect(hx - 34, hy - 14, 68, 28, 13); ctx.fill(); ctx.stroke();
      ctx.fillStyle = '#355135'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.font = '950 12px sans-serif';
      ctx.fillText(p.signalText || '당기기', hx, hy + 1);
      ctx.restore();
    }
    drawFailureCue(ctx, x, sheathTop, p) {
      if (!p.failReason) return;
      const t = clamp(p.outcomeTime / .35);
      const width = Math.min(330, this.w - 30);
      const y = Math.max(this.h * .16, sheathTop - 96 - easeOut(t) * 10);
      ctx.save();
      ctx.globalAlpha = clamp(t);
      ctx.fillStyle = 'rgba(255,242,219,.96)';
      ctx.strokeStyle = '#d96a52'; ctx.lineWidth = 3;
      ctx.beginPath(); ctx.roundRect(this.w / 2 - width / 2, y - 34, width, 68, 19); ctx.fill(); ctx.stroke();
      ctx.fillStyle = '#bd493d'; ctx.textAlign = 'center'; ctx.font = '950 14px sans-serif';
      const title = p.failReason.includes('세게') ? '힘이 너무 셌어요' : p.failReason.includes('각도') || p.failReason.includes('비틀') ? '각도가 틀어졌어요' : p.failReason.includes('아직') ? '아직 덜 빠졌어요' : '흐름이 끊겼어요';
      ctx.fillText(title, this.w / 2, y - 9);
      ctx.fillStyle = '#5f5b49'; ctx.font = '800 11px sans-serif';
      ctx.fillText(p.failTip.slice(0, 34), this.w / 2, y + 14);
      ctx.restore();
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
      const stalkW = 13 * p.type.width;
      const traceScape = () => {
        ctx.moveTo(x + bend * .06, visibleBottom);
        ctx.bezierCurveTo(x + bend * .16, lerp(visibleBottom, neckY, .38), x + bend * .76, neckY + 78, stemTopX, neckY);
        ctx.bezierCurveTo(stemTopX + curlSide * 2, topY + 2, stemTopX + curlSide * 46, topY - 8, budX, budY);
      };
      ctx.save();
      ctx.translate(x + flyX, sheathTop - fly); ctx.rotate(rotation); ctx.translate(-x, -sheathTop);
      ctx.lineCap = 'round';
      ctx.shadowColor = 'rgba(16,48,24,.24)'; ctx.shadowBlur = 8; ctx.shadowOffsetY = 3;
      ctx.strokeStyle = p.type.dark; ctx.lineWidth = stalkW + 7;
      ctx.beginPath(); traceScape(); ctx.stroke();
      ctx.shadowColor = 'transparent'; ctx.shadowBlur = 0; ctx.shadowOffsetY = 0;
      const scapeGradient = ctx.createLinearGradient(0, innerBottom, 0, topY - 8);
      if (p.key === 'golden') {
        scapeGradient.addColorStop(0, '#fff2ae'); scapeGradient.addColorStop(.2, '#f3d768'); scapeGradient.addColorStop(.58, '#d8a431'); scapeGradient.addColorStop(1, '#9b6b20');
      } else {
        scapeGradient.addColorStop(0, '#eef6bc'); scapeGradient.addColorStop(.12, '#cde891'); scapeGradient.addColorStop(.3, '#79b95d'); scapeGradient.addColorStop(.58, p.type.color); scapeGradient.addColorStop(1, p.type.dark);
      }
      ctx.strokeStyle = scapeGradient; ctx.lineWidth = stalkW;
      ctx.beginPath(); traceScape(); ctx.stroke();
      ctx.strokeStyle = 'rgba(255,255,224,.74)'; ctx.lineWidth = 1.55;
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

      if (!p.resolved && p.progress > .78) {
        const a = clamp((p.progress - .78) / .2);
        ctx.save();
        ctx.globalAlpha = .28 + a * .34 + Math.sin(this.time * 17) * .08;
        ctx.strokeStyle = p.progress > .94 ? '#fff4a8' : '#e8f0b7';
        ctx.lineWidth = 4 + a * 3;
        ctx.beginPath(); ctx.ellipse(x, sheathTop + 4, 28 + a * 9, 11 + a * 4, targetA * .1, 0, Math.PI * 2); ctx.stroke();
        ctx.fillStyle = '#fff8c8'; ctx.strokeStyle = '#44643b'; ctx.lineWidth = 3;
        ctx.font = '950 13px sans-serif'; ctx.textAlign = 'center';
        ctx.strokeText(p.progress > .94 ? '거의 다!' : '버티면 빠져요', x, sheathTop - 26);
        ctx.fillText(p.progress > .94 ? '거의 다!' : '버티면 빠져요', x, sheathTop - 26);
        ctx.restore();
      }

      // Early callout teaches that the outer garlic plant remains behind.
      if (p.progress < .16 && !p.resolved) {
        const side = w < 500 ? -1 : 1;
        const labelX = x + side * Math.min(130, w * .27), labelY = sheathTop + 20;
        ctx.save(); ctx.strokeStyle = 'rgba(255,249,211,.9)'; ctx.lineWidth = 2;
        ctx.beginPath(); ctx.moveTo(x + side * 17, sheathTop - 2); ctx.lineTo(labelX - side * 52, labelY - 8); ctx.stroke();
        ctx.fillStyle = 'rgba(38,74,42,.88)'; ctx.beginPath(); ctx.roundRect(labelX - 56, labelY - 24, 112, 32, 12); ctx.fill();
        ctx.fillStyle = '#fff9d9'; ctx.textAlign = 'center'; ctx.font = '800 12px sans-serif'; ctx.fillText('마늘쫑만 쑥', labelX, labelY - 4); ctx.restore();
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
        this.drawLessonCoach(ctx, stemTopX, neckY, sheathTop);
        this.drawPullHandle(ctx, stemTopX, neckY, sheathTop);
      }
      if (p.resolved && p.failReason) this.drawFailureCue(ctx, x, sheathTop, p);
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
    drawHarvestPile(ctx) {
      if (!this.harvested) return;
      const w = this.w, h = this.h, ground = h * .66;
      const count = Math.min(this.harvested, 28);
      const x = w < 560 ? w * .18 : w * .2;
      const y = ground + Math.min(86, h * .14);
      ctx.save();
      ctx.fillStyle = 'rgba(37,28,18,.24)';
      ctx.beginPath(); ctx.ellipse(x + 8, y + 20, 82, 18, 0, 0, Math.PI * 2); ctx.fill();

      if (this.stage >= 4) {
        ctx.fillStyle = '#9b6137'; ctx.strokeStyle = '#5c3d25'; ctx.lineWidth = 2;
        ctx.beginPath(); ctx.roundRect(x - 59, y + 6, 118, 29, 8); ctx.fill(); ctx.stroke();
        ctx.strokeStyle = '#d69b5c'; ctx.lineWidth = 2;
        for (let i = -42; i <= 42; i += 28) { ctx.beginPath(); ctx.moveTo(x + i, y + 8); ctx.lineTo(x + i + 9, y + 33); ctx.stroke(); }
      }

      for (let i = 0; i < count; i++) {
        const row = Math.floor(i / 7);
        const col = i % 7;
        const ox = (col - 3) * 13 + ((row % 2) * 6);
        const oy = -row * 7 + Math.sin(i * 1.7) * 2;
        const rot = (-.45 + col * .15) + Math.sin(i * 2.1) * .08;
        const length = 58 + (i % 4) * 7;
        ctx.save(); ctx.translate(x + ox, y + oy); ctx.rotate(rot);
        ctx.lineCap = 'round';
        ctx.strokeStyle = '#1f5b36'; ctx.lineWidth = 7;
        ctx.beginPath(); ctx.moveTo(-length * .42, 0); ctx.quadraticCurveTo(-5, -14 - (i % 3) * 3, length * .38, -3); ctx.stroke();
        const g = ctx.createLinearGradient(-length * .42, 0, length * .38, -3);
        g.addColorStop(0, '#eff5c8'); g.addColorStop(.25, '#a9d57a'); g.addColorStop(1, '#3e9b4b');
        ctx.strokeStyle = g; ctx.lineWidth = 4.8;
        ctx.beginPath(); ctx.moveTo(-length * .42, 0); ctx.quadraticCurveTo(-5, -14 - (i % 3) * 3, length * .38, -3); ctx.stroke();
        ctx.fillStyle = '#5f9847'; ctx.strokeStyle = '#1f5b36'; ctx.lineWidth = 1.5;
        ctx.beginPath(); ctx.ellipse(length * .44, -4, 5.8, 11, .7, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
        ctx.restore();
      }

      ctx.fillStyle = 'rgba(255,249,215,.92)';
      ctx.strokeStyle = '#6d7040'; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.roundRect(x - 43, y - 51 - Math.min(18, count), 86, 28, 12); ctx.fill(); ctx.stroke();
      ctx.fillStyle = '#42533b'; ctx.textAlign = 'center'; ctx.font = '900 12px sans-serif';
      ctx.fillText(`수확 ${this.harvested}줄`, x, y - 33 - Math.min(18, count));
      ctx.restore();
    }
    drawFieldClear(ctx) {
      if (this.fieldClearTimer <= 0 || this.state !== 'playing') return;
      const t = 1 - this.fieldClearTimer / FIELD_CLEAR_DURATION;
      const a = Math.min(1, this.fieldClearTimer * 2.4, t * 5.5);
      const pulse = 1 + Math.sin(this.time * 9) * .025;
      const cx = this.w / 2, cy = this.h * .31;
      ctx.save();
      ctx.globalAlpha = clamp(a);
      ctx.translate(cx, cy);
      ctx.scale(pulse, pulse);

      const panelW = Math.min(390, this.w - 34);
      const panelH = 108;
      ctx.fillStyle = 'rgba(255,249,218,.95)';
      ctx.strokeStyle = '#5d7e42'; ctx.lineWidth = 4;
      ctx.beginPath(); ctx.roundRect(-panelW / 2, -panelH / 2, panelW, panelH, 25); ctx.fill(); ctx.stroke();
      ctx.fillStyle = 'rgba(103,158,74,.18)';
      ctx.beginPath(); ctx.roundRect(-panelW / 2 + 12, 6, panelW - 24, 32, 16); ctx.fill();

      ctx.textAlign = 'center';
      ctx.fillStyle = '#e17b3c'; ctx.font = `950 ${Math.min(43, this.w * .085)}px sans-serif`;
      ctx.strokeStyle = '#fff3bd'; ctx.lineWidth = 6;
      ctx.strokeText(`밭 ${this.fieldClearStage} 클리어!`, 0, -8);
      ctx.fillText(`밭 ${this.fieldClearStage} 클리어!`, 0, -8);
      ctx.fillStyle = '#42633b'; ctx.font = '900 14px sans-serif';
      ctx.fillText(`다음 밭 ${this.stage}/${MAX_STAGE} · 마늘쫑 ${PLANTS_PER_STAGE}줄기 준비`, 0, 29);

      for (let i = 0; i < MAX_STAGE; i++) {
        const x = (i - (MAX_STAGE - 1) / 2) * 28;
        ctx.fillStyle = i < this.stage - 1 ? '#6fba5a' : i === this.stage - 1 ? '#f0b34b' : '#d6d0a1';
        ctx.strokeStyle = '#546540'; ctx.lineWidth = 1.5;
        ctx.beginPath(); ctx.arc(x, 51, 6, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
      }
      ctx.restore();
    }
    drawWarningOverlay(ctx) {
      const p = this.plant;
      if (this.state !== 'playing' || !p || p.resolved || p.warningPulse <= 0) return;
      const a = clamp(p.warningPulse);
      ctx.save();
      ctx.globalAlpha = a;
      ctx.strokeStyle = 'rgba(231,82,63,.75)'; ctx.lineWidth = 8;
      ctx.strokeRect(8, 8, this.w - 16, this.h - 16);
      ctx.fillStyle = 'rgba(255,246,211,.94)';
      ctx.strokeStyle = '#db654f'; ctx.lineWidth = 3;
      const y = this.h * .2, width = Math.min(270, this.w - 28);
      ctx.beginPath(); ctx.roundRect(this.w / 2 - width / 2, y - 23, width, 46, 18); ctx.fill(); ctx.stroke();
      ctx.fillStyle = '#bd493d'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.font = '950 16px sans-serif';
      ctx.fillText('끊어지기 직전 · 힘 빼기!', this.w / 2, y);
      ctx.restore();
    }
    drawSupportFriend(ctx) {
      if (this.state !== 'playing' && this.state !== 'gameover') return;
      const w = this.w, h = this.h, ground = h * .66;
      const mood = this.levelMaxed && (this.friendMood === 'max' || this.maxLevelBanner > 0) ? 'max' : this.friendMood;
      const x = w < 560 ? w * .83 : w * .82;
      const y = ground + Math.min(78, h * .13);
      const bob = Math.sin(this.time * 3.2) * (mood === 'max' ? 5 : 2.3);
      const scale = w < 560 ? .72 : .9;
      const speech = mood === 'max' ? 'MAX 축하!'
        : mood === 'fail' ? '다시 쑥!'
          : mood === 'good' ? '좋아!'
            : this.input.held ? '천천히!' : 'PLAY!';

      ctx.save();
      ctx.translate(x, y + bob);
      ctx.scale(scale, scale);
      ctx.globalAlpha = .95;
      ctx.fillStyle = 'rgba(45,32,20,.22)';
      ctx.beginPath(); ctx.ellipse(0, 43, 58, 12, 0, 0, Math.PI * 2); ctx.fill();

      const friendImage = this.visualAssets.friend(mood);
      if (this.visualAssets.ready(friendImage)) {
        ctx.save();
        ctx.rotate(Math.sin(this.time * 5) * .045);
        ctx.drawImage(friendImage, -48, -56, 96, 108);
        ctx.restore();
      } else {
        ctx.save();
        ctx.rotate(Math.sin(this.time * 5) * .045);
        ctx.fillStyle = '#f5c45d';
        ctx.strokeStyle = '#6b4e31';
        ctx.lineWidth = 3;
        ctx.beginPath(); ctx.ellipse(0, 3, 38, 42, 0, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
        ctx.fillStyle = '#ffe79a';
        ctx.beginPath(); ctx.ellipse(0, 13, 25, 24, 0, 0, Math.PI * 2); ctx.fill();
        ctx.fillStyle = '#f5c45d';
        ctx.strokeStyle = '#6b4e31';
        ctx.beginPath(); ctx.ellipse(-25, -29, 13, 18, -.55, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
        ctx.beginPath(); ctx.ellipse(25, -29, 13, 18, .55, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
        ctx.fillStyle = '#3a3429';
        const eyeY = mood === 'fail' ? -4 : -7;
        if (mood === 'max') {
          ctx.font = '900 15px sans-serif'; ctx.textAlign = 'center'; ctx.fillText('✦', -13, eyeY); ctx.fillText('✦', 13, eyeY);
        } else {
          ctx.beginPath(); ctx.arc(-13, eyeY, 3.8, 0, Math.PI * 2); ctx.arc(13, eyeY, 3.8, 0, Math.PI * 2); ctx.fill();
        }
        ctx.strokeStyle = '#3a3429'; ctx.lineWidth = 2.2; ctx.lineCap = 'round';
        ctx.beginPath();
        if (mood === 'fail') ctx.arc(0, 16, 8, Math.PI * 1.08, Math.PI * 1.92);
        else ctx.arc(0, 8, 10, .15, Math.PI - .15);
        ctx.stroke();
        ctx.restore();
      }

      ctx.strokeStyle = '#6b4e31'; ctx.lineWidth = 3; ctx.lineCap = 'round';
      ctx.beginPath(); ctx.moveTo(28, -2); ctx.lineTo(58, -29); ctx.stroke();
      ctx.fillStyle = '#fff8d8'; ctx.strokeStyle = '#5d7e42'; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.roundRect(46, -48, 78, 28, 10); ctx.fill(); ctx.stroke();
      ctx.fillStyle = '#315f38'; ctx.textAlign = 'center'; ctx.font = '950 10px sans-serif';
      ctx.fillText('WEMADE', 85, -37);
      ctx.fillText('PLAY', 85, -27);

      ctx.fillStyle = mood === 'max' ? 'rgba(255,246,194,.97)' : 'rgba(255,250,224,.94)';
      ctx.strokeStyle = mood === 'fail' ? '#d96a52' : '#5d7e42';
      ctx.lineWidth = 2.5;
      ctx.beginPath(); ctx.roundRect(-68, -72, 102, 34, 15); ctx.fill(); ctx.stroke();
      ctx.fillStyle = mood === 'fail' ? '#bd493d' : '#315f38';
      ctx.textAlign = 'center'; ctx.font = '950 13px sans-serif';
      ctx.fillText(speech, -17, -50);
      ctx.restore();
    }
    drawMaxLevelCelebration(ctx) {
      if (this.maxLevelBanner <= 0) return;
      const t = 1 - this.maxLevelBanner / 3.1;
      const a = Math.min(1, this.maxLevelBanner * 2.2, t * 5);
      const pulse = 1 + Math.sin(this.time * 12) * .025;
      const cx = this.w / 2, cy = this.h * .32;
      ctx.save();
      ctx.globalAlpha = clamp(a);
      ctx.translate(cx, cy);
      ctx.scale(pulse, pulse);

      const panelW = Math.min(470, this.w - 28);
      const panelH = 142;
      ctx.fillStyle = 'rgba(255,248,210,.97)';
      ctx.strokeStyle = '#e0a735';
      ctx.lineWidth = 5;
      ctx.beginPath(); ctx.roundRect(-panelW / 2, -panelH / 2, panelW, panelH, 28); ctx.fill(); ctx.stroke();
      ctx.fillStyle = 'rgba(255,224,90,.22)';
      ctx.beginPath(); ctx.roundRect(-panelW / 2 + 14, 15, panelW - 28, 38, 18); ctx.fill();

      for (let i = 0; i < 9; i++) {
        const x = -panelW * .42 + i * panelW * .105;
        const y = 58 + Math.sin(this.time * 5 + i) * 6;
        ctx.strokeStyle = i % 2 ? '#5dbb58' : '#f0bb44';
        ctx.lineWidth = 5;
        ctx.lineCap = 'round';
        ctx.beginPath(); ctx.moveTo(x, y + 24); ctx.quadraticCurveTo(x + 12, y - 2, x + 30, y + 7); ctx.stroke();
      }

      ctx.textAlign = 'center';
      ctx.fillStyle = '#e17b3c';
      ctx.strokeStyle = '#fff5bd';
      ctx.lineWidth = 7;
      ctx.font = `950 ${Math.min(42, this.w * .078)}px sans-serif`;
      ctx.strokeText('마늘쫑 장인 달성!', 0, -24);
      ctx.fillText('마늘쫑 장인 달성!', 0, -24);
      ctx.fillStyle = '#315f38';
      ctx.font = '950 21px sans-serif';
      ctx.fillText('MAX LEVEL', 0, 17);
      ctx.fillStyle = '#6c7448';
      ctx.font = '900 12px sans-serif';
      ctx.fillText(`WEMADE PLAY FARM CHALLENGE · ${formatTime(this.levelMaxTime)}`, 0, 43);
      ctx.restore();
    }
    drawForeground(ctx) {
      if (this.state === 'playing' || this.state === 'gameover') this.drawHarvestPile(ctx);
      this.drawSupportFriend(ctx);
      this.drawFieldClear(ctx);
      this.drawWarningOverlay(ctx);
      if (this.stageBanner > 0 && this.state === 'playing') {
        const a = Math.min(1, this.stageBanner * 2, (1.8 - this.stageBanner) * 3);
        ctx.save(); ctx.globalAlpha = clamp(a); ctx.textAlign = 'center';
        ctx.fillStyle = '#fff8d8'; ctx.strokeStyle = '#496540'; ctx.lineWidth = 7; ctx.font = `900 ${Math.min(48, this.w * .09)}px sans-serif`;
        ctx.strokeText(`밭 ${this.stage}`, this.w / 2, this.h * .45); ctx.fillText(`밭 ${this.stage}`, this.w / 2, this.h * .45);
        ctx.restore();
      }
      if (this.plant.key === 'golden' && !this.plant.resolved && this.state === 'playing') {
        ctx.save(); ctx.globalAlpha = .65 + Math.sin(this.time * 5) * .2; ctx.fillStyle = '#fff1a2'; ctx.textAlign = 'center'; ctx.font = '900 16px sans-serif'; ctx.fillText('✦ 황금 마늘쫑 · 희귀 장줄기 ✦', this.w / 2, this.h * .13); ctx.restore();
      }
      this.drawMaxLevelCelebration(ctx);
      if (this.flash > 0) { ctx.fillStyle = `rgba(255,255,220,${this.flash * .38})`; ctx.fillRect(0,0,this.w,this.h); }
    }
    loop(now) {
      const rawDt = Math.min(.033, (now - this.lastTime) / 1000 || .016); this.lastTime = now;
      if (this.slow < 1) this.slow = Math.min(1, this.slow + rawDt * 1.15);
      this.update(rawDt * this.slow);
      this.particles = this.particles.filter((p) => p.update(rawDt));
      const ctx = this.ctx; ctx.save();
      const sx = this.shake ? (Math.random() - .5) * this.shake : 0, sy = this.shake ? (Math.random() - .5) * this.shake : 0;
      ctx.translate(sx, sy); this.drawBackground(ctx); this.drawWaitingScapes(ctx); this.drawPlant(ctx);
      this.particles.forEach((p) => p.draw(ctx)); this.drawForeground(ctx); ctx.restore();
      requestAnimationFrame((t) => this.loop(t));
    }
  }

  new Game();
})();
