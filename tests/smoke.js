const fs = require('fs');
const vm = require('vm');
const assert = require('assert');

class FakeClassList {
  add() {} remove() {} toggle() {}
}

function fakeElement(id) {
  return {
    id,
    style: {},
    classList: new FakeClassList(),
    textContent: '',
    innerHTML: '',
    addEventListener() {},
    getBoundingClientRect() { return { left: 0, top: 0, width: 960, height: 640 }; },
    getContext() { return { setTransform() {} }; },
    setPointerCapture() {},
    get offsetWidth() { return 1; }
  };
}

const elements = new Map();
global.document = {
  getElementById(id) {
    if (!elements.has(id)) elements.set(id, fakeElement(id));
    return elements.get(id);
  }
};
global.window = { AudioContext: null, webkitAudioContext: null };
global.localStorage = {
  data: new Map(),
  getItem(key) { return this.data.get(key) ?? null; },
  setItem(key, value) { this.data.set(key, String(value)); }
};
global.addEventListener = () => {};
global.requestAnimationFrame = () => 0;
global.devicePixelRatio = 1;
global.navigator = {};

function pngSize(file) {
  const buffer = fs.readFileSync(file);
  assert.equal(buffer.toString('ascii', 1, 4), 'PNG', `${file} should be a PNG file`);
  return { width: buffer.readUInt32BE(16), height: buffer.readUInt32BE(20) };
}

const manifest = JSON.parse(fs.readFileSync('manifest.webmanifest', 'utf8'));
assert.equal(manifest.display, 'standalone', 'PWA manifest should launch in standalone mode');
assert.ok(manifest.icons.some((icon) => icon.sizes === '512x512'), 'PWA manifest should include a 512px icon');
const html = fs.readFileSync('index.html', 'utf8');
assert.ok(html.includes('WEMADE PLAY FARM CHALLENGE'), 'title/result screens should include the WEMADE PLAY challenge badge');
assert.ok(html.includes('level-label') && html.includes('timer-label') && html.includes('xp-fill'), 'HUD should expose level, timer, and XP progress elements');
assert.ok(html.includes('width="1280" height="720"'), 'canvas should default to a 16:9 landscape baseline');
assert.ok(html.includes('result-ranking-summary'), 'result screen should show ranking without opening the ranking card');
assert.ok(html.includes('result-player-title'), 'result screen should show a fun performance title');
assert.ok(html.includes('result-share-button'), 'result screen should offer Slack sharing');
assert.ok(!html.includes('🏆 랭킹 확인'), 'result screen should remove the old ranking check button');
assert.ok(html.includes('● ●') && html.includes('1 / 3'), 'initial HUD should reflect 2 lives and 3 scapes per field');
assert.ok(html.includes('game.js?v=20260710-v10') && html.includes('styles.css?v=20260710-v10'), 'HTML should version app shell assets to avoid stale service-worker caches');
const css = fs.readFileSync('styles.css', 'utf8');
assert.ok(css.includes('html, body, #game-shell'), 'root containers should share fixed full-frame sizing');
assert.ok(css.includes('overflow: hidden'), 'page layout should prevent iframe scrollbars');
assert.ok(css.includes('aspect-ratio: 16 / 9'), 'game shell should declare the 16:9 design basis');
assert.equal(manifest.orientation, 'landscape-primary', 'PWA manifest should prefer landscape play');
const visualResourceSizes = {
  'assets/wemade-building.png': { width: 384, height: 316 },
  'assets/wemade-building-mid.png': { width: 384, height: 316 },
  'assets/wemade-building-final.png': { width: 384, height: 316 },
  'assets/support-friend-idle.png': { width: 192, height: 216 },
  'assets/support-friend-good.png': { width: 192, height: 216 },
  'assets/support-friend-fail.png': { width: 192, height: 216 },
  'assets/support-friend-max.png': { width: 192, height: 216 }
};
Object.entries(visualResourceSizes).forEach(([file, expectedSize]) => {
  assert.ok(fs.existsSync(file), `${file} should exist as a replaceable visual resource`);
  assert.deepEqual(pngSize(file), expectedSize, `${file} should match the 2x draw size`);
});
['icons/icon-192.png', 'icons/icon-512.png', 'icons/maskable-192.png', 'icons/maskable-512.png'].forEach((file) => {
  assert.ok(fs.existsSync(file), `${file} should exist for installable PWA icons`);
});
const serviceWorker = fs.readFileSync('sw.js', 'utf8');
assert.ok(serviceWorker.includes('garlicdone-pwa-v10'), 'service worker cache should be bumped for the latest deploy');
assert.ok(serviceWorker.includes('manifest.webmanifest'), 'service worker should cache the manifest');
assert.ok(serviceWorker.includes('supabase-config.js'), 'service worker should cache runtime config for the app shell');
assert.ok(serviceWorker.indexOf('fetch(request)') < serviceWorker.indexOf('caches.match(request)'), 'service worker should prefer network before cached app assets');
assert.ok(serviceWorker.includes('assets/wemade-building.png'), 'service worker should cache replaceable building art');
assert.ok(serviceWorker.includes('assets/wemade-building-mid.png'), 'service worker should cache the mid-stage building art');
assert.ok(serviceWorker.includes('assets/wemade-building-final.png'), 'service worker should cache the final-stage building art');
assert.ok(serviceWorker.includes('assets/support-friend-idle.png'), 'service worker should cache replaceable character art');
assert.ok(serviceWorker.includes('assets/support-friend-good.png'), 'service worker should cache the success character art');
assert.ok(serviceWorker.includes('assets/support-friend-fail.png'), 'service worker should cache the fail character art');
assert.ok(serviceWorker.includes('assets/support-friend-max.png'), 'service worker should cache the max-level character art');

