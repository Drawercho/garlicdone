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

const source = fs.readFileSync('game.js', 'utf8').replace('new Game();', 'globalThis.testGame = new Game();');
vm.runInThisContext(source, { filename: 'game.js' });

const game = global.testGame;
game.tutorialDone = true;
game.enterFarm('테스트농부');
assert.equal(JSON.parse(localStorage.getItem('garlic-profile')).name, '테스트농부', 'nickname should persist');
game.start();

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
assert.equal(game.lives, livesBefore - 1, 'failure should consume one chance');
assert.equal(game.combo, 0, 'failure should reset combo');

game.gameOver();
const ranking = JSON.parse(localStorage.getItem('garlic-world-cache'));
assert.equal(ranking[0].name, '테스트농부', 'ranking should use the active nickname');
assert.ok(ranking[0].cm > 0, 'ranking should save harvested centimeters');

console.log('Smoke test passed: login, release harvest, failure, cm scoring, ranking, and record storage.');
