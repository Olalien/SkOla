/**
 * OlaSkole build script — esbuild-based
 *
 * Usage:
 *   npm run build          # one-shot production build → dist/
 *   npm run build:watch    # rebuild on file changes
 *
 * Output:
 *   dist/app.js            minified main bundle
 *   dist/games.js          minified games bundle (lazy-loaded)
 *   dist/app.css           minified stylesheet
 *   dist/index.html        updated HTML with content-hash references
 *   dist/sw.js             service worker (verbatim copy)
 *   dist/manifest.json     PWA manifest (verbatim copy)
 */

import * as esbuild from 'esbuild';
import { readFileSync, writeFileSync, mkdirSync, copyFileSync } from 'fs';
import { createHash } from 'crypto';
import path from 'path';

const watch = process.argv.includes('--watch');
const outDir = 'dist';
mkdirSync(outDir, { recursive: true });

// ── helpers ──────────────────────────────────────────────────────────────────

function hash(buf) {
  return createHash('sha256').update(buf).digest('hex').slice(0, 8);
}

function hashedName(name, buf) {
  const ext  = path.extname(name);
  const base = path.basename(name, ext);
  return `${base}.${hash(buf)}${ext}`;
}

// ── build JS bundles ──────────────────────────────────────────────────────────

async function buildJS(entry, outFile, extraOptions = {}) {
  const result = await esbuild.build({
    entryPoints: [entry],
    bundle: false,          // no import/export in these files; just minify
    minify: true,
    sourcemap: watch ? 'inline' : false,
    target: ['es2020'],
    charset: 'utf8',
    write: false,
    ...extraOptions,
  });
  // outputFiles[0] is always the JS; [1] would be external sourcemap (not used here)
  return result.outputFiles[0].contents;
}

// ── build CSS ─────────────────────────────────────────────────────────────────

async function buildCSS(entry) {
  const result = await esbuild.build({
    entryPoints: [entry],
    bundle: true,           // resolves @import
    minify: true,
    loader: { '.css': 'css' },
    write: false,
  });
  return result.outputFiles[0].contents;
}

// ── main build ────────────────────────────────────────────────────────────────

async function build() {
  console.time('build');

  // Build all assets concurrently
  const [appJsBuf, gamesJsBuf, appCssBuf] = await Promise.all([
    buildJS('app.js',   'app.js'),
    // games.js is only present after code-split (item 12); graceful fallback
    (async () => {
      try { return await buildJS('games.js', 'games.js'); } catch { return null; }
    })(),
    buildCSS('app.css'),
  ]);

  // Content-hash filenames for cache busting
  const appJsName   = hashedName('app.js',   appJsBuf);
  const gamesJsName = gamesJsBuf ? hashedName('games.js', gamesJsBuf) : null;
  const appCssName  = hashedName('app.css',  appCssBuf);

  // Write built assets
  writeFileSync(`${outDir}/${appJsName}`,  appJsBuf);
  writeFileSync(`${outDir}/${appCssName}`, appCssBuf);
  if (gamesJsBuf) writeFileSync(`${outDir}/${gamesJsName}`, gamesJsBuf);

  // Patch index.html: swap references to hashed filenames
  let html = readFileSync('index.html', 'utf8');

  // Swap app.css reference
  html = html.replace(
    /href="app\.css"/g,
    `href="${appCssName}"`
  );

  // Swap app.js reference
  html = html.replace(
    /src="app\.js"/g,
    `src="${appJsName}"`
  );

  // If games.js split exists, patch the _CDN_GAMES constant in the hashed app.js
  // (The app.js stub uses window._GAMES_JS_URL set here)
  if (gamesJsName) {
    html = html.replace(
      /(<script[^>]*src=["'])([^"']*app\.[a-f0-9]+\.js["'])/,
      (m) => m  // keep unchanged; the URL is injected via a tiny inline script below
    );
    // Inject the games URL so the lazy-loader can find the hashed file
    html = html.replace(
      '</head>',
      `<script>window._GAMES_JS_URL="${gamesJsName}";</script>\n</head>`
    );
  }

  writeFileSync(`${outDir}/index.html`, html);

  // Copy static files verbatim
  for (const f of ['sw.js', 'manifest.json']) {
    try { copyFileSync(f, `${outDir}/${f}`); } catch { /* optional files */ }
  }

  const appKB   = (appJsBuf.length   / 1024).toFixed(1);
  const cssKB   = (appCssBuf.length  / 1024).toFixed(1);
  const gamesKB = gamesJsBuf ? (gamesJsBuf.length / 1024).toFixed(1) : '-';
  console.log(`✅ app.js   ${appKB} KB → dist/${appJsName}`);
  console.log(`✅ app.css  ${cssKB} KB → dist/${appCssName}`);
  if (gamesJsBuf) console.log(`✅ games.js ${gamesKB} KB → dist/${gamesJsName}`);
  console.timeEnd('build');
}

// ── watch mode ────────────────────────────────────────────────────────────────

if (watch) {
  // Simple poll-based watch: rebuild on any source change
  const { watch: fsWatch } = await import('fs');
  let debounceTimer;
  const rebuild = () => {
    clearTimeout(debounceTimer);
    debounceTimer = setTimeout(() => build().catch(console.error), 150);
  };
  for (const f of ['app.js', 'games.js', 'app.css', 'index.html']) {
    try { fsWatch(f, rebuild); } catch { /* file may not exist yet */ }
  }
  console.log('👀 Watching for changes…');
  await build();
} else {
  await build().catch(e => { console.error(e); process.exit(1); });
}