const source = fs.readFileSync('game.js', 'utf8').replace('new Game();', 'globalThis.testGame = new Game();');
assert.ok(source.includes('assets/wemade-building.png'), 'game should reference the replaceable building resource');
assert.ok(source.includes('assets/wemade-building-mid.png'), 'game should reference the mid-stage building resource');
assert.ok(source.includes('assets/wemade-building-final.png'), 'game should reference the final-stage building resource');
assert.ok(source.includes('assets/support-friend-idle.png'), 'game should reference the replaceable character resource');
assert.ok(source.includes('assets/support-friend-good.png'), 'game should reference the success character resource');
assert.ok(source.includes('assets/support-friend-fail.png'), 'game should reference the fail character resource');
assert.ok(source.includes('assets/support-friend-max.png'), 'game should reference the max-level character resource');
vm.runInThisContext(source, { filename: 'game.js' });

const game = global.testGame;
assert.equal(game.state, 'title', 'game should open directly without a blocking login gate');
assert.equal(game.profile.name, '농부', 'default guest farmer should allow immediate iframe play');
game.tutorialDone = true;
game.enterFarm('테스트농부');
assert.equal(JSON.parse(localStorage.getItem('garlic-profile')).name, '테스트농부', 'nickname should persist');
game.start();
assert.equal(game.lives, 2, 'game should now start with 2 lives');

assert.equal(game.plant.lesson, 1, 'first scape should be the forgiving hand-feel lesson');
game.input.held = true;
game.input.power = .22;
game.input.angle = 1;
game.releaseInput();
assert.equal(game.plant.resolved, true, 'first scape should forgive rough input and still succeed');
assert.equal(game.plant.failReason, '', 'first lesson should not punish rough first input');

game.nextPlant();
assert.equal(game.plant.lesson, 2, 'second scape should teach force control');
for (let i = 0; i < 1200 && game.plant.progress < .9; i++) {
  game.input.held = true;
  game.input.power = game.plant.targetForce(game.time);
  game.input.angle = game.plant.targetAngle(game.time);
  game.update(1 / 60);
}
game.releaseInput();

assert.equal(game.plant.resolved, true, 'skillful release should pull the scape');
assert.equal(game.plant.failReason, '', 'skillful input should not fail');
assert.ok(game.score > 0, 'success should award harvested centimeters');
assert.ok(game.combo > 0, 'success should build combo');
assert.ok(Number(localStorage.getItem('garlic-best')) > 0, 'best score should persist');

game.nextPlant();
assert.equal(game.plant.lesson, 3, 'third scape should teach resistance pattern response');
for (let i = 0; i < 1400 && !game.plant.resolved; i++) {
  game.input.held = true;
  game.input.power = game.plant.targetForce(game.time);
  game.input.angle = game.plant.targetAngle(game.time);
  game.update(1 / 60);
}

assert.equal(game.plant.resolved, true, 'full pull should auto-harvest without release');
assert.equal(game.plant.failReason, '', 'auto-harvest should not fail with skillful input');

