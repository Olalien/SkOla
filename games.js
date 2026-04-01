/**
 * games.js — lazy-loaded game bundle for OlaSkole
 *
 * Globals used from app.js (must be loaded first):
 *   state, showToast, escHtml, sanitizeHTML, showView,
 *   SND, launchConfetti, getApiKey, _reg, _anthropicFetch,
 *   DB, openModal, closeModal
 *
 * Loaded on demand when the user navigates to the Spill view
 * or a teacher opens the Klasserom tab.
 */

// ====== GAME ZONE ENGINE ======
let GZ = {
  session: null,
  player: null,
  view: 'login',
  scores: {}, // {game: score}
  timerInterval: null
};
let WORDLE_ST = {}, WORLDLE_ST = {}, WHOAMI_ST = {};

// ── DB helpers for game sessions ──
async function dbGameReq(method, table, query, body) {
  return DB._q(method, table, query, body);
}

// ── Session management ──
async function gzLogin() {
  const code = (document.getElementById('gz-code-input')?.value||'').trim().toUpperCase();
  const errEl = document.getElementById('gz-login-error');
  if (!code || code.length < 3) { gzError('Skriv inn koden du fikk av læreren'); return; }
  if (errEl) errEl.style.display = 'none';

  // Vis loading-state
  const btn = document.querySelector('#gz-login button');
  if (btn) { btn.textContent = 'Sjekker...'; btn.disabled = true; }

  // Try Supabase (works cross-device)
  const rows = await sbSelect('os_game_sessions', 'code=eq.'+encodeURIComponent(code)+'&select=*');
  if (rows === null) {
    // Supabase unreachable - try localStorage
    console.warn('[GZ] Supabase unreachable, trying localStorage');
  } else if (rows.length > 0) {
    if (btn) { btn.textContent = 'Logg inn'; btn.disabled = false; }
    const raw = rows[0];
    const cfg = (typeof raw.config === 'object' && raw.config) ? raw.config : {};
    const sess = {
      id: raw.id, code: raw.code || code,
      name: cfg.name || raw.name || raw.id,
      games: cfg.games || raw.games || ['wordle','worldle','whoami'],
      customWords: cfg.customWords || raw.customWords || [],
      starts_at: raw.starts_at,
      ends_at: raw.ends_at,
      // Spread ALL config fields so game settings are passed through
      wordleLang: cfg.wordleLang || 'no',
      wordleDiff: cfg.wordleDiff || 'normal',
      wordleLen: cfg.wordleLen || 5,
      wordleShowColors: cfg.wordleShowColors !== false,
      wordleShowKeyboard: cfg.wordleShowKeyboard !== false,
      worldleDiff: cfg.worldleDiff || 'normal',
      worldleContinent: cfg.worldleContinent || 'all',
      worldleShowContinent: cfg.worldleShowContinent !== false,
      worldleShowPop: cfg.worldleShowPop !== false,
      whoamiDiff: cfg.whoamiDiff || 'normal',
      whoamiCategory: cfg.whoamiCategory || 'alle',
      whoamiCustom: cfg.whoamiCustom || null,
    };
    const now = Date.now();
    const start = sess.starts_at ? new Date(sess.starts_at).getTime() : 0;
    const end   = sess.ends_at   ? new Date(sess.ends_at).getTime()   : Infinity;
    if (now < start) { gzError('Spilløkten starter ' + new Date(sess.starts_at).toLocaleString('no-NO')); return; }
    if (now > end)   { gzError('Spilløkten er avsluttet'); return; }
    GZ.session = sess;
    gzEnterLobby();
    return;
  }

  // Supabase unreachable or no result → try localStorage (same device only)
  if (btn) { btn.textContent = 'Logg inn'; btn.disabled = false; }
  const raw = localStorage.getItem('os_game_session_' + code);
  if (raw) {
    try {
      const sess = JSON.parse(raw);
      const now = Date.now();
      if (sess.endsAt && now > sess.endsAt) { gzError('Spilløkten er avsluttet'); return; }
      if (sess.startsAt && now < sess.startsAt) { gzError('Spilløkten starter snart'); return; }
      // Also spread any config fields from localStorage
      GZ.session = { wordleLang:'no', wordleDiff:'normal', worldleDiff:'normal', whoamiDiff:'normal',
        worldleContinent:'all', worldleShowContinent:true, worldleShowPop:true,
        wordleShowColors:true, wordleShowKeyboard:true, whoamiCategory:'alle',
        ...sess, code };
      gzEnterLobby();
      return;
    } catch(e) {}
  }

  // Nothing found
  if (rows === null) {
    gzError('Kan ikke nå serveren. Be læreren sjekke at SQL-skjema er kjørt.');
  } else {
    gzError('Ugyldig kode – sjekk at du har skrevet riktig');
  }
}

function gzError(msg) {
  const el = document.getElementById('gz-login-error');
  if (el) { el.style.display = 'block'; el.textContent = '❌ ' + msg; }
}

function gzEnterLobby() {
  GZ.view = 'lobby';
  GZ.scores = {};
  gzShowPanel('gz-lobby');
  const nameEl = document.getElementById('gz-session-name');
  if (nameEl) nameEl.textContent = GZ.session.name || 'Spillsone';
  const codeEl = document.getElementById('gz-lobby-code');
  if (codeEl) codeEl.textContent = GZ.session.code;
  gzRenderGameCards();
  gzStartTimer();
  gzLoadMyScores();
}

function gzRenderGameCards() {
  const grid = document.getElementById('gz-game-cards');
  if (!grid) return;
  const games = [
    { id:'wordle',  label:'Wordle',   icon:'W', desc:'Gjett det skjulte ordet', color:'#22c55e', startFn:'gzStartWordle' },
    { id:'worldle', label:'Worldle',  icon:'🌍', desc:'Gjett landet fra silhuetten', color:'#4f6ef7', startFn:'gzStartWorldle' },
    { id:'whoami',  label:'Who Am I?',icon:'?', desc:'Gjett personen fra hint', color:'#a855f7', startFn:'gzStartWhoami' },
  ].filter(g => !GZ.session.games || GZ.session.games.includes(g.id));

  grid.innerHTML = games.map(g => {
    const myScore = GZ.scores[g.id];
    const sess = GZ.session;
    // Get session-level difficulty as default
    const defDiff = g.id==='wordle' ? (sess.wordleDiff||'normal') : g.id==='worldle' ? (sess.worldleDiff||'normal') : (sess.whoamiDiff||'normal');
    return `<div style="background:var(--s1);border:1px solid var(--border);border-radius:16px;padding:1.5rem;transition:all 0.18s;position:relative;" id="game-card-${g.id}">
      <div style="display:flex;align-items:center;gap:0.875rem;margin-bottom:0.875rem;">
        <div style="width:48px;height:48px;border-radius:12px;background:${g.color}22;border:2px solid ${g.color}44;display:flex;align-items:center;justify-content:center;font-family:'Fredoka One',cursive;font-size:1.4rem;color:${g.color};">${g.icon}</div>
        <div>
          <div style="font-family:'Fredoka One',cursive;font-size:1.2rem;color:var(--text);">${g.label}</div>
          <div style="font-size:0.8rem;color:var(--text-2);">${g.desc}</div>
        </div>
        ${myScore!=null ? `<div style="margin-left:auto;background:${g.color}22;border:1px solid ${g.color}55;border-radius:8px;padding:4px 10px;font-family:'Fredoka One',cursive;font-size:1rem;color:${g.color};">${myScore}p</div>` : ''}
      </div>
      <div style="display:flex;gap:0.4rem;margin-bottom:0.875rem;">
        ${['easy','normal','hard'].map(d=>`<button data-onclick="gzSetDiff" data-onclick-args="${escHtml(JSON.stringify([g.id,d]))}" id="diff-${g.id}-${d}" style="flex:1;padding:7px 4px;border-radius:8px;border:2px solid ${d===defDiff?g.color:'var(--border-2)'};background:${d===defDiff?g.color+'22':'transparent'};color:${d===defDiff?g.color:'var(--text-2)'};font-family:'Nunito',sans-serif;font-weight:800;font-size:0.78rem;cursor:pointer;transition:all 0.15s;">${{easy:'Lett',normal:'Normal',hard:'Vanskelig'}[d]}</button>`).join('')}
      </div>
      ${g.id === 'worldle' && (sess.worldleContinent === 'all' || !sess.worldleContinent) ? `
      <div style="margin-bottom:0.875rem;">
        <label style="font-size:0.72rem;font-weight:800;color:var(--text-3);text-transform:uppercase;letter-spacing:0.05em;display:block;margin-bottom:0.3rem;">Verdensdel</label>
        <select id="student-worldle-continent" style="width:100%;padding:8px 10px;border:1px solid var(--border-2);border-radius:8px;background:var(--s2);color:var(--text);font-family:'Nunito',sans-serif;font-weight:700;font-size:0.88rem;">
          <option value="all">🌐 Alle land</option>
          <option value="Europa">🏛 Europa</option>
          <option value="Asia">🏯 Asia</option>
          <option value="Afrika">🌴 Afrika</option>
          <option value="Amerika">🗽 Amerika</option>
          <option value="Oseania">🏄 Oseania</option>
        </select>
      </div>` : ''}
      ${g.id === 'whoami' && (!sess.whoamiCategory || sess.whoamiCategory === 'alle') ? `
      <div style="margin-bottom:0.875rem;">
        <label style="font-size:0.72rem;font-weight:800;color:var(--text-3);text-transform:uppercase;letter-spacing:0.05em;display:block;margin-bottom:0.3rem;">Kategori</label>
        <select id="student-whoami-cat" style="width:100%;padding:8px 10px;border:1px solid var(--border-2);border-radius:8px;background:var(--s2);color:var(--text);font-family:'Nunito',sans-serif;font-weight:700;font-size:0.88rem;">
          <option value="alle">🎭 Alle kategorier</option>
          <option value="politiker">🏛 Politikere</option>
          <option value="vitenskapsmann">🔬 Vitenskapsmenn</option>
          <option value="kunstner">🎨 Kunstnere</option>
          <option value="idrett">⚽ Idrettsutøvere</option>
          <option value="historisk">📜 Historiske</option>
          <option value="aktivist">✊ Aktivister</option>
          <option value="gründer">💡 Gründere</option>
        </select>
      </div>` : ''}
      <button data-onclick="_callWindowFn" data-onclick-arg="${g.startFn}" style="width:100%;padding:11px;background:${g.color};color:white;border:none;border-radius:10px;font-family:'Nunito',sans-serif;font-weight:800;font-size:0.95rem;cursor:pointer;transition:opacity 0.18s;">Spill nå</button>
    </div>`;
  }).join('');

  // Init difficulty buttons state
  games.forEach(g => {
    const sess = GZ.session;
    const defDiff = g.id==='wordle' ? (sess.wordleDiff||'normal') : g.id==='worldle' ? (sess.worldleDiff||'normal') : (sess.whoamiDiff||'normal');
    GZ._gameDiff = GZ._gameDiff || {};
    GZ._gameDiff[g.id] = defDiff;
  });
}

function gzSetDiff(gameId, diff) {
  GZ._gameDiff = GZ._gameDiff || {};
  GZ._gameDiff[gameId] = diff;
  const colors = {wordle:'#22c55e', worldle:'#4f6ef7', whoami:'#a855f7'};
  const c = colors[gameId] || 'var(--accent)';
  ['easy','normal','hard'].forEach(d => {
    const btn = document.getElementById(`diff-${gameId}-${d}`);
    if (!btn) return;
    const active = d === diff;
    btn.style.borderColor = active ? c : 'var(--border-2)';
    btn.style.background = active ? c+'22' : 'transparent';
    btn.style.color = active ? c : 'var(--text-2)';
  });
}

function gzStartTimer() {
  if (GZ.timerInterval) clearInterval(GZ.timerInterval);
  const update = () => {
    const el = document.getElementById('gz-session-timer');
    if (!el) return;
    const end = GZ.session.ends_at || GZ.session.endsAt;
    if (!end) { el.textContent = ''; return; }
    const left = new Date(end).getTime() - Date.now();
    if (left <= 0) { el.textContent = 'Økten er avsluttet'; clearInterval(GZ.timerInterval); return; }
    const h = Math.floor(left/3600000), m = Math.floor((left%3600000)/60000), s = Math.floor((left%60000)/1000);
    el.textContent = `Slutter om ${h>0?h+'t ':''} ${m}m ${s}s`;
  };
  update();
  GZ.timerInterval = setInterval(update, 1000);
}

function gzShowPanel(id) {
  ['gz-login','gz-lobby','gz-wordle','gz-worldle','gz-whoami','gz-leaderboard'].forEach(p => {
    const el = document.getElementById(p);
    if (el) el.style.display = p === id ? 'block' : 'none';
  });
}

function gzBackToLobby() {
  gzShowPanel('gz-lobby');
  gzRenderGameCards();
}

function gzLogout() {
  GZ.session = null; GZ.player = null; GZ.scores = {};
  if (GZ.timerInterval) clearInterval(GZ.timerInterval);
  gzShowPanel('gz-login');
  const inp = document.getElementById('gz-code-input'); if(inp) inp.value='';
}

function gzInit() {
  gzShowPanel(GZ.session ? 'gz-lobby' : 'gz-login');
  if (GZ.session) { gzRenderGameCards(); gzLoadMyScores(); }
}

async function gzSaveScore(game, score) {
  GZ.scores[game] = score;
  gzRenderMyScores();
  const player = state.student ? (state.student.name || state.student) : 'Anonym';
  const id = (GZ.session.code||'x') + '_' + game + '_' + player.replace(/\s/g,'_');
  try {
    await sbInsert('os_game_scores', { id, session_code: GZ.session.code, player_name: player, game, score });
  } catch(e) {}
  localStorage.setItem('oz_score_'+GZ.session.code+'_'+game, score);
}

function gzLoadMyScores() {
  if (!GZ.session) return;
  ['wordle','worldle','whoami'].forEach(g => {
    const s = localStorage.getItem('oz_score_'+GZ.session.code+'_'+g);
    if (s !== null) GZ.scores[g] = parseInt(s)||0;
  });
  gzRenderMyScores();
}

function gzRenderMyScores() {
  const el = document.getElementById('gz-my-scores');
  if (!el) return;
  const colors = {wordle:'#22c55e', worldle:'#4f6ef7', whoami:'#a855f7'};
  const labels = {wordle:'Wordle', worldle:'Worldle', whoami:'Who Am I'};
  el.innerHTML = Object.entries(GZ.scores).map(([g,s]) =>
    `<div style="background:${colors[g]}22;border:1px solid ${colors[g]}55;border-radius:8px;padding:6px 14px;font-family:'Fredoka One',cursive;font-size:1.05rem;color:${colors[g]};">${labels[g]}: ${s}p</div>`
  ).join('');
}

async function gzShowLeaderboard() {
  gzShowPanel('gz-leaderboard');
  const el = document.getElementById('gz-leaderboard-content');
  if (!el) return;
  el.innerHTML = '<div style="color:var(--text-3);">Laster toppliste...</div>';
  try {
    const rows = await dbGameReq('GET','os_game_scores',`session_code=eq.${GZ.session.code}&select=*&order=score.desc`);
    if (!rows || !rows.length) { el.innerHTML='<div style="color:var(--text-3);">Ingen poeng registrert ennå</div>'; return; }
    const totals = {};
    rows.forEach(r => { totals[r.player_name] = (totals[r.player_name]||0) + r.score; });
    const sorted = Object.entries(totals).sort((a,b)=>b[1]-a[1]);
    const medals = ['🥇','🥈','🥉'];
    el.innerHTML = sorted.map(([name,total],i) => `
      <div style="display:flex;align-items:center;gap:0.875rem;padding:0.875rem 1.1rem;background:var(--s1);border:1px solid var(--border);border-radius:12px;margin-bottom:0.5rem;">
        <div style="font-size:1.4rem;width:32px;text-align:center;">${medals[i]||'#'+(i+1)}</div>
        <div style="flex:1;font-weight:800;">${escHtml(name)}</div>
        <div style="font-family:'Fredoka One',cursive;font-size:1.2rem;color:var(--accent-h);">${total}p</div>
      </div>`).join('');
  } catch(e) {
    el.innerHTML='<div style="color:var(--red);">Kunne ikke laste toppliste</div>';
  }
}

// ── WORDLE ──
function gzStartWordle() {
  gzShowPanel('gz-wordle');
  const sess = GZ.session;
  const wLen = sess.wordleLen || 5;
  const custom = (sess.customWords||[]).filter(w=>w.length===wLen).map(w=>w.toLowerCase());
  const base = GZ_WORDS_NO.filter(w=>w.length===wLen).map(w=>w.toLowerCase());
  // Track played words to avoid repeats
  if (!GZ._playedWordle) GZ._playedWordle = new Set();
  let pool = custom.length > 0 ? custom : base.length > 0 ? base : GZ_WORDS_NO.map(w=>w.toLowerCase());
  // Filter out already played words (unless all exhausted)
  let unplayed = pool.filter(w => !GZ._playedWordle.has(w));
  if (unplayed.length === 0) { GZ._playedWordle.clear(); unplayed = pool; }
  const word = unplayed[Math.floor(Math.random()*unplayed.length)];
  GZ._playedWordle.add(word);
  const lang = sess.wordleLang || 'no';
  const diff = (GZ._gameDiff && GZ._gameDiff.wordle) || sess.wordleDiff || 'normal';
  const maxTries = diff==='easy' ? 8 : diff==='hard' ? 4 : 6;
  WORDLE_ST = { word, guesses:[], cur:'', over:false, maxTries, wLen:word.length };
  const diffEl = document.getElementById('wordle-diff-badge');
  if (diffEl) diffEl.textContent = {easy:'Lett',normal:'Normal',hard:'Vanskelig'}[diff] || '';
  const langBadge = document.getElementById('wordle-lang-badge');
  if (langBadge) langBadge.textContent = lang === 'en' ? '🇬🇧 Engelsk' : '🇳🇴 Norsk';
  document.getElementById('wordle-result').style.display='none';
  document.getElementById('wordle-msg').textContent='';
  const wgb = document.getElementById('wordle-giveup-btn');
  if (wgb) { wgb.style.display='inline-block'; wgb.style.color='var(--text-3)'; wgb.style.borderColor='var(--border-2)'; }
  wordleRender();
  wordleRenderKeyboard();
}

function wordleRender() {
  const board = document.getElementById('wordle-board');
  if (!board) return;
  board.innerHTML = '';
  const wLen = WORDLE_ST.word.length;
  const cellSize = wLen <= 5 ? 54 : wLen <= 6 ? 48 : 42;
  const showColors = GZ.session.wordleShowColors !== false;
  for (let r=0; r<WORDLE_ST.maxTries; r++) {
    const row = document.createElement('div');
    row.style.cssText='display:flex;gap:5px;';
    const guess = WORDLE_ST.guesses[r];
    const isCurrent = r === WORDLE_ST.guesses.length && !WORDLE_ST.over;
    const colors = guess ? wordleGetColors(WORDLE_ST.word, guess) : null;
    for (let c=0; c<wLen; c++) {
      const cell = document.createElement('div');
      cell.style.cssText=`width:${cellSize}px;height:${cellSize}px;border-radius:8px;display:flex;align-items:center;justify-content:center;font-family:'Fredoka One',cursive;font-size:${cellSize>48?'1.5':'1.2'}rem;font-weight:800;transition:all 0.25s;`;
      if (guess) {
        const letter = guess[c] || '';
        const color = showColors ? colors[c] : '#55566e';
        cell.textContent = letter.toUpperCase();
        cell.style.background = color; cell.style.color='white'; cell.style.border='2px solid '+color;
        // Flip animation
        cell.style.animation = `wordleFlip 0.4s ${c*0.08}s both`;
      } else if (isCurrent) {
        cell.textContent = (WORDLE_ST.cur[c]||'').toUpperCase();
        cell.style.background='var(--s2)';
        cell.style.border='2px solid '+(WORDLE_ST.cur[c]?'var(--accent)':'var(--border-2)');
        cell.style.color='var(--text)';
      } else {
        cell.style.background='var(--s2)'; cell.style.border='2px solid var(--border)';
      }
      row.appendChild(cell);
    }
    board.appendChild(row);
  }
}

function wordleGetColors(word, guess) {
  const wLen = word.length;
  const colors = new Array(wLen).fill('#55566e');
  const wordArr = word.split('');
  const guessArr = guess.split('');
  // Pass 1: mark greens
  for (let i = 0; i < wLen; i++) {
    if (guessArr[i] === wordArr[i]) {
      colors[i] = '#22c55e';
      wordArr[i] = null; guessArr[i] = null;
    }
  }
  // Pass 2: mark yellows (remaining letters)
  for (let i = 0; i < wLen; i++) {
    if (guessArr[i] === null) continue;
    const wi = wordArr.indexOf(guessArr[i]);
    if (wi !== -1) {
      colors[i] = '#f59e0b';
      wordArr[wi] = null;
    }
  }
  return colors;
}
function wordleColor(word, guess, idx) {
  return wordleGetColors(word, guess)[idx];
}

function wordleRenderKeyboard() {
  const kb = document.getElementById('wordle-keyboard');
  if (!kb || GZ.session.wordleShowKeyboard === false) { if(kb) kb.innerHTML=''; return; }
  const lang = GZ.session.wordleLang || 'no';
  const rows = lang === 'en'
    ? ['QWERTYUIOP','ASDFGHJKL','ZXCVBNM⌫↵']
    : ['QWERTYUIOPÅ','ASDFGHJKLØÆ','ZXCVBNM⌫↵'];
  const showColors = GZ.session.wordleShowColors !== false;
  // Build letter → best color map using proper duplicate handling
  const colors = {};
  WORDLE_ST.guesses.forEach(g => {
    const rowColors = wordleGetColors(WORDLE_ST.word, g);
    for(let i=0;i<g.length;i++) {
      const l=g[i], c=rowColors[i];
      const priority = {'#22c55e':3,'#f59e0b':2,'#55566e':1};
      if ((priority[c]||0) > (priority[colors[l]]||0)) colors[l]=showColors?c:'#55566e';
    }
  });
  kb.innerHTML = rows.map(row => `<div style="display:flex;gap:5px;">${[...row].map(k => {
    const bg = colors[k] || 'var(--s3)';
    const tc = colors[k] ? 'white' : 'var(--text)';
    const w = (k==='⌫'||k==='↵') ? '52px' : '36px';
    return `<button data-onclick="wordleKey" data-onclick-arg="${k}" style="width:${w};height:46px;border-radius:7px;border:none;background:${bg};color:${tc};font-family:'Nunito',sans-serif;font-weight:800;font-size:${k.length>1?'0.7':'0.95'}rem;cursor:pointer;transition:background 0.2s;">${k}</button>`;
  }).join('')}</div>`).join('');
}

