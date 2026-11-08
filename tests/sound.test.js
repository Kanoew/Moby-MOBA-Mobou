import test from 'node:test';
import assert from 'node:assert/strict';

test('audio : mixage limité, sons de compétence courts, silence sans nouvelle voix quand coupé', async () => {
  const saved = { AudioContext: globalThis.AudioContext, localStorage: globalThis.localStorage, location: globalThis.location };
  const voices = [], gains = [], compressors = [];
  const param = () => ({ value: 0, setValueAtTime() {}, exponentialRampToValueAtTime() {} });
  const node = (props = {}) => ({ ...props, connect(next) { this.next = next; return next; } });
  class Audio {
    currentTime = 0; state = 'running'; destination = {};
    createGain() { const g = node({ gain: param() }); gains.push(g); return g; }
    createDynamicsCompressor() {
      const c = node({ threshold: param(), knee: param(), ratio: param(), attack: param(), release: param() }); compressors.push(c); return c;
    }
    createOscillator() { const o = node({ frequency: param(), start(t) { this.startAt = t; }, stop(t) { this.stopAt = t; } }); voices.push(o); return o; }
  }
  try {
    globalThis.AudioContext = Audio; globalThis.localStorage = { getItem: () => null, setItem() {} }; globalThis.location = { search: '' };
    const audio = await import('../src/ui/sound.js?audio-test');
    audio.play('skill_dash'); assert.equal(voices.length, 0);
    audio.unlockAudio(); audio.unlockAudio(); assert.equal(compressors.length, 1); assert.equal(gains[0].gain.value, 0.65);
    for (const name of ['skill_dash', 'skill_magic', 'hit_blade', 'hit_heavy', 'hit_magic', 'ult_cast', 'kill']) audio.play(name);
    assert.ok(voices.length > 0); assert.ok(voices.every((o) => o.stopAt - o.startAt <= 0.23));
    assert.ok(voices.every((o) => o.next.next === gains[0])); assert.equal(gains[0].next, compressors[0]);
    const count = voices.length; audio.setMuted(true); audio.play('skill_magic'); audio.play('kill'); assert.equal(voices.length, count);
  } finally {
    for (const [k, v] of Object.entries(saved)) if (v === undefined) delete globalThis[k]; else globalThis[k] = v;
  }
});