game.nextPlant();
assert.equal(game.plant.lesson, 0, 'fourth scape should leave tutorial mode');
assert.ok(game.plant.assist >= .25, 'fourth scape should bridge tutorial and normal play gently');
const livesBefore = game.lives;

const desiredAngle = game.plant.targetAngle(game.time);
game.input.held = true;
game.input.power = game.plant.targetForce(game.time);
game.input.angle = Math.min(1, desiredAngle + 0.4);
game.update(1 / 60);
assert.ok(game.plant.feedback.includes('왼쪽'), 'correction cue should point back from an overshot angle');

for (let i = 0; i < 360 && !game.plant.resolved; i++) {
  game.input.held = true;
  game.input.power = 1;
  game.input.angle = -1;
  game.update(1 / 60);
}

assert.ok(game.plant.failReason, 'reckless input should explain its failure');
assert.ok(game.plant.failTip, 'failure should include a useful next-attempt tip');
assert.equal(game.lives, livesBefore - 1, 'failure should consume one chance');
assert.equal(game.combo, 0, 'failure should reset combo');

game.gameOver();
assert.ok(elements.get('result-stats').innerHTML.includes('도달 레벨'), 'result screen should summarize reached level');
assert.ok(elements.get('result-stats').innerHTML.includes('챌린지 시간'), 'result screen should summarize challenge time');
assert.ok(elements.get('result-goal').textContent.includes('다음 목표'), 'result screen should offer a replay goal');
assert.ok(elements.get('result-player-title').innerHTML.includes('칭호'), 'result screen should show a player title');
assert.ok(elements.get('result-ranking-summary').innerHTML.includes('현재 내 순위'), 'result screen should calculate my ranking immediately');
assert.equal(elements.get('result-share-button').textContent, '슬랙으로 내 성과 공유하기', 'result screen should replace ranking check with Slack sharing');
const lowTitle = game.calculateResultTitle({ score: 20, level: 1, harvested: 0 });
const midTitle = game.calculateResultTitle({ score: 230, level: 6, harvested: 5 });
const highTitle = game.calculateResultTitle({ score: 430, level: 10, levelMaxed: true, rank: 2, total: 30, time: 49, combo: 9, perfectCount: 6, completed: true, harvested: 9 });
assert.notEqual(lowTitle.title, midTitle.title, 'low and mid scores should receive different titles');
assert.notEqual(midTitle.title, highTitle.title, 'mid and high scores should receive different titles');
const shareText = game.buildShareText();
assert.ok(shareText.includes('마늘쫑 뽑기 완료') && shareText.includes('테스트농부') && shareText.includes('현재 순위') && shareText.includes('칭호'), 'Slack share message should summarize this result and title');
assert.ok(source.includes('ClipboardItem') && source.includes('image/png'), 'Slack sharing should copy the result card as a PNG image when supported');
assert.ok(source.includes('이미지 복사가 막혀 성과 문구를 복사했어요'), 'Slack sharing should fall back to text when image clipboard is unavailable');
const ranking = JSON.parse(localStorage.getItem('garlic-world-cache'));
assert.equal(ranking[0].name, '테스트농부', 'ranking should use the active nickname');
assert.ok(ranking[0].cm > 0, 'ranking should save harvested centimeters');

game.start();
let simulatedSeconds = 0;
for (let i = 0; i < 60 * 60 && !game.completed && game.state === 'playing'; i++) {
  if (!game.plant.resolved) {
    game.input.held = true;
    game.input.power = game.plant.targetForce(game.time);
    game.input.angle = game.plant.targetAngle(game.time);
  }
  game.update(1 / 60);
  simulatedSeconds += 1 / 60;
}
assert.equal(game.completed, true, 'skillful play should clear all 3 fields inside the 60-second challenge');
assert.equal(game.harvested, 9, 'clearing all 3 fields should harvest 9 scapes');
assert.ok(game.runTime <= 60, `all 3 fields should clear within 60 seconds, got ${game.runTime}`);
assert.equal(game.levelMaxed, true, 'skillful play should reach max level inside the 60-second challenge');
assert.ok(game.levelMaxTime <= 60, `max level should be reached within 60 seconds, got ${game.levelMaxTime}`);
assert.ok(elements.get('level-label').textContent.includes('MAX'), 'HUD should show max level clearly');

console.log('Smoke test passed: login, release harvest, failure, cm scoring, ranking, record storage, 60s three-field clear, max level, and PWA files.');