function wordleKey(k) {
  if (WORDLE_ST.over) return;
  if (k==='⌫') { WORDLE_ST.cur=WORDLE_ST.cur.slice(0,-1); }
  else if (k==='↵') { wordleSubmit(); return; }
  else if (WORDLE_ST.cur.length<(WORDLE_ST.word?.length||5)) { WORDLE_ST.cur+=k.toLowerCase(); }
  wordleRender();
}

document.addEventListener('keydown', e => {
  if (document.getElementById('gz-wordle')?.style.display==='none') return;
  if (e.key==='Enter') wordleSubmit();
  else if (e.key==='Backspace') { WORDLE_ST.cur=WORDLE_ST.cur.slice(0,-1); wordleRender(); }
  else if (/^[a-zA-ZæøåÆØÅ]$/.test(e.key) && WORDLE_ST.cur.length<(WORDLE_ST.word?.length||5)) {
    WORDLE_ST.cur+=e.key.toLowerCase(); wordleRender();
  }
});


// Word dictionaries per language (common words cache to avoid repeated API calls)
const WORDLE_VALID_CACHE = new Set();
const WORDLE_INVALID_CACHE = new Set();

async function wordleCheckWord(word) {
  if (!word) return false;
  const w = word.toLowerCase().trim();
  if (WORDLE_VALID_CACHE.has(w)) return true;
  if (WORDLE_INVALID_CACHE.has(w)) return false;

  const lang = GZ.session.wordleLang || 'no';

  // Custom words are always valid
  const customWords = (GZ.session.customWords||[]).map(x=>x.toLowerCase());
  if (customWords.includes(w)) { WORDLE_VALID_CACHE.add(w); return true; }

  // Built-in word list check
  if (GZ_WORDS_NO.some(bw => bw.toLowerCase() === w)) {
    WORDLE_VALID_CACHE.add(w); return true;
  }
  if (GZ_WORDS_EN && GZ_WORDS_EN.some(bw => bw.toLowerCase() === w)) {
    WORDLE_VALID_CACHE.add(w); return true;
  }

  // English - Free Dictionary API (reliable, supports CORS)
  if (lang === 'en') {
    try {
      const res = await fetch('https://api.dictionaryapi.dev/api/v2/entries/en/' + encodeURIComponent(w),
        { signal: AbortSignal.timeout(3000) });
      if (res.ok) { WORDLE_VALID_CACHE.add(w); return true; }
      if (res.status === 404) { WORDLE_INVALID_CACHE.add(w); return false; }
    } catch(e) { console.warn('[Wordle] Dict API error:', e.message); }
    // If API unreachable, accept valid English chars
    const valid = /^[a-z]+$/.test(w);
    valid ? WORDLE_VALID_CACHE.add(w) : WORDLE_INVALID_CACHE.add(w);
    return valid;
  }

  // Norwegian - use ordbokene.no (Universitetet i Bergen) - correct CORS endpoint
  if (lang === 'no') {
    try {
      const res = await fetch(
        'https://ordbokene.no/api/bm,nn/search?q=' + encodeURIComponent(w) + '&include=e',
        { signal: AbortSignal.timeout(3000) }
      );
      if (res.ok) {
        const data = await res.json();
        // Response has articles array - if any exact match exists, word is valid
        const hasMatch = (data.articles?.bm?.length > 0) || (data.articles?.nn?.length > 0) ||
                         (data.meta?.bm?.total > 0) || (data.meta?.nn?.total > 0);
        hasMatch ? WORDLE_VALID_CACHE.add(w) : WORDLE_INVALID_CACHE.add(w);
        return hasMatch;
      }
    } catch(e) { console.warn('[Wordle] Ordbokene API error:', e.message); }
    // Fallback: accept Norwegian alphabet words
    const valid = /^[a-zæøå]+$/.test(w);
    valid ? WORDLE_VALID_CACHE.add(w) : WORDLE_INVALID_CACHE.add(w);
    return valid;
  }

  // Generic fallback
  const valid = /^[a-zæøåäöü]+$/.test(w);
  valid ? WORDLE_VALID_CACHE.add(w) : WORDLE_INVALID_CACHE.add(w);
  return valid;
}

function wordleShakeRow() {
  const board = document.getElementById('wordle-board');
  const rows = board?.children;
  const curRow = rows?.[WORDLE_ST.guesses.length];
  if (curRow) { curRow.style.animation='wordleShake 0.4s'; setTimeout(()=>curRow.style.animation='',500); }
}

async function wordleSubmit() {
  const wLen = WORDLE_ST.word.length;
  if (WORDLE_ST.over || WORDLE_ST.cur.length!==wLen) {
    if (WORDLE_ST.cur.length > 0) wordleShakeRow();
    return;
  }
  // Validate word unless it's a custom word or session skips validation
  const isCustom = (GZ.session.customWords||[]).map(w=>w.toLowerCase()).includes(WORDLE_ST.cur);
  if (!isCustom && GZ.session.wordleValidate !== false) {
    const valid = await wordleCheckWord(WORDLE_ST.cur);
    if (!valid) {
      const msgEl = document.getElementById('wordle-msg');
      if (msgEl) { msgEl.textContent='Ikke et gyldig ord'; msgEl.style.color='#ef4444'; setTimeout(()=>{msgEl.textContent='';msgEl.style.color='';},1800); }
      wordleShakeRow();
      return;
    }
  }
  WORDLE_ST.guesses.push(WORDLE_ST.cur);
  const won = WORDLE_ST.cur === WORDLE_ST.word;
  WORDLE_ST.cur='';
  wordleRender(); wordleRenderKeyboard();
  if (won) {
    const tries = WORDLE_ST.guesses.length;
    const score = Math.max(100, 600-(tries-1)*100);
    WORDLE_ST.over=true;
    const wGiveUp = document.getElementById('wordle-giveup-btn');
    if (wGiveUp) wGiveUp.style.display='none';
    document.getElementById('wordle-result').style.display='block';
    document.getElementById('wordle-result-msg').textContent='🎉 Riktig på '+tries+(tries===1?' forsøk!':' forsøk!');
    document.getElementById('wordle-result-word').textContent='Ordet var: '+WORDLE_ST.word.toUpperCase()+' · '+score+' poeng';
    document.getElementById('wordle-score-badge').style.display='block';
    document.getElementById('wordle-score-badge').textContent=score+'p';
    gzSaveScore('wordle', score);
  } else if (WORDLE_ST.guesses.length>=WORDLE_ST.maxTries) {
    WORDLE_ST.over=true;
    const wGiveUp2 = document.getElementById('wordle-giveup-btn');
    if (wGiveUp2) wGiveUp2.style.display='none';
    document.getElementById('wordle-result').style.display='block';
    document.getElementById('wordle-result-msg').textContent='😔 Ikke denne gangen!';
    document.getElementById('wordle-result-word').textContent='Ordet var: '+WORDLE_ST.word.toUpperCase()+' · 0 poeng';
    gzSaveScore('wordle', 0);
  }
  const msgEl=document.getElementById('wordle-msg');
  if(msgEl && !WORDLE_ST.over) msgEl.textContent='';
}

// ── WORLDLE ──
function gzStartWorldle() {
  gzShowPanel('gz-worldle');
  const sess = GZ.session;
  // Filter by continent if specified
  let pool = GZ_COUNTRIES;
  // Student may have picked a continent in the lobby
  const studentContinent = document.getElementById('student-worldle-continent')?.value;
  const activeContinent = studentContinent || sess.worldleContinent;
  if (activeContinent && activeContinent !== 'all') {
    const filtered = GZ_COUNTRIES.filter(c=>c.c===activeContinent || c.c.includes(activeContinent));
    if (filtered.length > 0) pool = filtered;
  }
  if (!GZ._playedWorldle) GZ._playedWorldle = new Set();
  let unplayedW = pool.filter(c => !GZ._playedWorldle.has(c.n));
  if (unplayedW.length === 0) { GZ._playedWorldle.clear(); unplayedW = pool; }
  const country = unplayedW[Math.floor(Math.random()*unplayedW.length)];
  GZ._playedWorldle.add(country.n);
  const diff = (GZ._gameDiff && GZ._gameDiff.worldle) || sess.worldleDiff || 'normal';
  const maxTries = diff==='easy' ? 8 : diff==='hard' ? 4 : 6;
  WORLDLE_ST = { country, guesses:[], over:false, maxTries };
  const path = document.getElementById('worldle-path');
  if (path) path.setAttribute('d', country.d);
  // Scale path to fit new 200x200 viewBox
  const svg = document.getElementById('worldle-svg');
  if (svg) svg.setAttribute('viewBox', '0 0 100 100');
  document.getElementById('worldle-guesses').innerHTML='';
  document.getElementById('worldle-result').style.display='none';
  document.getElementById('worldle-input').value='';
  document.getElementById('worldle-autocomplete').style.display='none';
  // Initial hint
  const hintEl = document.getElementById('worldle-hint');
  const attEl = document.getElementById('worldle-attempts-left');
  if (hintEl) {
    if (sess.worldleShowContinent!==false) {
      const chip = document.createElement('span');
      chip.style.cssText='display:inline-block;background:var(--s2);border:1px solid var(--border-2);border-radius:6px;padding:3px 10px;font-size:0.8rem;font-weight:700;';
      chip.textContent='🌍 '+country.c;
      hintEl.innerHTML='';
      hintEl.appendChild(chip);
    } else {
      hintEl.innerHTML='';
    }
  }
  if (attEl) attEl.textContent = maxTries + ' forsøk igjen';
  const wlgb = document.getElementById('worldle-giveup-btn');
  if (wlgb) { wlgb.style.display='inline-block'; wlgb.style.color='var(--text-3)'; wlgb.style.borderColor='var(--border-2)'; }
  const worldleInp = document.getElementById('worldle-input');
  if (worldleInp) worldleInp.disabled = false;
  const diffBadge = document.getElementById('worldle-diff-badge');
  if (diffBadge) diffBadge.textContent = {easy:'Lett',normal:'Normal',hard:'Vanskelig'}[diff]||'';
}

function worldleLevenshtein(a, b) {
  const m = a.length, n = b.length;
  const dp = Array.from({length:m+1}, (_,i)=>[i,...Array(n).fill(0)]);
  for (let j=0;j<=n;j++) dp[0][j]=j;
  for (let i=1;i<=m;i++) for (let j=1;j<=n;j++)
    dp[i][j] = a[i-1]===b[j-1] ? dp[i-1][j-1] : 1+Math.min(dp[i-1][j],dp[i][j-1],dp[i-1][j-1]);
  return dp[m][n];
}

let worldleAcIdx = -1;

function worldleAutocomplete(val) {
  const ac = document.getElementById('worldle-autocomplete');
  if (!ac) return;
  worldleAcIdx = -1;
  if (!val || val.length < 1) { ac.style.display='none'; return; }
  const v = val.toLowerCase().trim();

  // Get filtered pool based on continent
  const sess = GZ.session;
  let pool = GZ_COUNTRIES;
  // Student may have picked a continent in the lobby
  const studentContinent = document.getElementById('student-worldle-continent')?.value;
  const activeContinent = studentContinent || sess.worldleContinent;
  if (activeContinent && activeContinent !== 'all') {
    pool = GZ_COUNTRIES.filter(c=>c.c===sess.worldleContinent);
  }

  // Score each country
  const scored = pool.map(c => {
    const name = c.n.toLowerCase();
    let score = 0;
    if (name === v) score = 100;
    else if (name.startsWith(v)) score = 90 - name.length;
    else if (name.includes(v)) score = 70;
    else {
      // Fuzzy: check if typed chars appear in order
      let idx = 0;
      for (const ch of v) {
        const pos = name.indexOf(ch, idx);
        if (pos === -1) { score = -1; break; }
        idx = pos + 1;
        score += 1;
      }
      if (score > 0) score = Math.max(0, score - worldleLevenshtein(v, name.substring(0, v.length)));
    }
    return { c, score };
  }).filter(x=>x.score>=0).sort((a,b)=>b.score-a.score).slice(0,8);

  if (!scored.length) { ac.style.display='none'; return; }

  ac.style.display='block';
  ac.innerHTML = scored.map((x,i) => {
    const already = WORLDLE_ST.guesses.map(g=>g.toLowerCase()).includes(x.c.n.toLowerCase());
    return `<div data-onclick="worldleSelectCountry" data-onclick-args="${escHtml(JSON.stringify([x.c.n]))}" data-idx="${i}" data-ac-hover="${i}" style="padding:9px 14px;cursor:pointer;font-weight:700;font-size:0.88rem;border-bottom:1px solid var(--border);display:flex;align-items:center;gap:0.75rem;${already?'opacity:0.45;':''};">
      <span style="font-size:1.2rem;">${x.c.f}</span>
      <span style="flex:1;">${worldleHighlight(x.c.n, val)}</span>
      <span style="font-size:0.72rem;color:var(--text-3);">${x.c.c}</span>
      ${already ? '<span style="font-size:0.7rem;color:var(--text-3);">✓ prøvd</span>' : ''}
    </div>`;
  }).join('');
}

function worldleHighlight(name, query) {
  const q = query.toLowerCase();
  const n = name.toLowerCase();
  if (n.startsWith(q)) {
    return `<strong>${name.substring(0,q.length)}</strong>${name.substring(q.length)}`;
  }
  return name;
}

function worldleAcHover(idx) {
  worldleAcIdx = idx;
  document.querySelectorAll('#worldle-autocomplete > div').forEach((el,i) => {
    el.style.background = i===idx ? 'var(--accent-g)' : '';
  });
}

function worldleInputKeydown(e) {
  const ac = document.getElementById('worldle-autocomplete');
  const items = ac?.querySelectorAll('div');
  if (e.key === 'ArrowDown') {
    e.preventDefault();
    worldleAcIdx = Math.min(worldleAcIdx+1, (items?.length||1)-1);
    worldleAcHover(worldleAcIdx);
  } else if (e.key === 'ArrowUp') {
    e.preventDefault();
    worldleAcIdx = Math.max(0, worldleAcIdx-1);
    worldleAcHover(worldleAcIdx);
  } else if (e.key === 'Enter') {
    e.preventDefault();
    if (worldleAcIdx >= 0 && items?.[worldleAcIdx]) {
      const name = items[worldleAcIdx].dataset?.name || items[worldleAcIdx].textContent?.trim();
      const inp = document.getElementById('worldle-input');
      if (inp && name) { inp.value = name; }
      if (ac) ac.style.display = 'none';
      worldleAcIdx = -1;
      worldleGuess();
    } else {
      worldleGuess();
    }
  } else if (e.key === 'Escape') {
    if (ac) ac.style.display = 'none';
    worldleAcIdx = -1;
  }
}

function worldleSelectCountry(name, e) {
  if (e) e.preventDefault();
  const inp = document.getElementById('worldle-input');
  if (inp) { inp.value = name; inp.focus(); }
  const ac = document.getElementById('worldle-autocomplete');
  if (ac) ac.style.display = 'none';
  worldleAcIdx = -1;
  // Auto-submit on click
  worldleGuess();
}

function worldleHaversine(lat1, lon1, lat2, lon2) {
  const R = 6371;
  const dLat = (lat2-lat1)*Math.PI/180;
  const dLon = (lon2-lon1)*Math.PI/180;
  const a = Math.sin(dLat/2)*Math.sin(dLat/2) +
    Math.cos(lat1*Math.PI/180)*Math.cos(lat2*Math.PI/180)*Math.sin(dLon/2)*Math.sin(dLon/2);
  return Math.round(R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a)));
}
function worldleBearing(lat1, lon1, lat2, lon2) {
  const dLon = (lon2-lon1)*Math.PI/180;
  const y = Math.sin(dLon)*Math.cos(lat2*Math.PI/180);
  const x = Math.cos(lat1*Math.PI/180)*Math.sin(lat2*Math.PI/180) -
    Math.sin(lat1*Math.PI/180)*Math.cos(lat2*Math.PI/180)*Math.cos(dLon);
  const bearing = Math.atan2(y,x)*180/Math.PI;
  return (bearing+360)%360;
}
function worldleArrow(bearing) {
  const dirs = ['⬆️','↗️','➡️','↘️','⬇️','↙️','⬅️','↖️'];
  return dirs[Math.round(bearing/45)%8];
}

function worldleGuess() {
  if (WORLDLE_ST.over) return;
  const inp = document.getElementById('worldle-input');
  let guess = (inp?.value||'').trim();
  if (!guess) return;

  // Accept autocomplete selection if active
  const acItems = document.querySelectorAll('#worldle-autocomplete > div');
  if (worldleAcIdx >= 0 && acItems[worldleAcIdx]) {
    guess = acItems[worldleAcIdx].dataset?.name || guess;
  }

  inp.value = '';
  document.getElementById('worldle-autocomplete').style.display = 'none';
  worldleAcIdx = -1;

  const target = WORLDLE_ST.country;
  const guessCountry = GZ_COUNTRIES.find(c => c.n.toLowerCase() === guess.toLowerCase());
  if (!guessCountry) {
    // Unknown country - shake input
    inp.style.borderColor = '#ef4444';
    inp.placeholder = 'Ukjent land – prøv autocomplete';
    setTimeout(() => { inp.style.borderColor = 'var(--border-2)'; inp.placeholder = 'Skriv inn land ...'; }, 1500);
    return;
  }

  const correct = guessCountry.n.toLowerCase() === target.n.toLowerCase();
  WORLDLE_ST.guesses.push(guessCountry.n);

  const gl = document.getElementById('worldle-guesses');
  if (gl) {
    const row = document.createElement('div');

    if (correct) {
      // Green winning row
      row.style.cssText = 'display:grid;grid-template-columns:1fr auto auto;align-items:center;gap:0;border-radius:8px;overflow:hidden;animation:fadeIn 0.3s ease;border:1px solid #22c55e44;';
      row.innerHTML = `
        <div style="padding:11px 14px;background:rgba(34,197,94,0.15);font-weight:700;font-size:0.92rem;display:flex;align-items:center;gap:0.6rem;">
          <span style="font-size:1.2rem;">${guessCountry.f}</span>
          <span>${escHtml(guessCountry.n)}</span>
        </div>
        <div style="padding:11px 16px;background:rgba(34,197,94,0.1);font-weight:700;font-size:0.88rem;text-align:center;border-left:1px solid #22c55e33;color:#22c55e;">Du vant! 🎉</div>
        <div style="padding:11px 12px;background:rgba(34,197,94,0.15);display:flex;align-items:center;justify-content:center;border-left:1px solid #22c55e33;">
          <span style="font-size:1.3rem;">🏆</span>
        </div>`;
    } else {
      // Calculate distance and bearing
      const dist = worldleHaversine(guessCountry.lat||0, guessCountry.lon||0, target.lat||0, target.lon||0);
      const bearing = worldleBearing(guessCountry.lat||0, guessCountry.lon||0, target.lat||0, target.lon||0);
      const distStr = dist < 10 ? '< 10 km' : '~ ' + dist.toLocaleString('no-NO') + ' km';

      // Arrow box - exact worldlegame.io style: blue box with white arrow, rotated
      const arrowBox = `<div style="width:36px;height:36px;background:#4f6ef7;border-radius:6px;display:flex;align-items:center;justify-content:center;flex-shrink:0;">
        <svg width="18" height="18" viewBox="0 0 24 24" fill="white" style="transform:rotate(${Math.round(bearing)}deg);display:block;">
          <polygon points="12,2 20,20 12,15 4,20"/>
        </svg>
      </div>`;

      row.style.cssText = 'display:grid;grid-template-columns:1fr auto auto;align-items:center;gap:0;border-radius:8px;overflow:hidden;animation:fadeIn 0.3s ease;border:1px solid var(--border-2);';
      row.innerHTML = `
        <div style="padding:11px 14px;background:var(--s2);font-weight:700;font-size:0.92rem;display:flex;align-items:center;gap:0.6rem;">
          <span style="font-size:1.2rem;">${guessCountry.f}</span>
          <span>${escHtml(guessCountry.n)}</span>
        </div>
        <div style="padding:11px 16px;background:var(--s2);font-weight:700;font-size:0.88rem;text-align:center;white-space:nowrap;border-left:1px solid var(--border);color:var(--text-2);">${distStr}</div>
        <div style="padding:11px 12px;background:var(--s2);display:flex;align-items:center;justify-content:center;border-left:1px solid var(--border);">${arrowBox}</div>`;
    }
    gl.appendChild(row);
    gl.scrollTop = gl.scrollHeight;
  }

  if (correct) {
    const tries = WORLDLE_ST.guesses.length;
    const score = Math.max(50, 500-(tries-1)*80);
    WORLDLE_ST.over = true;
    const wldGiveUp = document.getElementById('worldle-giveup-btn');
    if (wldGiveUp) wldGiveUp.style.display = 'none';
    setTimeout(() => {
      document.getElementById('worldle-result').style.display = 'block';
      document.getElementById('worldle-result-msg').textContent = 'Du vant! ' + target.f;
      document.getElementById('worldle-result-country').textContent =
        target.n + ' · ' + target.c + ' · Befolkning: ' + target.p + '\n' + score + ' poeng';
      gzSaveScore('worldle', score);
    }, 400);
  } else if (WORLDLE_ST.guesses.length >= WORLDLE_ST.maxTries) {
    WORLDLE_ST.over = true;
    const wldGiveUp2 = document.getElementById('worldle-giveup-btn');
    if (wldGiveUp2) wldGiveUp2.style.display = 'none';
    setTimeout(() => {
      document.getElementById('worldle-result').style.display = 'block';
      document.getElementById('worldle-result-msg').textContent = 'Svaret var: ' + target.n + ' ' + target.f;
      document.getElementById('worldle-result-country').textContent = target.c + ' · Befolkning: ' + target.p + ' · 0 poeng';
      gzSaveScore('worldle', 0);
    }, 400);
  } else {
    // Update attempts + progressive hints
    const sess = GZ.session;
    const numGuesses = WORLDLE_ST.guesses.length;
    const remaining = WORLDLE_ST.maxTries - numGuesses;
    const attEl = document.getElementById('worldle-attempts-left');
    if (attEl) attEl.textContent = remaining + (remaining===1 ? ' forsøk igjen' : ' forsøk igjen');

    // Build hint chips
    const hintEl = document.getElementById('worldle-hint');
    if (hintEl) {
      const chips = [];
      if (sess.worldleShowContinent !== false) chips.push('🌍 ' + target.c);
      if (sess.worldleShowPop !== false && numGuesses >= 2) chips.push('👥 ' + target.p);
      if (numGuesses >= 3) chips.push('💡 ' + target.hints[Math.min(numGuesses-2, target.hints.length-1)]);
      hintEl.innerHTML = chips.map(c =>
        `<span style="display:inline-flex;align-items:center;gap:4px;background:var(--s2);border:1px solid var(--border-2);border-radius:6px;padding:4px 10px;font-size:0.8rem;font-weight:700;">${c}</span>`
      ).join('');
    }
  }
}

