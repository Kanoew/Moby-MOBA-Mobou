// Outil de validation facultatif : Playwright et Chromium, hors dépendances du jeu.
// npm start, puis node tools/benchmark-combat-feedback.cjs /tmp/feedback.json
const { chromium } = require("playwright");
const fs = require("node:fs");
(async () => {
  const browser = await chromium.launch({
    headless: true,
    executablePath: "/usr/bin/chromium",
    args: ["--no-sandbox"],
  });
  const cases = [];
  for (const mode of ["full", "light"])
    for (const load of ["normal", "dense"]) {
      const page = await browser.newPage({
        viewport: { width: 844, height: 390 },
        deviceScaleFactor: 2,
        isMobile: true,
        hasTouch: true,
      });
      await page.addInitScript(
        (mode) => localStorage.setItem("moba.effects", mode),
        mode,
      );
      await page.goto(
        "http://localhost:8000/?hero=jennie&bot=off&touch=1&seed=77",
      );
      await page.waitForFunction(() => window.__moba);
      const data = await page.evaluate(
        async ({ mode, load }) => {
          const a = __moba,
            w = a.world,
            { gainXp } = await import(
              `/src/sim/progression.js?v=${APP_VERSION}`
            );
          w.time = 8000;
          w.nextWaveAt = Infinity;
          const positions = {
            player: [1450, 900],
            "a-yeji": [1560, 760],
            "a-sweetie": [1540, 1040],
            "e-jennie": [1800, 930],
            "e-yeji": [1840, 760],
            "e-sweetie": [1800, 1040],
          };
          for (const h of w.heroes) {
            h.controller = "idle";
            gainXp(w, h, w.match.progression.levels[2]);
            const [x, y] = positions[h.id];
            Object.assign(h, { x, y, px: x, py: y, hp: 10000, maxHp: 10000 });
            a.issueCommand(w, h.id, { type: "ult" });
          }
          a.renderer.camera.recenter();
          for (let i = 0; i < 60; i++) {
            a.step(w, 16);
            a.renderer.draw(16, "player", null, 1);
          }
          a.issueCommand(w, "player", { type: "attack", targetId: "e-jennie" });
          for (let i = 0; i < 18; i++) {
            a.step(w, 16);
            a.renderer.draw(16, "player", null, 1);
          }
          a.game().paused = true;
          const target = a.getUnit(w, "e-jennie");
          for (let i = 0; i < (load === "dense" ? 80 : 3); i++)
            w.onEvent({
              type: "damage",
              sourceId: "player",
              targetId: target.id,
              amount: 20,
              t: w.time,
            });
          const before = JSON.stringify(w.units);
          const rounds = [];
          for (let r = 0; r < 3; r++) {
            for (let i = 0; i < 25; i++) a.renderer.draw(0, "player", null, 1);
            const times = [];
            for (let i = 0; i < 100; i++) {
              const t = performance.now();
              a.renderer.draw(0, "player", null, 1);
              times.push(performance.now() - t);
            }
            times.sort((x, y) => x - y);
            rounds.push({ median: times[50], p95: times[95] });
          }
          let filters = 0;
          const savedFilter = Array.prototype.filter;
          Array.prototype.filter = function (...args) {
            filters++;
            return savedFilter.apply(this, args);
          };
          try {
            for (let i = 0; i < 20; i++) a.renderer.draw(0, "player", null, 1);
          } finally {
            Array.prototype.filter = savedFilter;
          }
          return {
            mode,
            load,
            rounds,
            filtersPerDraw: filters / 20,
            stats: a.renderer.combatEffects.stats(),
            zones: w.zones.length,
            projectiles: w.projectiles.length,
            unchanged: before === JSON.stringify(w.units),
          };
        },
        { mode, load },
      );
      cases.push(data);
      await page.close();
    }
  await browser.close();
  const out = { viewport: "844x390", dpr: 2, cases };
  fs.writeFileSync(
    process.argv[2] || "/tmp/combat-feedback-benchmark.json",
    JSON.stringify(out, null, 2),
  );
  console.log(JSON.stringify(out));
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
