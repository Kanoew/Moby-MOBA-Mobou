const { chromium } = require("playwright");
const assert = require("node:assert/strict");
(async () => {
  const browser = await chromium.launch({
    headless: true,
    executablePath: "/usr/bin/chromium",
    args: ["--no-sandbox"],
  });
  const results = [];
  for (const [width, height, touch] of [
    [844, 390, true],
    [667, 375, true],
    [1440, 900, false],
  ]) {
    for (const hero of ["yeji", "sweetie", "jennie"]) {
      const page = await browser.newPage({
        viewport: { width, height },
        hasTouch: touch,
        isMobile: touch,
        deviceScaleFactor: touch ? 2 : 1,
      });
      const errors = [];
      page.on("pageerror", (e) => errors.push(e.message));
      await page.goto(
        `http://localhost:8000/?hero=${hero}&bot=off&level=3&spend=1${touch ? "&touch=1" : ""}`,
      );
      await page.waitForFunction(() => window.__moba);
      await page.keyboard.press("s");
      await page.evaluate(() => {
        const a = __moba,
          w = a.world,
          p = a.getUnit(w, "player"),
          foe = a.getUnit(w, "e-sweetie");
        for (const h of w.heroes) {
          h.controller = "idle";
          h.targetId = null;
        }
        Object.assign(p, { x: 1500, y: 900, px: 1500, py: 900 });
        Object.assign(foe, {
          x: 1620,
          y: 900,
          px: 1620,
          py: 900,
          hp: 900,
          maxHp: 900,
        });
        w.time = 6000;
        w.nextWaveAt = Infinity;
        a.renderer.camera.recenter();
        window.fxNotes = [];
        const make = AudioContext.prototype.createOscillator;
        AudioContext.prototype.createOscillator = function (...args) {
          const o = make.apply(this, args),
            set = o.frequency.setValueAtTime.bind(o.frequency);
          o.frequency.setValueAtTime = (f, t) => {
            fxNotes.push(f);
            return set(f, t);
          };
          return o;
        };
        a.issueCommand(w, "player", { type: "target", targetId: foe.id });
      });
      await page.waitForFunction(
        () => __moba.renderer.combatEffects.flashAlpha("e-sweetie") > 0,
      );
      await page.evaluate(() => {
        __moba.game().paused = true;
        __moba.renderer.draw(0, "player", null, 1);
      });
      const hit = await page.evaluate(() => ({
        stats: __moba.renderer.combatEffects.stats(),
        notes: fxNotes,
        life: __moba.getUnit(__moba.world, "e-sweetie").hp,
      }));
      assert.ok(hit.stats.numbers > 0);
      assert.ok(hit.stats.bursts > 0);
      assert.ok(hit.life < 900);
      assert.ok(
        hit.notes.includes(
          hero === "jennie" ? 880 : hero === "sweetie" ? 95 : 620,
        ),
      );
      if (hero === "yeji")
        await page.screenshot({ path: `/tmp/moba-fx-hit-${width}.png` });
      // Un sort garde sa planche et son timing ; les nouveaux effets viennent seulement s'y ajouter.
      await page.evaluate(() => {
        const a = __moba,
          p = a.getUnit(a.world, "player");
        a.issueCommand(a.world, p.id, { type: "ult" });
        a.renderer.draw(0, p.id, null, 1);
      });
      assert.ok(
        (await page.evaluate(
          () => __moba.renderer.combatEffects.stats().bursts,
        )) >= 2,
      );
      // Élimination réellement appliquée : événement, retour compact et dégâts synchrones.
      await page.evaluate(async () => {
        const a = __moba,
          { applyDamage } = await import(`/src/sim/world.js?v=${APP_VERSION}`);
        applyDamage(
          a.world,
          a.getUnit(a.world, "player"),
          a.getUnit(a.world, "e-sweetie"),
          99999,
        );
        a.renderer.draw(0, "player", null, 1);
      });
      assert.equal(
        await page.evaluate(() => __moba.renderer.combatEffects.banner()?.text),
        "Élimination",
      );
      if (hero === "yeji")
        await page.screenshot({ path: `/tmp/moba-fx-kill-${width}.png` });
      // Préférence persistante, réduction immédiate du budget, pas de flash ni secousse.
      await page.evaluate(() => {
        __moba.game().paused = false;
      });
      await page.locator("#btn-pause").click();
      const button = page.locator("#btn-effects");
      assert.ok(await button.isVisible());
      assert.ok((await button.boundingBox()).height >= 38);
      await button.click();
      await page.waitForFunction(
        () => __moba.renderer.combatEffects.stats().mode === "light",
      );
      const light = await page.evaluate(() => ({
        saved: localStorage.getItem("moba.effects"),
        shake: __moba.renderer.combatEffects.shake(),
        flash: __moba.renderer.combatEffects.flashAlpha("e-sweetie"),
      }));
      assert.equal(light.saved, "light");
      assert.deepEqual(light.shake, { x: 0, y: 0 });
      assert.equal(light.flash, 0);
      await page.reload();
      await page.waitForFunction(() => window.__moba);
      assert.equal(
        await page.evaluate(() => __moba.renderer.combatEffects.stats().mode),
        "light",
      );
      // Priorité et changement dynamique de l'accessibilité du système.
      await page.emulateMedia({ reducedMotion: "reduce" });
      await page.locator("#btn-pause").click();
      await page.waitForFunction(
        () => document.querySelector("#btn-effects").disabled,
      );
      assert.equal(await button.isDisabled(), true);
      assert.ok((await button.textContent()).includes("système"));
      assert.deepEqual(errors, []);
      results.push({
        viewport: `${width}x${height}`,
        hero,
        realImpact: true,
        distinctSound: true,
        ultimate: true,
        kill: true,
        persistentLightMode: true,
        reducedMotion: true,
        errors,
      });
      await page.close();
    }
  }
  // Neutralité du rendu et coût mesuré dans Chromium, séparément des tests sur matériel physique.
  const page = await browser.newPage({
    viewport: { width: 844, height: 390 },
    hasTouch: true,
    isMobile: true,
    deviceScaleFactor: 2,
  });
  await page.goto("http://localhost:8000/?hero=yeji&bot=off&touch=1");
  await page.waitForFunction(() => window.__moba);
  const stress = await page.evaluate(async () => {
    const a = __moba,
      w = a.world,
      p = a.getUnit(w, "player"),
      foe = a.getUnit(w, "e-sweetie");
    for (const h of w.heroes) h.controller = "idle";
    Object.assign(p, { x: 1500, y: 900, px: 1500, py: 900 });
    Object.assign(foe, { x: 1600, y: 900, px: 1600, py: 900 });
    a.game().paused = true;
    const before = JSON.stringify(w.units);
    for (let i = 0; i < 500; i++)
      w.onEvent({
        type: "damage",
        sourceId: p.id,
        targetId: foe.id,
        amount: 40,
        t: w.time,
      });
    const samples = [];
    for (let i = 0; i < 100; i++) {
      const t = performance.now();
      a.renderer.draw(0, p.id, null, 0.5);
      samples.push(performance.now() - t);
    }
    samples.sort((x, y) => x - y);
    const after = JSON.stringify(w.units);
    return {
      unchanged: before === after,
      stats: a.renderer.combatEffects.stats(),
      median: samples[50],
      p95: samples[95],
    };
  });
  assert.equal(stress.unchanged, true);
  assert.ok(stress.stats.bursts <= 64);
  assert.ok(stress.stats.numbers <= 40);
  results.push({ stress });
  await browser.close();
  console.log(JSON.stringify(results, null, 2));
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