// ── WHO AM I ──
function gzStartWhoami() {
  gzShowPanel('gz-whoami');
  const sess = GZ.session;
  // Filter by category
  let pool = GZ_PERSONS;
  const studentCat = document.getElementById('student-whoami-cat')?.value;
  const activeCat = studentCat || sess.whoamiCategory;
  if (activeCat && activeCat !== 'alle') {
    const filtered = GZ_PERSONS.filter(p=>p.cat===activeCat);
    if (filtered.length > 0) pool = filtered;
  }
  // Use custom persons if set
  if (sess.whoamiCustom && sess.whoamiCustom.length > 0) {
    pool = sess.whoamiCustom;
  }
  if (!GZ._playedWhoami) GZ._playedWhoami = new Set();
  let unplayedP = pool.filter(p => !GZ._playedWhoami.has(p.n));
  if (unplayedP.length === 0) { GZ._playedWhoami.clear(); unplayedP = pool; }
  const person = unplayedP[Math.floor(Math.random()*unplayedP.length)];
  GZ._playedWhoami.add(person.n);
  // Difficulty
  const diff = (GZ._gameDiff && GZ._gameDiff.whoami) || sess.whoamiDiff || 'normal';
  const autoReveal = diff==='easy' ? 2 : diff==='hard' ? 0 : 1; // auto-reveal hints
  const maxScore = diff==='easy' ? 300 : diff==='hard' ? 700 : 500;
  const maxHints = person.hints.length;
  WHOAMI_ST = { person, revealed:0, over:false, maxHints, maxScore, diff };
  document.getElementById('whoami-hints-container').innerHTML='';
  document.getElementById('whoami-result').style.display='none';
  document.getElementById('whoami-input').value='';
  document.getElementById('whoami-reveal-btn').style.display='inline-flex';
  // Auto-reveal hints based on difficulty
  for (let i=0; i<autoReveal; i++) whoamiRevealHint(true);
  if (autoReveal === 0) whoamiRevealHint(true); // always show at least 1
  // Update points display
  const ptsRemaining = Math.max(100, maxScore - WHOAMI_ST.revealed*Math.floor(maxScore/maxHints));
  document.getElementById('whoami-points-left').textContent = ptsRemaining+' poeng mulig';
}

function whoamiRevealHint(silent) {
  const st=WHOAMI_ST;
  if (st.over || st.revealed>=st.maxHints) return;
  const hint=st.person.hints[st.revealed];
  st.revealed++;
  const container=document.getElementById('whoami-hints-container');
  if(container) {
    const el=document.createElement('div');
    el.style.cssText=`padding:0.875rem 1.1rem;background:var(--s1);border:1px solid var(--border);border-radius:12px;font-weight:700;font-size:0.92rem;${silent?'':'animation:fadeIn 0.3s ease;'}`;
    const catColors={politiker:'#4f6ef7',vitenskapsmann:'#22c55e',kunstner:'#a855f7',idrett:'#f59e0b',historisk:'#ef4444',aktivist:'#06b6d4',gründer:'#f59e0b',oppdagelsesreisende:'#22c55e'};
    const catColor = catColors[st.person.cat] || 'var(--accent-h)';
    el.innerHTML=`<span style="color:${catColor};font-family:'Fredoka One',cursive;margin-right:8px;">Hint ${st.revealed}:</span>${escHtml(hint)}`;
    container.appendChild(el);
  }
  const pointsPerHint = Math.floor((st.maxScore||500)/st.maxHints);
  const remaining = Math.max(100, (st.maxScore||500) - st.revealed*pointsPerHint);
  const ptsEl=document.getElementById('whoami-points-left');
  if(ptsEl) ptsEl.textContent=(st.revealed<st.maxHints?remaining+' poeng mulig':'Siste hint!');
  const btn=document.getElementById('whoami-reveal-btn');
  if(btn) {
    if(st.revealed>=st.maxHints) btn.style.display='none';
    else btn.textContent=`Vis neste hint (−${pointsPerHint} poeng)`;
  }
}


let whoamiAcIdx = -1;

function whoamiAutocomplete(val) {
  const ac = document.getElementById('whoami-autocomplete');
  if (!ac) return;
  whoamiAcIdx = -1;
  if (!val || val.length < 1) { ac.style.display='none'; return; }
  const v = val.toLowerCase().trim();

  // Pool: custom persons or all persons
  const sess = GZ.session;
  let pool = sess.whoamiCustom?.length ? sess.whoamiCustom : GZ_PERSONS;
  const studentCat = document.getElementById('student-whoami-cat')?.value;
  const activeCat = studentCat || sess.whoamiCategory;
  if (activeCat && activeCat !== 'alle') {
    const filtered = pool.filter(p=>p.cat===activeCat);
    if (filtered.length) pool = filtered;
  }

  // Score each person
  const scored = pool.map(p => {
    const name = p.n.toLowerCase();
    const parts = name.split(' ');
    let score = 0;
    if (name === v) score = 100;
    else if (name.startsWith(v)) score = 90;
    else if (parts.some(part => part.startsWith(v))) score = 80;
    else if (name.includes(v)) score = 60;
    else {
      // Fuzzy: Levenshtein on first word
      const firstWord = parts[0];
      const dist = worldleLevenshtein(v, firstWord.substring(0, Math.max(v.length, firstWord.length)));
      if (dist <= 2) score = Math.max(0, 40 - dist*10);
    }
    return { p, score };
  }).filter(x=>x.score>0).sort((a,b)=>b.score-a.score).slice(0,8);

  if (!scored.length) { ac.style.display='none'; return; }
  ac.style.display='block';

  const catColors = {politiker:'#4f6ef7',vitenskapsmann:'#22c55e',kunstner:'#a855f7',
    idrett:'#f59e0b',historisk:'#ef4444',aktivist:'#06b6d4',gründer:'#f59e0b',oppdagelsesreisende:'#22c55e'};

  ac.innerHTML = scored.map((x,i) => {
    const catColor = catColors[x.p.cat] || 'var(--text-3)';
    const catLabel = {politiker:'Politiker',vitenskapsmann:'Vitenskap',kunstner:'Kunst',
      idrett:'Idrett',historisk:'Historisk',aktivist:'Aktivist',gründer:'Gründer',
      oppdagelsesreisende:'Utforsker'}[x.p.cat] || x.p.cat||'';
    // Highlight matching part
    const highlighted = whoamiHighlight(x.p.n, val);
    return `<div data-onclick="whoamiSelectPerson" data-onclick-args="${escHtml(JSON.stringify([x.p.n]))}" data-idx="${i}" data-name="${escHtml(x.p.n)}" data-whoami-hover="${i}" style="padding:9px 14px;cursor:pointer;display:flex;align-items:center;justify-content:space-between;gap:0.75rem;border-bottom:1px solid var(--border);font-size:0.9rem;font-weight:700;">
      <span>${highlighted}</span>
      <span style="font-size:0.72rem;color:${catColor};background:${catColor}22;border-radius:4px;padding:2px 7px;white-space:nowrap;">${catLabel}</span>
    </div>`;
  }).join('');
}

function whoamiHighlight(name, query) {
  const q = query.toLowerCase();
  const n = name.toLowerCase();
  if (n.startsWith(q)) return `<strong>${name.substring(0,q.length)}</strong>${name.substring(q.length)}`;
  // Highlight first matching word
  const parts = name.split(' ');
  return parts.map(p => p.toLowerCase().startsWith(q) ? `<strong>${p}</strong>` : p).join(' ');
}

function whoamiAcHover(idx) {
  whoamiAcIdx = idx;
  document.querySelectorAll('#whoami-autocomplete > div').forEach((el,i) => {
    el.style.background = i===idx ? 'var(--accent-g)' : '';
  });
}

function whoamiSelectPerson(name, e) {
  if (e) e.preventDefault();
  const inp = document.getElementById('whoami-input');
  if (inp) { inp.value = name; inp.focus(); }
  const ac = document.getElementById('whoami-autocomplete');
  if (ac) ac.style.display = 'none';
  whoamiAcIdx = -1;
  // Don't auto-submit - let student confirm
}

function whoamiInputKeydown(e) {
  const ac = document.getElementById('whoami-autocomplete');
  const items = ac?.querySelectorAll('div');
  if (e.key === 'ArrowDown') {
    e.preventDefault();
    whoamiAcIdx = Math.min(whoamiAcIdx+1, (items?.length||1)-1);
    whoamiAcHover(whoamiAcIdx);
  } else if (e.key === 'ArrowUp') {
    e.preventDefault();
    whoamiAcIdx = Math.max(0, whoamiAcIdx-1);
    whoamiAcHover(whoamiAcIdx);
  } else if (e.key === 'Enter') {
    if (whoamiAcIdx >= 0 && items?.[whoamiAcIdx]) {
      const name = items[whoamiAcIdx].dataset?.name || '';
      const inp = document.getElementById('whoami-input');
      if (inp && name) inp.value = name;
      if (ac) ac.style.display = 'none';
      whoamiAcIdx = -1;
    }
    whoamiGuess();
  } else if (e.key === 'Escape') {
    if (ac) ac.style.display = 'none';
    whoamiAcIdx = -1;
  }
}

function whoamiGuess() {
  if (WHOAMI_ST.over) return;
  const inp=document.getElementById('whoami-input');
  const guess=(inp?.value||'').trim().toLowerCase();
  if (!guess) return;
  // Fuzzy matching: accept if close enough to any part of the name
  const fullName = WHOAMI_ST.person.n.toLowerCase();
  const nameParts = fullName.split(' ');
  const lastName = nameParts.slice(-1)[0];
  const firstName = nameParts[0];
  // Direct match
  let correct = fullName === guess || fullName.includes(guess) || guess.includes(lastName);
  // Fuzzy: allow 1-2 character typos on last name or first name
  if (!correct && guess.length >= 3) {
    const distLast = worldleLevenshtein(guess, lastName);
    const distFirst = worldleLevenshtein(guess, firstName);
    const distFull = worldleLevenshtein(guess, fullName);
    correct = distLast <= 2 || distFirst <= 2 || distFull <= 3;
  }
  if (correct) {
    const pointsPerHint = Math.floor((WHOAMI_ST.maxScore||500)/WHOAMI_ST.maxHints);
    const score=Math.max(100,(WHOAMI_ST.maxScore||500) - (WHOAMI_ST.revealed-1)*pointsPerHint);
    WHOAMI_ST.over=true;
    document.getElementById('whoami-result').style.display='block';
    document.getElementById('whoami-result-msg').textContent='🎉 Riktig!';
    document.getElementById('whoami-result-name').textContent=WHOAMI_ST.person.n+' · '+score+' poeng';
    gzSaveScore('whoami', score);
  } else {
    if (inp) { inp.value=''; inp.style.borderColor='#ef4444'; setTimeout(()=>inp.style.borderColor='var(--border-2)',800); }
    showToast('Ikke riktig – prøv igjen!');
  }
}

// ── TEACHER SESSION MANAGEMENT ──

async function gsGenerateWordleWords() {
  const topic = document.getElementById('gsWordleAiTopic')?.value.trim();
  if (!topic) { showToast('Skriv inn et tema'); return; }
  const spinner = document.getElementById('gsWordleAiSpinner');
  const resultEl = document.getElementById('gsWordleAiResult');
  if (spinner) spinner.style.display = 'inline-block';
  if (resultEl) resultEl.style.display = 'none';
  const wLen = parseInt(document.getElementById('gsWordleLen')?.value||'5');
  const lang = document.getElementById('gsWordleLang')?.value || 'no';
  const key = getApiKey();
  if (!key) { showToast('Ingen API-nøkkel – sjekk Innstillinger'); if(spinner)spinner.style.display='none'; return; }
  const langPrompt = lang === 'en'
    ? `Create a list of exactly 20 English words with exactly ${wLen} letters about the topic: "${topic}". Only real English words. Reply ONLY with a comma-separated list of words in UPPERCASE, no other text. Example: STORM,OCEAN,FLAME`
    : `Lag en liste med nøyaktig 20 ${lang==='no'?'norske':'ord på valgt språk'} med nøyaktig ${wLen} bokstaver som handler om temaet: "${topic}". Bare gyldige ord. Svar KUN med en kommaseparert liste over ordene med store bokstaver, ingen annen tekst. Eksempel: FJORD,STEIN,SNØEN`;
  try {
    const res = await _anthropicFetch('https://api.anthropic.com/v1/messages', {
      method:'POST',
      headers:{'Content-Type':'application/json','x-api-key':key,'anthropic-version':'2023-06-01','anthropic-dangerous-direct-browser-access':'true'},
      body: JSON.stringify({
        model:'claude-sonnet-4-20250514', max_tokens:500,
        messages:[{role:'user',content:langPrompt}]
      })
    });
    const data = await res.json();
    const text = (data.content?.[0]?.text||'').trim().toUpperCase();
    const words = text.split(/[,\s]+/).map(w=>w.replace(/[^A-ZÆØÅÄÖÜ]/g,'')).filter(w=>w.length===wLen);
    if (!words.length) throw new Error('Ingen gyldige ord generert');
    // Put in the custom words field
    const inp = document.getElementById('gsCustomWords');
    if (inp) inp.value = words.join(', ');
    if (resultEl) { resultEl.style.display='block'; resultEl.textContent=`✅ ${words.length} ord generert fra "${topic}": ${words.slice(0,5).join(', ')}${words.length>5?'...':''}`; }
    showToast('✅ '+words.length+' Wordle-ord generert!');
  } catch(e) {
    showToast('❌ '+e.message);
  } finally {
    if (spinner) spinner.style.display='none';
  }
}

async function gsGeneratePersons() {
  const topic = document.getElementById('gsWhoamiAiTopic')?.value.trim();
  if (!topic) { showToast('Skriv inn et tema'); return; }
  const spinner = document.getElementById('gsPersonAiSpinner');
  const resultEl = document.getElementById('gsWhoamiAiResult');
  if (spinner) spinner.style.display = 'inline-block';
  if (resultEl) resultEl.style.display = 'none';
  const key = getApiKey();
  if (!key) { showToast('Ingen API-nøkkel – sjekk Innstillinger'); if(spinner)spinner.style.display='none'; return; }
  try {
    const res = await _anthropicFetch('https://api.anthropic.com/v1/messages', {
      method:'POST',
      headers:{'Content-Type':'application/json','x-api-key':key,'anthropic-version':'2023-06-01','anthropic-dangerous-direct-browser-access':'true'},
      body: JSON.stringify({
        model:'claude-sonnet-4-20250514', max_tokens:2000,
        messages:[{role:'user',content:`Lag 5 «Who Am I»-kort med kjente personer relatert til temaet: "${topic}". Hver person skal ha 5 hint som gradvis avslører hvem personen er (starter vagt, slutter spesifikt). Svar KUN med JSON: [{"n":"Fullt navn","cat":"kategori","hints":["Hint1","Hint2","Hint3","Hint4","Hint5"]}] Kategorier: politiker, vitenskapsmann, kunstner, idrett, historisk, aktivist, gründer. Alt på norsk.`}]
      })
    });
    const data = await res.json();
    const text = (data.content?.[0]?.text||'').replace(/```json|```/g,'').trim();
    const jsonMatch = text.match(/\[[\s\S]*\]/);
    if (!jsonMatch) throw new Error('Ugyldig svar fra AI');
    const persons = JSON.parse(jsonMatch[0]);
    window._gsCustomPersons = persons;
    if (resultEl) {
      resultEl.style.display='block';
      resultEl.innerHTML=`✅ ${persons.length} personer generert: ${escHtml(persons.map(p=>p.n).join(', '))}<br><small style="color:var(--text-3)">Disse vil bli brukt i Who Am I for denne økten</small>`;
    }
    showToast('✅ '+persons.length+' Who Am I-kort generert!');
  } catch(e) {
    showToast('❌ '+e.message);
  } finally {
    if (spinner) spinner.style.display='none';
  }
}


function gsToggleGamePanel(game, show) {
  const panel = document.getElementById('gs-'+game+'-panel');
  if (panel) panel.style.display = show ? 'block' : 'none';
}
async function gsCreate() {
  const name=document.getElementById('gsName')?.value.trim();
  const startVal=document.getElementById('gsStart')?.value;
  const endVal=document.getElementById('gsEnd')?.value;
  if (!name) { showToast('Gi økten et navn'); return; }
  if (!endVal) { showToast('Sett en sluttid'); return; }
  const code = Math.random().toString(36).substring(2,8).toUpperCase();
  const games=[];
  if(document.getElementById('gsWordle')?.checked) games.push('wordle');
  if(document.getElementById('gsWorldle')?.checked) games.push('worldle');
  if(document.getElementById('gsWhoami')?.checked) games.push('whoami');
  const wLen = parseInt(document.getElementById('gsWordleLen')?.value||'5');
  const customWordsRaw=document.getElementById('gsCustomWords')?.value||'';
  const customWords=customWordsRaw.split(',').map(w=>w.trim().toUpperCase()).filter(w=>w.length===wLen);
  // Game-specific settings
  const wordleDiff = document.getElementById('gsWordleDiff')?.value || 'normal';
  const wordleLang = document.getElementById('gsWordleLang')?.value || 'no';
  const wordleShowColors = document.getElementById('gsWordleColors')?.checked !== false;
  const wordleShowKeyboard = document.getElementById('gsWordleKb')?.checked !== false;
  const worldleDiff = document.getElementById('gsWorldleDiff')?.value || 'normal';
  const worldleContinent = document.getElementById('gsWorldleContinent')?.value || 'all';
  const worldleShowContinent = document.getElementById('gsWorldleContinent2')?.checked !== false;
  const worldleShowPop = document.getElementById('gsWorldlePop')?.checked !== false;
  const whoamiDiff = document.getElementById('gsWhoamiDiff')?.value || 'normal';
  const whoamiCategory = document.getElementById('gsWhoamiCat')?.value || 'alle';
  const whoamiCustom = window._gsCustomPersons || null;
  const starts = startVal ? new Date(startVal).toISOString() : new Date().toISOString();
  const ends   = new Date(endVal).toISOString();
  const config = { 
    name, games, customWords, code, wordleLen:wLen,
    wordleDiff, wordleLang, wordleShowColors, wordleShowKeyboard,
    worldleDiff, worldleContinent, worldleShowContinent, worldleShowPop,
    whoamiDiff, whoamiCategory, whoamiCustom
  };
  const sess = { id: code, code, name, starts_at: starts, ends_at: ends, config };

  // Always save to localStorage so same-device works instantly
  localStorage.setItem('os_game_session_'+code, JSON.stringify({
    name, games, customWords, code,
    startsAt: new Date(starts).getTime(),
    endsAt:   new Date(ends).getTime()
  }));

  // Save to Supabase - DB._q returns null on failure, [] or array on success
  const sbResult = await sbInsert('os_game_sessions', sess);
  if (sbResult !== null) {
    showToast('✅ Økt lagret i sky! Kode: ' + code);
  } else {
    // Show diagnostic info
    const diagBtn = document.getElementById('gs-diag-btn');
    if (diagBtn) diagBtn.style.display = 'inline-block';
    showToast('⚠️ Sky-lagring feilet. Bruk diagnoseverktøyet. Kode: ' + code, 6000);
  }

  gsShowActiveBanner({ code, name, ends_at: ends, games });
  gsLoadSessions();

  // Clear form
  document.getElementById('gsName').value='';
  document.getElementById('gsStart').value='';
  document.getElementById('gsEnd').value='';
  document.getElementById('gsCustomWords').value='';
}

async function gsLoadSessions() {
  const el=document.getElementById('gsSessionList');
  if(!el) return;
  el.innerHTML='<div style="color:var(--text-3);font-size:0.88rem;padding:0.5rem;">Laster...</div>';
  let sessions = [];

  // Merge Supabase + localStorage sessions
  const rows = await sbSelect('os_game_sessions', 'select=*&order=created_at.desc&limit=20');
  if (rows && rows.length) sessions = rows.map(s => ({
      code: s.code||s.id,
      name: (s.config&&s.config.name)||s.name||s.id,
      games: (s.config&&s.config.games)||s.games||['wordle','worldle','whoami'],
      customWords: (s.config&&s.config.customWords)||[],
      starts_at: s.starts_at,
      ends_at: s.ends_at,
      _source:'supabase'
    }));

  // Also include localStorage sessions not yet in list
  for (let i=0; i<localStorage.length; i++) {
    const k = localStorage.key(i);
    if (!k || !k.startsWith('os_game_session_')) continue;
    try {
      const s = JSON.parse(localStorage.getItem(k));
      if (!sessions.find(r=>r.code===s.code)) {
        sessions.push({ code:s.code, name:s.name||s.code, games:s.games||[], customWords:s.customWords||[],
          starts_at: s.startsAt ? new Date(s.startsAt).toISOString() : null,
          ends_at: s.endsAt ? new Date(s.endsAt).toISOString() : null, _source:'local' });
      }
    } catch(e) {}
  }

  if (rows === null && !sessions.length) {
    el.innerHTML='<div style="color:#f59e0b;font-size:0.85rem;padding:0.5rem;"><strong>⚠️ Kan ikke nå Supabase.</strong> Kjør SQL-skjema og klikk «Test tilkobling».</div>';
    return;
  }
  if (!sessions.length) {
    el.innerHTML='<div style="color:var(--text-3);font-size:0.88rem;padding:0.5rem;">Ingen spilløkter opprettet ennå.</div>';
    return;
  }

  // Sort: active first
  const now = Date.now();
  sessions.sort((a,b) => {
    const aEnd = a.ends_at ? new Date(a.ends_at).getTime() : 0;
    const bEnd = b.ends_at ? new Date(b.ends_at).getTime() : 0;
    const aActive = aEnd > now, bActive = bEnd > now;
    if (aActive !== bActive) return aActive ? -1 : 1;
    return bEnd - aEnd;
  });

  el.innerHTML = sessions.map(s => {
    const endTs = s.ends_at ? new Date(s.ends_at).getTime() : 0;
    const startTs = s.starts_at ? new Date(s.starts_at).getTime() : 0;
    const active = endTs > now && (startTs===0 || startTs <= now);
    const upcoming = startTs > now;
    const statusColor = active ? '#22c55e' : upcoming ? '#f59e0b' : '#ef4444';
    const statusLabel = active ? 'AKTIV' : upcoming ? 'SNART' : 'AVSLUTTET';
    const gameLabels = (s.games||[]).map(g=>({wordle:'Wordle',worldle:'Worldle',whoami:'Who Am I'}[g]||g)).join(' · ');
    const localBadge = s._source==='local' ? '<span style="font-size:0.65rem;background:rgba(245,158,11,0.15);color:#f59e0b;border:1px solid rgba(245,158,11,0.3);border-radius:4px;padding:1px 6px;margin-left:6px;">LOKALT</span>' : '';
    return `<div style="background:var(--s1);border:1px solid ${active?'rgba(79,110,247,0.4)':'var(--border)'};border-radius:14px;padding:1.1rem 1.25rem;margin-bottom:0.75rem;${active?'box-shadow:0 0 0 1px rgba(79,110,247,0.15)':''}" id="gs-card-${s.code}">
      <div style="display:flex;align-items:flex-start;gap:0.875rem;flex-wrap:wrap;">
        <div style="flex:1;min-width:160px;">
          <div style="display:flex;align-items:center;gap:0.5rem;margin-bottom:0.3rem;">
            <span style="font-weight:800;font-size:1rem;">${escHtml(s.name)}</span>
            <span style="padding:2px 9px;border-radius:50px;font-size:0.68rem;font-weight:800;background:${statusColor}22;color:${statusColor};border:1px solid ${statusColor}44;">${statusLabel}</span>
            ${localBadge}
          </div>
          <div style="font-family:'Fredoka One',cursive;font-size:2rem;color:var(--accent-h);letter-spacing:0.2em;line-height:1.1;">${s.code}</div>
          <div style="font-size:0.78rem;color:var(--text-3);margin-top:0.3rem;">${gameLabels||'Alle spill'}</div>
          ${s.ends_at ? `<div style="font-size:0.75rem;color:var(--text-3);margin-top:0.2rem;">Slutter: ${new Date(s.ends_at).toLocaleString('no-NO',{day:'2-digit',month:'2-digit',hour:'2-digit',minute:'2-digit'})}</div>` : ''}
        </div>
        <div style="display:flex;flex-direction:column;gap:0.4rem;align-items:flex-end;">
          ${active ? `<button data-onclick="gsCopyCode" data-onclick-arg="${s.code}" style="padding:6px 12px;background:var(--accent);color:white;border:none;border-radius:7px;font-family:'Nunito',sans-serif;font-weight:800;font-size:0.78rem;cursor:pointer;display:flex;align-items:center;gap:5px;"><svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>Kopier kode</button>` : ''}
          <button data-onclick="gsViewLeaderboard" data-onclick-arg="${s.code}" style="padding:6px 12px;background:var(--s2);border:1px solid var(--border-2);border-radius:7px;font-family:'Nunito',sans-serif;font-weight:800;font-size:0.78rem;color:var(--text-2);cursor:pointer;">Toppliste</button>
          <button data-onclick="gsEditSession" data-onclick-arg="${s.code}" style="padding:6px 12px;background:var(--s2);border:1px solid var(--border-2);border-radius:7px;font-family:'Nunito',sans-serif;font-weight:800;font-size:0.78rem;color:var(--text-2);cursor:pointer;">Rediger</button>
          <button data-onclick="gsDeleteSession" data-onclick-arg="${s.code}"
            style="padding:6px 12px;background:rgba(239,68,68,0.1);border:1px solid rgba(239,68,68,0.3);border-radius:7px;font-family:'Nunito',sans-serif;font-weight:800;font-size:0.78rem;color:#ef4444;cursor:pointer;">Slett</button>
          <button data-onclick="gsEndSession" data-onclick-arg="${s.code}" style="padding:6px 12px;background:rgba(239,68,68,0.1);border:1px solid rgba(239,68,68,0.3);border-radius:7px;font-family:'Nunito',sans-serif;font-weight:800;font-size:0.78rem;color:#ef4444;cursor:pointer;">Avslutt</button>
        </div>
      </div>
    </div>`;
  }).join('');
}

