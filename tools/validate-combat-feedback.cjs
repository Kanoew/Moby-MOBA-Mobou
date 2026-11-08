const { chromium } = require("playwright");
const assert = require("node:assert/strict");
const fs = require("node:fs");
(async () => {
  const browser = await chromium.launch({
    headless: true,
    executablePath: "/usr/bin/chromium",
    args: ["--no-sandbox"],
  });
  const results = [];
  for (const [width, height] of [
    [844, 390],
    [667, 375],
    [1440, 900],
  ])
    for (const hero of ["yeji", "sweetie", "jennie"]) {
      const page = await browser.newPage({
        viewport: { width, height },
        hasTouch: width < 1000,
        isMobile: width < 1000,
      });
      const errors = [];
      page.on("pageerror", (e) => errors.push(e.message));
      await page.goto(
        `http://localhost:8000/?hero=${hero}&bot=off&level=3&spend=1${width < 1000 ? "&touch=1" : ""}`,
      );
      await page.waitForFunction(() => window.__moba);
      await page.keyboard.press("s");
      const result = await page.evaluate(async () => {
        const a = __moba,
          w = a.world,
          p = a.getUnit(w, "player"),
          foe = a.getUnit(w, "e-jennie");
        a.game().paused = true;
        w.time = 8000;
        w.nextWaveAt = Infinity;
        for (const h of w.heroes) {
          h.controller = "idle";
          h.targetId = null;
          h.hp = h.maxHp = 10000;
        }
        Object.assign(p, { x: 1450, y: 900, px: 1450, py: 900 });
        Object.assign(foe, { x: 1750, y: 900, px: 1750, py: 900 });
        const { gainXp } = await import(
          `/src/sim/progression.js?v=${APP_VERSION}`
        );
        gainXp(w, foe, w.match.progression.levels[2]);
        const sounds = [],
          play = AudioContext.prototype.createOscillator;
        AudioContext.prototype.createOscillator = function (...args) {
          sounds.push(1);
          return play.apply(this, args);
        };
        const step = (n) => {
          for (let i = 0; i < n; i++) {
            a.step(w, 16);
            a.renderer.draw(16, p.id, null, 1);
          }
        };
        const skill = a.issueCommand(w, p.id, {
          type: "skill",
          x: foe.x,
          y: foe.y,
        });
        step(35);
        const skillFx = a.renderer.combatEffects.stats(),
          skillSounds = sounds.length;
        const ult = a.issueCommand(w, p.id, { type: "ult" });
        const enemyUlt = a.issueCommand(w, foe.id, {
          type: "ult",
          x: p.x,
          y: p.y,
        });
        step(20);
        const snapshot = JSON.stringify(w.units);
        a.renderer.draw(0, p.id, null, 0.5);
        const unchanged = snapshot === JSON.stringify(w.units);
        const zones = w.zones.map((z) => ({
          kind: z.kind,
          team: z.team,
          radius: z.radius,
          remaining: z.endAt - w.time,
          arming: w.time < z.armAt,
        }));
        const { setMuted } = await import(`/src/ui/sound.js?v=${APP_VERSION}`);
        setMuted(true);
        const before = sounds.length;
        w.onEvent({ type: "cast_start", heroId: p.id, slot: "ult", t: w.time });
        const muted = sounds.length === before;
        return {
          skill,
          ult,
          enemyUlt,
          skillFx,
          skillSounds,
          zones,
          unchanged,
          muted,
        };
      });
      assert.equal(result.skill, true);
      assert.equal(result.ult, true);
      assert.equal(result.enemyUlt, true);
      assert.ok(result.skillSounds > 0);
      assert.equal(result.unchanged, true);
      assert.equal(result.muted, true);
      assert.deepEqual(errors, []);
      if (hero === "jennie")
        await page.screenshot({ path: `/tmp/moba-zones-${width}.png` });
      results.push({ width, height, hero, ...result, errors });
      await page.close();
    }
  await browser.close();
  fs.writeFileSync(
    "/tmp/moba-zones-browser.json",
    JSON.stringify(results, null, 2),
  );
  console.log("9 scenarios passed");
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
