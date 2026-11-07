// Numéro de version : source unique = version.json. Ce script le fait avancer (ou le relit) puis régénère :
//  - package.json (champ version) ;
//  - index.html : constante APP_VERSION, feuille de style, manifeste, script d'entrée et surtout la carte
//    d'import (importmap) qui ajoute ?v=<version> à CHAQUE module de src/.
// Sans cette carte, un module importé par un autre module (./world.js) resterait en cache : la carte réécrit
// l'URL résolue de chacun. Le navigateur recharge donc tout dès que la version change.
//
//   npm run bump            → 0.3.0 → 0.3.1
//   npm run bump -- minor   → 0.3.1 → 0.4.0
//   npm run bump -- 1.0.0   → version explicite
//   npm run bump -- sync    → ne change pas la version, régénère seulement (après un ajout de fichier)
import { readFileSync, writeFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(fileURLToPath(new URL('..', import.meta.url)));

export function listModules(dir = join(root, 'src')) {
  const out = [];
  for (const name of readdirSync(dir).sort()) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) out.push(...listModules(p));
    else if (name.endsWith('.js')) out.push('./' + relative(root, p).split('\\').join('/'));
  }
  return out;
}

export function bump(version, how) {
  const m = /^(\d+)\.(\d+)\.(\d+)$/.exec(version);
  if (!m) throw new Error(`version illisible : ${version}`);
  let [maj, min, pat] = m.slice(1).map(Number);
  if (how === 'sync') return version;
  if (/^\d+\.\d+\.\d+$/.test(how || '')) return how;
  if (how === 'major') return `${maj + 1}.0.0`;
  if (how === 'minor') return `${maj}.${min + 1}.0`;
  return `${maj}.${min}.${pat + 1}`;
}

export function renderHeadBlock(version, modules) {
  const imports = Object.fromEntries(modules.map((m) => [m, `${m}?v=${version}`]));
  return [
    '<!--version:start-->',
    `<script>window.APP_VERSION = ${JSON.stringify(version)};</script>`,
    `<script type="importmap">${JSON.stringify({ imports }, null, 2)}</script>`,
    `<link rel="manifest" href="manifest.webmanifest?v=${version}">`,
    `<link rel="stylesheet" href="styles/ui.css?v=${version}">`,
    '<!--version:end-->',
  ].join('\n  ');
}

export function renderEntryBlock(version) {
  return `<!--entry:start-->\n  <script type="module" src="src/main.js?v=${version}"></script>\n  <!--entry:end-->`;
}

export function applyToHtml(html, version, modules) {
  const head = /<!--version:start-->[\s\S]*?<!--version:end-->/;
  const entry = /<!--entry:start-->[\s\S]*?<!--entry:end-->/;
  if (!head.test(html) || !entry.test(html)) throw new Error('marqueurs <!--version:…--> ou <!--entry:…--> absents de index.html');
  return html.replace(head, renderHeadBlock(version, modules)).replace(entry, renderEntryBlock(version));
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const how = process.argv[2];
  const file = join(root, 'version.json');
  const current = JSON.parse(readFileSync(file, 'utf8')).version;
  const next = bump(current, how);
  writeFileSync(file, JSON.stringify({ version: next }) + '\n');
  const pkgFile = join(root, 'package.json');
  const pkg = JSON.parse(readFileSync(pkgFile, 'utf8'));
  pkg.version = next;
  writeFileSync(pkgFile, JSON.stringify(pkg, null, 2) + '\n');
  const htmlFile = join(root, 'index.html');
  writeFileSync(htmlFile, applyToHtml(readFileSync(htmlFile, 'utf8'), next, listModules()));
  console.log(`version ${current} → ${next} (${listModules().length} modules versionnés)`);
}