async function gsViewLeaderboard(code) {
  const wrap=document.getElementById('gsLeaderboardWrap');
  const table=document.getElementById('gsLeaderboardTable');
  if(!wrap||!table) return;
  wrap.style.display='block';
  table.innerHTML='<div style="color:var(--text-3);font-size:0.88rem;">Laster...</div>';
  try {
    const rows=await sbSelect('os_game_scores', 'session_code=eq.'+encodeURIComponent(code)+'&select=*&order=score.desc');
    if(!rows||!rows.length) { table.innerHTML='<div style="color:var(--text-3);">Ingen poeng ennå</div>'; return; }
    const totals={};
    rows.forEach(r=>{ totals[r.player_name]=(totals[r.player_name]||0)+r.score; });
    const sorted=Object.entries(totals).sort((a,b)=>b[1]-a[1]);
    const medals=['🥇','🥈','🥉'];
    table.innerHTML=sorted.map(([name,total],i)=>`
      <div style="display:flex;gap:0.875rem;padding:10px 14px;background:var(--s2);border:1px solid var(--border);border-radius:10px;margin-bottom:0.4rem;align-items:center;">
        <span style="font-size:1.2rem;">${medals[i]||i+1+'.'}</span>
        <span style="flex:1;font-weight:800;">${escHtml(name)}</span>
        <span style="font-family:'Fredoka One',cursive;font-size:1.1rem;color:var(--accent-h);">${total}p</span>
      </div>`).join('');
  } catch(e) { table.innerHTML='<div style="color:var(--red);">Feil ved lasting</div>'; }
}



async function gsLoadActiveBanner() {
  const now = Date.now();
  // Check Supabase for active sessions
  try {
    const rows = await dbGameReq('GET','os_game_sessions','select=*&order=created_at.desc&limit=5');
    if (rows && rows.length) {
      const active = rows.find(s => {
        const end = s.ends_at ? new Date(s.ends_at).getTime() : Infinity;
        const start = s.starts_at ? new Date(s.starts_at).getTime() : 0;
        return end > now && start <= now;
      });
      if (active) { gsShowActiveBanner({...(active.config||{}), ...active}); return; }
    }
  } catch(e) {}
  // Check localStorage
  for (let i=0; i<localStorage.length; i++) {
    const k = localStorage.key(i);
    if (!k || !k.startsWith('os_game_session_')) continue;
    try {
      const s = JSON.parse(localStorage.getItem(k));
      if (s.endsAt > now && (!s.startsAt || s.startsAt <= now)) {
        gsShowActiveBanner(s); return;
      }
    } catch(e) {}
  }
  document.getElementById('gs-active-banner')?.style && (document.getElementById('gs-active-banner').style.display='none');
}

function gsShowActiveBanner(sess) {
  const banner = document.getElementById('gs-active-banner');
  if (!banner) return;
  if (!sess) { banner.style.display='none'; return; }
  banner.style.display = 'block';
  banner.innerHTML = `
    <div style="display:flex;align-items:center;gap:1rem;flex-wrap:wrap;">
      <div style="flex:1;">
        <div style="font-size:0.72rem;font-weight:800;color:var(--text-3);text-transform:uppercase;letter-spacing:0.06em;margin-bottom:0.25rem;">Aktiv spilløkt</div>
        <div style="font-weight:800;font-size:0.95rem;color:var(--text);">${escHtml(sess.name||sess.code)}</div>
        <div style="font-size:0.78rem;color:var(--text-2);margin-top:0.15rem;">Slutter: ${sess.ends_at?new Date(sess.ends_at).toLocaleString('no-NO',{day:'2-digit',month:'2-digit',hour:'2-digit',minute:'2-digit'}):'-'}</div>
      </div>
      <div style="text-align:center;">
        <div style="font-size:0.72rem;font-weight:800;color:var(--text-3);text-transform:uppercase;letter-spacing:0.06em;margin-bottom:0.2rem;">Kode til elevene</div>
        <div style="font-family:'Fredoka One',cursive;font-size:2.5rem;color:var(--accent-h);letter-spacing:0.25em;line-height:1;">${sess.code}</div>
      </div>
      <button data-onclick="gsCopyCode" data-onclick-arg="${sess.code}" style="padding:10px 18px;background:var(--accent);color:white;border:none;border-radius:9px;font-family:'Nunito',sans-serif;font-weight:800;font-size:0.88rem;cursor:pointer;">Kopier kode</button>
    </div>`;
}

function gsCopyCode(code) {
  navigator.clipboard.writeText(code).then(()=>showToast('✅ Kode kopiert: ' + code)).catch(()=>showToast('Koden er: ' + code));
}

async function gsDeleteSession(code) {
  if (!confirm('Slette spilløkt ' + code + ' permanent? Dette kan ikke angres.')) return;
  try { await DB._q('DELETE','os_game_sessions','id=eq.'+encodeURIComponent(code)); } catch(e) {}
  localStorage.removeItem('os_game_session_'+code);
  showToast('Økt slettet');
  gsLoadSessions();
}

async function gsEndSession(code) {
  if (!confirm('Avslutte spilløkt ' + code + '? Elevene kan ikke lenger logge inn.')) return;
  // Set ends_at to now in Supabase
  try {
    const url = SB_URL+'/rest/v1/os_game_sessions?id=eq.'+encodeURIComponent(code);
    await fetch(url, { method:'PATCH', headers:{'apikey':SB_KEY,'Authorization':'Bearer '+SB_KEY,'Content-Type':'application/json','Prefer':'return=minimal'}, body: JSON.stringify({ends_at: new Date().toISOString()}) });
  } catch(e) {}
  // Update localStorage
  const raw = localStorage.getItem('os_game_session_'+code);
  if (raw) {
    try { const s=JSON.parse(raw); s.endsAt=Date.now(); localStorage.setItem('os_game_session_'+code,JSON.stringify(s)); } catch(e){}
  }
  showToast('Økt avsluttet');
  gsLoadSessions();
}

function gsEditSession(code) {
  // Load session data into form for editing
  const raw = localStorage.getItem('os_game_session_'+code);
  let sess = null;
  try { sess = raw ? JSON.parse(raw) : null; } catch(e) {}
  if (!sess) { showToast('Kan ikke laste øktdata – rediger i Supabase'); return; }
  // Fill form
  const nameEl = document.getElementById('gsName'); if(nameEl) nameEl.value = sess.name||'';
  const endEl = document.getElementById('gsEnd');
  if (endEl && sess.endsAt) {
    const d = new Date(sess.endsAt);
    endEl.value = d.toISOString().slice(0,16);
  }
  if (sess.games) {
    document.getElementById('gsWordle')?.closest('label') && (document.getElementById('gsWordle').checked = sess.games.includes('wordle'));
    document.getElementById('gsWorldle')?.closest('label') && (document.getElementById('gsWorldle').checked = sess.games.includes('worldle'));
    document.getElementById('gsWhoami')?.closest('label') && (document.getElementById('gsWhoami').checked = sess.games.includes('whoami'));
  }
  const cwEl = document.getElementById('gsCustomWords'); if(cwEl) cwEl.value = (sess.customWords||[]).join(', ');
  // Scroll to form
  document.getElementById('gsName')?.scrollIntoView({behavior:'smooth', block:'center'});
  showToast('Rediger og klikk «Opprett økt» for å lagre ny versjon');
}



// Direct Supabase fetch for game tables (plain INSERT, no upsert)
async function sbInsert(table, data) {
  const url = SB_URL + '/rest/v1/' + table;
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'apikey': SB_KEY,
        'Authorization': 'Bearer ' + SB_KEY,
        'Content-Type': 'application/json',
        'Prefer': 'return=minimal'
      },
      body: JSON.stringify(data)
    });
    if (!res.ok) {
      const err = await res.text();
      console.error('[sbInsert]', table, res.status, err.substring(0, 300));
      return null;
    }
    return true;
  } catch(e) {
    console.error('[sbInsert] fetch error:', e.message);
    return null;
  }
}

async function sbSelect(table, query) {
  const url = SB_URL + '/rest/v1/' + table + (query ? '?' + query : '');
  try {
    const res = await fetch(url, {
      method: 'GET',
      headers: {
        'apikey': SB_KEY,
        'Authorization': 'Bearer ' + SB_KEY,
        'Content-Type': 'application/json'
      }
    });
    if (!res.ok) {
      const err = await res.text();
      console.error('[sbSelect]', table, res.status, err.substring(0, 300));
      return null;
    }
    const text = await res.text();
    return (text && text !== 'null') ? JSON.parse(text) : [];
  } catch(e) {
    console.error('[sbSelect] fetch error:', e.message);
    return null;
  }
}

async function gsDiagnose() {
  const el = document.getElementById('gs-diag-result');
  if (!el) return;
  el.style.display = 'block';
  el.textContent = '⏳ Tester tilkobling...';

  const lines = [];
  lines.push('Supabase URL: ' + SB_URL);
  lines.push('API-nøkkel: ' + (SB_KEY ? SB_KEY.substring(0,20)+'...' : 'MANGLER'));
  lines.push('');

  // Test 1: Can we reach Supabase at all?
  try {
    const res = await fetch(SB_URL + '/rest/v1/os_game_sessions?limit=0', {
      headers: { 'apikey': SB_KEY, 'Authorization': 'Bearer ' + SB_KEY }
    });
    lines.push('✅ Supabase nåbar (HTTP ' + res.status + ')');
  } catch(e) {
    lines.push('❌ KAN IKKE NÅ SUPABASE: ' + e.message);
    lines.push('   → Sjekk at prosjektet ikke er på pause på supabase.com');
    el.textContent = lines.join('\n');
    return;
  }

  // Test 2: Does os_game_sessions table exist?
  const rows = await sbSelect('os_game_sessions', 'limit=1&select=id,code');
  if (rows === null) {
    lines.push('❌ TABELL os_game_sessions MANGLER');
    lines.push('   → Klikk "Kopier SQL" og kjør det i Supabase SQL Editor');
  } else {
    lines.push('✅ Tabell os_game_sessions finnes (' + rows.length + ' rader lest)');
  }

  // Test 3: Can we write to it?
  const testCode = 'ZZZTEST';
  const writeRes = await sbInsert('os_game_sessions', {
    id: testCode, code: testCode, name: 'test', starts_at: new Date().toISOString(),
    ends_at: new Date(Date.now() + 60000).toISOString(), config: { test: true }
  });
  if (writeRes === null) {
    lines.push('❌ KAN IKKE SKRIVE til os_game_sessions');
    lines.push('   → Sjekk at RLS-policy "allow_game_sessions" er aktiv');
  } else {
    lines.push('✅ Skrivetilgang OK');
    // Cleanup
    const delUrl = SB_URL+'/rest/v1/os_game_sessions?code=eq.ZZZTEST'; await fetch(delUrl, {method:'DELETE',headers:{'apikey':SB_KEY,'Authorization':'Bearer '+SB_KEY}});
    lines.push('✅ Slettetilgang OK');
  }

  // Test 4: os_game_scores
  const scores = await sbSelect('os_game_scores', 'limit=1&select=id');
  if (scores === null) {
    lines.push('❌ TABELL os_game_scores MANGLER');
  } else {
    lines.push('✅ Tabell os_game_scores finnes');
  }

  lines.push('');
  const allOk = !lines.some(l => l.startsWith('❌'));
  lines.push(allOk ? '🎉 ALT OK – spilløkter skal nå fungere på tvers av enheter!' : '⚠️ Fikset alle feil? Klikk "Test tilkobling" på nytt.');
  el.textContent = lines.join('\n');
}

function copyGameSQL() {
  const sql = `-- SkOla Spillmodul – Kjør dette i Supabase SQL Editor
-- Trygt å kjøre flere ganger

-- Tabell for spilløkter
create table if not exists os_game_sessions (
  id           text primary key,
  code         text unique not null,
  name         text,
  config       jsonb,
  starts_at    timestamptz,
  ends_at      timestamptz,
  created_at   timestamptz default now()
);

-- Tabell for poeng
create table if not exists os_game_scores (
  id           text primary key,
  session_code text not null,
  player_name  text not null,
  game         text not null,
  score        int  default 0,
  created_at   timestamptz default now()
);

-- Aktiver row-level security
alter table os_game_sessions enable row level security;
alter table os_game_scores   enable row level security;

-- Tillat alle operasjoner (åpen tilgang – passer for skole-intern bruk)
drop policy if exists "allow_game_sessions" on os_game_sessions;
create policy "allow_game_sessions"
  on os_game_sessions for all
  using (true) with check (true);

drop policy if exists "allow_game_scores" on os_game_scores;
create policy "allow_game_scores"
  on os_game_scores for all
  using (true) with check (true);

-- Indeks for raskere oppslag på kode
create index if not exists idx_game_sessions_code on os_game_sessions(code);
create index if not exists idx_game_scores_session on os_game_scores(session_code);
`;
  navigator.clipboard.writeText(sql)
    .then(() => showToast('✅ SQL kopiert! Lim inn i Supabase SQL Editor og klikk RUN'))
    .catch(() => { document.getElementById('gs-diag-result').style.display='block'; document.getElementById('gs-diag-result').textContent = sql; });
}
// ====== END GAME ZONE ENGINE ======


// ── GIVE UP functions ──
function wordleGiveUp() {
  if (WORDLE_ST.over) return;
  if (!confirm('Er du sikker på at du vil gi opp? Du får 0 poeng.')) return;
  WORDLE_ST.over = true;
  const resultEl = document.getElementById('wordle-result');
  const msgEl = document.getElementById('wordle-result-msg');
  const wordEl = document.getElementById('wordle-result-word');
  const btn = document.getElementById('wordle-giveup-btn');
  if (btn) btn.style.display = 'none';
  if (resultEl) resultEl.style.display = 'block';
  if (msgEl) {
    msgEl.style.color = '#ef4444';
    msgEl.textContent = '🏳️ Du ga opp!';
  }
  if (wordEl) wordEl.textContent = 'Ordet var: ' + WORDLE_ST.word.toUpperCase() + ' · 0 poeng';
  // Replace play-again button with "ny oppgave" message
  const resultActions = resultEl.querySelector('div:last-child');
  if (resultActions) {
    resultActions.innerHTML = `
      <button data-onclick="gzStartWordle" style="padding:10px 22px;background:var(--accent);color:white;border:none;border-radius:9px;font-family:'Nunito',sans-serif;font-weight:800;cursor:pointer;">Prøv et nytt ord</button>
      <button data-onclick="gzBackToLobby" style="padding:10px 22px;background:var(--s2);border:1px solid var(--border-2);color:var(--text-2);border-radius:9px;font-family:'Nunito',sans-serif;font-weight:800;cursor:pointer;">Tilbake til meny</button>`;
  }
  gzSaveScore('wordle', 0);
}

function worldleGiveUp() {
  if (WORLDLE_ST.over) return;
  if (!confirm('Er du sikker på at du vil gi opp? Du får 0 poeng.')) return;
  WORLDLE_ST.over = true;
  const btn = document.getElementById('worldle-giveup-btn');
  if (btn) btn.style.display = 'none';
  const inp = document.getElementById('worldle-input');
  if (inp) inp.disabled = true;
  // Show give-up result
  const resultEl = document.getElementById('worldle-result');
  const msgEl = document.getElementById('worldle-result-msg');
  const countryEl = document.getElementById('worldle-result-country');
  if (resultEl) resultEl.style.display = 'block';
  if (msgEl) {
    msgEl.style.color = '#ef4444';
    msgEl.textContent = '🏳️ Du ga opp! Det var: ' + WORLDLE_ST.country.n + ' ' + WORLDLE_ST.country.f;
  }
  if (countryEl) countryEl.textContent = WORLDLE_ST.country.c + ' · Befolkning: ' + WORLDLE_ST.country.p + ' · 0 poeng';
  // Replace buttons
  const resultActions = resultEl.querySelector('div:last-child');
  if (resultActions) {
    resultActions.innerHTML = `
      <button data-onclick="gzStartWorldle" style="padding:11px 24px;background:var(--accent);color:white;border:none;border-radius:9px;font-family:'Nunito',sans-serif;font-weight:800;cursor:pointer;">Prøv et nytt land</button>
      <button data-onclick="gzBackToLobby" style="padding:11px 24px;background:var(--s2);border:1px solid var(--border-2);color:var(--text-2);border-radius:9px;font-family:'Nunito',sans-serif;font-weight:800;cursor:pointer;">Tilbake</button>`;
  }
  gzSaveScore('worldle', 0);
}

function whoamiGiveUp() {
  if (WHOAMI_ST.over) return;
  if (!confirm('Er du sikker på at du vil gi opp? Du får 0 poeng.')) return;
  WHOAMI_ST.over = true;
  // Reveal all remaining hints
  while (WHOAMI_ST.revealed < WHOAMI_ST.maxHints) {
    whoamiRevealHint(true);
  }
  const revealBtnWrap = document.getElementById('whoami-reveal-btn-wrap');
  if (revealBtnWrap) revealBtnWrap.style.display = 'none';
  const resultEl = document.getElementById('whoami-result');
  const msgEl = document.getElementById('whoami-result-msg');
  const nameEl = document.getElementById('whoami-result-name');
  if (resultEl) resultEl.style.display = 'block';
  if (msgEl) {
    msgEl.style.color = '#ef4444';
    msgEl.textContent = '🏳️ Du ga opp!';
  }
  if (nameEl) nameEl.textContent = 'Det var: ' + WHOAMI_ST.person.n + ' · 0 poeng';
  // Replace buttons with "ny oppgave"
  const resultActions = resultEl.querySelector('div:last-child');
  if (resultActions) {
    resultActions.innerHTML = `
      <button data-onclick="gzStartWhoami" style="padding:10px 22px;background:var(--accent);color:white;border:none;border-radius:9px;font-family:'Nunito',sans-serif;font-weight:800;cursor:pointer;">Prøv en ny person</button>
      <button data-onclick="gzBackToLobby" style="padding:10px 22px;background:var(--s2);border:1px solid var(--border-2);color:var(--text-2);border-radius:9px;font-family:'Nunito',sans-serif;font-weight:800;cursor:pointer;">Tilbake til meny</button>`;
  }
  gzSaveScore('whoami', 0);
}

// ====== GAME ZONE DATA ======
const GZ_WORDS_NO = [
  'SKOLE','FJORD','SNØEN','HYTTE','ELVEN','HAVET','SPILL','ORDEN','GRØNN','SVART',
  'HVITT','KALDT','VARMT','SOLEN','MÅNEN','NESEN','HUSET','BOKEN','VEIEN','LIVET',
  'TREET','BARNA','RISEN','TIMEN','BRANN','KRAFT','SKYER','STEIN','REISE','KILDE',
  'KLIMA','NORSK','ALENE','FOSSE','DAGER','NESTE','GLEDE','STOPP','GRUNN','MINNE',
  'TENKE','LESTE','TRINN','BILDE','SKINN','TUREN','STIGE','STYGG','SNILL','STERK',
  'KJØRE','HOPPE','SYNGE','SETTE','FUGLE','FARGE','HELGE','FLYTT','BLAND','PLAGE',
  'ANGER','KNUST','DRØMT','GAVEN','ARENE','SPRAK','SVAKE','GANGE','FESTE','BRINGT'
];

const GZ_WORDS_EN = [
  'about','above','abuse','actor','acute','admit','adopt','adult','after','again',
  'agent','agree','ahead','alarm','album','alert','alike','alive','alley','allow',
  'alone','along','alter','angel','anger','angle','angry','angst','anime','ankle',
  'annex','apart','apple','apply','arena','argue','arise','armor','army','aroma',
  'arose','array','arson','aside','asked','atlas','attic','audit','avoid','awake',
  'award','aware','badly','bagel','baked','baker','bases','basic','basis','beach',
  'began','begin','being','below','bench','bible','black','blade','blame','bland',
  'blank','blast','blaze','bleed','blend','bless','blind','block','blood','bloom',
  'blown','board','bonus','boost','booth','bound','brain','brand','brave','bread',
  'break','breed','brick','bride','brief','bring','broad','broke','brown','brush',
  'build','built','bunch','burst','cabin','candy','carry','cause','cease','chain',
  'chair','chaos','charm','chart','chase','cheap','check','cheek','chess','chest',
  'chief','child','china','chord','chose','civic','civil','claim','clash','class',
  'clean','clear','clerk','click','cliff','climb','cling','clock','clone','close',
  'cloud','coach','coast','color','comes','comic','comma','coral','count','court',
  'cover','crack','craft','crash','crazy','cream','creek','crime','cross','crowd',
  'crown','crush','curve','cycle','daily','dance','datum','dealt','death','debut',
  'decry','delay','dense','depot','depth','derby','devil','disco','ditch','doing',
  'dolce','doubt','dough','draft','drain','drama','drank','drawn','dream','dress',
  'dried','drift','drill','drink','drive','drove','drunk','dryer','dying','eager',
  'eagle','early','earth','eight','elite','empty','enemy','enjoy','enter','entry',
  'equal','error','essay','event','every','exact','exist','extra','fable','faced',
  'faith','false','fancy','fatal','favor','feast','fence','fever','field','fifth',
  'fifty','fight','final','first','fixed','flame','flash','flesh','flock','floor',
  'float','flung','focus','force','forge','found','franc','frank','fraud','fresh',
  'front','frost','froze','fruit','fully','funny','gamut','ghost','given','glass',
  'globe','gloom','gloss','going','grace','grade','grain','grand','grant','grape',
  'grasp','grass','grave','great','green','greet','grief','grind','groan','group',
  'grove','grown','guard','guess','guest','guide','guild','guilt','guise','gusto',
  'happy','harsh','haven','heart','heavy','hedge','honor','horse','hotel','house',
  'human','humor','hurry','image','index','inner','input','inter','intro','irony',
  'issue','ivory','judge','juice','juicy','jumbo','karen','kayak','knife','knock',
  'known','label','later','layer','learn','least','leave','legal','level','light',
  'limit','liver','local','lodge','logic','loose','lunar','lying','magic','major',
  'maker','manor','march','marry','match','mayor','media','mercy','merit','metal',
  'meter','midst','might','minor','minus','mixed','model','money','month','moral',
  'motif','mount','mouth','moved','movie','multi','music','naive','named','nerve',
  'never','night','noble','noise','north','noted','novel','nurse','nymph','ocean',
  'offer','often','onset','orbit','order','other','ought','outer','ovary','oxide',
  'ozone','paint','panel','panic','paper','pasta','patch','pause','peace','pearl',
  'penny','phase','phone','photo','piano','piece','pilot','pinch','pixel','pizza',
  'place','plain','plane','plant','plate','plaza','plead','pluck','plumb','plume',
  'point','polar','power','press','price','pride','prime','print','prior','prize',
  'probe','prone','proof','prose','proud','prove','proxy','psalm','pulse','punch',
  'pupil','queen','query','quest','queue','quick','quiet','quota','quote','radar',
  'raise','rally','ranch','range','rapid','ratio','reach','ready','realm','rebel',
  'refer','reign','relax','repay','reply','reset','rider','ridge','right','risky',
  'rival','river','robot','rocky','rouge','rough','round','route','rover','ruled',
  'rural','saint','sauce','scale','scare','scene','scope','score','scout','sense',
  'serve','seven','shaft','shake','shall','shame','shape','share','shark','sharp',
  'shift','shine','shirt','shock','shore','short','shout','shrug','siege','sight',
  'silly','since','sixth','sixty','sized','skill','skull','slash','slate','slave',
  'sleep','slice','slide','slope','slump','smart','smile','smoke','solar','solid',
  'solve','sorry','south','space','spare','spark','speak','speed','spell','spend',
  'spice','spine','spoke','sport','spray','squad','staff','stage','stain','stake',
  'stale','stand','stark','start','state','stays','steal','steam','steel','steep',
  'steer','stern','stick','stiff','still','stone','stood','store','storm','story',
  'stout','strap','straw','strip','stuck','study','style','sugar','suite','sunny',
  'super','surge','swamp','swear','sweep','sweet','swept','swift','swing','swore',
  'sworn','syrup','table','taken','taste','teach','tense','tenth','terms','terry',
  'theme','there','thick','thing','think','third','those','three','threw','throw',
  'thumb','tiger','tight','timer','tired','title','today','token','total','touch',
  'tough','tower','toxic','trace','track','trade','trail','train','trait','trash',
  'treat','trend','trial','tried','troop','truck','truly','trunk','trust','truth',
  'tutor','twice','twist','typed','ultra','uncle','under','union','unity','until',
  'upset','urban','usage','usual','utter','valid','value','valve','vapor','vault',
  'verse','video','vigil','vigor','vinyl','viral','virus','visit','visor','vista',
  'vital','vivid','vocal','vodka','voice','voter','vague','wager','waste','watch',
  'water','weary','weave','weigh','weird','wheat','where','which','while','white',
  'whole','whose','wider','widow','witch','woman','women','world','worry','worse',
  'worst','worth','would','wound','wrath','wrist','wrote','xenon','yacht','yearn',
  'young','youth','zebra','zesty'
];
const GZ_COUNTRIES = [
  {n:'Norge',      f:'🇳🇴', c:'Europa',   p:'~5 mill',  d:'M60,5L70,8L73,14L68,20L74,26L70,33L76,40L72,48L66,58L59,68L51,78L43,85L36,83L31,76L33,68L37,61L32,54L36,47L33,40L38,32L35,25L39,18L44,12L50,8Z', lat:65,lon:13, hints:['Nordisk land med fjorder','Grenser til Sverige og Finland','Oljenasjon i Nordsjøen','Vikingenes hjemland','Laks og midnattsol']},
  {n:'Sverige',    f:'🇸🇪', c:'Europa',   p:'~10 mill', d:'M46,5L58,7L66,12L70,20L67,28L71,36L68,44L63,52L65,60L62,68L55,74L47,78L40,74L36,66L38,58L40,50L37,42L39,34L37,26L40,18L44,12Z', lat:62,lon:15, hints:['Nordisk land','Naboer med Norge og Finland','IKEA og ABBA','Grenser til Danmark via bro','Kongedømme med kongehuset Bernadotte']},
  {n:'Danmark',    f:'🇩🇰', c:'Europa',   p:'~6 mill',  d:'M42,25L52,20L60,25L62,35L58,45L50,52L42,50L36,43L35,33Z', lat:56,lon:10, hints:['Nordisk land, halvøya','Grenser til Tyskland i sør','LEGO og H.C. Andersen','Kongedømme','Kjent for smørrebrød']},
  {n:'Finland',    f:'🇫🇮', c:'Europa',   p:'~5,5 mill',d:'M46,10L58,6L68,10L74,18L72,28L65,36L72,44L68,54L61,62L52,67L43,64L36,55L33,44L35,33L37,22Z', lat:64,lon:26, hints:['Nordisk land','Tusen innsjøer','Naboer med Sverige, Norge og Russland','Sauna er fra dette landet','Helsinki er hovedstaden']},
  {n:'Island',     f:'🇮🇸', c:'Europa',   p:'~370 000', d:'M22,38L38,28L58,26L74,32L80,44L74,56L58,64L38,62L22,52Z', lat:65,lon:-18, hints:['Øystat i Nordatlanteren','Kjent for geysirer og nordlys','En av verdens nordligste stater','Reykjavik er hovedstad','Vikingætt']},
  {n:'Frankrike',  f:'🇫🇷', c:'Europa',   p:'~67 mill', d:'M38,15L60,15L72,28L72,48L60,62L40,62L28,50L28,28Z', lat:46,lon:2, hints:['Vesteuropeisk land','Eiffeltårnet er kjent ikon','Vin og baguetter','Grenser til Spania, Italia og Tyskland','Paris er verdens mest besøkte by']},
  {n:'Tyskland',   f:'🇩🇪', c:'Europa',   p:'~84 mill', d:'M38,12L62,12L70,20L72,32L68,42L65,52L55,58L45,58L35,52L30,42L28,30L32,20Z', lat:51,lon:10, hints:['Midteuropeisk land','Grenser til 9 land','Kjent for øl, pølser og biler','Berlin er hovedstad','Delt i øst og vest under den kalde krigen']},
  {n:'Spania',     f:'🇪🇸', c:'Europa',   p:'~47 mill', d:'M25,20L72,18L82,30L80,50L72,62L50,68L30,65L18,55L15,38Z', lat:40,lon:-4, hints:['Sørvest i Europa','Grenser til Portugal og Frankrike','Flamenco og tyre kampspill','Real Madrid og FC Barcelona','Madrid er hovedstad']},
  {n:'Italia',     f:'🇮🇹', c:'Europa',   p:'~60 mill', d:'M42,8L55,10L62,18L58,28L62,38L58,48L60,55L65,62L70,68L68,76L60,80L54,74L48,68L44,74L36,76L32,70L38,62L40,54L36,46L36,35L38,25L40,15Z', lat:42,lon:12, hints:['Ser ut som en støvel','Middelhavland','Pizza og pasta','Roma er evig by og hovedstad','Hjem til Vatikanet']},
  {n:'Storbritannia',f:'🇬🇧',c:'Europa',  p:'~67 mill', d:'M42,12L56,10L64,18L62,28L66,36L62,46L56,54L50,58L44,56L38,50L36,40L38,30L36,22Z', lat:54,lon:-2, hints:['Øystat vest for Europa','Kjent for te og høflig vær','Hjemsted for Beatles og Rolling Stones','London er en av verdens største byer','Monarki med kong Charles']},
  {n:'Nederland',  f:'🇳🇱', c:'Europa',   p:'~17 mill', d:'M35,30L62,28L70,36L68,50L55,56L38,54L28,45Z', lat:52,lon:5, hints:['Vesteuropeisk lavland','Kjent for tulipaner og vindmøller','Amsterdam er hovedstad','Mye land er under havnivå','Sykkelparadis']},
  {n:'Polen',      f:'🇵🇱', c:'Europa',   p:'~38 mill', d:'M28,25L72,22L78,32L76,48L64,58L48,60L30,56L20,45L22,33Z', lat:52,lon:20, hints:['Midtøsteuropeisk land','Grenser til Russland, Ukraina og Tyskland','Warszawa er hovedstad','Kjent for Chopin','Katolsk og stolt nasjon']},
  {n:'Sveits',     f:'🇨🇭', c:'Europa',   p:'~8,7 mill',d:'M30,36L65,34L72,46L65,58L40,60L28,50Z', lat:47,lon:8, hints:['Lite alpeland i Europa','Kjent for sjokolade og ost','Nøytralt land','Ingen kystlinje','Genève er FNs europeiske sete']},
  {n:'USA',        f:'🇺🇸', c:'Amerika',  p:'~330 mill',d:'M10,28L32,22L55,20L72,22L88,28L90,40L85,50L75,52L70,60L62,62L55,58L45,55L36,52L28,55L22,50L12,45L8,36Z', lat:38,lon:-97, hints:['Supermakt i Nord-Amerika','50 delstater','Washington D.C. er hovedstad','Kjent for Hollywood og NASA','Kaldkrig-rival med Sovjet']},
  {n:'Canada',     f:'🇨🇦', c:'Amerika',  p:'~38 mill', d:'M5,20L25,15L45,12L65,10L85,15L95,25L95,40L85,45L70,48L55,45L40,48L28,45L15,42L5,35Z', lat:60,lon:-95, hints:['Nordamerikansk land med lengst kystlinje','Grenser kun til USA','Ahorn-løvet på flagget','Ottawa er hovedstad','Kjent for ishockey og grizzlybjørn']},
  {n:'Mexico',     f:'🇲🇽', c:'Amerika',  p:'~130 mill',d:'M15,28L45,22L65,25L78,35L80,48L72,58L60,65L48,68L38,62L28,55L18,45Z', lat:23,lon:-102, hints:['Søramerikansk stat i Mellom-Amerika','Grenser til USA i nord','Tortillas og tacos','Tenochtitlan (Mexico City) var aztekernes by','Turistmål med pyramider']},
  {n:'Brasil',     f:'🇧🇷', c:'Amerika',  p:'~214 mill',d:'M30,10L70,8L85,18L90,32L88,48L80,60L70,70L58,78L45,78L32,70L20,58L15,42L18,26Z', lat:-10,lon:-55, hints:['Søramerikansk gigant','Verdens største regnskog','Fotballnasjon','Rio de Janeiro og karneval','Snakker portugisisk']},
  {n:'Argentina',  f:'🇦🇷', c:'Amerika',  p:'~45 mill', d:'M38,5L60,5L68,15L65,28L60,42L56,55L58,68L55,80L50,90L45,95L40,88L36,75L32,60L30,45L30,28L32,15Z', lat:-34,lon:-64, hints:['Smalest i sør i Sør-Amerika','Buenos Aires er europeisklignende storby','Tango og biff','Grenser til Chile langs Andesfjellene','Messi er herfra']},
  {n:'Chile',      f:'🇨🇱', c:'Amerika',  p:'~19 mill', d:'M44,8L56,10L60,20L58,35L56,50L58,63L56,76L52,88L47,95L42,88L40,75L40,60L38,45L38,30L40,18Z', lat:-30,lon:-71, hints:['Verdens lengste og smaleste land','Langs vestkysten av Sør-Amerika','Andesfjellene i øst','Atacama-ørkenen er verdens tørreste','Santiago er hovedstad']},
  {n:'Russland',   f:'🇷🇺', c:'Asia/Europa',p:'~144 mill',d:'M5,28L30,20L55,18L75,20L92,25L96,35L90,45L75,50L55,52L38,50L20,52L8,47L4,37Z', lat:60,lon:100, hints:['Verdens største land','Strekker seg over 11 tidssoner','Moskva er hovedstad','Grenser til 14 land','Var Sovjetunionens kjerne']},
  {n:'Tyrkia',     f:'🇹🇷', c:'Asia/Europa',p:'~84 mill',d:'M15,33L45,28L68,30L88,35L92,44L85,53L68,56L45,55L22,53L12,45Z', lat:39,lon:35, hints:['Bro mellom Europa og Asia','Istanbul er byens historiske perle','Grenser til Hellas og Syria','Ankara er faktisk hovedstad','Kjent for kebab og baklava']},
  {n:'Saudi-Arabia',f:'🇸🇦',c:'Asia',     p:'~35 mill', d:'M25,22L68,20L78,30L82,45L75,60L60,70L45,72L30,65L20,52L18,36Z', lat:24,lon:45, hints:['Den arabiske halvøya','Verdens største oljeprodusent','Mekka og Medina er hellige steder','Monarkiet al-Saud','Riyadh er hovedstad']},
  {n:'Egypt',      f:'🇪🇬', c:'Afrika',   p:'~100 mill',d:'M22,20L73,18L80,28L78,55L68,65L48,65L28,60L18,48L16,32Z', lat:27,lon:30, hints:['Nordøstafrikansk land','Nilen renner gjennom','Pyramidene i Giza','Grenser til Libya og Sudan','Kairo er Afrikas største by']},
  {n:'India',      f:'🇮🇳', c:'Asia',     p:'~1,4 mrd', d:'M32,12L68,12L78,22L80,35L75,48L68,58L60,68L52,76L48,80L44,76L36,68L28,58L22,46L20,32Z', lat:21,lon:78, hints:['Verdens mest folkerike land','Ganges er hellig elv','Cricket er nasjonalsporten','Delhi er landets hovedstad','Gandhi og Taj Mahal er herfra']},
  {n:'Kina',       f:'🇨🇳', c:'Asia',     p:'~1,4 mrd', d:'M22,18L55,10L80,15L92,28L90,42L78,55L60,62L42,60L26,52L15,40L15,28Z', lat:35,lon:105, hints:['Verdens nest mest folkerike land','Den kinesiske muren','Grenser til 14 land','Beijing er hovedstad','Den store stupa og ris-terrasser']},
  {n:'Japan',      f:'🇯🇵', c:'Asia',     p:'~125 mill',d:'M58,12L72,14L80,22L78,35L70,44L60,50L50,52L42,48L38,40L40,30L48,20Z', lat:36,lon:138, hints:['Øystat i Stillehavet','Soloppgangens land','Sushi, anime og samuraier','Tokyo er verdens mest folkerike by','Kjent for teknologi og Fuji-fjellet']},
  {n:'Sør-Korea',  f:'🇰🇷', c:'Asia',     p:'~52 mill', d:'M32,30L65,28L74,38L70,52L58,62L42,62L30,55L26,44Z', lat:37,lon:128, hints:['Østasiatisk halvøyland','K-pop og K-drama','Seoul er en gigantby','Grenser til Nord-Korea','Kjent for Samsung og Hyundai']},
  {n:'Australia',  f:'🇦🇺', c:'Oseania',  p:'~26 mill', d:'M20,28L48,18L75,20L90,32L92,48L82,60L65,68L48,68L32,60L18,48Z', lat:-27,lon:133, hints:['Kontinent og land i ett','Sydney Opera House','Kenguru og koala','Canberra er faktisk hovedstad (ikke Sydney)','Great Barrier Reef']},
  {n:'Sør-Afrika', f:'🇿🇦', c:'Afrika',   p:'~60 mill', d:'M22,18L72,18L82,30L80,48L68,62L55,70L48,74L42,70L28,60L18,44L16,30Z', lat:-29,lon:25, hints:['Sørspissen av Afrika','Nelson Mandela var herfra','Kjent for diamanter og safari','Tre hovedsteder','Apartheidregimet avsluttes i 1994']},
  {n:'Marokko',    f:'🇲🇦', c:'Afrika',   p:'~37 mill', d:'M24,18L62,15L75,22L80,36L75,52L60,60L40,60L22,52L16,38Z', lat:32,lon:-5, hints:['Nordvestafrikansk land','Grenser til Algerie og Vest-Sahara','Marrakesh og Casablanca','Sahara i sør','Arabisk-berberisk kultur']},
  {n:'Nigeria',    f:'🇳🇬', c:'Afrika',   p:'~220 mill',d:'M24,20L72,18L80,28L80,45L70,58L52,64L34,62L20,52L18,36Z', lat:10,lon:8, hints:['Afrikas mest folkerike land','Niger-deltaet er oljerik','Lagos er gigantby','Naboer med Niger og Kamerun','Abuja er hovedstad']},
  // ── EUROPA ──
  {n:'Østerrike',   f:'🇦🇹', c:'Europa',   p:'~9 mill',  lat:47.5, lon:14.5, d:'M38,30L62,28L68,36L65,48L55,52L42,50L32,44Z', hints:['Alpe-land i Sentral-Europa','Grenser til 8 land','Wien er en av Europas kulturhovedsteder','Hjemland til Mozart','Kjent for skiing og Schnitzel']},
  {n:'Belgia',      f:'🇧🇪', c:'Europa',   p:'~11 mill', lat:50.8, lon:4.5,  d:'M35,28L65,26L70,38L60,50L40,52L28,42Z', hints:['Vesteuropeisk land','Grenser til Frankrike, Nederland og Luxembourg','Brussel er EU-hovedkvarter','Kjent for sjokolade og vafler','Har tre offisielle språk']},
  {n:'Portugal',    f:'🇵🇹', c:'Europa',   p:'~10 mill', lat:39.5, lon:-8.0, d:'M30,15L55,12L60,25L55,42L48,55L38,60L28,50L25,35Z', hints:['Vestligste land i Fastlands-Europa','Lisboa er historisk havneby','Grenser kun til Spania','Kjent for Fado-musikk','Hadde et av historiens største kolonialimperier']},
  {n:'Hellas',      f:'🇬🇷', c:'Europa',   p:'~11 mill', lat:39.0, lon:22.0, d:'M25,20L58,15L72,25L75,40L65,52L50,60L35,55L22,45Z', hints:['Søreuropeisk land','Sivilisasjonens vugge i Vesten','Athen er landets hovedstad','Kjent for olympiske leker og mytologi','Tusenvis av øyer i Middelhavet']},
  {n:'Ungarn',      f:'🇭🇺', c:'Europa',   p:'~10 mill', lat:47.0, lon:19.5, d:'M25,30L70,28L75,40L68,52L30,55L20,45Z', hints:['Midteuropeisk land omgitt av land','Budapest er europeisk kulturperle','Kjent for gulasj og Tokay-vin','Donau renner gjennom hovedstaden','Del av Østerrike-Ungarn inntil 1918']},
  {n:'Tsjekkia',    f:'🇨🇿', c:'Europa',   p:'~11 mill', lat:49.8, lon:15.5, d:'M22,28L70,25L75,35L70,48L28,50L18,40Z', hints:['Midteuropeisk innlandsstat','Praha er en av Europas vakreste byer','Grenser til Polen, Østerrike, Slovakia og Tyskland','Hjemland til Kafka','Øl-land nummer én i verden per innbygger']},
  {n:'Romania',     f:'🇷🇴', c:'Europa',   p:'~19 mill', lat:45.9, lon:25.0, d:'M22,22L72,20L80,32L78,48L65,58L40,58L22,45Z', hints:['Sørøst-Europa','Karpatene krysser landet','Transylvania og Dracula-legenden','Bukarest er landets store by','Grenser til Svartehavet']},
  {n:'Serbia',      f:'🇷🇸', c:'Europa',   p:'~7 mill',  lat:44.0, lon:21.0, d:'M30,25L68,22L72,35L68,50L52,58L32,55L22,42Z', hints:['Balkan-land på Balkanhalvøya','Beograd er en av Europas eldste byer','Grenser til 8 land','Kjent for kaffekultur','Gavrilo Princip skjøt erkehertug Franz Ferdinand her']},
  {n:'Kroatia',     f:'🇭🇷', c:'Europa',   p:'~4 mill',  lat:45.1, lon:15.5, d:'M18,20L55,18L72,28L65,40L55,50L40,55L25,48L15,35Z', hints:['Adriaterhavskysten i Europa','Zagreb er innlands-hovedstaden','Dubrovnik er kjent fra Game of Thrones','Grenser til Slovenia, Ungarn og Bosnia','Del av Jugoslavia til 1991']},
  {n:'Bulgaria',    f:'🇧🇬', c:'Europa',   p:'~7 mill',  lat:42.7, lon:25.5, d:'M20,28L72,25L78,38L72,52L42,55L18,45Z', hints:['Balkan-land ved Svartehavet','Sofia er landets moderne hovedstad','Grenser til Tyrkia, Hellas og Romania','Kyrillisk alfabet ble utviklet her','Kjent for yoghurt og rose-essensolje']},
  {n:'Slovakia',    f:'🇸🇰', c:'Europa',   p:'~5,5 mill',lat:48.7, lon:19.5, d:'M20,35L72,30L78,40L65,52L22,55L15,45Z', hints:['Lite midteuropeisk land','Bratislava er hovedstad','Grenser til Tsjekkia, Polen, Ungarn og Østerrike','Del av Tsjekkoslovakia til 1993','Kjent for slott og fjelllandskap']},
  {n:'Slovenia',    f:'🇸🇮', c:'Europa',   p:'~2 mill',  lat:46.1, lon:14.8, d:'M25,30L62,28L68,38L60,50L35,52L20,42Z', hints:['Lite alpeland i Sentral-Europa','Ljubljana er en sjarmerende hovedstad','Grenser til Italia, Østerrike, Ungarn og Kroatia','Del av Jugoslavia til 1991','Kjent for Julian-Alpene og Soča-elven']},
  {n:'Hviterussland',f:'🇧🇾',c:'Europa',   p:'~9,5 mill',lat:53.7, lon:27.9, d:'M22,20L72,18L78,30L75,45L62,55L28,55L15,42Z', hints:['Østeuropeisk land','Minsk er landets staselige hovedstad','Grenser til Russland, Ukraina og Polen','Kalles "Europas siste diktatur"','Viktig kampsted under 2. verdenskrig']},
  {n:'Ukraina',     f:'🇺🇦', c:'Europa',   p:'~44 mill', lat:49.0, lon:31.5, d:'M18,20L78,18L88,28L85,45L70,55L32,58L15,45Z', hints:['Størst land i Europa (unntatt Russland)','Kijevrusʼ var middelalderlig stormakt','Grenser til Russland, Polen og Romania','Svartehavet i sør','Kjent for solsikkeolje og hvete']},
  {n:'Litauen',     f:'🇱🇹', c:'Europa',   p:'~2,8 mill',lat:55.2, lon:23.9, d:'M30,28L65,25L70,38L62,52L32,55L22,42Z', hints:['Baltisk stat','Vilnius er en vakker barokkby','Grenser til Latvia, Hviterussland og Polen','Var Europas siste land til å bli kristent','Del av Sovjet fra 1940 til 1991']},
  {n:'Latvia',      f:'🇱🇻', c:'Europa',   p:'~1,9 mill',lat:56.9, lon:24.6, d:'M28,28L68,25L72,38L60,50L28,52L18,40Z', hints:['Baltisk stat','Riga er en storslått art nouveau-by','Grenser til Estland, Litauen og Russland','Dina er et kjent landemerke','Del av Sovjet 1940–1991']},
  {n:'Estland',     f:'🇪🇪', c:'Europa',   p:'~1,3 mill',lat:58.6, lon:25.0, d:'M28,25L70,22L75,35L65,48L30,50L18,38Z', hints:['Baltisk stat og digital foregangsnasjon','Tallinn er en middelalderperle','Grenser til Latvia og Russland','Skypen ble grunnlagt her','Frihet fra Sovjet i 1991']},
  {n:'Albania',     f:'🇦🇱', c:'Europa',   p:'~2,8 mill',lat:41.2, lon:20.2, d:'M35,20L60,18L65,32L60,50L48,58L32,48L25,35Z', hints:['Lite balkanland','Tirana er livlig og fargerik by','Grenser til Montenegro, Kosovo og Hellas','Muslimsk flertall i Europa','Bunker-land: Hoxha bygde 750 000 bunkere']},
  {n:'Nord-Makedonia',f:'🇲🇰',c:'Europa', p:'~2,1 mill',lat:41.6, lon:21.7, d:'M28,28L65,25L70,40L60,52L32,52L22,40Z', hints:['Lite balkanland','Skopje er en moderne by etter jordskjelv 1963','Grenser til Serbia, Bulgaria og Hellas','Tvister om navn med Hellas løst i 2019','Hjemsted for Mor Teresa']},
  {n:'Bosnia-Hercegovina',f:'🇧🇦',c:'Europa',p:'~3,3 mill',lat:44.2, lon:17.9, d:'M22,22L65,18L72,32L65,48L45,58L25,50L16,38Z', hints:['Balkan-land i Sørøst-Europa','Sarajevo var vertsby for Vinter-OL 1984','Franz Ferdinands attentat utløste 1. verdenskrig','Del av Jugoslavia til 1991–1995','Neobyen er UNESCOs verdensarv']},
  {n:'Montenegro',  f:'🇲🇪', c:'Europa',   p:'~620 000', lat:42.7, lon:19.4, d:'M28,25L65,22L70,38L60,52L35,55L20,42Z', hints:['Lite balkanland','Kjent for Kotor-bukten og Adriaterhavskysten','Grenser til Kroatia, Bosnia og Albania','Uavhengig fra Serbia i 2006','Populær turistdestinasjon']},
  {n:'Moldova',     f:'🇲🇩', c:'Europa',   p:'~2,6 mill',lat:47.0, lon:28.4, d:'M30,22L68,20L72,35L65,50L32,52L22,38Z', hints:['Lite østeuropeisk land','Chisinau er landets viktigste by','Grenser kun til Romania og Ukraina','Vin-produserende land','Transnistria er en ikke-anerkjent stat innenfor Moldova']},
  {n:'Kosovo',      f:'🇽🇰', c:'Europa',   p:'~1,8 mill',lat:42.6, lon:20.9, d:'M28,28L65,25L70,38L62,50L32,52L22,40Z', hints:['Ungt land i Europa (uavhengig 2008)','Pristina er landets rastløse by','Omstridt selvstendighet fra Serbia','Grenser til Albania og Nord-Makedonia','Størst muslimsk andel i Europa']},
  {n:'Irland',      f:'🇮🇪', c:'Europa',   p:'~5 mill',  lat:53.4, lon:-8.0, d:'M22,18L58,15L68,28L65,48L50,58L30,55L18,38Z', hints:['Øystat vest for Storbritannia','Dublin er kjent for pub-kultur og Guinness','Deler øya med Nord-Irland','Keltisk arv og grønt landskap','Kjent for U2 og Riverdance']},
  {n:'Luxemburg',   f:'🇱🇺', c:'Europa',   p:'~660 000', lat:49.8, lon:6.1,  d:'M35,28L62,25L68,42L55,55L32,52Z', hints:['Et av Europas minste land','Ett av verdens rikeste land per innbygger','Grenser til Frankrike, Belgia og Tyskland','Luxembourg City er en festningshovedstad','Finanssentrum i Europa']},
  // ── AFRIKA ──
  {n:'Eritrea',     f:'🇪🇷', c:'Afrika',   p:'~3,5 mill',lat:15.2, lon:39.8, d:'M28,18L68,15L78,28L72,42L55,50L35,45L20,35Z', hints:['Nordøstafrikansk land ved Rødehavet','Asmara er bygget av italienerne og er UNESCO-arv','Uavhengig fra Etiopia i 1993','Eritreere er en av Europas største flyktninggrupper','En av verdens mest lukkede stater']},
  {n:'Etiopia',     f:'🇪🇹', c:'Afrika',   p:'~120 mill',lat:9.1,  lon:40.5, d:'M18,18L75,12L88,25L85,42L70,55L45,60L20,50Z', hints:['Nest mest folkerike land i Afrika','Addis Abeba er AU-hovedkvarter','Eneste afrikanske land som aldri ble kolonialisert (unntatt Mussolini)','Kaffeens hjemland','Hailé Sélassié hersket her frem til 1974']},
  {n:'Kenya',       f:'🇰🇪', c:'Afrika',   p:'~55 mill', lat:0.0,  lon:38.0, d:'M22,20L72,18L80,30L75,48L58,58L35,55L18,40Z', hints:['Østafrikansk land ved Indiahavet','Nairobi er østafrikansk business-hub','Masai Mara er kjent for Great Migration','Langdistanseløpere i verdensklasse','Grenser til Tanzania, Uganda og Somalia']},
  {n:'Tanzania',    f:'🇹🇿', c:'Afrika',   p:'~63 mill', lat:-6.4, lon:35.0, d:'M18,18L72,15L80,28L78,48L62,60L30,62L15,48Z', hints:['Østafrikansk land','Kilimanjaro er Afrikas høyeste fjell','Zanzibar er en vakker øy utenfor kysten','Serengeti nasjonalpark er berømt','Grenser til Kenya, Uganda og Mosambik']},
  {n:'Ghana',       f:'🇬🇭', c:'Afrika',   p:'~32 mill', lat:7.9,  lon:-1.0, d:'M25,18L65,15L72,28L68,45L52,58L30,55L18,40Z', hints:['Vestafrikansk land','Accra er en moderne afrikansk by','Første sub-saharisk land til å bli uavhengig (1957)','Kakaoprodusent','Kofi Annan fra Ghana var FN-generalsekretær']},
  {n:'DR Kongo',    f:'🇨🇩', c:'Afrika',   p:'~100 mill',lat:-4.0, lon:21.8, d:'M15,18L72,12L85,22L88,40L78,55L55,65L25,62L10,48Z', hints:['Nest største land i Afrika','Kongofloden er verdens dypeste elv','Kinshasa er verdens nest største fransktalende by','Grenser til 9 land','Kobolt- og diamantrike']},
  {n:'Mosambik',    f:'🇲🇿', c:'Afrika',   p:'~32 mill', lat:-18.7,lon:35.5, d:'M28,15L65,12L72,25L68,48L55,65L35,68L20,55L18,35Z', hints:['Sørøstafrikansk land','Maputo er en art deco-by','Har en av Afrikas lengste kystlinjer','Tidligere portugisisk koloni','Grenser til Tanzania, Malawi og Zimbabwe']},
  {n:'Angola',      f:'🇦🇴', c:'Afrika',   p:'~34 mill', lat:-11.2,lon:17.9, d:'M18,18L68,15L78,28L72,50L55,65L30,65L15,50Z', hints:['Sørvestafrikansk land','Luanda er en av Afrikas dyreste byer','Rik på olje og diamanter','Lang borgerkrig avsluttes i 2002','Tidligere portugisisk koloni']},
  {n:'Zimbabwe',    f:'🇿🇼', c:'Afrika',   p:'~15 mill', lat:-20.0,lon:30.0, d:'M22,22L68,20L75,35L70,52L42,55L18,42Z', hints:['Sørlig Afrika','Harare er landets viktigste by','Viktoriafallene deles med Zambia','Hyperinflasjon tidlig 2000-tall','Uavhengig fra Rhodesia i 1980']},
  {n:'Zambia',      f:'🇿🇲', c:'Afrika',   p:'~19 mill', lat:-13.1,lon:27.8, d:'M18,18L72,15L80,28L75,45L55,55L25,55L12,40Z', hints:['Innlandsstat i Sørlige Afrika','Lusaka er landets nye by','Viktoriafallene er på grensen til Zimbabwe','Koboltprodusent','Grenser til 8 land']},
  {n:'Senegal',     f:'🇸🇳', c:'Afrika',   p:'~17 mill', lat:14.5, lon:-14.5,d:'M22,18L62,15L68,28L60,45L40,52L18,45L12,32Z', hints:['Vestafrikansk land','Dakar er Afrikas vestligste punkt','Grenser til Mauritania, Mali og Guinea','Kjent for wrestling og Teranga','Gambia er et smalt land inne i Senegal']},
  {n:'Kamerun',     f:'🇨🇲', c:'Afrika',   p:'~27 mill', lat:3.8,  lon:11.5, d:'M22,15L68,12L78,22L75,40L60,55L38,58L18,45Z', hints:['Vestafrikansk land','Yaoundé og Douala er de to store byene','Kalles "Afrika i miniatyr" pga naturmangfold','Mounts Kamerun er aktiv vulkan','Grenser til Nigeria og DR Kongo']},
  {n:'Elfenbenskysten',f:'🇨🇮',c:'Afrika', p:'~27 mill', lat:7.5,  lon:-5.5, d:'M22,18L65,15L72,28L65,45L45,55L22,50L12,35Z', hints:['Vestafrikansk land','Abidjan er den mest folkerike byen','Verdens største kakaoprodusent','Kjent for fotball (Didier Drogba)','Yamoussoukro er formell hovedstad']},
  {n:'Algerie',     f:'🇩🇿', c:'Afrika',   p:'~44 mill', lat:28.0, lon:2.6,  d:'M12,18L78,12L88,20L88,45L75,58L30,60L10,48Z', hints:['Afrikas største land','Det meste er Sahara','Algier er en hvit middelhavsby','Franske 1830–1962','Stor gassleverandør til Europa']},
  {n:'Libya',       f:'🇱🇾', c:'Afrika',   p:'~7 mill',  lat:26.3, lon:17.2, d:'M12,18L78,15L85,25L82,45L70,55L25,58L10,42Z', hints:['Nordafrikansk land','Tripoli er havnebyen og hovedstad','Mest Sahara-ørkен','Gaddafi styrte fra 1969–2011','Grenser til Egypt, Chad og Tunesiaer']},
  {n:'Tunesiaer',   f:'🇹🇳', c:'Afrika',   p:'~12 mill', lat:33.9, lon:9.6,  d:'M30,18L62,15L68,28L65,45L50,55L32,52L22,38Z', hints:['Nordafrikansk land','Tunis er en arabisk og europeisk by','Karthago var romersk rival','Middelhavet i nord','Kjent for Matmata-huler og Star Wars-innspillinger']},
  // ── ASIA ──
  {n:'Indonesia',   f:'🇮🇩', c:'Asia',     p:'~277 mill',lat:-0.8, lon:113.9,d:'M10,38L40,30L70,32L90,38L88,48L65,52L35,52L10,48Z', hints:['Verdens 4. mest folkerike land','Over 17 000 øyer','Jakarta er i ferd med å synke – ny hoved­stad Nusantara','Bali er verdensberømt ferieøy','Har flest muslimer i verden']},
  {n:'Pakistan',    f:'🇵🇰', c:'Asia',     p:'~225 mill',lat:30.4, lon:69.3, d:'M18,18L72,15L82,25L80,42L65,55L38,58L18,45Z', hints:['Sørasia','Islamabad er planlagt som ny hovedstad','K2 er verdens nest høyeste fjell','Delt fra India i 1947','Grenser til Afghanistan, India og Kina']},
  {n:'Bangladesh',  f:'🇧🇩', c:'Asia',     p:'~170 mill',lat:23.7, lon:90.4, d:'M25,20L65,18L70,32L65,48L48,55L28,52L18,38Z', hints:['Tett befolket land i Sør-Asia','Dhaka er en av verdens raskest voksende byer','Gangesdeltaet er verdens største','Delt fra Pakistan i 1971','Risiko for flom pga lavt terreng']},
  {n:'Vietnam',     f:'🇻🇳', c:'Asia',     p:'~97 mill', lat:14.1, lon:108.3,d:'M48,10L62,12L68,22L65,35L60,50L52,65L40,72L35,60L38,45L35,30L40,18Z', hints:['Langstrakt land i Sørøst-Asia','Hanoi er hovedstad, Ho Chi Minh City er størst','Kjent for Vietnamkrigen','Riksnudler (pho) og ris-langt','Grenser til Kina, Laos og Kambodsja']},
  {n:'Thailand',    f:'🇹🇭', c:'Asia',     p:'~70 mill', lat:15.9, lon:100.9,d:'M30,15L65,12L75,22L72,38L60,50L52,62L42,55L30,45L25,30Z', hints:['Sørøst-Asia','Bangkok er Asia-hub for fly','Aldri kolonisert','Kjent for tempel, strand og mat','Bhuddistisk kongedømme']},
  {n:'Malaysia',    f:'🇲🇾', c:'Asia',     p:'~33 mill', lat:4.2,  lon:108.0,d:'M15,35L48,30L65,32L80,38L78,48L62,52L35,52L12,45Z', hints:['Sørøst-Asia','Kuala Lumpur er kjent for Petronas-tårnene','Grenser til Thailand, Indonesia og Brunei','Produserer palmeolје og gummi','Muslimsk majoritet men multietnisk']},
  {n:'Myanmar',     f:'🇲🇲', c:'Asia',     p:'~54 mill', lat:19.2, lon:96.7, d:'M28,12L65,10L75,20L72,38L60,52L48,60L35,52L22,38L20,22Z', hints:['Sørøst-Asia','Naypyidaw er mystisk ny regjeringshovedstad','Rangoon (Yangon) er gammel kolonihavn','Aung San Suu Kyi fikk fredsprisen i 1991','Militærkupp i 2021']},
  {n:'Nepal',       f:'🇳🇵', c:'Asia',     p:'~30 mill', lat:28.4, lon:84.1, d:'M18,35L72,30L78,42L65,52L22,55L12,45Z', hints:['Himalaya-land mellom India og Kina','Katmandu er en mystisk by','Mount Everest er på grensen til Kina','Sherpaene er verdens beste fjellklatrere','Aldri kolonisert']},
  {n:'Iran',        f:'🇮🇷', c:'Asia',     p:'~85 mill', lat:32.4, lon:53.7, d:'M15,20L72,15L88,25L88,45L75,58L45,62L18,50Z', hints:['Midtøsten','Teheran er en megaby','Persisk sivilisasjon er blant verdens eldste','Islamsk revolusjon i 1979','Grenser til Irak, Tyrkia og Afghanistan']},
  {n:'Irak',        f:'🇮🇶', c:'Asia',     p:'~41 mill', lat:33.2, lon:43.7, d:'M18,18L68,15L80,25L78,42L60,55L35,58L18,45Z', hints:['Midtøsten','Mesopotamia – sivilisasjonens vugge','Bagdad er en av historiens viktigste byer','Tigris og Eufrat renner gjennom landet','USA invaderte i 2003']},
  {n:'Israel',      f:'🇮🇱', c:'Asia',     p:'~9,5 mill',lat:31.1, lon:34.9, d:'M35,15L58,12L65,22L62,38L55,50L42,52L30,42L28,28Z', hints:['Midtøsten','Jerusalem er hellig by for tre religioner','Grunnlagt i 1948','Tel Aviv er tech-hub','Grenser til Libanon, Syria, Jordan og Egypt']},
  {n:'Kasakhstan',  f:'🇰🇿', c:'Asia',     p:'~19 mill', lat:48.0, lon:66.9, d:'M12,22L78,18L88,28L88,50L72,62L30,65L10,52Z', hints:['Verdens 9. største land','Steppe og steppe','Nursultan (Astana) ble ny hoved­stad i 1997','Oljerik tidligere Sovjet-stat','Gagarin ble skutt opp fra Baikonur her']},
  {n:'Usbekistan',  f:'🇺🇿', c:'Asia',     p:'~35 mill', lat:41.4, lon:64.6, d:'M18,25L72,22L78,35L72,50L28,52L12,40Z', hints:['Sentralasiatisk land','Samarkand er legendarisk silkeveisby','Tashkent er største by i Sentral-Asia','Bistand fra bomullsproduksjon','Aralsøen er nesten borte']},
  {n:'Afghanistan', f:'🇦🇫', c:'Asia',     p:'~40 mill', lat:33.9, lon:67.7, d:'M15,20L70,15L82,25L80,42L65,55L38,58L15,45Z', hints:['Sentral-Asia','Kabul er fjellhovedstad','Ingen kystlinje','Taliban kontrollerer etter 2021','Kryssested for sivilisasjoner i årtusener']},
  {n:'Syria',       f:'🇸🇾', c:'Asia',     p:'~22 mill', lat:35.0, lon:38.0, d:'M18,22L68,18L78,28L72,45L45,52L18,48Z', hints:['Midtøsten','Damaskus er en av verdens eldste byer','Ødelagt av borgerkrig siden 2011','Grenser til Tyrkia, Irak og Israel','Hjemsted for begynnende jordbruk for 10 000 år siden']},
  // ── AMERIKAS ──
  {n:'Colombia',    f:'🇨🇴', c:'Amerika',  p:'~51 mill', lat:4.0,  lon:-72.0,d:'M18,15L62,12L72,22L70,38L55,50L35,52L18,40Z', hints:['Nordvestlig Sør-Amerika','Bogotá er høytliggende millionby','Kjent for kaffe og umulig biodiversitet','Grenser til Venezuela, Brasil og Peru','Tidligere narkostat nå turistvennlig']},
  {n:'Venezuela',   f:'🇻🇪', c:'Amerika',  p:'~28 mill', lat:8.0,  lon:-66.0,d:'M18,18L68,12L78,22L75,38L55,50L25,52L10,38Z', hints:['Nordlig Sør-Amerika','Caracas er farlig megaby','Angel Falls er verdens høyeste foss','Rik på olje men dypt i krise','Grenser til Colombia, Brasil og Guyana']},
  {n:'Peru',        f:'🇵🇪', c:'Amerika',  p:'~33 mill', lat:-9.2, lon:-75.0,d:'M15,15L62,10L72,22L70,42L55,58L28,60L12,45Z', hints:['Vest-Sør-Amerika','Lima er en av Amerikas eldste byer','Machu Picchu og inkasivilisasjonen','Amazonas har sine kilder her','Grenser til Ecuador, Colombia og Brasil']},
  {n:'Bolivia',     f:'🇧🇴', c:'Amerika',  p:'~12 mill', lat:-16.3,lon:-63.6,d:'M18,18L65,15L72,28L68,48L45,55L18,50Z', hints:['Sør-Amerika uten kystlinje','La Paz er verdens høyestliggende regjerings­hoved­stad','Salar de Uyuni er verdens største saltøde','To ho­ved­steder: La Paz og Sucre','Grenser til Brasil, Peru og Argentina']},
  {n:'Ecuador',     f:'🇪🇨', c:'Amerika',  p:'~18 mill', lat:-1.8, lon:-78.2,d:'M22,20L62,18L68,32L62,48L40,52L22,45Z', hints:['Navnets land på ekvator','Galapagos-øyene er her','Quito er på nesten 3000 moh','Bananeksportør','Grenser til Colombia og Peru']},
  {n:'Cuba',        f:'🇨🇺', c:'Amerika',  p:'~11 mill', lat:21.5, lon:-80.0,d:'M10,38L40,30L70,32L90,38L85,46L65,52L35,50L10,46Z', hints:['Karibiøy','Havana er fargerik kolonialby','Kommunistisk revolusjon i 1959','Kjent for sigarer og rum','Under USA-embargo siden 1960']},
  {n:'Guatemala',   f:'🇬🇹', c:'Amerika',  p:'~17 mill', lat:15.8, lon:-90.2,d:'M20,22L62,20L68,32L62,50L40,55L18,48Z', hints:['Mellom-Amerika','Guatemala City er regionens minst kjente stor­by','Maya-sivilisasjonens hjemland','Tikal er en imponerende ruin­by','Grenser til Mexico, Belize og Honduras']},
  {n:'Panama',      f:'🇵🇦', c:'Amerika',  p:'~4,5 mill',lat:8.4,  lon:-80.1,d:'M15,35L55,30L75,35L80,48L60,55L30,52L12,45Z', hints:['Mellom-Amerika','Panama-kanalen forbinder Atlanteren og Stillehavet','Panama City er en moderne finansby','Smaleste land mellom Nord- og Sør-Amerika','Hat er oppkalt etter landet']},
  // ── OSEANIA ──
  {n:'New Zealand', f:'🇳🇿', c:'Oseania',  p:'~5 mill',  lat:-40.9,lon:174.9,d:'M35,15L65,12L72,25L65,45L52,58L35,62L25,48L22,32Z', hints:['Øystat ved Australia','Wellington er verdens sydligste main­land-hoved­stad','Filmlokasjon for Ringenes Herre','Maori-kulturen er levende','Kjent for kiwi (fugl og frukt)']},
  {n:'Papua Ny-Guinea',f:'🇵🇬',c:'Oseania',p:'~10 mill', lat:-6.3, lon:143.9,d:'M15,28L55,22L80,28L88,40L80,52L55,58L25,55L10,42Z', hints:['Oseania','Port Moresby er landets hoved­stad','En av verdens mest kulturelt mangfoldige land (800+ språk)','Deler øy med Indonesia (Papua)','Kjent for stammekulturer og rite­riter']},

  // ── SENTRAL-ASIA ──
  {n:'Tadsjikistan',  f:'🇹🇯',c:'Asia',     p:'~10 mill', lat:38.9, lon:71.0, d:'M22,28L68,25L75,38L68,50L28,52L18,40Z', hints:['Sentralasiatisk land','Dushanbe er landets rolige hoved­stad','Pamir-fjellene er «verdens tak»','Grenser til Afghanistan og Kina','Tidl. Sovjet-stat']},
  {n:'Kirgisistan',   f:'🇰🇬',c:'Asia',     p:'~7 mill',  lat:41.2, lon:74.8, d:'M18,28L70,25L76,36L70,50L22,52L12,40Z', hints:['Sentralasiatisk land','Bisjkek er landets hoved­stad','Tian Shan-fjellene dominerer','Nomade-kultur og filthus (yurt)','Tidl. Sovjet-stat']},
  {n:'Turkmenistan',  f:'🇹🇲',c:'Asia',     p:'~6 mill',  lat:39.0, lon:59.6, d:'M12,22L75,18L85,28L82,45L65,55L22,55L10,40Z', hints:['Sentralasiatisk land','Askhabad er overdådig marmor-by','Karakum-ørken dekker 80%','«Dødens Port» er en brennende kratergass','Tidl. Sovjet-stat']},
  {n:'Mongolia',      f:'🇲🇳',c:'Asia',     p:'~3,4 mill',lat:46.9, lon:103.8,d:'M15,20L78,15L90,25L88,45L72,55L25,58L10,42Z', hints:['Verdenshistoriens største landimperium','Ulaanbaatar er kald hoved­stad','Gobi-ørkenen i sør','Djengis Khan er herfra','Grenser til Kina og Russland']},
  {n:'Nord-Korea',    f:'🇰🇵',c:'Asia',     p:'~26 mill', lat:40.3, lon:127.5,d:'M25,22L70,18L78,28L72,45L52,55L28,55L18,42Z', hints:['Lukket diktatur i Asia','Pyongyang er nattmørk hoved­stad','Delt fra Sør-Korea ved 38. breddegrad','Kim-dynastiet har regjert siden 1948','Kjernekraft-prøvesprengninger']},
  {n:'Laos',          f:'🇱🇦',c:'Asia',     p:'~7 mill',  lat:17.6, lon:102.5,d:'M30,15L65,12L72,25L68,40L55,52L38,55L25,42Z', hints:['Sørøst-Asia uten kyst','Vientiane er en stille hoved­stad','Mekongfloden renner gjennom','Sterkt bombet under Vietnam-krigen','Buddhistisk kommuniststat']},
  {n:'Kambodsja',     f:'🇰🇭',c:'Asia',     p:'~17 mill', lat:12.6, lon:104.9,d:'M22,18L65,15L72,28L65,45L42,52L18,45Z', hints:['Sørøst-Asia','Phnom Penh er hoved­staden','Angkor Wat er verdens største religiøse monument','Røde Khmer drepte 2 mill (1975–79)','Grenser til Vietnam og Thailand']},
  {n:'Sri Lanka',     f:'🇱🇰',c:'Asia',     p:'~22 mill', lat:7.9,  lon:80.8, d:'M30,15L62,12L68,28L62,48L42,55L25,45Z', hints:['Øystat sør for India','Colombo og Sri Jayawardenepura Kotte er byer','Kjent for te og kanel','26 år borgerkrig avsluttet 2009','Elefanter og leoparder']},
  {n:'Jordan',        f:'🇯🇴',c:'Asia',     p:'~10 mill', lat:31.2, lon:36.8, d:'M22,18L68,15L75,28L70,45L48,52L22,45Z', hints:['Midtøsten','Amman er en bakke-hoved­stad','Petra er nabateisk rosestad','Jordalv­dalen og Dødehavet','Grenser til Israel, Saudi-Arabia og Syria']},
  {n:'Libanon',       f:'🇱🇧',c:'Asia',     p:'~6,8 mill',lat:33.9, lon:35.9, d:'M28,25L65,22L70,38L58,52L35,50Z', hints:['Lite Midtøsten-land','Beirut er «Midtøstens Paris»','Libanesisk mat er verdensberømt','Krigs­herjet siden 1975','Grenser til Israel og Syria']},
  {n:'Jemen',         f:'🇾🇪',c:'Asia',     p:'~34 mill', lat:16.0, lon:47.6, d:'M15,20L72,15L85,25L88,40L72,52L35,55L12,42Z', hints:['Sørvest på Den arabiske halvøya','Sanaa er verdens eldste bebodde by','Humanitær katastrofe pga krig fra 2015','Mocha-kaffe herfra','Socotra-øya kalles «Galapagos i Midtøsten»']},
  {n:'Oman',          f:'🇴🇲',c:'Asia',     p:'~4,5 mill',lat:21.5, lon:57.0, d:'M22,18L70,12L82,20L85,38L72,50L45,55L22,45Z', hints:['Sørvest på Den arabiske halvøya','Muscat er moderne havn-hoved­stad','Kjent for røkelse og dadler','Stable monarki','Grenser til Saudi-Arabia og Jemen']},
  {n:'De forente arabiske emirater',f:'🇦🇪',c:'Asia',p:'~10 mill',lat:24.0,lon:54.0,d:'M22,25L62,22L68,35L62,50L35,52L18,42Z', hints:['7 emirater','Dubai er verdens høyeste skyskraper-by','Abu Dhabi er hoved­stad og rikest','Oljepenger + turisme','Grenser til Saudi-Arabia og Oman']},
  {n:'Kuwait',        f:'🇰🇼',c:'Asia',     p:'~4,3 mill',lat:29.3, lon:47.7, d:'M30,25L62,22L68,38L55,52L32,50Z', hints:['Lite emirat','Kuwait City er hoved­stad','Irak invaderte i 1990','Stor oljeformue per innbygger','Grenser til Irak og Saudi-Arabia']},
  {n:'Qatar',         f:'🇶🇦',c:'Asia',     p:'~2,9 mill',lat:25.4, lon:51.2, d:'M35,22L58,20L65,35L58,52L35,50Z', hints:['Halvøy i Persiabukta','Doha er ultramoderne hoved­stad','Rikeste land i verden per innbygger','VM i fotball 2022','Al Jazeera er herfra']},
  {n:'Bahrain',       f:'🇧🇭',c:'Asia',     p:'~1,5 mill',lat:26.1, lon:50.6, d:'M38,30L58,28L65,42L55,52L38,50Z', hints:['Liten øystat i Persiabukta','Manama er hoved­stad','F1 Grand Prix-bane','Kjent for perler og olje','Bro til Saudi-Arabia']},
  {n:'Filippinene',   f:'🇵🇭',c:'Asia',     p:'~114 mill',lat:12.9, lon:121.8,d:'M25,12L55,10L72,18L78,32L72,45L58,55L38,58L18,45L15,28Z', hints:['Øy-arkipel i Stillehavet','Manila er tett storbyen','Over 7000 øyer','Katolsk etter spansk kolonisering','Tagalog og Cebuano er hovedspråk']},
  {n:'Taiwan',        f:'🇹🇼',c:'Asia',     p:'~23 mill', lat:23.7, lon:120.9,d:'M30,15L62,12L70,28L62,50L38,55L25,38Z', hints:['Øy i Det kinesiske hav','Taipei er en dynamisk by','Omstridt status ifht. Kina','TSMC produserer halvparten av verdens chips','Demokrati siden 1996']},
  // ── MELLOM-Amerika / KARIBIA ──
  {n:'Honduras',      f:'🇭🇳',c:'Amerika',  p:'~10 mill', lat:15.2, lon:-86.2,d:'M18,22L62,18L70,30L65,48L40,55L15,48Z', hints:['Mellom-Amerika','Tegucigalpa er uvanlig hoved­stadsnavn','Maya-ruiner i Copán','Grenser til Nicaragua og Guatemala','«Bananrepublikk»-begrepet oppsto her']},
  {n:'Nicaragua',     f:'🇳🇮',c:'Amerika',  p:'~7 mill',  lat:12.9, lon:-85.2,d:'M18,20L62,17L70,28L65,48L38,55L15,42Z', hints:['Mellom-Amerika','Managua er hoved­stad','Störst land i Mellom-Amerika','Sandinistar-revolusjon i 1979','Store sjøer som Nicaragua-sjøen']},
  {n:'Costa Rica',    f:'🇨🇷',c:'Amerika',  p:'~5,2 mill',lat:9.9,  lon:-84.2,d:'M18,22L62,18L68,30L60,50L38,55L18,45Z', hints:['Mellom-Amerika','San José er hoved­stad','Ingen hær siden 1949','Fremragende øko-turisme','25% av landet er vernet natur']},
  {n:'Haiti',         f:'🇭🇹',c:'Amerika',  p:'~11 mill', lat:18.9, lon:-72.3,d:'M22,25L58,22L65,35L58,52L28,55Z', hints:['Vest-Karibia','Port-au-Prince er hoved­stad','Deler øya Hispaniola med Dominikanske republikk','Første sorte fri stat (1804)','Hardt rammet av jordskjelv i 2010']},
  {n:'Jamaica',       f:'🇯🇲',c:'Amerika',  p:'~2,9 mill',lat:18.1, lon:-77.3,d:'M18,35L55,30L78,38L72,52L35,55Z', hints:['Karibiøy','Kingston er hoved­stad','Hjemland for reggae og Bob Marley','Usain Bolt er herfra','Blue Mountains-kaffe']},
  {n:'Trinidad og Tobago',f:'🇹🇹',c:'Amerika',p:'~1,4 mill',lat:10.7,lon:-61.2,d:'M25,32L65,28L72,42L60,55L25,52Z', hints:['Karibi-øy-stat','Port of Spain er hoved­stad','Rikelig olje og naturgass','Carneval er verdens beste','Stålband-musikk ble oppfunnet her']},
  {n:'Guyana',        f:'🇬🇾',c:'Amerika',  p:'~0,8 mill',lat:5.0,  lon:-59.0,d:'M18,18L62,15L70,28L65,48L40,55L15,42Z', hints:['Nordøst-Sør-Amerika','Georgetown er hoved­stad','Eneste engelsktalende land i Sør-Amerika','Angel Falls er i nabolandet','Grenser til Venezuela og Brasil']},
  {n:'Surinam',       f:'🇸🇷',c:'Amerika',  p:'~0,6 mill',lat:3.9,  lon:-56.0,d:'M18,18L62,15L70,28L65,48L40,55L15,42Z', hints:['Minste land i Sør-Amerika','Paramaribo er hoved­stad','Eneste nederlandsktalende i Sør-Amerika','Jungel dekker 90%','Grenser til Brasil og Guyana']},
  {n:'Uruguay',       f:'🇺🇾',c:'Amerika',  p:'~3,5 mill',lat:-33.0,lon:-56.0,d:'M22,25L65,22L72,35L65,52L38,55L18,45Z', hints:['Sørøst Sør-Amerika','Montevideo er hoved­stad','Et av Sør-Amerikas mest stabile demokratier','Kjent for mate-drikke og gaucho','Verdens høyeste cannabis-forbruk per innbygger']},
  {n:'Paraguay',      f:'🇵🇾',c:'Amerika',  p:'~7 mill',  lat:-23.4,lon:-58.4,d:'M18,22L65,18L72,32L65,50L38,55L15,42Z', hints:['Sentralt i Sør-Amerika uten kyst','Asunción er hoved­stad','Guaraní er offisielt språk','Itaipu-dammen er en av verdens største','Grenser til Brasil, Argentina og Bolivia']},
  {n:'Liberia',       f:'🇱🇷',c:'Afrika',   p:'~5,2 mill',lat:6.5,  lon:-9.4, d:'M25,22L62,18L68,32L62,50L38,55L22,45Z', hints:['Vestafrikansk land','Monrovia er hoved­stad (oppkalt etter Monroe)','Grunnlagt av frigjorte amerikanske slaver i 1822','Grenser til Sierra Leone og Guinea','Borgerkrig 1989–2003']},
  {n:'Sierra Leone',  f:'🇸🇱',c:'Afrika',   p:'~8,1 mill',lat:8.5,  lon:-11.8,d:'M25,20L60,18L65,32L58,50L35,52L18,38Z', hints:['Vestafrikansk land','Freetown er hoved­stad','Kjent for diamanter og strander','Borgerkrig 1991–2002','Grenser til Guinea og Liberia']},
  {n:'Guinea',        f:'🇬🇳',c:'Afrika',   p:'~13 mill', lat:11.0, lon:-10.9,d:'M15,18L60,15L68,28L60,45L35,52L12,38Z', hints:['Vestafrikansk land','Conakry er hoved­stad','Rikt på bauxitt','Grenser til 6 land','Ikke å forveksle med Ekvatorial-Guinea']},
  {n:'Mali',          f:'🇲🇱',c:'Afrika',   p:'~22 mill', lat:17.6, lon:-4.0, d:'M10,15L75,12L85,22L82,45L68,58L22,58L8,42Z', hints:['Vestafrikansk land','Bamako er hoved­stad','Timbuktu var middelalderens lærdomssentrum','Stor del er Sahara','Grenser til Algerie og Niger']},
  {n:'Niger',         f:'🇳🇪',c:'Afrika',   p:'~25 mill', lat:17.6, lon:8.1,  d:'M10,15L78,10L88,18L88,38L72,52L32,55L10,40Z', hints:['Vestafrikansk land','Niamey er hoved­stad','Størst land i Vest-Afrika','Sahara dekker mesteparten','Grenser til 7 land inkl. Nigeria og Mali']},
  {n:'Tsjad',         f:'🇹🇩',c:'Afrika',   p:'~17 mill', lat:15.5, lon:18.7, d:'M15,12L75,10L85,20L82,42L68,55L28,58L12,42Z', hints:['Sentralafrikansk land','NDjamena er hoved­stad','Tsjad-sjøen er svinnende','Grenser til Libya, Sudan og Nigeria','Blant verdens fattigste land']},
  {n:'Sudan',         f:'🇸🇩',c:'Afrika',   p:'~45 mill', lat:12.9, lon:30.2, d:'M18,12L72,10L82,20L80,42L65,55L38,58L15,42Z', hints:['Nordøstafrikansk land','Khartoum er hoved­stad','Nilen renner gjennom','Delt fra Sør-Sudan i 2011','Pyramider fra det nubiske kongedømmet']},
  {n:'Sør-Sudan',     f:'🇸🇸',c:'Afrika',   p:'~11 mill', lat:6.9,  lon:31.3, d:'M18,18L70,15L78,25L75,42L55,55L28,58L15,42Z', hints:['Verdens yngste land (2011)','Juba er hoved­stad','Uavhengig fra Sudan','Borgerkrig siden 2013','Nilen er viktig']},
  {n:'Somalia',       f:'🇸🇴',c:'Afrika',   p:'~17 mill', lat:5.2,  lon:46.2, d:'M35,10L75,12L85,22L82,45L68,60L38,62L20,45L22,25Z', hints:['Afrikashornet','Mogadishu er hoved­stad','Piratvirksomhet i Det indiske hav','Langst kystlinje i fastlands-Afrika','Ingen effektiv sentralregjering siden 1991']},
  {n:'Rwanda',        f:'🇷🇼',c:'Afrika',   p:'~13 mill', lat:-2.0, lon:30.0, d:'M28,28L65,25L70,40L62,52L32,52L20,40Z', hints:['Lite øst-afrikansk land','Kigali er velordnet hoved­stad','Folkemord i 1994: 800 000 drept på 100 dager','Nå et av Afrikas raskest voksende økonomi','«Tusen haugers land»']},
  {n:'Burundi',       f:'🇧🇮',c:'Afrika',   p:'~13 mill', lat:-3.4, lon:30.0, d:'M28,25L62,22L68,38L60,50L30,52L20,40Z', hints:['Lite sentralafrikansk land','Bujumbura er hoved­stad','Et av verdens fattigste land','Grenser til Rwanda, Tanzania og DR Kongo','Kjent for Tanganyika-sjøen']},
  {n:'Uganda',        f:'🇺🇬',c:'Afrika',   p:'~48 mill', lat:1.4,  lon:32.3, d:'M18,18L72,15L80,28L75,45L55,55L22,52L12,38Z', hints:['Østafrikansk land','Kampala er hoved­stad','Perlen av Afrika','Viktoria-sjøen deles med Tanzania','Grenser til Kenya, DR Kongo og Tanzania']},
  {n:'Ekvatorial-Guinea',f:'🇬🇶',c:'Afrika',p:'~1,5 mill',lat:1.6, lon:10.3, d:'M28,30L62,28L68,42L55,52L32,52Z', hints:['Liten stat i Sentral-Afrika','Malabo er hoved­stad på en øy','Eneste Spansk-talende land i Afrika','Olje har gitt rikdom til elitene','Grenser til Kamerun og Gabon']},
  {n:'Gabon',         f:'🇬🇦',c:'Afrika',   p:'~2,3 mill',lat:-0.8, lon:11.6, d:'M18,18L65,15L72,28L65,48L38,52L15,40Z', hints:['Sentralafrikansk land','Libreville er hoved­stad','80% tropisk regnskog','Kjent for olje','Grenser til Kamerun og Kongo']},
  {n:'Kongo',         f:'🇨🇬',c:'Afrika',   p:'~5,8 mill',lat:-0.2, lon:15.8, d:'M18,15L65,12L72,25L68,45L38,50L15,35Z', hints:['Brazzaville-Kongo (ikke DR Kongo)','Brazzaville er hoved­stad','Grenser til DR Kongo over elven','Kongofloden er grense','Tropisk regnskog']},
  {n:'Djibouti',      f:'🇩🇯',c:'Afrika',   p:'~0,9 mill',lat:11.8, lon:42.6, d:'M32,28L62,25L68,38L58,52L35,52Z', hints:['Lite horn-af­rika-land','Djibouti er hoved­stad','Strategisk havn ved Adensbukta','Verdens varmeste land','Franske og amerikanske baser']},
  {n:'Komoros',       f:'🇰🇲',c:'Afrika',   p:'~0,8 mill',lat:-11.6,lon:43.3, d:'M28,30L62,28L68,42L52,55Z', hints:['Øy-stat i Det indiske hav','Moroni er hoved­stad','Nesten daglige militærkupp','Kjent for ylang-ylang parfyme','Grenser til Madagaskar og Mosambik']},
  {n:'Seychellene',   f:'🇸🇨',c:'Afrika',   p:'~98 000',  lat:-4.7, lon:55.5, d:'M30,28L62,25L68,38L52,50Z', hints:['Øy-stat i Det indiske hav','Victoria er verdens minste hoved­stad','Paradisøyer med korallrev','Hvite strender og palmetrær','Utenfor kysten av Øst-Afrika']},
  {n:'Madagaskar',    f:'🇲🇬',c:'Afrika',   p:'~28 mill', lat:-18.8,lon:46.9, d:'M28,12L65,10L72,22L68,45L55,60L32,62L18,50L15,32Z', hints:['Fjerde største øy i verden','Antananarivo er hoved­stad','80% av dyre- og plantelivet er unikt','Lemurer lever bare her','Utenfor sørøstkysten av Afrika']},
  // ── OSEANIA ──
  {n:'Fiji',          f:'🇫🇯',c:'Oseania',  p:'~0,9 mill',lat:-17.7,lon:178.1,d:'M25,30L62,28L68,42L55,55Z', hints:['Øy-stat i Stillehavet','Suva er hoved­stad','Over 300 øyer','Rugby-nasjon','Turisme er viktigste næring']},
  {n:'Vanuatu',       f:'🇻🇺',c:'Oseania',  p:'~0,3 mill',lat:-15.4,lon:166.9,d:'M32,22L58,20L62,35L52,50Z', hints:['Øy-arkipel i Stillehavet','Port Vila er hoved­stad','80 øyer','Aktivt vulkanliv','Grunnlagt av Storbritannia og Frankrike sammen']},
  {n:'Samoa',         f:'🇼🇸',c:'Oseania',  p:'~0,2 mill',lat:-13.8,lon:-172.1,d:'M25,30L60,28L65,42L50,55Z', hints:['Polynesisk øy-stat','Apia er hoved­stad','Ikke å forveksle med Amerikansk Samoa','Rugby-spillere','Robert Louis Stevenson bodde her']},
  {n:'Tonga',         f:'🇹🇴',c:'Oseania',  p:'~0,1 mill',lat:-21.2,lon:-175.2,d:'M28,28L60,26L65,40L52,52Z', hints:['Polynesisk kongeriket','Nukualofa er hoved­stad','Eneste gjenværende monarki i Stillehavet','Kjent for rubgy','Ble del av Storbritannias innflytelsessfære']},
  // ── EUROPA (EKSTRA) ──
  {n:'Malta',         f:'🇲🇹',c:'Europa',   p:'~0,5 mill',lat:35.9, lon:14.5, d:'M32,30L62,28L68,42L52,55Z', hints:['Liten øy­stat i Middelhavet','Valletta er verdens minste EU-hoved­stad','Ridderne av Malta','Strategisk under 2. verdenskrig','Nordens sørligste engelsktalende land']},
  {n:'Kypros',        f:'🇨🇾',c:'Europa',   p:'~1,2 mill',lat:35.1, lon:33.4, d:'M15,35L55,28L80,35L82,48L55,55L18,52Z', hints:['Middelhavsøy','Nicosia er delt hoved­stad','Delt mellom Kypros og Tyrkiske nord-Kypros','Gresk og tyrkisk kultur','Tredje største øy i Middelhavet']},
  {n:'Andorra',       f:'🇦🇩',c:'Europa',   p:'~77 000',  lat:42.5, lon:1.5,  d:'M38,30L62,28L65,42L48,52Z', hints:['Lilleputtstaten i Pyreneene','Andorra la Vella er hoved­stad','Co-prinsipat mellom Frankrike og Spania','Kjent for duty-free shopping','Ingen flyplass og ingen jernbane']},
  {n:'San Marino',    f:'🇸🇲',c:'Europa',   p:'~34 000',  lat:43.9, lon:12.5, d:'M38,30L60,28L63,42L45,50Z', hints:['Omgitt av Italia','Verdens minste og eldste republikk','Grunnlagt i år 301','En av Europas rikeste land','Monte Titano er ikonisk fjell']},
  {n:'Monaco',        f:'🇲🇨',c:'Europa',   p:'~37 000',  lat:43.7, lon:7.4,  d:'M38,32L58,30L62,42L45,48Z', hints:['Verdens nest minste land','Monte Carlo er kjent for casino','Omgitt av Frankrike og Middelhavet','Formel 1-løp gjennom bygatene','Fyrstehuset Grimaldi']},
  {n:'Vatikanstaten', f:'🇻🇦',c:'Europa',   p:'~800',     lat:41.9, lon:12.5, d:'M42,32L58,30L60,40L44,45Z', hints:['Verdens minste land','Hoved­stad: Vatikanstaten','Pavestolens sete','Peterskirken er verdens største katedrale','Omgitt av Roma, Italia']},
  {n:'Liechtenstein', f:'🇱🇮',c:'Europa',   p:'~38 000',  lat:47.1, lon:9.6,  d:'M38,28L62,26L65,40L48,52Z', hints:['Lilleputtstaten mellom Sveits og Østerrike','Vaduz er hoved­stad','Ikke OECD-medlem','Kjent for postfrimerkene','Dobbelt innlandet: omgitt av innlandsstater']},
  {n:'Georgia (landet)',f:'🇬🇪',c:'Asia/Europa',p:'~3,7 mill',lat:42.3,lon:43.4,d:'M18,22L68,18L78,28L72,45L35,50L15,38Z', hints:['Kaukasus-land','Tbilisi er en fargerik gammel by','Grenser til Russland, Tyrkia og Armenia','Georgisk alfabet er unikt','Kjent for vin og khachapuri']},
  {n:'Armenia',       f:'🇦🇲',c:'Asia/Europa',p:'~3 mill', lat:40.1, lon:45.0, d:'M25,22L65,20L72,32L65,48L35,50L20,38Z', hints:['Kaukasus-land','Jerevan er eldgammel hoved­stad','Første kristne nasjon (år 301)','Folkemord i 1915 av osmanerne','Grenser til Tyrkia, Iran og Aserbajdsjan']},
  {n:'Aserbajdsjan',  f:'🇦🇿',c:'Asia/Europa',p:'~10 mill',lat:40.1, lon:47.6, d:'M22,20L70,17L78,28L72,45L38,50L18,38Z', hints:['Kaukasus-land','Baku er moderne hoved­stad','Stor oljeprodusent','Grenser til Russland, Georgia og Iran','Kjent for ild – «Brannenes land»']},

];

const GZ_PERSONS = [
  {n:'Nelson Mandela',cat:'politiker',    hints:['Sørafrikansk politiker','Sonet 27 år i fengsel for sine overbevisninger','Kjempet mot apartheid med ikkevold','Fikk Nobels fredspris i 1993','Ble Sør-Afrikas første svarte president i 1994']},
  {n:'Marie Curie',cat:'vitenskapsmann',       hints:['Polsk-fransk forsker (1867–1934)','Første kvinne til å vinne Nobelprisen','Oppdaget grunnstoffene polonium og radium','Eneste person til å vinne to Nobelpriser i ulike naturvitenskaplige fag','Forsket på radioaktivitet – døde av det']},
  {n:'Albert Einstein',cat:'vitenskapsmann',   hints:['Tysk-sveitsisk-amerikansk vitenskapsmann','Levde fra 1879 til 1955','Kjent for relativitetsteorien','Utviklet formelen E=mc²','Fikk Nobels fysikkpris i 1921']},
  {n:'Leonardo da Vinci',cat:'kunstner', hints:['Italiensk renessansekunstner (1452–1519)','Malte Mona Lisa og Det siste måltid','Var også ingeniør og oppfinner','Tegnet skisser av fly og tankliknende maskiner 400 år for tidlig','Regnes som verdenshistoriens mest allsidige geni']},
  {n:'Mahatma Gandhi',cat:'politiker',    hints:['Indisk frihetsleder (1869–1948)','Kjent for ikkevoldelig motstand (satyagraha)','Ledet India mot frigjøring fra Storbritannia','Kallenavn betyr «stor sjel»','Ble skutt og drept i januar 1948']},
  {n:'Martin Luther King',cat:'politiker',hints:['Amerikansk borgerrettighetsleder','Baptistpastor som kjempet for rasemessig likhet','Holdt talen «I Have a Dream» i 1963','Mottok Nobels fredspris i 1964','Ble skutt og drept i Memphis i april 1968']},
  {n:'Anne Frank',cat:'historisk',        hints:['Tysk-nederlandsk jødisk jente (1929–1945)','Flyktet med familien til Amsterdam for nazistene','Gjemte seg i et skjulested i Amsterdam i to år','Dagboken hennes ble en av historiens mest leste bøker','Ble deportert og døde i Bergen-Belsen']},
  {n:'Fridtjof Nansen',cat:'oppdagelsesreisende',   hints:['Norsk polarforsker og diplomat (1861–1930)','Krysset Grønlands innlandsis på ski i 1888','Ledet Fram-ekspedisjonen mot Nordpolen','Fikk Nobels fredspris i 1922 for flyktningarbeid','Nansen-passet er oppkalt etter ham']},
  {n:'Cleopatra',cat:'historisk',         hints:['Hersket over Egypt for ca. 2000 år siden','Siste farao av ptolemeisk ætt','Var faktisk av gresk opprinnelse, ikke egyptisk','Hadde romantiske forhold til Julius Caesar og Marcus Antonius','Tok livet av seg etter at Marcus Antonius døde']},
  {n:'William Shakespeare',cat:'kunstner',hints:['Engelsk forfatter (1564–1616)','Levde og virket i London under dronning Elizabeth I','Skrev 37 skuespill og 154 sonetter','Kjent for Romeo og Julie, Hamlet og Macbeth','Regnes som verdenslitteraturens mest innflytelsesrike forfatter']},
  {n:'Barack Obama',cat:'politiker',      hints:['Amerikansk politiker (f. 1961)','Advokat og senator fra Illinois','USAs 44. president (2009–2017)','Første afroamerikanske president i USA','Mottok Nobels fredspris i 2009']},
  {n:'Greta Thunberg',cat:'aktivist',    hints:['Svensk klimaaktivist (f. 2003)','Begynte å streike utenfor det svenske parlamentet i august 2018','Grunnla bevegelsen Fridays for Future','Har diagnosen Aspergers syndrom','Ble Times person of the year i 2019']},
  {n:'Isaac Newton',cat:'vitenskapsmann',      hints:['Engelsk vitenskapsmann (1643–1727)','Formulerte gravitasjonsloven','Utviklet klassisk mekanikk','En eple-anekdote er knyttet til oppdagelsen hans','Bidro til calculus og optikk']},
  {n:'Nikola Tesla',cat:'vitenskapsmann',      hints:['Serbisk-amerikansk oppfinner (1856–1943)','Kjent for å utvikle vekselstrøm (AC)','Rivaliserte med Thomas Edison','Oppfant blant annet Tesla-spolen','Elbilselskapet Tesla er oppkalt etter ham']},
  {n:'Malala Yousafzai',cat:'aktivist',  hints:['Pakistansk utdanningssaktivist (f. 1997)','Ble skutt i hodet av Taliban som 15-åring','Overlevde og fortsatte kampen for jenters skolegang','Yngste mottaker av Nobels fredspris (2014)','Studerte ved Oxford og grunnla Malala Fund']},
  {n:'Christopher Columbus',cat:'oppdagelsesreisende',hints:['Italiensk sjøfarer (1451–1506)','Seilte på vegne av den spanske kronen','Krysset Atlanterhavet i 1492','Mente han hadde nådd Asia – fant Amerika','Gjorde fire reiser til den nye verden']},
  {n:'Frida Kahlo',cat:'kunstner',       hints:['Meksikansk kunstner (1907–1954)','Kjent for selvportretter med surrealistisk preg','Levde med kroniske smerter etter en bussulykke som ung','Gift med mureren Diego Rivera','Symbol for feminisme og mexicansk kultur']},
  {n:'Roald Dahl',cat:'kunstner',        hints:['Halvnorsk-britisk forfatter (1916–1990)','Faren hans var norsk fra Sarpsborg','Tjenestegjorde i RAF under 2. verdenskrig','Kjent for Charlie og sjokoladefabrikken og Matilda','Også forfatter av voksenlitteratur og noveller']},
  {n:'Elon Musk',cat:'gründer',         hints:['Sør-afrikansk-amerikanerskaper (f. 1971)','Grunnla PayPal, SpaceX og var med å grunnlegge Tesla','Kjøpte og omdøpte Twitter til X','En av verdens rikeste personer','Drømmer om å kolonisere Mars']},
  {n:'Winston Churchill',cat:'politiker',  hints:['Britisk statsleder (1874–1965)','Ledet Storbritannia gjennom 2. verdenskrig','Kjent for inspirerende taler («We shall fight on the beaches»)','Fikk Nobelprisen i litteratur i 1953','Statsminister i to perioder']},
  // Idrettsutøvere
  {n:'Usain Bolt',        cat:'idrett', hints:['Jamaicansk sprinter','Verdens raskeste mann','Satte verdensrekord på 100m (9,58 sek) i 2009','Vant 8 OL-gull','Kjent for «lightning bolt»-posen']},
  {n:'Lionel Messi',      cat:'idrett', hints:['Argentinsk fotballspiller','Vant VM med Argentina i 2022','Har spilt for Barcelona og PSG','Vant Gullballen 8 ganger','Mange regner ham som tidenes beste fotballspiller']},
  {n:'Simone Biles',      cat:'idrett', hints:['Amerikansk gymnast (f. 1997)','Vant 4 OL-gull i Rio 2016','Kjent for å utføre elementer ingen andre tør','Trakk seg fra OL 2020 av psykiske helsegrunner','Regnes som tidenes beste gymnast']},
  {n:'Muhammad Ali',      cat:'idrett', hints:['Amerikansk bokselegende (1942–2016)','Tidligere navn: Cassius Clay','Verdensmeser i tungvekt tre ganger','Kjent for «float like a butterfly, sting like a bee»','Politisk aktivist under Vietnam-krigen']},
  {n:'Serena Williams',   cat:'idrett', hints:['Amerikansk tennisspiller (f. 1981)','Vant 23 Grand Slam-titler','Regnes som tidenes beste tennisspiller','Søster av Venus Williams','La opp i 2022']},
  // Vitenskapsmenn
  {n:'Charles Darwin',    cat:'vitenskapsmann', hints:['Britisk naturvitenskaper (1809–1882)','Reiste med HMS Beagle til Galápagos','Utviklet teorien om naturlig utvalg','Boken «Artenes opprinnelse» fra 1859','Hans teorier la grunnlaget for moderne biologi']},
  {n:'Stephen Hawking',   cat:'vitenskapsmann', hints:['Britisk fysiker (1942–2018)','Diagnostisert med ALS som 21-åring','Forsket på svarte hull og kvantemekanikk','Kjent for boken «En kort historien om tiden»','Kommuniserte via talesyntesizer']},
  {n:'Alan Turing',       cat:'vitenskapsmann', hints:['Britisk matematiker (1912–1954)','Regnes som datamaskinens far','Knakk den tyske Enigma-koden under 2. verdenskrig','Turing-testen sjekker om maskiner kan tenke','Ble forfulgt for sin seksuelle legning']},
  // Kunstnere
  {n:'Pablo Picasso',     cat:'kunstner', hints:['Spansk maler (1881–1973)','Grunnla kubismen sammen med Georges Braque','Malte «Guernica» som protest mot fascistisk bombeangrep','Produserte over 20 000 kunstverk','En av 1900-tallets mest innflytelsesrike kunstnere']},
  {n:'Beethoven',         cat:'kunstner', hints:['Tysk komponist (1770–1827)','Begynte å miste hørselen rundt 1800','Komponerte 9 symfonier','Den 9. symfonien ble skrevet da han var helt døv','«For Elise» og «Måneskinn-sonaten» er blant hans kjente verk']},
];
// ====== END GAME ZONE DATA ======

// ====== CLASSROOM / LIVE QUIZ ENGINE (lazy bundle) ======

// ====== CLASSROOM / LIVE QUIZ ENGINE ======
// Game state lives purely in-memory (same-device simulation via localStorage events)
const ANIMALS = ['🦊','🐯','🐻','🦁','🐼','🐨','🐸','🦋','🐬','🦄','🐺','🦅','🦜','🐙','🦀','🐝','🦎','🐳'];
const ADJECTIVES = ['Rask','Lur','Modig','Snill','Sterk','Smart','Glad','Rolig','Vill','Kjekk','Ivrig','Grei'];
const NOUNS = ['Elg','Bjørn','Rev','Ulv','Ørn','Sel','Hval','Løve','Tiger','Panda','Koala','Frosk'];

let crGame = null; // teacher game state
let sjGame = null; // student game state


// ════════════════════════════════════════════════════════════
//  GAME – real-time game state via Supabase os_games table
//  Falls back to localStorage when DB not configured
// ════════════════════════════════════════════════════════════
const GAME = {
  async save(code, data) {
    localStorage.setItem('cr_game', JSON.stringify(data));
    await DB._q('POST', 'os_games', null, [{ code, data, updated_at: new Date().toISOString() }]);
  },

  async load(code) {
    const rows = await DB._q('GET', 'os_games', 'code=eq.' + encodeURIComponent(code) + '&select=data,updated_at&limit=1');
    if (!rows || !rows.length) {
      // Fallback til localStorage
      const raw = localStorage.getItem('cr_game');
      if (!raw) return null;
      const d = JSON.parse(raw);
      return d.code === code ? d : null;
    }
    const age = Date.now() - new Date(rows[0].updated_at).getTime();
    if (age > 3 * 60 * 60 * 1000) return null;
    return rows[0].data;
  },

  async delete(code) {
    localStorage.removeItem('cr_game');
    await DB._q('DELETE', 'os_games', 'code=eq.' + encodeURIComponent(code));
  }
};

function crGenerateCode() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  return Array.from({length:4}, () => chars[Math.floor(Math.random()*chars.length)]).join('');
}

function crGenerateUsername() {
  const adj = ADJECTIVES[Math.floor(Math.random()*ADJECTIVES.length)];
  const noun = NOUNS[Math.floor(Math.random()*NOUNS.length)];
  const num = Math.floor(Math.random()*99)+1;
  return adj + noun + num;
}

function crGetAnimal(username) {
  return ANIMALS[username.length % ANIMALS.length];
}

function crPopulateModules() {
  const sel = document.getElementById('crModuleSelect');
  if (!sel) return;
  const published = state.modules.filter(m => m.quiz && m.quiz.length > 0);
  sel.innerHTML = '<option value="">— Velg emne —</option>' +
    published.map((m,i) => `<option value="${i}">${m.emoji||'📚'} ${m.name} (${m.quiz.length} spørsmål)</option>`).join('');
  // Also populate arbeid module list
  const arbList = document.getElementById('crArbeidModuleList');
  if (arbList) {
    if (state.modules.length === 0) {
      arbList.innerHTML = '<p style="color:var(--text-3);font-size:0.9rem;">Ingen emner publisert ennå.</p>';
    } else {
      arbList.innerHTML = state.modules.map(m => `
        <div style="display:flex;align-items:center;gap:0.75rem;padding:0.6rem 0;border-bottom:1px solid #f0f0f0;">
          <span style="font-size:1.5rem;">${m.emoji||'📚'}</span>
          <span style="font-weight:700;font-size:0.92rem;color:var(--text);">${escHtml(m.name)}</span>
          <span style="font-size:0.8rem;color:var(--text-3);margin-left:auto;">${countTasks(m)} oppgaver</span>
        </div>`).join('');
    }
  }
}


// ════════════════════════════════════════════════════════
//  HIGHSCORES
// ════════════════════════════════════════════════════════
async function showPublicHighscores() {
  sjShow('highscores');
  const container = document.getElementById('publicHsContainer');
  if (!container) return;
  container.innerHTML = '<div style="text-align:center;padding:2rem;color:var(--text-3);">⏳ Laster...</div>';
  const rows = await DB.loadHighscores('');
  if (!rows.length) {
    container.innerHTML = '<div style="text-align:center;padding:3rem;color:var(--text-3);"><div style="font-size:3rem;">🏆</div><div style="margin-top:0.5rem;">Ingen high scores ennå!</div></div>';
    return;
  }
  const byQuiz = {};
  rows.forEach(r => { if (!byQuiz[r.quiz_name]) byQuiz[r.quiz_name] = []; byQuiz[r.quiz_name].push(r); });
  const medals = ['🥇','🥈','🥉'];
  let out = '';
  for (const [quiz, entries] of Object.entries(byQuiz)) {
    const top = entries.sort((a,b) => b.score-a.score).slice(0,10);
    out += `<div style="background:var(--s1);border-radius:14px;padding:1.25rem;margin-bottom:1.25rem;box-shadow:0 4px 16px rgba(0,0,0,0.07);">
      <div style="font-family:'Fredoka One',cursive;font-size:1.2rem;color:var(--text);margin-bottom:0.875rem;">🎮 ${quiz}</div>
      ${top.map((r,i) => `<div style="display:flex;align-items:center;gap:0.75rem;padding:0.6rem 0.75rem;border-radius:10px;background:${i<3?['rgba(234,179,8,0.12)','rgba(123,143,253,0.1)','rgba(34,197,94,0.1)'][i]:'var(--s2)'};margin-bottom:0.4rem;border:1px solid ${i<3?['rgba(234,179,8,0.25)','rgba(123,143,253,0.2)','rgba(34,197,94,0.2)'][i]:'var(--border)'};">
        <span style="font-size:1.3rem;min-width:2rem;text-align:center;">${medals[i]||i+1}</span>
        <span style="font-weight:800;flex:1;">${r.player_name}</span>
        <span style="font-weight:900;color:var(--c4);">${r.score} pts</span>
        <span style="font-size:0.78rem;color:var(--text-3);">${new Date(r.played_at).toLocaleDateString('no')}</span>
      </div>`).join('')}
    </div>`;
  }
  container.innerHTML = out;
}

async function loadHighscoreView() {
  const container = document.getElementById('hsTableContainer');
  const filter = document.getElementById('hsQuizFilter');
  if (!container) return;
  container.innerHTML = '<div style="text-align:center;padding:2rem;color:var(--text-3);">⏳ Laster...</div>';

  const rows = await DB.loadHighscores('');
  if (!rows.length) {
    container.innerHTML = '<div style="text-align:center;padding:3rem;color:var(--text-3);"><div style="font-size:3rem;">🏆</div><div style="margin-top:0.5rem;">Ingen high scores ennå.<br>Spill en Live Quiz for å komme på listen!</div></div>';
    return;
  }

  // Populate quiz filter dropdown
  if (filter) {
    const quizNames = [...new Set(rows.map(r => r.quiz_name))].sort();
    const current = filter.value;
    filter.innerHTML = '<option value="">— Alle quizer —</option>' +
      quizNames.map(n => `<option value="${n}" ${n===current?'selected':''}>${n}</option>`).join('');
  }

  // Filter by selected quiz
  const selectedQuiz = filter ? filter.value : '';
  const filtered = selectedQuiz ? rows.filter(r => r.quiz_name === selectedQuiz) : rows;

  // Group by quiz, show top entries
  const byQuiz = {};
  filtered.forEach(r => {
    if (!byQuiz[r.quiz_name]) byQuiz[r.quiz_name] = [];
    byQuiz[r.quiz_name].push(r);
  });

  const medals = ['🥇','🥈','🥉'];
  const isTeacher = state.isTeacher;

  let html = '';
  for (const [quiz, entries] of Object.entries(byQuiz)) {
    const top = entries.sort((a,b) => b.score - a.score).slice(0, 20);
    html += `
      <div style="background:var(--s1);border-radius:14px;padding:1.25rem;margin-bottom:1.25rem;box-shadow:0 4px 16px rgba(0,0,0,0.07);">
        <div style="font-family:'Fredoka One',cursive;font-size:1.2rem;color:var(--text);margin-bottom:0.875rem;">🎮 ${quiz}</div>
        ${top.map((r, i) => `
          <div style="display:flex;align-items:center;gap:0.75rem;padding:0.6rem 0.75rem;border-radius:10px;background:${i<3?['rgba(234,179,8,0.12)','rgba(123,143,253,0.1)','rgba(34,197,94,0.1)'][i]:'var(--s2)'};margin-bottom:0.4rem;border:1px solid ${i<3?['rgba(234,179,8,0.25)','rgba(123,143,253,0.2)','rgba(34,197,94,0.2)'][i]:'var(--border)'};">
            <div style="font-size:1.3rem;min-width:2rem;text-align:center;">${medals[i] || (i+1)}</div>
            <div style="font-weight:800;flex:1;">${r.player_name}</div>
            <div style="font-weight:900;color:var(--c4);font-size:1.05rem;">${r.score} pts</div>
            <div style="font-size:0.78rem;color:var(--text-3);">${new Date(r.played_at).toLocaleDateString('no')}</div>
            ${isTeacher ? `<button data-onclick="deleteHighscoreEntry" data-onclick-arg="${r.id}" title="Fjern fra listen" class="btn-danger-hover" style="background:none;border:none;cursor:pointer;font-size:1rem;color:var(--text-3);padding:2px 6px;border-radius:6px;">🗑</button>` : ''}
          </div>`).join('')}
      </div>`;
  }
  container.innerHTML = html;
}

async function deleteHighscoreEntry(id) {
  if (!state.isTeacher) return;
  if (!confirm('Fjerne denne spilleren fra high score-listen?')) return;
  await DB.deleteHighscore(id);
  showToast('🗑 Fjernet fra high score-listen');
  loadHighscoreView();
}
function crSwitchTab(tab) {
  ['quiz','arbeid','hs'].forEach(t => {
    const pane = document.getElementById('crPane-' + t);
    if (pane) pane.style.display = t === tab ? 'block' : 'none';
    const btn = document.getElementById('crTab-' + t);
    if (!btn) return;
    const colors = { quiz:'var(--c4)', arbeid:'var(--c3)', hs:'var(--c2)' };
    const textColors = { quiz:'white', arbeid:'white', hs:'var(--dark)' };
    btn.style.background = t === tab ? colors[t] : 'var(--s3)';
    btn.style.color = t === tab ? textColors[t] : 'var(--text-2)';
  });
  if (tab === 'arbeid') crPopulateModules();
}

