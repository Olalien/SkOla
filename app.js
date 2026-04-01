// ====== HANDLER REGISTRY (CSP-safe closures for dynamic HTML) ======
// Usage in template literals: data-hid="${_reg(function(event){...})}"
// delegation calls fn.call(element, event) so `this` = element, event = MouseEvent
const _H = {};
let _hid = 0;
function _reg(fn) { const id = ++_hid; _H[id] = fn; return id; }

// ====== STATE ======
let state = {
  isTeacher: false,
  student: null,
  modules: [],
  tempQuiz: [],
  tempDisc: [],
  tempWrite: [],
  tempVideos: [],
  tempFlashcards: [],
  tempBlanks: [],
  tempGlossary: [],
  studentAnswers: {},
  currentModule: null,
  currentTask: 'text',
  fcIndex: 0
};

const SecurityUtils = {
  generateSalt() {
    const bytes = new Uint8Array(16);
    crypto.getRandomValues(bytes);
    return btoa(String.fromCharCode(...bytes));
  },
  async hashPassword(password, salt) {
    const enc = new TextEncoder();
    const keyMaterial = await crypto.subtle.importKey('raw', enc.encode(password), 'PBKDF2', false, ['deriveBits']);
    const saltBytes = Uint8Array.from(atob(salt), c => c.charCodeAt(0));
    const bits = await crypto.subtle.deriveBits({ name: 'PBKDF2', salt: saltBytes, iterations: 100000, hash: 'SHA-256' }, keyMaterial, 256);
    return btoa(String.fromCharCode(...new Uint8Array(bits)));
  },
  async verifyPassword(password, storedHash, salt) {
    const derived = await this.hashPassword(password, salt);
    return derived === storedHash;
  },
  async deriveEncryptionKey(password) {
    const enc = new TextEncoder();
    const saltBytes = enc.encode('olaskole-encryption-salt-v1');
    const keyMaterial = await crypto.subtle.importKey('raw', enc.encode(password), 'PBKDF2', false, ['deriveKey']);
    return crypto.subtle.deriveKey(
      { name: 'PBKDF2', salt: saltBytes, iterations: 100000, hash: 'SHA-256' },
      keyMaterial,
      { name: 'AES-GCM', length: 256 },
      false,
      ['encrypt', 'decrypt']
    );
  },
  async encrypt(data, key) {
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const enc = new TextEncoder();
    const cipher = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, enc.encode(String(data || '')));
    return {
      iv: btoa(String.fromCharCode(...iv)),
      ciphertext: btoa(String.fromCharCode(...new Uint8Array(cipher)))
    };
  },
  async decrypt(ciphertext, key, iv) {
    const ivBytes = Uint8Array.from(atob(iv), c => c.charCodeAt(0));
    const ctBytes = Uint8Array.from(atob(ciphertext), c => c.charCodeAt(0));
    const plain = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: ivBytes }, key, ctBytes);
    return new TextDecoder().decode(plain);
  }
};

function sanitizeHTML(input) {
  return String(input ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}
function sanitizeForAttribute(input) {
  return sanitizeHTML(input).replace(/`/g, '&#96;');
}
function createSafeElement(tag, text) {
  const el = document.createElement(tag);
  el.textContent = String(text ?? '');
  return el;
}


// ====== COMPETANSE_MAAL ======
const COMPETANSE_MAAL = {
  norsk:["Lese og analysere tekster i ulike sjangre","Skrive argumenterende tekster","Sammensatte tekster og multimodalitet","Muntlig kommunikasjon og retorikk","Språkhistorie og språkutvikling","Litteraturhistorie – fra norrøn tid til i dag","Rettskriving og grammatikk","Kritisk lesing av kilder og medietekster"],
  matematikk:["Tall og algebra – likninger og ulikheter","Geometri – beregning av areal og volum","Statistikk og sannsynlighet","Funksjoner og koordinatsystem","Økonomi – rente, skatt og budsjett","Problemløsning og matematisk resonnering","Tall i vitenskapelig notasjon","Pytagoras og trigonometri"],
  engelsk:["Kommunikasjon og samtale på engelsk","Lesing og analyse av engelskspråklige tekster","Skriftlig produksjon på engelsk","Engelsktalende land – kultur og samfunn","Grammatikk og setningsstruktur","Muntlig presentasjon på engelsk","Digitale tekster og media på engelsk","Litteratur og film på engelsk"],
  naturfag:["Celler, arv og evolusjon","Kroppen – organer og helse","Økosystem og biologisk mangfold","Kjemi – stoffer og kjemiske reaksjoner","Fysikk – energi, krefter og bevegelse","Astronomi og universet","Teknologi og bærekraftig utvikling","Forskning og vitenskapelig metode"],
  samfunnsfag:["Demokrati og politiske systemer","Økonomi – produksjon, handel og forbruk","Geografi – natur og menneskeskapte landskap","Befolkning og migrasjon","Norgeshistorie – 1800-tallet til i dag","Menneskerettigheter og internasjonale organisasjoner","Identitet, kultur og mangfold","Mediebruk og kildekritikk"],
  krle:["Kristendom – tro og tradisjon","Verdensreligioner – islam, jødedom, hinduisme, buddhisme","Livssyn og ikke-religiøse perspektiver","Etikk og moralske valg","Filosofi og sentrale tenkere","Religion i norsk og global samtid","Høytider og ritualer på tvers av religioner","Samvittighet, rettferdighet og menneskeverd"],
  kunst_og_handverk:["Tegning og komposisjon","Fargelære og fargebruk","Skulptur og tredimensjonale uttrykk","Tekstil og mote","Digitale verktøy i design","Arkitektur og rom","Kunsthistorie og kunstnerisk analyse","Håndverk og materialbruk"],
  musikk:["Musikkteori – rytme, melodi, harmoni","Sang og vokal fremføring","Spill på instrument","Musikkhistorie fra ulike epoker","Komponering og arrangering","Musikk fra ulike kulturer","Digital musikkproduksjon","Musikk og identitet"],
  mat_og_helse:["Kosthold og ernæring","Matlaging – teknikker og oppskrifter","Hygiene og matsikkerhet","Bærekraftig matvalg","Måltidskultur i Norge og verden","Økonomi i hverdagen – planlegging og innkjøp","Allergi og spesielle dietter","Forbrukervalg og reklame"],
  kroppsøving:["Idrett og fair play","Friluftsliv og naturaktiviteter","Helse og livsstil","Bevegelseslære og teknikk","Lagspill og samarbeid","Svømming og vannsikkerhet","Trening og treningsprinsipper","Kroppsøving og inkludering"],
  utdanningsvalg:["Utdanningsvalg og karriereplanlegging","Arbeidslivet – rettigheter og plikter","Videregående opplæring – programmer og fag","Utprøving av utdanningsprogram","Interesser, verdier og personlighet","Lokalt arbeids- og næringsliv","Fremtidens yrker og arbeidsmarked","Selvrefleksjon og karrierekompetanse"],
  programmering:["Algoritmer og problemløsning","Variabler, løkker og betingelser","Funksjoner og objektorientert programmering","Debugging og testing","Webteknologi – HTML, CSS, JavaScript","Databaser og datalagring","Kunstig intelligens og maskinlæring","Etikk i teknologi og personvern"]
};

let editingModuleIdx = null;
let uploadedFileText = '';
let uploadedFileName = '';
let uploadedFileBase64 = '';
let uploadedFileMime = '';
let activeSubjectFilter = null;
let _writeTimers = {};
let _quizTimers = {}; // Quiz-timer handles per spørsmål
let _autoSaveTimers = {};
let _sessionEncKey = null;
let _teacherSessionPassword = '';
let _decryptedApiKey = '';
let _decryptedSbUrl = '';
let _decryptedSbKey = '';
let _sessionWarningShown = false;
let _sessionWarningTimeout = null;
let _sessionLogoutTimeout = null;

async function hydrateDecryptedSecrets() {
  if (!_sessionEncKey) return;
  try {
    const apiRaw = localStorage.getItem('olaskole_apikey');
    if (apiRaw) {
      const p = JSON.parse(apiRaw);
      _decryptedApiKey = await SecurityUtils.decrypt(p.ciphertext, _sessionEncKey, p.iv);
    }
  } catch { _decryptedApiKey = ''; }
  try {
    const sbUrlRaw = localStorage.getItem('os_sb_url');
    if (sbUrlRaw) {
      const p = JSON.parse(sbUrlRaw);
      _decryptedSbUrl = await SecurityUtils.decrypt(p.ciphertext, _sessionEncKey, p.iv);
    }
  } catch { _decryptedSbUrl = ''; }
  try {
    const sbKeyRaw = localStorage.getItem('os_sb_key');
    if (sbKeyRaw) {
      const p = JSON.parse(sbKeyRaw);
      _decryptedSbKey = await SecurityUtils.decrypt(p.ciphertext, _sessionEncKey, p.iv);
    }
  } catch { _decryptedSbKey = ''; }
  SB_URL = _decryptedSbUrl || '';
  SB_KEY = _decryptedSbKey || '';
}

let _showViewTimer = null;

// ====== NAVIGATION ======
function showView(name) {
  // Cleanup timers when leaving views
  if (name !== 'wc' && typeof WC !== 'undefined' && WC.refreshTimer) {
    clearInterval(WC.refreshTimer); WC.refreshTimer = null;
  }
  if (name !== 'tasks' && name !== 'arbeid') {
    Object.values(_quizTimers||{}).forEach(t => clearInterval(t));
    _quizTimers = {};
    Object.values(_writeTimers||{}).forEach(t => clearTimeout(t));
    _writeTimers = {};
  }
  // Cancel any in-flight transition to prevent race conditions
  if (_showViewTimer) { clearTimeout(_showViewTimer); _showViewTimer = null; }
  // Clear all leaving states (cleanup from interrupted transitions)
  document.querySelectorAll('.view.leaving').forEach(v => v.classList.remove('leaving', 'active'));

  const currentView = document.querySelector('.view.active');
  const targetId = 'view-' + name;
  if (currentView && currentView.id !== targetId) {
    currentView.classList.add('leaving');
    _showViewTimer = setTimeout(() => {
      currentView.classList.remove('active', 'leaving');
      _showViewTimer = null;
    }, 170);
  } else if (!currentView) {
    // No current view — instant show, no flash
    document.querySelectorAll('.view').forEach(v => v.classList.remove('active'));
  }

  const tabs = document.querySelectorAll('.nav-tab');
  tabs.forEach(t => t.classList.remove('active'));
  const viewEl = document.getElementById(targetId);
  if (!viewEl) return;

  const delay = (currentView && currentView.id !== targetId) ? 140 : 0;
  setTimeout(() => {
    viewEl.classList.add('active');
    // Scroll to top on view change
    if (!currentView || currentView.id !== targetId) {
      window.scrollTo({ top: 0, behavior: 'instant' });
    }
    // Release will-change after animation completes
    setTimeout(() => { viewEl.style.willChange = 'auto'; }, 300);
  }, delay);

  // Match via data-onclick/data-onclick-arg (the delegation system uses these)
  tabs.forEach(tab => {
    const fn  = tab.dataset.onclick || '';
    const arg = tab.dataset.onclickArg || '';
    const isActive =
      (fn === 'showView'  && arg === name) ||
      (fn === 'arbOpen'   && (name === 'tasks' || name === 'arbeid')) ||
      (fn === 'checkTeacher' && name === 'teacher');
    tab.classList.toggle('active', isActive);
    if (isActive) tab.setAttribute('aria-current', 'page');
    else          tab.removeAttribute('aria-current');
  });
  if (name === 'home') { renderHomeModules(); _heroGreeting(); }
  if (name === 'tasks') { DB.loadModules().then(m => { if(m.length){state.modules=m; _invalidateGridCache();} renderTaskModules(); }).catch(e => { console.warn('[showView:tasks] DB.loadModules failed', e); renderTaskModules(); }); }
  if (name === 'teacher') {
    if (!state.isTeacher) { showToast('⛔ Logg inn som lærer for å få tilgang'); return; }
    renderResults(); renderManageModules(); teacherUpdateActivity();
    const lastTab = localStorage.getItem('os_last_tr_tab') || 'new';
    trTab(lastTab);
  }
  if (name === 'join' && state.isTeacher) crPopulateModules();
  if (name === 'arbeid') { arbState.moduleIdx = null; arbRenderModuleGrid(); }
  if (name === 'wc') wcInit();
  if (name === 'spill') gzInit();
  setProgress(name === 'home' ? 20 : name === 'tasks' ? 60 : 90);
  syncMobileNav(name);
  // Oppdater SR-tilgjengelig H1 og flytt fokus til nytt innhold
  const _h1Labels = { home:'SkOla – Hjem', arbeid:'Oppgaver', join:'Quiz', wc:'Ordsky', spill:'Spill', teacher:'Lærerrom', tasks:'Emner' };
  const h1 = document.getElementById('pageH1');
  if (h1) h1.textContent = _h1Labels[name] || 'SkOla';
  // Lagre siste visning (unntatt teacher-panel)
  if (name !== 'teacher') localStorage.setItem('os_last_view', name);
}

function syncMobileNav(name) {
  document.querySelectorAll('.mob-nav-btn').forEach(b => {
    b.classList.remove('active');
    b.removeAttribute('aria-current');
  });
  const map = {home:'mob-home',tasks:'mob-tasks',arbeid:'mob-tasks',join:'mob-join',teacher:'mob-teacher',wc:'mob-wc',spill:'mob-spill'};
  const btn = document.getElementById(map[name]);
  if (btn) {
    btn.classList.add('active');
    btn.setAttribute('aria-current', 'page');
    // Sliding pill indicator
    let pill = document.querySelector('.mob-active-pill');
    if (!pill) {
      pill = document.createElement('span');
      pill.className = 'mob-active-pill';
      const inner = document.querySelector('.mobile-nav-inner');
      if (inner) inner.appendChild(pill);
    }
    if (pill) {
      const bRect = btn.getBoundingClientRect();
      const innerRect = btn.closest('.mobile-nav-inner')?.getBoundingClientRect();
      if (innerRect) {
        const btnCenter = bRect.left - innerRect.left + bRect.width / 2;
        const pillOffset = btnCenter - 16; // half of 32px width
        pill.style.transform = 'translateX(' + pillOffset + 'px)';
        pill.style.opacity = '1';
      }
    }
  }
}

function mobNav(name) { showView(name); }

function setProgress(pct) {
  const el = document.getElementById('progressFill');
  if (el) el.style.width = pct + '%';
  // Keep ARIA in sync so screen readers report correct progress
  const bar = el?.closest('[role="progressbar"]');
  if (bar) bar.setAttribute('aria-valuenow', pct);
}

// ====== DARK MODE ======
// Site is dark by default; toggling adds .light class for light mode
const SUN_ICON = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="5"/><line x1="12" y1="1" x2="12" y2="3"/><line x1="12" y1="21" x2="12" y2="23"/><line x1="4.22" y1="4.22" x2="5.64" y2="5.64"/><line x1="18.36" y1="18.36" x2="19.78" y2="19.78"/><line x1="1" y1="12" x2="3" y2="12"/><line x1="21" y1="12" x2="23" y2="12"/><line x1="4.22" y1="19.78" x2="5.64" y2="18.36"/><line x1="18.36" y1="5.64" x2="19.78" y2="4.22"/></svg>';
const MOON_ICON = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/></svg>';

/* ===== FOKUS-MODUS ===== */
function toggleFocusMode() {
  const on = document.body.classList.toggle('focus-mode');
  const btn = document.getElementById('focusModeBtn');
  const toggleBtn = document.getElementById('focusToggleBtn');
  if (btn) btn.style.display = on ? 'flex' : 'none';
  if (toggleBtn) { toggleBtn.textContent = on ? '✕ Avslutt fokus' : '🎯 Fokus'; toggleBtn.style.background = on ? 'var(--accent)' : ''; toggleBtn.style.color = on ? 'white' : ''; }
  if (on) showToast('🎯 Fokus-modus aktivert — trykk ✕ for å avslutte');
}
function exitFocusMode() {
  if (document.body.classList.contains('focus-mode')) toggleFocusMode();
}

/* ===== DELELENKE ===== */
function shareModule() {
  const m = state.modules[state.currentModule];
  if (!m) return;
  const url = window.location.origin + window.location.pathname + '?modul=' + encodeURIComponent(m._id || m.name);
  if (navigator.share) {
    navigator.share({ title: m.name, text: 'Sjekk ut dette emnet på SkOla: ' + m.name, url }).catch(() => {});
  } else {
    navigator.clipboard.writeText(url)
      .then(() => showToast('🔗 Lenke kopiert til utklippstavlen!'))
      .catch(() => showToast('🔗 Lenke: ' + url));
  }
}

/* ===== FAGFELT SYNC ===== */
function syncModuleSubject(val) {
  const free = document.getElementById('moduleSubjectFree');
  if (free && val) free.value = '';
}
function syncModuleSubjectFromFree(val) {
  const sel = document.getElementById('moduleSubjectSelect');
  if (sel && val) sel.value = '';
}

/* ===== TEKSTSTØRRELSE ===== */
let _fontScale = parseFloat(localStorage.getItem('os_font_scale') || '1');
function applyFontScale(scale) {
  _fontScale = Math.min(1.5, Math.max(0.75, scale));
  document.documentElement.style.setProperty('--font-scale', _fontScale);
  localStorage.setItem('os_font_scale', _fontScale);
}
function changeFontSize(dir) {
  applyFontScale(_fontScale + dir * 0.1);
  showToast(dir > 0 ? '🔡 Større tekst' : '🔡 Mindre tekst');
}
function initFontScale() { applyFontScale(_fontScale); }

/* ===== BRUKERINNSTILLINGER (åpen for alle) ===== */
const US_ACCENTS = [
  { name:'Lilla',   accent:'#7b8ffd', h:'#9aaaff', g:'rgba(123,143,253,0.18)' },
  { name:'Rosa',    accent:'#f472b6', h:'#f9a8d4', g:'rgba(244,114,182,0.18)' },
  { name:'Grønn',   accent:'#34d399', h:'#6ee7b7', g:'rgba(52,211,153,0.18)'  },
  { name:'Oransje', accent:'#fb923c', h:'#fdba74', g:'rgba(251,146,60,0.18)'  },
  { name:'Blå',     accent:'#38bdf8', h:'#7dd3fc', g:'rgba(56,189,248,0.18)'  },
];

let _usSettings = {
  accent: 0,
  font: 'default',
  reduceMotion: false,
  compact: false,
  largeTargets: false,
  sound: true,
  confetti: true,
};

function _usLoad() {
  try { return Object.assign({}, _usSettings, JSON.parse(localStorage.getItem('os_user_settings') || '{}')); } catch { return _usSettings; }
}
function _usSave() { localStorage.setItem('os_user_settings', JSON.stringify(_usSettings)); }

function openUserSettings() {
  _usSettings = _usLoad();
  _usApplyAll();
  _usRefreshUI();
  const m = document.getElementById('userSettingsModal');
  if (m) m.classList.add('open');
}

function _usRefreshUI() {
  // Accent picker
  const picker = document.getElementById('usAccentPicker');
  if (picker) {
    picker.innerHTML = US_ACCENTS.map((a, i) => `
      <button data-onclick="usSetAccent" data-onclick-arg="${i}" title="${a.name}"
        style="width:34px;height:34px;border-radius:50%;background:${a.accent};border:3px solid ${i===_usSettings.accent?'var(--text)':'transparent'};cursor:pointer;transition:all 0.18s;transform:${i===_usSettings.accent?'scale(1.15)':'scale(1)'};box-shadow:${i===_usSettings.accent?'0 0 0 1px '+a.accent:'none'};"
        aria-label="${a.name}" aria-pressed="${i===_usSettings.accent}"></button>
    `).join('');
  }

  // Font slider
  const slider = document.getElementById('usFontSlider');
  const label = document.getElementById('usFontLabel');
  if (slider) slider.value = Math.round(_fontScale * 100);
  if (label) label.textContent = Math.round(_fontScale * 100) + '%';

  // Font buttons
  const curFont = _usSettings.font || 'default';
  ['usFontNormalBtn','usFontSerifBtn','usFontMonoBtn','usFontDyslexiaBtn'].forEach(id => {
    const btn = document.getElementById(id);
    if (!btn) return;
    const active = (id==='usFontNormalBtn'&&curFont==='default')||(id==='usFontSerifBtn'&&curFont==='serif')||(id==='usFontMonoBtn'&&curFont==='mono')||(id==='usFontDyslexiaBtn'&&curFont==='dyslexia');
    btn.style.borderColor = active ? 'var(--accent)' : 'var(--border-2)';
    btn.style.color = active ? 'var(--text)' : 'var(--text-2)';
    btn.style.background = active ? 'rgba(123,143,253,0.1)' : 'var(--s3)';
  });

  // Toggles
  _usRefreshToggle('reduceMotion', 'usReduceMotionToggle', 'usReduceMotionThumb');
  _usRefreshToggle('compact',      'usCompactToggle',      'usCompactThumb');
  _usRefreshToggle('largeTargets', 'usLargeTargetsToggle', 'usLargeTargetsThumb');
  _usRefreshToggle('sound',        'usSoundToggle',        'usSoundThumb');
  _usRefreshToggle('confetti',     'usConfettiToggle',     'usConfettiThumb');
}

function _usRefreshToggle(key, btnId, thumbId) {
  const on = _usSettings[key];
  const btn = document.getElementById(btnId);
  const thumb = document.getElementById(thumbId);
  if (!btn || !thumb) return;
  btn.style.background = on ? 'var(--accent)' : 'var(--border-2)';
  btn.setAttribute('aria-checked', on ? 'true' : 'false');
  thumb.style.transform = on ? 'translateX(20px)' : 'translateX(0)';
}

function usSetAccent(idx) {
  _usSettings.accent = idx;
  _usSave();
  _usApplyAccent();
  _usRefreshUI();
}

function _usApplyAccent() {
  const a = US_ACCENTS[_usSettings.accent] || US_ACCENTS[0];
  const r = document.documentElement.style;
  r.setProperty('--accent',   a.accent);
  r.setProperty('--accent-h', a.h);
  r.setProperty('--accent-g', a.g);
}

function usSetFontScale(val) {
  applyFontScale(parseInt(val) / 100);
  const label = document.getElementById('usFontLabel');
  if (label) label.textContent = Math.round(_fontScale * 100) + '%';
}

function usToggleSetting(key) {
  _usSettings[key] = !_usSettings[key];
  _usSave();
  _usApplyAll();
  _usRefreshUI();
}

function _usApplyAll() {
  _usApplyAccent();
  document.body.classList.toggle('reduce-motion',  !!_usSettings.reduceMotion);
  document.body.classList.toggle('compact-mode',   !!_usSettings.compact);
  document.body.classList.toggle('large-targets',  !!_usSettings.largeTargets);
  document.body.classList.toggle('dyslexia-font',  _usSettings.font === 'dyslexia');
  document.body.classList.toggle('serif-font',     _usSettings.font === 'serif');
  document.body.classList.toggle('mono-font',      _usSettings.font === 'mono');
}

function usSetFont(val) {
  _usSettings.font = val;
  _usSave();
  _usApplyAll();
  _usRefreshUI();
}

function usResetAll() {
  _usSettings = { accent:0, reduceMotion:false, compact:false, largeTargets:false, sound:true, confetti:true };
  localStorage.removeItem('os_user_settings');
  applyFontScale(1);
  _usApplyAll();
  _usRefreshUI();
  showToast('↩️ Innstillinger tilbakestilt');
}

function initUserSettings() {
  _usSettings = _usLoad();
  _usApplyAll();
}

/* ===== NOTATBLOKK ===== */
function _noteKey() {
  const m = state.modules[state.currentModule];
  return 'os_note_' + (m?._id || 'mod_' + state.currentModule);
}
function toggleNotepad() {
  const body = document.getElementById('notepadBody');
  const chev = document.getElementById('notepadChevron');
  if (!body) return;
  const open = body.style.display === 'none';
  body.style.display = open ? 'block' : 'none';
  if (chev) chev.style.transform = open ? 'rotate(180deg)' : '';
  if (open) {
    const ta = document.getElementById('notepadText');
    if (ta) ta.value = localStorage.getItem(_noteKey()) || '';
  }
}
const _saveNoteDebounced = debounce(() => {
  const ta = document.getElementById('notepadText');
  if (!ta) return;
  localStorage.setItem(_noteKey(), ta.value);
  const st = document.getElementById('notepadSavedStatus');
  if (st) { st.textContent = '✓ Lagret'; setTimeout(() => { if(st) st.textContent = 'Lagres automatisk'; }, 1500); }
}, 600);
function saveNotepad() { _saveNoteDebounced(); }
function clearNotepad() {
  const key = _noteKey();
  const ta = document.getElementById('notepadText');
  const prev = localStorage.getItem(key) || ta?.value || '';
  if (!prev.trim()) return;
  localStorage.removeItem(key);
  if (ta) ta.value = '';
  _showUndoToast('🗑 Notater slettet', () => {
    localStorage.setItem(key, prev);
    if (ta) ta.value = prev;
    showToast('↩️ Notater gjenopprettet');
  });
}
function exportNotepad() {
  const ta = document.getElementById('notepadText');
  if (!ta?.value.trim()) { showToast('⚠️ Ingen notater å laste ned'); return; }
  downloadFile('notater.txt', ta.value, 'text/plain');
}

function resetNotepadUI() {
  const body = document.getElementById('notepadBody');
  const chev = document.getElementById('notepadChevron');
  if (body) body.style.display = 'none';
  if (chev) chev.style.transform = '';
}

// ====== APP VERSION + MIGRATION ======
const APP_VERSION = '2.1';
function _runMigrations() {
  const stored = localStorage.getItem('os_app_version');
  if (stored === APP_VERSION) return;
  // v2.0→v2.1: ensure wordleWords field exists on all modules
  if (state.modules.length) {
    state.modules = state.modules.map(m => ({ wordleWords: [], ...m }));
  }
  localStorage.setItem('os_app_version', APP_VERSION);
}

// ====== OFFLINE INDICATOR ======
function _initOfflineIndicator() {
  const banner = document.getElementById('offlineBanner');
  if (!banner) return;
  const update = () => {
    const offline = !navigator.onLine;
    banner.classList.toggle('show', offline);
    if (!offline && banner._wasOffline) showToast('🟢 Tilkoblet igjen!');
    banner._wasOffline = offline;
  };
  window.addEventListener('online', update);
  window.addEventListener('offline', update);
  update();
}

// ====== GLOBAL ERROR BOUNDARY ======
window.addEventListener('unhandledrejection', e => {
  const msg = e.reason?.message || '';
  if (msg.includes('API') || msg.includes('fetch') || msg.includes('NetworkError')) return;
  console.error('[SkOla] Unhandled:', e.reason);
});
window.onerror = (msg, src, line, col, err) => {
  if (!msg || msg.includes('Script error') || msg.includes('extension')) return false;
  console.error('[SkOla] Error:', msg, src, line);
  showToast('⚠️ Det oppsto en feil. Last siden på nytt om noe ikke fungerer.');
  return false;
};

// ====== QUIZ KEYBOARD NAVIGATION ======
let _quizKbListener = null;
function _initQuizKeyboard() {
  if (_quizKbListener) document.removeEventListener('keydown', _quizKbListener);
  _quizKbListener = (e) => {
    if (['INPUT','TEXTAREA','SELECT'].includes(document.activeElement?.tagName)) return;
    if (!['1','2','3','4'].includes(e.key)) return;
    // Find first unanswered question card
    const cards = document.querySelectorAll('.quiz-card, .arb-quiz-card');
    let targetCard = null;
    for (const card of cards) {
      const fb = card.querySelector('.quiz-feedback, .arb-feedback');
      if (!fb || !fb.innerHTML) { targetCard = card; break; }
    }
    if (!targetCard) return;
    const idx = parseInt(e.key) - 1;
    const opts = targetCard.querySelectorAll('.quiz-opt, .arb-opt');
    if (opts[idx] && !opts[idx].disabled) { opts[idx].click(); e.preventDefault(); }
  };
  document.addEventListener('keydown', _quizKbListener);
}
function _removeQuizKeyboard() {
  if (_quizKbListener) { document.removeEventListener('keydown', _quizKbListener); _quizKbListener = null; }
}

// ====== LOAD / SAVE STATE ======
async function loadState() {
  showDbStatus();
  localStorage.removeItem('olaskole_light');
  document.body.classList.remove('light');
  initFontScale();
  initUserSettings();
  _initOfflineIndicator();
  initMsToken();
  initTeacherActivityTracking();
  let dbMods = [];
  try { dbMods = await DB.loadModules(); } catch(e) { console.warn('[loadState] DB.loadModules failed:', e); }
  if (dbMods.length > 0) {
    state.modules = dbMods;
  }
  _runMigrations();
  _checkScheduled();

  // Seed default hashed password on first load so 'Olala1234' works out of the box
  if (!localStorage.getItem('os_teacher_auth')) {
    try {
      const salt = SecurityUtils.generateSalt();
      const hash = await SecurityUtils.hashPassword(TEACHER_PASS, salt);
      localStorage.setItem('os_teacher_auth', JSON.stringify({ salt, hash }));
    } catch(e) { console.warn('Could not seed teacher auth:', e); }
  }

  // Restore teacher session
  const teacherSession = localStorage.getItem('os_teacher_session');
  if (teacherSession) {
    try {
      if (!localStorage.getItem('os_teacher_auth')) throw new Error('missing auth');
      const ts = JSON.parse(teacherSession);
      // Session expires after 30 minutes of inactivity
      const lastActive = ts.lastActive || ts.loggedInAt || 0;
      if (lastActive && (Date.now() - lastActive) < 30 * 60 * 1000) {
        state.isTeacher = true;
        teacherUpdateActivity();
        startTeacherSessionTimer();
        document.querySelectorAll('.teacher-tab').forEach(t => t.style.display = 'inline-flex');
        const btn = document.getElementById('teacherLoginBtn');
        if (btn) btn.style.display = 'none';
        const logoutBtn = document.getElementById('teacherLogoutBtn');
        if (logoutBtn) logoutBtn.style.display = 'inline-flex';
        const mobLogout2 = document.getElementById('mob-logout-teacher');
        if (mobLogout2) mobLogout2.style.display = 'flex';
        const rb = document.getElementById('roleBadge');
        if (rb) { rb.textContent = 'Lærer'; rb.style.color = 'var(--accent-h)'; rb.style.borderColor = 'var(--accent)'; }
        if (document.getElementById('teacherQuizSection')) {
          document.getElementById('teacherQuizSection').style.display = 'block';
          document.getElementById('studentQuizSection').style.display = 'none';
        }
      } else {
        localStorage.removeItem('os_teacher_session');
      }
    } catch(e) { localStorage.removeItem('os_teacher_session'); }
  }

  // Restore student session (7-day TTL if "Husk meg" was checked)
  const savedStudent = localStorage.getItem('lh_student');
  if (savedStudent) {
    let parsed = null;
    try { parsed = JSON.parse(savedStudent); } catch(e) { localStorage.removeItem('lh_student'); }
    if (parsed) {
      const ageMs = Date.now() - (parsed.savedAt || 0);
      const expired = parsed.remember ? ageMs > 7 * 24 * 60 * 60 * 1000 : false;
      if (expired) {
        localStorage.removeItem('lh_student');
      } else {
        state.student = parsed;
        state.studentAnswers = await DB.loadAnswers(state.student.name);
        _progressCache = await DB.loadProgress(state.student.name);
        showStudentWelcome();
      }
    }
  }
}

async function saveModulesToStorage() {
  const ok = await DB.saveModules(state.modules);
  _invalidateGridCache();
  renderHomeModules();
  renderTaskModules();
  updateContinueCard();
  if (ok) {
    showToast('✅ ' + state.modules.length + ' emne(r) lagret til Supabase');
  } else {
    showToast('⚠️ Lagret lokalt – Supabase ikke nådd. Kjør 🔬 Diagnose i innstillinger.');
  }
}
function saveAnswersToStorage() {
  localStorage.setItem('lh_answers', JSON.stringify(state.studentAnswers));
}

// ====== STUDENT ======
async function studentLogin() {
  const name = document.getElementById('studentName').value.trim();
  const cls  = document.getElementById('studentClass').value.trim();
  if (!name) { showToast('⚠️ Skriv inn navnet ditt!'); return; }
  const rememberMe = document.getElementById('rememberMe')?.checked;
  state.student = { name, cls, joinedAt: new Date().toLocaleString('no'), savedAt: Date.now(), remember: !!rememberMe };
  localStorage.setItem('lh_student', JSON.stringify(state.student));
  const btn = document.querySelector('#studentLoginBox button[data-onclick="studentLogin"]');
  if (btn) { btn._orig = btn.textContent; btn.textContent = '⏳ Logger inn...'; btn.disabled = true; }
  state.studentAnswers = await DB.loadAnswers(name);
  _progressCache = await DB.loadProgress(name);
  const roster = await DB.loadRoster();
  if (!roster.find(r => r.name === name)) {
    roster.push({ name, cls, joinedAt: new Date().toISOString() });
    _rosterCache = roster;
    await DB.saveRoster(roster);
  }
  if (btn) { btn.textContent = btn._orig; btn.disabled = false; }
  showStudentWelcome();
  updateContinueCard();
  showView('tasks');
  // Vis lærerfeedback hvis det finnes
  const fbKey = 'feedback_' + name;
  const fbText = await DB.loadFeedback(fbKey);
  if (fbText) setTimeout(() => showFeedbackNotice(fbText, fbKey), 600);
}

function studentLogout(fullLogout) {
  if (fullLogout) {
    _showConfirm('Er du sikker på at du vil logge ut?', () => _doStudentLogout(true));
    return;
  }
  _doStudentLogout(false);
}
function _doStudentLogout(fullLogout) {
  state.student = null;
  _progressCache = {};
  localStorage.removeItem('lh_student');
  if (fullLogout) showToast('Logget ut');
  const loginBox = document.getElementById('studentLoginBox');
  const wb = document.getElementById('welcomeBack');
  if (loginBox) loginBox.style.display = 'block';
  if (wb) wb.style.display = 'none';
  const rb = document.getElementById('roleBadge');
  if (rb) rb.textContent = '👤 Gjest';
  const ba = document.getElementById('badgeArea');
  if (ba) ba.style.display = 'none';
  renderHomeModules();
}

function showStudentWelcome() {
  const loginBox = document.getElementById('studentLoginBox');
  const wb = document.getElementById('welcomeBack');
  if (loginBox) loginBox.style.display = 'none';
  if (wb) wb.style.display = 'block';
  const wn = document.getElementById('welcomeName');
  const wc = document.getElementById('welcomeClass');
  const rb = document.getElementById('roleBadge');
  if (wn) wn.textContent = 'Hei, ' + state.student.name + '! 👋';
  if (wc) wc.textContent = state.student.cls || '';
  if (rb) rb.textContent = '🎓 ' + state.student.name;
  const ba = document.getElementById('badgeArea');
  if (ba) ba.style.display = 'flex';
  renderBadges();
  updateStudentProgress();
}

function getStreak() {
  const today = new Date().toDateString();
  const raw = localStorage.getItem('os_streak_' + (state.student?.name||''));
  if (!raw) return { days: 0, lastDate: '' };
  try { return JSON.parse(raw); } catch { return { days: 0, lastDate: '' }; }
}

function updateStreak() {
  if (!state.student) return;
  const key = 'os_streak_' + state.student.name;
  const today = new Date().toDateString();
  const yesterday = new Date(Date.now()-86400000).toDateString();
  let s = getStreak();
  if (s.lastDate === today) return; // allerede registrert i dag
  if (s.lastDate === yesterday) s.days++; // fortsetter streak
  else s.days = 1; // ny streak
  s.lastDate = today;
  localStorage.setItem(key, JSON.stringify(s));
}

function renderBadges() {
  updateStreak();
  const answers = state.studentAnswers;
  const total = Object.keys(answers).length;
  const quizCorrect = Object.values(answers).filter(a => a.correct).length;
  const streak = getStreak();
  const badges = [];

  // Aktivitetsbadges
  if (total >= 1)  badges.push({ icon: '⭐', label: 'Første svar!' });
  if (total >= 5)  badges.push({ icon: '🔥', label: '5 svar' });
  if (total >= 10) badges.push({ icon: '🏆', label: '10 svar' });
  if (total >= 25) badges.push({ icon: '💎', label: '25 svar' });
  if (total >= 50) badges.push({ icon: '👑', label: '50 svar' });

  // Quiz-badges
  if (quizCorrect >= 3)  badges.push({ icon: '🧠', label: 'Quiz-mester' });
  if (quizCorrect >= 10) badges.push({ icon: '🎯', label: 'Quiz-ekspert' });

  // Streak-badges
  if (streak.days >= 2) badges.push({ icon: '📅', label: streak.days + ' dagers streak!' });
  if (streak.days >= 7) badges.push({ icon: '🌟', label: '7-dagers streak!' });
  if (streak.days >= 30) badges.push({ icon: '🚀', label: '30-dagers streak!' });

  const area = document.getElementById('badgeArea');
  if (!area) return;

  // Vis streak-teller øverst
  const streakHtml = streak.days >= 1
    ? `<div class="badge earned" title="${streak.days} dager på rad!">🔥 ${streak.days} dag${streak.days===1?'':'er'} streak</div>`
    : '';

  area.innerHTML = streakHtml + badges.map(b =>
    `<div class="badge earned"><span class="badge-icon">${b.icon}</span>${b.label}</div>`
  ).join('') || '<div class="badge"><span class="badge-icon">🌱</span>Begynn å løse oppgaver!</div>';
}

function updateStudentProgress() {
  if (!state.student) return;
  const bar = document.getElementById('studentProgressBar');
  const label = document.getElementById('studentProgressLabel');
  const sKey = state.student.name;
  let total = 0, done = 0;
  state.modules.forEach((m, mi) => {
    const types = [];
    if (m.text) types.push('text');
    if (m.quiz?.length) types.push('quiz');
    if (m.discussion?.length) types.push('disc');
    if (m.write?.length) types.push('write');
    if (m.videos?.length) types.push('video');
    if (m.flashcards?.length) types.push('fc');
    total += types.length;
    types.forEach(t => { if (dbGetProgress(`arb_${sKey}_m${mi}_done_${t}`)) done++; });
  });
  const pct = total > 0 ? Math.round(done / total * 100) : 0;
  if (bar) bar.style.width = pct + '%';
  if (label) label.textContent = total > 0 ? `${pct}% fullført (${done}/${total} aktiviteter)` : '';
}

// ====== TEACHER ======
// ⚠️  SECURITY: Change this default password immediately after first login!
// Go to Settings → Teacher → Change password to set a unique password.
// This default is only used to seed the initial hashed credential in localStorage.
const TEACHER_PASS = 'Olala1234';
function getTeacherPass() {
  return TEACHER_PASS;
}
function openTeacherModal() {
  const tp = document.getElementById('teacherPass');
  if (tp) tp.value = '';
  openModal('teacherModal');
  setTimeout(() => { const t = document.getElementById('teacherPass'); if (t) t.focus(); }, 150);
}
function _getLoginAttempts() {
  try { return JSON.parse(sessionStorage.getItem('os_login_attempts') || '{"count":0,"lockUntil":0}'); } catch { return { count: 0, lockUntil: 0 }; }
}
function _setLoginAttempts(data) { sessionStorage.setItem('os_login_attempts', JSON.stringify(data)); }
function updateLoginLockoutUI() {
  const info = document.getElementById('teacherLockoutInfo');
  const btn = document.getElementById('teacherLoginBtn');
  if (!info || !btn) return;
  const attempts = _getLoginAttempts();
  const remainingMs = (attempts.lockUntil || 0) - Date.now();
  if (remainingMs > 0) {
    const sec = Math.ceil(remainingMs / 1000);
    info.style.display = 'block';
    info.textContent = '🔒 For mange forsøk. Prøv igjen om ' + sec + 's';
    btn.disabled = true;
  } else {
    info.style.display = 'none';
    btn.disabled = false;
  }
}
function _startLockoutCountdown() {
  updateLoginLockoutUI();
  const t = setInterval(() => {
    const attempts = _getLoginAttempts();
    if ((attempts.lockUntil || 0) <= Date.now()) {
      clearInterval(t);
      attempts.lockUntil = 0;
      attempts.count = 0;
      _setLoginAttempts(attempts);
      updateLoginLockoutUI();
      return;
    }
    updateLoginLockoutUI();
  }, 1000);
}
async function setupTeacherPassword() {
  const p1 = document.getElementById('teacherSetupPass')?.value || '';
  const p2 = document.getElementById('teacherSetupPassConfirm')?.value || '';
  const err = document.getElementById('teacherSetupError');
  if (p1.length < 8) { if (err) { err.style.display = 'block'; err.textContent = 'Passord må være minst 8 tegn.'; } return; }
  if (p1 !== p2) { if (err) { err.style.display = 'block'; err.textContent = 'Passordene er ikke like.'; } return; }
  const salt = SecurityUtils.generateSalt();
  const hash = await SecurityUtils.hashPassword(p1, salt);
  localStorage.setItem('os_teacher_auth', JSON.stringify({ salt, hash }));
  closeModal('teacherSetupModal');
  showToast('✅ Lærerpassord opprettet');
  openTeacherModal();
}
async function loginTeacher() {
  const pass = document.getElementById('teacherPass')?.value || '';
  const attempts = _getLoginAttempts();
  if ((attempts.lockUntil || 0) > Date.now()) {
    updateLoginLockoutUI();
    return;
  }
  const rawAuth = localStorage.getItem('os_teacher_auth');
  if (!rawAuth) { openModal('teacherSetupModal'); return; }
  let auth;
  try { auth = JSON.parse(rawAuth); } catch { localStorage.removeItem('os_teacher_auth'); openModal('teacherSetupModal'); return; }
  const ok = await SecurityUtils.verifyPassword(pass, auth.hash, auth.salt);
  if (ok) {
    state.isTeacher = true;
    _teacherSessionPassword = pass;
    _sessionEncKey = await SecurityUtils.deriveEncryptionKey(pass);
    _decryptedApiKey = '';
    _decryptedSbUrl = '';
    _decryptedSbKey = '';
    await hydrateDecryptedSecrets();
    localStorage.setItem('os_teacher_session', JSON.stringify({ loggedInAt: Date.now(), lastActive: Date.now() }));
    _setLoginAttempts({ count: 0, lockUntil: 0 });
    document.getElementById('teacherQuizSection').style.display = 'block';
    document.getElementById('studentQuizSection').style.display = 'none';
    showDbStatus();
    closeModal('teacherModal');
    document.querySelectorAll('.teacher-tab').forEach(t => t.style.display = 'inline-flex');
    document.getElementById('teacherLoginBtn').style.display = 'none';
    const rb = document.getElementById('roleBadge');
    if (rb) { rb.textContent = 'Lærer'; rb.style.color = 'var(--accent-h)'; rb.style.borderColor = 'var(--accent)'; }
    // Show logout button
    const logoutBtn = document.getElementById('teacherLogoutBtn');
    if (logoutBtn) logoutBtn.style.display = 'inline-flex';
    const mobLogout = document.getElementById('mob-logout-teacher');
    if (mobLogout) mobLogout.style.display = 'flex';
    showView('teacher');
    renderManageModules();
    renderResults();
    renderHomeModules();
    renderTaskModules();
    showToast('✅ Logget inn som lærer');
    // First-time teacher onboarding
    if (!localStorage.getItem('os_teacher_welcomed') && !state.modules.length) {
      localStorage.setItem('os_teacher_welcomed', '1');
      setTimeout(() => _showTeacherWelcome(), 600);
    }
  } else {
    const err = document.getElementById('teacherError');
    if (err) { err.style.display='block'; setTimeout(()=>err.style.display='none',2500); }
    const next = _getLoginAttempts();
    next.count = (next.count || 0) + 1;
    if (next.count >= 5) next.lockUntil = Date.now() + 30000;
    _setLoginAttempts(next);
    if (next.lockUntil) _startLockoutCountdown();
    updateLoginLockoutUI();
  }
}
function closeTeacherModal() {
  closeModal('teacherModal');
}
function checkTeacher() {
  if (state.isTeacher) { showView('teacher'); return; }
  openTeacherModal();
}

function teacherUpdateActivity() {
  try {
    const raw = localStorage.getItem('os_teacher_session');
    if (!raw) return;
    const ts = JSON.parse(raw);
    ts.lastActive = Date.now();
    localStorage.setItem('os_teacher_session', JSON.stringify(ts));
    if (state.isTeacher) startTeacherSessionTimer();
  } catch(e) {}
}

function startTeacherSessionTimer() {
  if (!state.isTeacher) return;
  if (_sessionWarningTimeout) clearTimeout(_sessionWarningTimeout);
  if (_sessionLogoutTimeout) clearTimeout(_sessionLogoutTimeout);
  const raw = localStorage.getItem('os_teacher_session');
  if (!raw) return;
  let ts;
  try { ts = JSON.parse(raw); } catch { return; }
  const last = ts.lastActive || Date.now();
  const warnIn = Math.max(0, (25 * 60 * 1000) - (Date.now() - last));
  const outIn = Math.max(0, (30 * 60 * 1000) - (Date.now() - last));
  _sessionWarningTimeout = setTimeout(() => {
    if (!state.isTeacher || _sessionWarningShown) return;
    _sessionWarningShown = true;
    const extend = confirm('Økten utløper snart på grunn av inaktivitet. Vil du forlenge økten?');
    if (extend) {
      _sessionWarningShown = false;
      teacherUpdateActivity();
      showToast('✅ Økten er forlenget');
    }
  }, warnIn);
  _sessionLogoutTimeout = setTimeout(() => {
    if (!state.isTeacher) return;
    showToast('⏳ Økten utløp etter inaktivitet');
    logoutTeacher();
  }, outIn);
}

function initTeacherActivityTracking() {
  const bump = () => { if (state.isTeacher) teacherUpdateActivity(); };
  ['click','keydown','mousemove','touchstart','scroll'].forEach(evt => {
    window.addEventListener(evt, bump, { passive: true });
  });
}

function loginTeacherAuto() {
  state.isTeacher = true;
  teacherUpdateActivity();
  startTeacherSessionTimer();
  document.querySelectorAll('.teacher-tab').forEach(t => t.style.display = 'inline-flex');
  const btn = document.getElementById('teacherLoginBtn');
  if (btn) btn.style.display = 'none';
  const logoutBtn = document.getElementById('teacherLogoutBtn');
  if (logoutBtn) logoutBtn.style.display = 'inline-flex';
  const mobLogout = document.getElementById('mob-logout-teacher');
  if (mobLogout) mobLogout.style.display = 'flex';
  const rb = document.getElementById('roleBadge');
  if (rb) { rb.textContent = 'Lærer'; rb.style.color = 'var(--accent-h)'; rb.style.borderColor = 'var(--accent)'; }
  if (document.getElementById('teacherQuizSection')) {
    document.getElementById('teacherQuizSection').style.display = 'block';
    document.getElementById('studentQuizSection').style.display = 'none';
  }
  showDbStatus();
  showView('teacher');
  renderManageModules();
  renderResults();
  renderHomeModules();
  renderTaskModules();
  // Warn if still using the default password
  if (!localStorage.getItem('os_teacher_pw_changed')) {
    setTimeout(() => showToast('⚠️ Husk å bytte standardpassordet under Innstillinger!', 5000), 1200);
  }
}
function logoutTeacher() {
  if (window._teacherAutosaveInterval) { clearInterval(window._teacherAutosaveInterval); window._teacherAutosaveInterval = null; }
  state.isTeacher = false;
  localStorage.removeItem('os_teacher_session');
  _sessionEncKey = null;
  _teacherSessionPassword = '';
  _decryptedApiKey = '';
  _decryptedSbUrl = '';
  _decryptedSbKey = '';
  _sessionWarningShown = false;
  if (_sessionWarningTimeout) clearTimeout(_sessionWarningTimeout);
  if (_sessionLogoutTimeout) clearTimeout(_sessionLogoutTimeout);
  document.getElementById('teacherQuizSection').style.display = 'none';
  document.getElementById('studentQuizSection').style.display = 'block';
  document.querySelectorAll('.teacher-tab').forEach(t => t.style.display = 'none');
  document.getElementById('teacherLoginBtn').style.display = 'inline-flex';
  const rb = document.getElementById('roleBadge');
  if (rb) { rb.textContent = 'Gjest'; rb.style.color = ''; rb.style.borderColor = ''; }
  const logoutBtn = document.getElementById('teacherLogoutBtn');
  if (logoutBtn) logoutBtn.style.display = 'none';
  const mobLogout = document.getElementById('mob-logout-teacher');
  if (mobLogout) mobLogout.style.display = 'none';
  renderHomeModules();
  renderTaskModules();
  updateContinueCard();
  showView('home');
  showToast('Logget ut');
}

// ====== FIRST-TIME ONBOARDING ======
function _showTeacherWelcome() {
  const existing = document.getElementById('teacherWelcomeOverlay');
  if (existing) existing.remove();
  const overlay = document.createElement('div');
  overlay.id = 'teacherWelcomeOverlay';
  overlay.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.55);z-index:9999;display:flex;align-items:center;justify-content:center;padding:1rem;';
  overlay.innerHTML = `
    <div style="background:var(--s1);border-radius:22px;padding:2rem;max-width:480px;width:100%;box-shadow:0 20px 60px rgba(0,0,0,0.35);animation:slideUp 0.3s ease;">
      <div style="text-align:center;margin-bottom:1.25rem;">
        <div style="font-size:3rem;margin-bottom:0.5rem;">👋</div>
        <div style="font-family:'Fredoka One',cursive;font-size:1.6rem;color:var(--text);margin-bottom:0.4rem;">Velkommen til OlaSkole!</div>
        <div style="font-size:0.92rem;color:var(--text-2);">Kom raskt i gang med disse stegene:</div>
      </div>
      <div style="display:flex;flex-direction:column;gap:0.75rem;margin-bottom:1.5rem;">
        <div style="background:var(--s2);border-radius:12px;padding:0.875rem 1rem;display:flex;align-items:flex-start;gap:0.75rem;">
          <span style="background:var(--accent);color:#fff;border-radius:50%;width:24px;height:24px;display:flex;align-items:center;justify-content:center;font-weight:800;font-size:0.78rem;flex-shrink:0;margin-top:2px;">1</span>
          <div><div style="font-weight:800;font-size:0.9rem;color:var(--text);">Opprett et emne</div><div style="font-size:0.8rem;color:var(--text-2);">Gå til «Nytt emne», gi emnet et navn og legg til oppgaver.</div></div>
        </div>
        <div style="background:var(--s2);border-radius:12px;padding:0.875rem 1rem;display:flex;align-items:flex-start;gap:0.75rem;">
          <span style="background:var(--c3);color:#fff;border-radius:50%;width:24px;height:24px;display:flex;align-items:center;justify-content:center;font-weight:800;font-size:0.78rem;flex-shrink:0;margin-top:2px;">2</span>
          <div><div style="font-weight:800;font-size:0.9rem;color:var(--text);">Bruk AI for å spare tid</div><div style="font-size:0.8rem;color:var(--text-2);">Lim inn en fagtekst og la AI generere quiz og flashcards automatisk. Trenger API-nøkkel.</div></div>
        </div>
        <div style="background:var(--s2);border-radius:12px;padding:0.875rem 1rem;display:flex;align-items:flex-start;gap:0.75rem;">
          <span style="background:var(--c4);color:#fff;border-radius:50%;width:24px;height:24px;display:flex;align-items:center;justify-content:center;font-weight:800;font-size:0.78rem;flex-shrink:0;margin-top:2px;">3</span>
          <div><div style="font-weight:800;font-size:0.9rem;color:var(--text);">Del med elevene</div><div style="font-size:0.8rem;color:var(--text-2);">Elevene besøker samme URL, velger «Arbeidsøkt» og logger inn med navn.</div></div>
        </div>
      </div>
      <div style="display:flex;gap:0.75rem;">
        <button data-onclick="_removeById" data-onclick-arg="teacherWelcomeOverlay" style="flex:1;background:var(--s3);border:1px solid var(--border-2);border-radius:12px;padding:11px;font-family:'Nunito',sans-serif;font-weight:800;font-size:0.9rem;cursor:pointer;color:var(--text);">Lukk</button>
        <button data-onclick="_removeByIdThenTab" data-onclick-args='["teacherWelcomeOverlay","new"]' style="flex:2;background:linear-gradient(135deg,var(--accent),var(--accent-h));border:none;border-radius:12px;padding:11px;font-family:'Nunito',sans-serif;font-weight:800;font-size:0.9rem;cursor:pointer;color:#fff;box-shadow:0 4px 16px rgba(123,143,253,0.3);">✏️ Opprett første emne →</button>
      </div>
    </div>`;
  document.body.appendChild(overlay);
  overlay.addEventListener('click', e => { if (e.target === overlay) overlay.remove(); });
}

// ====== BACKUP / EXPORT ======
function exportModulesJSON() {
  if (!state.modules.length) { showToast('⚠️ Ingen emner å eksportere'); return; }
  const payload = JSON.stringify({ version: 2, exportedAt: new Date().toISOString(), modules: state.modules }, null, 2);
  const blob = new Blob([payload], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `olaskole_backup_${new Date().toISOString().slice(0,10)}.json`;
  a.click();
  URL.revokeObjectURL(url);
  showToast(`✅ ${state.modules.length} emner eksportert!`);
}
async function importModulesJSON(input) {
  const file = input.files?.[0];
  if (!file) return;
  try {
    const text = await file.text();
    const data = JSON.parse(text);
    const imported = data.modules || (Array.isArray(data) ? data : null);
    if (!imported?.length) { showToast('❌ Ingen emner funnet i filen'); return; }
    if (!confirm(`Importer ${imported.length} emner? Eksisterende emner med samme ID overskrives.`)) return;
    // Merge: overwrite by _id, add new
    const byId = Object.fromEntries(state.modules.map(m => [m._id, m]));
    imported.forEach(m => { if (m._id) byId[m._id] = m; else state.modules.push(m); });
    state.modules = Object.values(byId).concat(state.modules.filter(m => !m._id));
    await saveModulesToStorage();
    renderHomeModules(); renderTaskModules(); renderManageModules();
    showToast(`✅ ${imported.length} emner importert!`);
  } catch(e) {
    showToast('❌ Ugyldig backup-fil: ' + e.message);
  }
  input.value = '';
}

// ====== SETTINGS ======
function openSettings() {
  openModal('settingsModal');
  showDbStatus();
  initSettingsFields();
  // Show password change section only for logged-in teacher
  const cpSection = document.getElementById('changePassSection');
  if (cpSection) cpSection.style.display = state.isTeacher ? 'block' : 'none';
  // Clear password fields
  const c = document.getElementById('changePassCurrent'); if (c) c.value = '';
  const n = document.getElementById('changePassNew'); if (n) n.value = '';
  const err = document.getElementById('changePassError'); if (err) err.style.display = 'none';
}

async function submitChangePass() {
  const current = document.getElementById('changePassCurrent')?.value || '';
  const newPass  = document.getElementById('changePassNew')?.value || '';
  const err      = document.getElementById('changePassError');
  const showErr  = (msg) => { if (err) { err.style.display = 'block'; err.textContent = msg; } };
  if (err) err.style.display = 'none';
  if (!current || !newPass) { showErr('Fyll inn begge feltene.'); return; }
  if (newPass.length < 8) { showErr('Nytt passord må være minst 8 tegn.'); return; }
  const rawAuth = localStorage.getItem('os_teacher_auth');
  if (!rawAuth) { showErr('Ingen passord lagret.'); return; }
  try {
    const auth = JSON.parse(rawAuth);
    const ok = await SecurityUtils.verifyPassword(current, auth.hash, auth.salt);
    if (!ok) { showErr('Nåværende passord er feil.'); return; }
    const salt = SecurityUtils.generateSalt();
    const hash = await SecurityUtils.hashPassword(newPass, salt);
    localStorage.setItem('os_teacher_auth', JSON.stringify({ salt, hash }));
    localStorage.setItem('os_teacher_pw_changed', '1');
    document.getElementById('changePassCurrent').value = '';
    document.getElementById('changePassNew').value = '';
    showToast('✅ Passord endret!');
  } catch(e) { showErr('Feil: ' + e.message); }
}

function initSettingsFields() {
  const apiEl = document.getElementById('settingsApiInput');
  if (apiEl) {
    const enc = localStorage.getItem('olaskole_apikey');
    apiEl.value = '';
    if (enc) { showApiStatus(true); }
  }
  const sbUrlEl = document.getElementById('sbUrlInput');
  const sbKeyEl = document.getElementById('sbKeyInput');
  if (sbUrlEl) sbUrlEl.value = '';
  if (sbKeyEl) sbKeyEl.value = '';
  if (localStorage.getItem('os_sb_url')) _decryptedSbUrl = '';
  if (localStorage.getItem('os_sb_key')) _decryptedSbKey = '';
  const msEl = document.getElementById('msClientId');
  if (msEl) {
    const cid = localStorage.getItem('olaskole_ms_clientid') || '';
    if (cid) msEl.value = cid;
  }
}
const _FOCUSABLE = 'a[href],button:not([disabled]),input:not([disabled]):not([type=hidden]),select:not([disabled]),textarea:not([disabled]),[tabindex]:not([tabindex="-1"])';
let _modalStack = []; // track open modals for Escape handling

function _trapFocus(modalEl) {
  const nodes = [...modalEl.querySelectorAll(_FOCUSABLE)].filter(n => !n.closest('[hidden]'));
  if (!nodes.length) return;
  const first = nodes[0], last = nodes[nodes.length - 1];
  modalEl._focusTrapHandler = e => {
    if (e.key !== 'Tab') return;
    if (nodes.length === 1) { e.preventDefault(); return; }
    if (e.shiftKey) { if (document.activeElement === first) { e.preventDefault(); last.focus(); } }
    else { if (document.activeElement === last) { e.preventDefault(); first.focus(); } }
  };
  modalEl.addEventListener('keydown', modalEl._focusTrapHandler);
}
function _releaseFocusTrap(modalEl) {
  if (modalEl._focusTrapHandler) { modalEl.removeEventListener('keydown', modalEl._focusTrapHandler); delete modalEl._focusTrapHandler; }
}

function closeModal(id) {
  const el = document.getElementById(id);
  if (!el) return;
  el.classList.remove('open');
  el.setAttribute('aria-hidden', 'true');
  _releaseFocusTrap(el);
  _modalStack = _modalStack.filter(x => x !== id);
  // Restore focus to trigger element
  const trigger = el._focusTrigger;
  if (trigger && document.body.contains(trigger)) trigger.focus();
  delete el._focusTrigger;
}
function openModal(id, triggerEl) {
  const el = document.getElementById(id);
  if (!el) return;
  el._focusTrigger = triggerEl || document.activeElement;
  el.classList.add('open');
  el.setAttribute('aria-hidden', 'false');
  _modalStack.push(id);
  setTimeout(() => {
    const inner = el.querySelector('.modal, [role="dialog"]');
    if (inner) { inner.setAttribute('tabindex', '-1'); inner.focus(); }
    _trapFocus(el);
  }, 80);
}

// Global Escape key handler for modals
document.addEventListener('keydown', e => {
  if (e.key === 'Escape' && _modalStack.length) {
    closeModal(_modalStack[_modalStack.length - 1]);
  }
});
function showApiStatus(ok) {
  const el = document.getElementById('settingsApiStatus');
  if (!el) return;
  el.style.display = 'block';
  el.style.color = ok ? 'var(--c3)' : 'var(--c1)';
  el.textContent = ok ? '✅ API-nøkkel lagret' : '❌ Ingen API-nøkkel';
}
function toggleSettingsKeyVis() {
  const el = document.getElementById('settingsApiInput');
  if (!el) return;
  el.type = el.type === 'password' ? 'text' : 'password';
}
function saveSettingsApiKey() {
  const key = document.getElementById('settingsApiInput')?.value.trim();
  if (!key) return;
  if (!_sessionEncKey) { showToast('🔐 Logg inn som lærer på nytt for å lagre kryptert nøkkel'); return; }
  SecurityUtils.encrypt(key, _sessionEncKey).then(payload => {
    localStorage.setItem('olaskole_apikey', JSON.stringify(payload));
    _decryptedApiKey = key;
    showApiStatus(true);
    const fb = document.getElementById('settingsApiFeedback');
    if (fb) { fb.style.display='block'; fb.style.background='#dcfce7'; fb.style.color='#166534'; fb.textContent='✅ API-nøkkel lagret kryptert'; setTimeout(()=>fb.style.display='none',2500); }
  }).catch(() => showToast('❌ Klarte ikke å lagre API-nøkkel'));
}
async function testSettingsApiKey() {
  const key = document.getElementById('settingsApiInput')?.value.trim() || getApiKey();
  if (!key) { showToast('⚠️ Lim inn en API-nøkkel først'); return; }
  const fb = document.getElementById('settingsApiFeedback');
  if (fb) { fb.style.display='block'; fb.style.background='#f0f0f0'; fb.style.color='#555'; fb.textContent='⏳ Tester…'; }
  try {
    const res = await _anthropicFetch('https://api.anthropic.com/v1/messages', {
      method:'POST',
      headers:{'Content-Type':'application/json','x-api-key':key,'anthropic-version':'2023-06-01','anthropic-dangerous-direct-browser-access':'true'},
      body:JSON.stringify({model:'claude-sonnet-4-20250514',max_tokens:10,messages:[{role:'user',content:'Hi'}]})
    });
    if (fb) { fb.style.display='block'; if(res.ok){fb.style.background='#dcfce7';fb.style.color='#166534';fb.textContent='✅ API-nøkkel fungerer!';}else{fb.style.background='#fee2e2';fb.style.color='#991b1b';fb.textContent='❌ Ugyldig nøkkel (status '+res.status+')';} }
  } catch(e) { if (fb) { fb.style.display='block'; fb.style.background='#fee2e2'; fb.style.color='#991b1b'; fb.textContent='❌ Feil: '+e.message; } }
}
function deleteSettingsApiKey() {
  localStorage.removeItem('olaskole_apikey');
  _decryptedApiKey = '';
  const el = document.getElementById('settingsApiInput'); if (el) el.value = '';
  showApiStatus(false);
}

function saveMsClientId() {
  const id = document.getElementById('msClientId')?.value.trim();
  if (id) localStorage.setItem('olaskole_ms_clientid', id);
}
function initMsToken() {
  const token = localStorage.getItem('olaskole_ms_token');
  if (token) {
    const nameEl = document.getElementById('msUserName');
    const statusEl = document.getElementById('msLoginStatus');
    if (nameEl) nameEl.textContent = localStorage.getItem('olaskole_ms_name') || '–';
    if (statusEl) statusEl.style.display = 'block';
  }
}
function testMsLogin() { msLogin(localStorage.getItem('olaskole_ms_clientid')); }
function msLogin(clientId) {
  if (!clientId) { showToast('⚠️ Lagre Azure App-ID først'); return; }
  const scopes = 'Files.ReadWrite Notes.Create Notes.ReadWrite openid profile';
  const redirect = encodeURIComponent(window.location.href.split('?')[0]);
  const url = `https://login.microsoftonline.com/common/oauth2/v2.0/authorize?client_id=${clientId}&response_type=token&redirect_uri=${redirect}&scope=${encodeURIComponent(scopes)}&response_mode=fragment`;
  const popup = window.open(url, 'mslogin', 'width=500,height=600');
  const check = setInterval(() => {
    try {
      if (!popup || popup.closed) { clearInterval(check); return; }
      const hash = popup.location.hash;
      if (hash && hash.includes('access_token')) {
        const params = new URLSearchParams(hash.substring(1));
        const token = params.get('access_token');
        if (token) { localStorage.setItem('olaskole_ms_token', token); initMsToken(); popup.close(); clearInterval(check); showToast('✅ Koblet til Microsoft 365!'); }
      }
    } catch(e) {}
  }, 500);
}

// ====== TEACHER ROOM TABS ======
function trTab(name) {
  if (!state.isTeacher) { showToast('⛔ Kun for lærere'); return; }
  document.querySelectorAll('.tr-tabs .tr-tab').forEach(t => t.classList.remove('active'));
  ['trpane-new','trpane-emner','trpane-results','trpane-inbox','trpane-klasser','trpane-kunngjoring','trpane-spill','trpane-stats','trpane-search'].forEach(id => {
    const el = document.getElementById(id); if (el) el.classList.remove('active');
  });
  const btn = document.getElementById('trtab-' + name);
  const pane = document.getElementById('trpane-' + name);
  if (btn) btn.classList.add('active');
  if (pane) pane.classList.add('active');
  if (name === 'emner') renderManageModules();
  if (name === 'results') renderResults();
  if (name === 'klasser') renderClassRoster();
  if (name === 'kunngjoring') loadAnnouncementEditor();
  if (name === 'spill') { gsLoadSessions(); gsLoadActiveBanner(); }
  if (name === 'stats') renderTeacherStats();
  if (name === 'inbox') renderWriteInbox();
  if (name === 'search') { document.getElementById('globalSearchInput')?.focus(); renderGlobalSearch(); }
  localStorage.setItem('os_last_tr_tab', name);
  const sel = document.getElementById('trTabMobileSelect');
  if (sel) sel.value = name;
}

function tcTab(name) {
  document.querySelectorAll('#taskCatTabs .task-cat-btn').forEach(t => t.classList.remove('active'));
  ['tcpane-quiz','tcpane-disc','tcpane-write','tcpane-video','tcpane-fc','tcpane-blank','tcpane-preview'].forEach(id => {
    const el = document.getElementById(id); if (el) el.classList.remove('active');
  });
  const btn = document.getElementById('tcbtn-' + name);
  const pane = document.getElementById('tcpane-' + name);
  if (btn) btn.classList.add('active');
  if (pane) pane.classList.add('active');
  if (name === 'preview') renderPreviewPanel();
}

function toggleAiSettings() {
  const panel = document.getElementById('aiSettingsPanel');
  const arrow = document.getElementById('aiSettingsArrow');
  if (!panel) return;
  const open = panel.style.display !== 'none';
  panel.style.display = open ? 'none' : 'block';
  if (arrow) arrow.textContent = open ? '▼' : '▲';
}

function previewModuleAsStudent() {
  const name = document.getElementById('moduleName')?.value.trim();
  if (!name) { showToast('⚠️ Fyll inn emnenavn først'); return; }
  const tempMod = {
    name, emoji: document.getElementById('moduleEmoji')?.value || '📚',
    desc: document.getElementById('moduleDesc')?.value.trim() || '',
    subject: document.getElementById('moduleSubject')?.value.trim() || '',
    text: document.getElementById('moduleText')?.value.trim() || '',
    quiz: [...(state.tempQuiz||[])],
    discussion: [...(state.tempDisc||[])],
    write: [...(state.tempWrite||[])],
    videos: [...(state.tempVideos||[])],
    flashcards: [...(state.tempFlashcards||[])],
    blanks: [...(state.tempBlanks||[])],
    language: document.getElementById('moduleLang')?.value || 'norsk bokmål',
  };
  const types = [];
  if (tempMod.text) types.push({key:'text',label:'📖 Les tekst'});
  if (tempMod.quiz.length) types.push({key:'quiz',label:'❓ Quiz'});
  if (tempMod.discussion.length) types.push({key:'disc',label:'💬 Drøfting'});
  if (tempMod.write.length) types.push({key:'write',label:'✍️ Skriveoppgave'});
  if (tempMod.videos.length) types.push({key:'video',label:'🎬 Video'});
  if (tempMod.flashcards.length) types.push({key:'fc',label:'🃏 Flashcards'});
  if (!types.length && !tempMod.text) { showToast('⚠️ Legg til innhold først'); return; }
  const tabsHtml = types.map(t => `<button data-onclick="_pvStudentSwitchTab" data-onclick-self data-onclick-args='["${t.key}"]' style="padding:8px 14px;border-radius:8px;border:1px solid var(--border-2);background:var(--s2);color:var(--text-2);font-family:'Nunito',sans-serif;font-weight:700;font-size:0.82rem;cursor:pointer;transition:all 0.18s;">${t.label}</button>`).join('');
  const ov = document.createElement('div');
  ov.id = 'pvStudentOverlay';
  ov.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.7);backdrop-filter:blur(6px);z-index:9999;display:flex;align-items:center;justify-content:center;padding:1rem;';
  ov.innerHTML = `<div style="background:var(--bg);border:1px solid var(--border-2);border-radius:20px;width:100%;max-width:600px;max-height:88vh;overflow-y:auto;padding:1.5rem;">
    <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:1rem;">
      <div style="font-weight:800;font-size:1.05rem;color:var(--text);">👁 Forhåndsvisning: ${escHtml(name)}</div>
      <button data-onclick="_removeById" data-onclick-arg="pvStudentOverlay" class="btn-modal-close"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg></button>
    </div>
    <div style="display:flex;gap:0.4rem;flex-wrap:wrap;margin-bottom:1rem;" id="pvStudentTabs">${tabsHtml}</div>
    <div id="pvStudentContent" style="color:var(--text);"></div>
  </div>`;
  ov.addEventListener('click', e => { if (e.target === ov) ov.remove(); });
  document.body.appendChild(ov);
  window.pvStudentMod = tempMod;
  if (types.length) {
    const firstBtn = ov.querySelector('#pvStudentTabs button');
    if (firstBtn) pvStudentSwitchTab(types[0].key, firstBtn, tempMod);
  }
}

function pvStudentSwitchTab(type, btn, m) {
  document.querySelectorAll('#pvStudentTabs button').forEach(b => {
    b.style.background = 'var(--s2)'; b.style.color = 'var(--text-2)'; b.style.borderColor = 'var(--border-2)';
  });
  if (btn) { btn.style.background = 'var(--accent-g)'; btn.style.color = 'var(--accent-h)'; btn.style.borderColor = 'var(--accent)'; }
  const content = document.getElementById('pvStudentContent');
  if (!content) return;
  if (type==='text') content.innerHTML = renderTextHTML(m);
  else if (type==='quiz') content.innerHTML = renderQuizHTML(m);
  else if (type==='disc') content.innerHTML = renderDiscHTML(m);
  else if (type==='write') content.innerHTML = renderWriteHTML(m);
  else if (type==='video') content.innerHTML = renderVideoHTML(m);
  else if (type==='fc') content.innerHTML = renderFlashcardHTML(m);
}

function updatePublishBarHint() {
  const hint = document.getElementById('publishBarHint');
  if (!hint) return;
  const name = document.getElementById('moduleName')?.value.trim();
  const total = (state.tempQuiz.length||0)+(state.tempDisc.length||0)+(state.tempWrite.length||0)+(state.tempVideos.length||0)+(state.tempFlashcards.length||0);
  const text = document.getElementById('moduleText')?.value.trim();
  if (!name) { hint.textContent = 'Fyll inn emnenavn for å publisere'; return; }
  if (!total && !text) { hint.textContent = '«'+name+'» – legg til oppgaver eller fagtekst'; return; }
  const parts = [];
  if (state.tempQuiz.length) parts.push(state.tempQuiz.length+' quiz');
  if (state.tempDisc.length) parts.push(state.tempDisc.length+' drøfting');
  if (state.tempWrite.length) parts.push(state.tempWrite.length+' skriving');
  if (state.tempVideos.length) parts.push(state.tempVideos.length+' video');
  if (state.tempFlashcards.length) parts.push(state.tempFlashcards.length+' flashcards');
  if (text) parts.push('fagtekst');
  hint.innerHTML = '<span style="color:var(--text-2)">«'+escHtml(name)+'»</span> &nbsp;<span style="color:var(--accent-h);font-weight:900;">'+parts.join('<span style="color:var(--text-3);margin:0 4px">·</span>')+'</span>';
}

// ====== MODULE RENDERING ======
function updateContinueCard() {
  const cc = document.getElementById('continueCard');
  if (!cc) return;
  const lastId = localStorage.getItem('os_last_module');
  if (!lastId || !state.student) { cc.style.display='none'; return; }
  const mod = state.modules.find(m => m._id === lastId);
  if (!mod) { cc.style.display='none'; return; }
  const idx = state.modules.indexOf(mod);
  cc.style.display = 'block';
  cc.innerHTML = `<div class="continue-card" data-onclick="openModule" data-onclick-arg="${idx}" role="button" tabindex="0" aria-label="Fortsett ${escHtml(mod.name)}" data-onkeydown-activate="openModule" data-onkeydown-activate-arg="${idx}">
    <div class="continue-card-icon">${mod.emoji||'📖'}</div>
    <div class="continue-card-text">
      <div class="continue-card-label">Fortsett der du slapp</div>
      <div class="continue-card-name">${escHtml(mod.name)}</div>
    </div>
    <div class="continue-card-arrow"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="9 18 15 12 9 6"/></svg></div>
  </div>`;
}

// Simple version tracker to skip redundant grid renders
const _gridVersions = {};
function _moduleGridHash() {
  // Include length, isTeacher, and a few ids so changes are detected
  const ids = state.modules.slice(0,5).map(m=>m.id||m._id||'').join(',');
  return state.modules.length + '|' + (state.isTeacher?'t':'s') + '|' + ids;
}
function _invalidateGridCache() { Object.keys(_gridVersions).forEach(k => delete _gridVersions[k]); }
function _renderModuleGrid(gridId, emptyId, opts={}) {
  const grid = document.getElementById(gridId);
  const empty = document.getElementById(emptyId);
  if (!grid) return;
  // Skip re-render if nothing changed and grid has content
  const hash = _moduleGridHash();
  if (!opts.force && _gridVersions[gridId] === hash && grid.children.length > 0) return;
  _gridVersions[gridId] = hash;
  const colors = ['color-1','color-2','color-3','color-4','color-5'];
  const visible = state.modules.filter(m => !m.locked);
  if (visible.length === 0) {
    grid.innerHTML = '';
    if (empty) empty.style.display = 'block';
    if (opts.onEmpty) opts.onEmpty();
    return;
  }
  if (empty) empty.style.display = 'none';
  // O(N) index map — avoids O(N²) indexOf inside map
  const idxMap = new Map(state.modules.map((m, i) => [m, i]));
  grid.innerHTML = visible.map((m, i) => {
    const realIdx = idxMap.get(m);
    const pct = getModuleProgress(realIdx);
    const progressBar = (pct >= 0) ? `<div style="margin-top:0.6rem;"><div style="height:4px;background:rgba(255,255,255,0.1);border-radius:50px;overflow:hidden;"><div style="height:100%;width:${pct}%;background:${pct===100?'#4ade80':'var(--accent)'};border-radius:50px;transition:width 0.4s;"></div></div><div style="font-size:0.68rem;font-weight:800;color:rgba(255,255,255,0.6);margin-top:3px;">${pct===100?'✓ Fullført':pct+'% gjennomført'}</div></div>` : '';
    const statusBadge = pct===100 ? '<span style="position:absolute;top:8px;left:8px;background:rgba(34,197,94,0.25);color:#4ade80;font-size:0.65rem;font-weight:800;padding:2px 8px;border-radius:50px;border:1px solid rgba(34,197,94,0.4);">✅ Ferdig</span>' : isNewModule(m) ? '<span style="position:absolute;top:8px;left:8px;background:var(--c1);color:white;font-size:0.68rem;font-weight:800;padding:2px 8px;border-radius:50px;">NY</span>' : '';
    const subjectBadge = m.subject ? `<span style="position:absolute;top:8px;right:8px;background:rgba(0,0,0,0.25);font-size:0.64rem;font-weight:800;padding:2px 7px;border-radius:50px;color:rgba(255,255,255,0.8);">${escHtml(m.subject)}</span>` : '';
    return `<div class="module-card ${colors[i%5]}" style="position:relative;--i:${i}" data-onclick="openModule" data-onclick-arg="${realIdx}" role="button" tabindex="0" aria-label="${escHtml(m.name)}" data-onkeydown-activate="openModule" data-onkeydown-activate-arg="${realIdx}" data-module-name="${escHtml(m.name)}" data-module-subject="${escHtml(m.subject||'')}">
      ${state.isTeacher ? `<button class="mc-edit-btn" data-onclick="quickEditModule" data-onclick-arg="${realIdx}" title="Rediger">✏️</button>` : ''}
      ${statusBadge}${subjectBadge}
      <span class="mc-emoji">${m.emoji||'📚'}</span>
      <h3>${escHtml(m.name)}</h3>
      <p>${escHtml(m.desc||'')}</p>
      <span class="task-count">${countTasks(m)} oppgaver</span>
      ${progressBar}
    </div>`;
  }).join('');
  _staggerCards('#' + gridId + ' .module-card');
}

function renderHomeModules() {
  _renderModuleGrid('homeModulesGrid', 'homeEmpty', {
    onEmpty: () => {
      const cta = document.getElementById('homeEmptyTeacherCta');
      if (cta) cta.style.display = state.isTeacher ? 'block' : 'none';
      const title = document.getElementById('homeEmptyTitle');
      const msg = document.getElementById('homeEmptyMsg');
      if (state.isTeacher) {
        if (title) title.textContent = 'Du har ingen emner ennå';
        if (msg) msg.textContent = 'Opprett ditt første emne for å komme i gang.';
      } else {
        if (title) title.textContent = 'Ingen emner tilgjengelig';
        if (msg) msg.textContent = 'Læreren din har ikke publisert noe innhold ennå. Sjekk igjen senere.';
      }
    }
  });
  renderSubjectFilter();
}

function _heroGreeting() {
  if (!state.student?.name) return;
  const h = new Date().getHours();
  const tid = h < 12 ? 'morgen' : h < 18 ? 'ettermiddag' : 'kveld';
  const fornavn = state.student.name.split(' ')[0];
  const el = document.getElementById('heroTitle');
  if (el) el.innerHTML = `God ${tid}, <span>${escHtml(fornavn)}</span>! 👋`;
}

function renderTaskModules() {
  _renderModuleGrid('taskModulesGrid', 'taskEmpty');
}

function getModuleProgress(realIdx) {
  if (!state.student) return -1;
  const m = state.modules[realIdx];
  if (!m) return -1;
  const types = [];
  if (m.text) types.push('text');
  if (m.quiz?.length) types.push('quiz');
  if (m.discussion?.length) types.push('disc');
  if (m.write?.length) types.push('write');
  if (m.videos?.length) types.push('video');
  if (m.flashcards?.length) types.push('fc');
  if (m.blanks?.length) types.push('blank');
  if (!types.length) return -1;
  const sKey = arbSKey ? arbSKey() : (state.student?.name?.replace(/\s+/g,'_') || 'anon');
  const done = types.filter(t => dbGetProgress(`arb_${sKey}_m${realIdx}_done_${t}`)).length;
  return Math.round(done / types.length * 100);
}

function countTasks(m) {
  return (m.quiz?.length||0)+(m.discussion?.length||0)+(m.write?.length||0)+(m.videos?.length||0)+(m.flashcards?.length||0)+(m.blanks?.length?1:0);
}

function renderSubjectFilter() {
  const el = document.getElementById('subjectFilter');
  if (!el) return;
  const subjects = [...new Set(state.modules.filter(m=>!m.locked&&m.subject).map(m=>m.subject))];
  if (!subjects.length) { el.innerHTML=''; return; }
  el.innerHTML = `<button class="subject-chip ${!activeSubjectFilter?'active':''}" data-onclick="setSubjectFilter">Alle</button>` +
    subjects.map(s=>`<button class="subject-chip ${activeSubjectFilter===s?'active':''}" data-onclick="setSubjectFilter" data-onclick-arg="${escHtml(s)}">${escHtml(s)}</button>`).join('');
}

function setSubjectFilter(subject) {
  activeSubjectFilter = subject;
  renderHomeModules();
}

function debounce(fn, ms) {
  let t; return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); };
}
const filterHomeModulesDebounced = debounce(filterHomeModulesImpl, 200);
function filterHomeModules() { filterHomeModulesDebounced(); }
function filterHomeModulesImpl() {
  const q = document.getElementById('moduleSearch')?.value.toLowerCase()||'';
  const cards = document.querySelectorAll('#homeModulesGrid .module-card');
  let visible = 0;
  cards.forEach(c => {
    const nameMatch = (c.getAttribute('data-module-name')||'').toLowerCase().includes(q);
    const subjectMatch = !activeSubjectFilter || (c.getAttribute('data-module-subject')||'')===activeSubjectFilter;
    const show = nameMatch && subjectMatch;
    c.style.display = show ? '' : 'none';
    if (show) visible++;
  });
  const empty = document.getElementById('homeEmpty');
  if (empty) empty.style.display = (visible===0 && state.modules.length>0) ? 'block' : 'none';
}

function filterTaskModules() {
  const q = document.getElementById('taskModuleSearch')?.value.toLowerCase()||'';
  const cards = document.querySelectorAll('#taskModulesGrid .module-card');
  let visible = 0;
  cards.forEach(c => {
    const show = (c.getAttribute('data-module-name')||'').toLowerCase().includes(q);
    c.style.display = show ? '' : 'none';
    if (show) visible++;
  });
  const empty = document.getElementById('taskEmpty');
  if (empty) empty.style.display = (visible===0 && state.modules.length>0) ? 'block' : 'none';
}
function openModule(idx) {
  if(state.modules[idx]) localStorage.setItem('os_last_module', state.modules[idx]._id||'mod_'+idx);
  // Track module opens per student
  if (state.student) {
    const trackKey = 'os_open_' + (state.modules[idx]?._id||'mod_'+idx);
    const opened = _lsGet(trackKey, {});
    opened[state.student.name] = new Date().toISOString();
    localStorage.setItem(trackKey, JSON.stringify(opened));
    DB.saveFeedback(trackKey, JSON.stringify(opened)).catch(()=>{});
  }
  state.currentModule = idx;
  const m = state.modules[idx];
  if (!m) return;
  document.getElementById('moduleDetailTitle').textContent = (m.emoji||'📚')+' '+m.name;
  document.getElementById('moduleList').style.display = 'none';
  document.getElementById('moduleDetail').style.display = 'block';
  showView('tasks');
  renderModuleDetail(m);
  resetNotepadUI();
  // Auto-open notepad if saved content exists
  const savedNote = localStorage.getItem('os_note_' + (m._id || 'mod_' + idx));
  if (savedNote && savedNote.trim() && state.student) {
    const body = document.getElementById('notepadBody');
    const chev = document.getElementById('notepadChevron');
    const ta = document.getElementById('notepadText');
    if (body) body.style.display = 'block';
    if (chev) chev.style.transform = 'rotate(180deg)';
    if (ta) ta.value = savedNote;
  }
}

function showModuleList() {
  exitFocusMode();
  document.getElementById('moduleList').style.display = 'block';
  document.getElementById('moduleDetail').style.display = 'none';
}

function renderModuleDetail(m) {
  const tabs = document.getElementById('taskTypeTabs');
  const content = document.getElementById('taskTypeContent');
  if (!tabs || !content) return;
  const available = [];
  if (m.text) available.push({key:'text', label:'📖 Les tekst'});
  if (m.quiz?.length) available.push({key:'quiz', label:'❓ Quiz'});
  if (m.discussion?.length) available.push({key:'disc', label:'💬 Drøfting'});
  if (m.write?.length) available.push({key:'write', label:'✍️ Skriveoppgave'});
  if (m.videos?.length) available.push({key:'video', label:'🎬 Video'});
  if (m.flashcards?.length) available.push({key:'fc', label:'🃏 Test deg selv'});
  if (m.blanks?.length) available.push({key:'blank', label:'✏️ Fyll inn'});
  if (m.flashcards?.length >= 2 || m.glossary?.length >= 2) available.push({key:'match', label:'🎯 Match'});
  if (!available.length) { content.innerHTML='<p style="color:var(--text-3);padding:2rem;">Ingen innhold i dette emnet ennå.</p>'; tabs.innerHTML=''; return; }
  // t.key and t.label are hardcoded constants — safe, but escape defensively
  tabs.innerHTML = available.map((t,i)=>`<button class="task-tab ${i===0?'active':''}" data-onclick="_switchTaskTabEl" data-onclick-args='["${escHtml(t.key)}"]' data-onclick-self>${escHtml(t.label)}</button>`).join('');
  switchTaskType(available[0].key, m);
}

function switchTaskTab(type, btn) {
  document.querySelectorAll('.task-tab').forEach(t=>t.classList.remove('active'));
  if (btn) btn.classList.add('active');
  switchTaskType(type, state.modules[state.currentModule]);
}

function switchTaskType(type, m) {
  const content = document.getElementById('taskTypeContent');
  if (!content || !m) return;
  // Stopp eventuelle løpende quiz-timere
  Object.values(_quizTimers||{}).forEach(t => clearInterval(t));
  _quizTimers = {};
  _removeQuizKeyboard();
  state.currentTask = type;
  if (type==='text') { content.innerHTML = renderTextHTML(m); setTimeout(()=>_initTaskTextView(m),50); }
  else if (type==='quiz') { content.innerHTML = renderQuizHTML(m); setTimeout(()=>{ startQuizTimers(m); _initQuizKeyboard(); }, 100); }
  else if (type==='disc') content.innerHTML = renderDiscHTML(m);
  else if (type==='write') { content.innerHTML = renderWriteHTML(m); setTimeout(()=>_loadWriteFeedback(m),100); }

  else if (type==='video') content.innerHTML = renderVideoHTML(m);
  else if (type==='fc') { content.innerHTML = renderFlashcardHTML(m); initFlashcards(m); }
  else if (type==='blank') content.innerHTML = renderBlanksHTML(m);
  else if (type==='match') _renderMatchGame(m, content);
}

function renderTextHTML(m) {
  if (!m.text) return '<p style="color:var(--text-3);padding:2rem;">Ingen tekst ennå.</p>';
  const saved = state.student ? (state.studentAnswers[state.student.name+'_m'+state.currentModule+'_text_read']) : null;
  const textHtml = _applyGlossary ? _applyGlossary(escHtml(m.text), m.glossary||[]) : escHtml(m.text);
  return `<div class="text-block">
    <div style="display:flex;align-items:center;gap:0.5rem;margin-bottom:0.75rem;flex-wrap:wrap;">
      <button class="tts-btn print-hide" id="ttsBtnTaskText" data-onclick="ttsSpeak" data-onclick-args='[null,"tasks-text-body"]'>🔊 Les høyt</button>
      ${state.student ? `<button class="tts-btn print-hide" data-onclick="_showMarksPanel" data-onclick-args="${JSON.stringify([state.currentModule,'tasks-text-body'])}">📝 Markeringer</button>` : ''}
    </div>
    <div id="tasks-text-body" style="white-space:pre-wrap;line-height:1.8;font-size:0.98rem;">${textHtml}</div>
    <div id="tasks-marks-panel-${state.currentModule}"></div>
    ${state.student ? `<div style="margin-top:1.5rem;padding-top:1rem;border-top:1px solid var(--border);">
      <button class="btn-save" data-onclick="markTextRead" style="${saved?'background:var(--c3);':''}">
        ${saved ? '✅ Lest!' : '📖 Merk som lest'}
      </button>
    </div>` : ''}
  </div>`;
}

function _initTaskTextView(m) {
  const body = document.getElementById('tasks-text-body');
  if (!body || !state.student) return;
  const mi = state.currentModule;
  // Apply saved marks
  const marks = _markLoad ? _markLoad(mi) : [];
  marks.forEach(mark => {
    const re = new RegExp('(' + mark.text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + ')', 'g');
    body.innerHTML = body.innerHTML.replace(re, `<mark class="text-mark" data-color="${escHtml(mark.color)}" data-id="${mark.id}" data-hid="${_reg(function(){_markClickMenu(this,mi,'tasks-text-body')})}" title="${escHtml(mark.note||'')}">$1</mark>`);
  });
  // Init selection handler
  body.addEventListener('mouseup', () => {
    const sel = window.getSelection();
    if (!sel || sel.isCollapsed || sel.toString().trim().length < 2) return;
    _showMarkPopover(sel.toString().trim(), mi, 'tasks-text-body');
  });
}

function markTextRead() {
  saveAnswer('text_read', true);
  switchTaskType('text', state.modules[state.currentModule]);
  arbMarkDone && arbMarkDone('text');
}

function renderQuizHTML(m) {
  if (!m.quiz?.length) return '<p style="color:var(--text-3);padding:2rem;">Ingen quiz ennå.</p>';
  const timerSec = m.quizTimer || 0;
  const shuffled = [...m.quiz].map((q,i) => ({...q, origIdx:i}));
  // Store stable shuffle order per module in sessionStorage to prevent re-shuffling on re-render
  const shuffleKey = `arb_quiz_shuffle_m${state.currentModule}`;
  let quizShuffle;
  try { quizShuffle = JSON.parse(sessionStorage.getItem(shuffleKey)); } catch {}
  if (!quizShuffle || quizShuffle.length !== m.quiz.length) {
    quizShuffle = m.quiz.map(() => [0,1,2,3].sort(()=>Math.random()-0.5));
    sessionStorage.setItem(shuffleKey, JSON.stringify(quizShuffle));
  }
  return `<div id="quizContainer">${shuffled.map((q, qi) => {
    const order = quizShuffle[qi] || [0,1,2,3];
    const allOpts = [
      {letter:'A', text:q.a, correct:true},
      {letter:'B', text:q.b, correct:false},
      {letter:'C', text:q.c, correct:false},
      {letter:'D', text:q.d, correct:false}
    ];
    const opts = order.map(oi => allOpts[oi]);
    const correctMap = JSON.stringify(opts.map(o=>o.correct));
    return `<div class="quiz-card" id="qcard-${qi}">
      <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:0.5rem;">
        <div class="quiz-q" style="margin-bottom:0;">${qi+1}. ${escHtml(q.question)}</div>
        ${timerSec>0?`<div id="qtimer-${qi}" style="font-size:0.85rem;font-weight:800;color:var(--c2);background:var(--dark);padding:4px 10px;border-radius:50px;min-width:44px;text-align:center;">${timerSec}s</div>`:''}
      </div>
      <div class="quiz-opts" role="group" aria-label="Svaralternativer">
        ${opts.map((o,oi)=>`<button class="quiz-opt" id="qopt-${qi}-${oi}" aria-pressed="false" data-onclick="checkAnswer" data-onclick-args="${JSON.stringify([qi,o.correct,oi,correctMap])}">${o.letter}. ${escHtml(o.text)}</button>`).join('')}
      </div>
      <div class="quiz-feedback" id="qfb-${qi}" aria-live="polite" aria-atomic="true"></div>
    </div>`;
  }).join('')}</div>`;
}

function startQuizTimers(m) {
  const timerSec = m.quizTimer || 0;
  if (!timerSec) return;
  m.quiz.forEach((q, qi) => {
    let left = timerSec;
    _quizTimers[qi] = setInterval(() => {
      const el = document.getElementById('qtimer-'+qi);
      const fb = document.getElementById('qfb-'+qi);
      if (!el || (fb && fb.innerHTML)) { clearInterval(_quizTimers[qi]); return; }
      left--;
      el.textContent = left + 's';
      el.style.color = left <= 5 ? 'var(--c1)' : 'var(--c2)';
      if (left <= 0) {
        clearInterval(_quizTimers[qi]);
        // Tid ute – marker som feil
        const card = document.getElementById('qcard-'+qi);
        if (!card) return;
        const opts = card.querySelectorAll('.quiz-opt');
        opts.forEach((o,i) => { o.disabled=true; });
        if (fb && !fb.innerHTML) {
          fb.innerHTML = `<span style="color:var(--c1);font-weight:800;">⏰ Tid ute!</span>${q.explain?` <span style="color:var(--text-2);font-size:0.88rem;">💡 ${escHtml(q.explain)}</span>`:''}`;
          saveAnswer('quiz_'+qi, false);
          el.textContent = '0s';
        }
      }
    }, 1000);
  });
}

function checkAnswer(qi, isCorrect, optIdx, correctMap) {
  const card = document.getElementById('qcard-'+qi);
  const fb = document.getElementById('qfb-'+qi);
  if (!card || fb.innerHTML) return;
  const explain = state.modules[state.currentModule]?.quiz?.[qi]?.explain || '';
  const opts = card.querySelectorAll('.quiz-opt');
  opts.forEach((o,i) => {
    o.disabled = true;
    o.setAttribute('aria-pressed', String(i === optIdx));
    if (correctMap[i]) o.classList.add('correct');
    else if (i===optIdx && !isCorrect) o.classList.add('wrong');
  });
  if (isCorrect) { SND.correct(); launchConfetti(); } else { SND.wrong(); }
  fb.innerHTML = isCorrect
    ? `<span style="color:var(--c3);font-weight:800;">✅ Riktig!</span>${explain?` <span style="color:var(--text-2);font-size:0.88rem;">${escHtml(explain)}</span>`:''}`
    : `<span style="color:var(--c1);font-weight:800;">❌ Feil.</span>${explain?` <span style="color:var(--text-2);font-size:0.88rem;">💡 ${escHtml(explain)}</span>`:''}`;
  saveAnswer('quiz_'+qi, isCorrect ? true : false);
}

function renderDiscHTML(m) {
  if (!m.discussion?.length) return '<p style="color:var(--text-3);padding:2rem;">Ingen drøftingsspørsmål ennå.</p>';
  return m.discussion.map((d,di) => {
    const savedKey = state.student ? (state.student.name+'_m'+state.currentModule+'_disc_'+di) : null;
    const saved = savedKey ? state.studentAnswers[savedKey] : null;
    return `<div class="discussion-card">
      <div class="dq-prompt">💬 ${escHtml(d)}</div>
      <textarea id="disc-${di}" placeholder="Skriv svaret ditt her..." style="width:100%;min-height:100px;border:2px solid var(--border-2);background:var(--s2);color:var(--text);border-radius:12px;padding:12px;font-family:'Nunito',sans-serif;font-size:0.95rem;outline:none;margin-top:0.5rem;">${saved?escHtml(saved.val):''}</textarea>
      <div style="display:flex;align-items:center;gap:0.5rem;margin-top:0.5rem;">
        <button class="btn-save" data-onclick="saveDiscAnswer" data-onclick-arg="${di}">💾 Lagre svar</button>
        <span class="saved-badge" id="saved-badge-${di}" style="display:none;">✓ Lagret!</span>
      </div>
    </div>`;
  }).join('');
}

function saveDiscAnswer(di) {
  const val = document.getElementById('disc-'+di)?.value.trim();
  if (!val) return;
  saveAnswer('disc_'+di, val);
  const badge = document.getElementById('saved-badge-'+di);
  if (badge) { badge.style.display='inline-block'; setTimeout(()=>badge.style.display='none',2500); }
  // Show awaiting feedback indicator
  let fbInd = document.getElementById('disc-fb-ind-'+di);
  if (!fbInd) {
    fbInd = document.createElement('span');
    fbInd.id = 'disc-fb-ind-'+di;
    fbInd.style.cssText = 'font-size:0.78rem;font-weight:700;color:var(--text-3);margin-left:0.5rem;';
    badge?.parentNode?.appendChild(fbInd);
  }
  fbInd.textContent = '⏳ Venter på tilbakemelding fra lærer';
}

function renderWriteHTML(m) {
  if (!m.write?.length) return '<p style="color:var(--text-3);padding:2rem;">Ingen skriveoppgave ennå.</p>';
  const lang = m.language || 'norsk bokmål';
  const langAttr = lang.includes('engelsk') ? 'en' : 'no';
  return m.write.map((w,wi) => {
    const savedKey = state.student ? (state.student.name+'_m'+state.currentModule+'_write_'+wi) : null;
    const saved = savedKey ? state.studentAnswers[savedKey] : null;
    return `<div class="discussion-card">
      <h3 style="font-weight:800;margin-bottom:0.5rem;">✍️ ${escHtml(w.title||'Skriveoppgave')}</h3>
      <div style="background:var(--bg);border-radius:12px;padding:1rem;margin-bottom:1rem;border-left:4px solid var(--c2);font-size:0.95rem;color:var(--text-2);">${escHtml(w.desc||'')}</div>
      <div style="display:flex;gap:0.5rem;flex-wrap:wrap;margin-bottom:0.75rem;align-items:center;">
        ${w.minWords?`<span style="font-size:0.82rem;color:var(--text-3);font-weight:700;background:var(--s3);padding:4px 10px;border-radius:50px;">Minimum ${w.minWords} ord</span>`:''}
        <span style="font-size:0.78rem;color:var(--text-3);font-weight:700;">🌐 ${escHtml(lang)}</span>
        <select data-onchange="_applyWriteTemplateEl" data-onchange-arg="${wi}" style="font-size:0.8rem;padding:4px 10px;border-radius:50px;border:1px solid var(--border-2);background:var(--s2);color:var(--text-2);font-family:'Nunito',sans-serif;font-weight:700;cursor:pointer;outline:none;">
          <option value="">📝 Velg tekstmal...</option>
          <option value="argumenterende">📣 Argumenterende</option>
          <option value="beskrivende">🔍 Beskrivende</option>
          <option value="fortellende">📖 Fortellende</option>
          <option value="reflekterende">💭 Reflekterende</option>
        </select>
      </div>
      <div id="writeTemplate-${wi}" style="display:none;background:rgba(245,158,11,0.08);border:2px dashed var(--c2);border-radius:12px;padding:0.875rem;margin-bottom:0.75rem;font-size:0.85rem;color:var(--text-2);line-height:1.65;"></div>
      <textarea id="write-${wi}" lang="${langAttr}" spellcheck="true"
        placeholder="Skriv teksten din her..."
        style="width:100%;min-height:200px;border:2px solid var(--border-2);background:var(--s2);color:var(--text);border-radius:12px;padding:12px;font-family:'Nunito',sans-serif;font-size:0.95rem;outline:none;line-height:1.7;transition:border-color 0.2s;"
        class="focus-accent"
        data-oninput="_countWordsEl" data-oninput-args="${JSON.stringify([wi,w.minWords||0])}">${saved?escHtml(saved.val):''}</textarea>
      <div style="display:flex;align-items:center;gap:0.75rem;margin-top:0.6rem;flex-wrap:wrap;">
        <span id="wcount-${wi}" style="font-size:0.82rem;color:var(--text-3);font-weight:700;">0 ord</span>
        <span id="wreadability-${wi}" style="font-size:0.78rem;color:var(--text-3);font-weight:700;"></span>
        <div style="flex:1;"></div>
        <button class="btn-save" data-onclick="saveWriteAnswer" data-onclick-arg="${wi}">💾 Lagre</button>
        <span class="saved-badge" id="wsaved-${wi}" style="display:none;">✓ Lagret!</span>
      </div>
      <div id="write-fb-${wi}"></div>
    </div>`;
  }).join('');
}

async function _loadWriteFeedback(m) {
  if (!state.student || !m.write?.length) return;
  const name = state.student.name;
  const mi = state.currentModule;
  for (let wi = 0; wi < m.write.length; wi++) {
    const answerKey = `${name}_m${mi}_write_${wi}`;
    const fbKey = 'af_' + answerKey;
    const slot = document.getElementById('write-fb-' + wi);
    if (!slot) continue;
    const fbText = await DB.loadFeedback(fbKey);
    if (fbText) {
      slot.innerHTML = `<div class="af-box"><strong>💬 Lærer:</strong> ${escHtml(fbText)}</div>`;
    }
  }
}

const WRITE_TEMPLATES = {
  argumenterende: `<b>📣 Argumenterende tekst – mal:</b><br>
<b>Innledning:</b> Presenter tema og din påstand (hva du mener).<br>
<b>Argument 1:</b> Første grunn for påstanden + eksempel/belegg.<br>
<b>Argument 2:</b> Andre grunn + eksempel/belegg.<br>
<b>Motargument:</b> Nevn et motsynspunkt og tilbakedvis det.<br>
<b>Avslutning:</b> Oppsummer og gjenta påstanden.`,
  beskrivende: `<b>🔍 Beskrivende tekst – mal:</b><br>
<b>Innledning:</b> Hva skal du beskrive? Gi leseren et overblikk.<br>
<b>Hoveddel:</b> Beskriv detaljert – bruk sanseinntrykk (se, høre, lukte, ta på).<br>
<b>Detaljer:</b> Legg til fakta, egenskaper og kjennetegn.<br>
<b>Avslutning:</b> Helhetsinntrykk – hva gjør dette emnet spesielt?`,
  fortellende: `<b>📖 Fortellende tekst – mal:</b><br>
<b>Innledning:</b> Presenter sted, tid og person(er). Skap spenning.<br>
<b>Oppbygging:</b> Beskriv situasjonen som fører til konflikten.<br>
<b>Høydepunkt:</b> Det viktigste som skjer – konflikt eller vendepunkt.<br>
<b>Løsning:</b> Hvordan løses problemet?<br>
<b>Avslutning:</b> Hva lærte personen? Hvordan endte det?`,
  reflekterende: `<b>💭 Reflekterende tekst – mal:</b><br>
<b>Innledning:</b> Hva reflekterer du over? Hvorfor er dette viktig for deg?<br>
<b>Egne tanker:</b> Hva tenker du om dette temaet? Hva har du erfart?<br>
<b>Perspektiv:</b> Kan andre se det annerledes? Hva sier fagstoffet?<br>
<b>Avslutning:</b> Hva har du kommet frem til? Hva lurer du fortsatt på?`
};

function applyWriteTemplate(wi, type) {
  const el = document.getElementById('writeTemplate-'+wi);
  if (!el) return;
  if (!type) { el.style.display='none'; el.innerHTML=''; return; }
  el.style.display = 'block';
  el.innerHTML = WRITE_TEMPLATES[type] || '';
}

function countWords(wi, minWords) {
  const el = document.getElementById('write-'+wi);
  const countEl = document.getElementById('wcount-'+wi);
  const readEl = document.getElementById('wreadability-'+wi);
  if (!el || !countEl) return;
  const text = el.value.trim();
  const words = text ? text.split(/\s+/).filter(w=>w).length : 0;
  countEl.textContent = words + ' ord';
  countEl.style.color = (minWords && words < minWords) ? 'var(--c1)' : 'var(--c3)';
  // Lesbarhetsindikator (enkel LIX-tilnærming)
  if (readEl && words > 10) {
    const sentences = text.split(/[.!?]+/).filter(s=>s.trim()).length || 1;
    const longWords = text.split(/\s+/).filter(w=>w.replace(/[^a-zA-ZæøåÆØÅ]/g,'').length > 6).length;
    const lix = Math.round((words/sentences) + (longWords*100/words));
    let label = '', color = '';
    if (lix < 25) { label='😊 Veldig enkel'; color='#6BCB77'; }
    else if (lix < 35) { label='✅ Enkel'; color='#6BCB77'; }
    else if (lix < 45) { label='📖 Middels'; color='#FFD93D'; }
    else if (lix < 55) { label='🎓 Vanskelig'; color='#FF9A3C'; }
    else { label='🔬 Svært vanskelig'; color='#FF6B6B'; }
    readEl.textContent = 'Lesbarhet: ' + label;
    readEl.style.color = color;
  } else if (readEl) {
    readEl.textContent = '';
  }
}

function saveWriteAnswer(wi) {
  const val = document.getElementById('write-'+wi)?.value.trim();
  if (!val) return;
  saveAnswer('write_'+wi, val);
  const badge = document.getElementById('wsaved-'+wi);
  if (badge) { badge.style.display='inline-block'; setTimeout(()=>badge.style.display='none',2500); }
  // Show awaiting feedback indicator
  let fbInd = document.getElementById('write-fb-ind-'+wi);
  if (!fbInd) {
    fbInd = document.createElement('span');
    fbInd.id = 'write-fb-ind-'+wi;
    fbInd.style.cssText = 'font-size:0.78rem;font-weight:700;color:var(--text-3);display:block;margin-top:0.35rem;';
    badge?.parentNode?.appendChild(fbInd);
  }
  fbInd.textContent = '⏳ Venter på tilbakemelding fra lærer';
}

function renderVideoHTML(m) {
  if (!m.videos?.length) return '<p style="color:var(--text-3);padding:2rem;">Ingen videoer ennå.</p>';
  return m.videos.map((v,vi) => {
    const ytId = getYtId(v.url);
    let embedHtml = '';
    if (ytId) {
      embedHtml = `<iframe width="100%" height="280" src="https://www.youtube.com/embed/${ytId}" frameborder="0" allowfullscreen style="border-radius:12px;margin-bottom:1rem;display:block;"></iframe>`;
    } else if (v.url) {
      embedHtml = `<a href="${escHtml(v.url)}" target="_blank" style="display:block;background:linear-gradient(135deg,var(--c1),var(--c5));color:white;text-align:center;padding:2rem;border-radius:12px;font-weight:800;margin-bottom:1rem;text-decoration:none;">🔗 Åpne lenken</a>`;
    }
    const savedKey = state.student ? (state.student.name+'_m'+state.currentModule+'_vid_'+vi) : null;
    const saved = savedKey ? state.studentAnswers[savedKey] : null;
    return `<div class="video-card">
      ${embedHtml}
      <h3 style="font-weight:800;margin-bottom:0.5rem;">${escHtml(v.title||'Video')}</h3>
      ${v.task?`<div style="background:var(--bg);border-radius:12px;padding:1rem;margin-top:0.75rem;border-left:4px solid var(--c2);font-size:0.95rem;color:var(--text-2);">📋 <b>Oppgave:</b> ${escHtml(v.task)}</div>
      <textarea style="width:100%;margin-top:0.75rem;border:2px solid var(--border-2);background:var(--s2);color:var(--text);border-radius:12px;padding:12px;font-family:'Nunito',sans-serif;font-size:0.95rem;min-height:100px;outline:none;" id="vid-${vi}" placeholder="Skriv svaret ditt her...">${saved?escHtml(saved.val):''}</textarea>
      <div style="display:flex;align-items:center;gap:0.5rem;margin-top:0.5rem;">
        <button class="btn-save" data-onclick="saveVidAnswer" data-onclick-arg="${vi}">💾 Lagre</button>
        <span class="saved-badge" id="vidsaved-${vi}" style="display:none;">✓ Lagret!</span>
      </div>`:''}
    </div>`;
  }).join('');
}

function saveVidAnswer(vi) {
  const val = document.getElementById('vid-'+vi)?.value.trim();
  if (!val) return;
  saveAnswer('vid_'+vi, val);
  const badge = document.getElementById('vidsaved-'+vi);
  if (badge) { badge.style.display='inline-block'; setTimeout(()=>badge.style.display='none',2500); }
}

function renderFlashcardHTML(m) {
  if (!m.flashcards?.length) return '<p style="color:var(--text-3);padding:2rem;">Ingen flashcards ennå.</p>';
  return `<div class="selftest-card">
    <h3 style="font-family:'Fredoka One',cursive;font-size:1.3rem;margin-bottom:1rem;">🃏 Test deg selv</h3>
    <div id="fcHolder"></div>
    <div class="flashcard-hint">Klikk på kortet for å se svaret!</div>
    <div class="fc-nav">
      <button data-onclick="prevFC">← Forrige</button>
      <span class="fc-counter" id="fcCounter">1 / ${m.flashcards.length}</span>
      <button data-onclick="nextFC">Neste →</button>
    </div>
  </div>`;
}

function initFlashcards(m) { state.fcIndex=0; renderFC(m); }
function renderFC(m) {
  const fc = m.flashcards[state.fcIndex];
  if (!fc) return;
  const holder = document.getElementById('fcHolder');
  if (!holder) return;
  holder.innerHTML = `<div class="flashcard" id="currentFC" data-onclick="_toggleFC">
    <div class="flashcard-inner">
      <div class="flashcard-front"><span style="font-size:1.1rem;font-weight:800;">${escHtml(fc.front)}</span></div>
      <div class="flashcard-back"><span style="font-size:1rem;">${escHtml(fc.back)}</span></div>
    </div>
  </div>`;
  const counter = document.getElementById('fcCounter');
  if (counter) counter.textContent = (state.fcIndex+1)+' / '+m.flashcards.length;
}
function nextFC() { const m=state.modules[state.currentModule]; if(m&&state.fcIndex<m.flashcards.length-1){state.fcIndex++;renderFC(m);} }
function prevFC() { const m=state.modules[state.currentModule]; if(m&&state.fcIndex>0){state.fcIndex--;renderFC(m);} }

function saveAnswer(key, val) {
  if (!state.student) return;
  const k = state.student.name+'_m'+state.currentModule+'_'+key;
  const correct = val===true || (typeof val==='string'&&val==='correct');
  state.studentAnswers[k] = { val, correct, time: new Date().toLocaleString('no') };
  DB.saveAnswer(state.student.name, state.student.cls, k, typeof val==='string'?val:JSON.stringify(val), correct);
  localStorage.setItem('lh_answers', JSON.stringify(state.studentAnswers));
  renderBadges();
}

// ====== TEACHER MODULE MANAGEMENT ======
function getAiSettings() {
  const fagFree = document.getElementById('aiSubjectFree')?.value.trim() || '';
  const fagDrop = document.getElementById('aiSubject')?.value || '';
  const fag = fagFree || fagDrop;
  return {
    klasse: document.getElementById('aiClass')?.value || '9. trinn',
    vanske: document.getElementById('aiDifficulty')?.value || 'middels',
    quizCount: parseInt(document.getElementById('aiQuizCount')?.value||'3'),
    fcCount: parseInt(document.getElementById('aiFcCount')?.value||'4'),
    discCount: parseInt(document.getElementById('aiDiscCount')?.value||'1'),
    writeTasks: document.getElementById('aiWriteTask')?.value !== 'nei',
    customPrompt: document.getElementById('aiCustomPrompt')?.value.trim()||'',
    fag,
    maal: document.getElementById('aiGoalSelect')?.value||'',
    language: document.getElementById('aiLanguage')?.value || 'norsk bokmål',
    quizTimer: parseInt(document.getElementById('aiQuizTimer')?.value || '0')
  };
}

function syncAiSubjectFree(val) {
  // When user types in free-text field, clear the dropdown selection
  if (val.trim()) {
    const sel = document.getElementById('aiSubject');
    if (sel) sel.value = '';
    const goalSel = document.getElementById('aiGoalSelect');
    if (goalSel) { goalSel.disabled = true; goalSel.innerHTML = '<option value="">— Velg skolefag over for å se kompetansemål —</option>'; }
    const badge = document.getElementById('selectedGoalBadge');
    if (badge) badge.style.display = 'none';
  }
}

function syncAiSubjectFromSelect(val) {
  // When user picks from dropdown, clear the free-text field
  if (val) {
    const inp = document.getElementById('aiSubjectFree');
    if (inp) inp.value = '';
  }
}

function updateCompetenceGoals() {
  const subj = document.getElementById('aiSubject')?.value;
  const sel = document.getElementById('aiGoalSelect');
  const badge = document.getElementById('selectedGoalBadge');
  if (!sel) return;
  if (!subj || !COMPETANSE_MAAL[subj]) { sel.innerHTML='<option value="">— Velg fag først —</option>'; sel.disabled=true; return; }
  sel.disabled = false;
  sel.innerHTML = '<option value="">— Velg kompetansemål —</option>' +
    COMPETANSE_MAAL[subj].map(g=>`<option value="${escHtml(g)}">${escHtml(g)}</option>`).join('');
  sel.onchange = () => {
    if (badge) { if(sel.value){badge.style.display='block';badge.textContent='🎯 '+sel.value;}else{badge.style.display='none';} }
  };
}

function addQuizQuestion() { setTimeout(updatePublishBarHint,50);
  const q=document.getElementById('quizQ')?.value.trim();
  const a=document.getElementById('quizA')?.value.trim();
  const b=document.getElementById('quizB')?.value.trim();
  const c=document.getElementById('quizC')?.value.trim();
  const d=document.getElementById('quizD')?.value.trim();
  if (!q||!a||!b||!c||!d) { showToast('Fyll inn spørsmål og alle fire svaralternativer'); return; }
  if (q.length > 400) { showToast('⚠️ Spørsmålet er for langt (maks 400 tegn)'); return; }
  if ([a,b,c,d].some(x => x.length > 200)) { showToast('⚠️ Svaralternativ er for langt (maks 200 tegn)'); return; }
  const explain = document.getElementById('quizExplain')?.value.trim()||'';
  const img = document.getElementById('quizImg')?.value.trim()||'';
  state.tempQuiz.push({question:q,a,b,c,d,explain,img});
  ['quizQ','quizA','quizB','quizC','quizD','quizExplain','quizImg'].forEach(id=>{const el=document.getElementById(id);if(el)el.value='';});
  const prev = document.getElementById('quizImgPreview'); if(prev) prev.innerHTML='';
  showToast('✅ Spørsmål lagt til!');
  renderQuizPreview();
}

function renderQuizPreview() {
  const preview = document.getElementById('quizPreview');
  if (!preview) return;
  if (!state.tempQuiz?.length) { preview.innerHTML = ''; return; }
  let dragSrc = null;
  preview.innerHTML = `<div style="font-size:0.8rem;color:var(--text-3);font-weight:700;margin-bottom:0.4rem;">📋 ${state.tempQuiz.length} spørsmål — dra for å endre rekkefølge</div>` +
    state.tempQuiz.map((q, qi) => {
      const qText = q.question || q.q || '?';
      return `<div class="preview-item" draggable="true" data-qi="${qi}" style="display:flex;align-items:center;gap:0.5rem;padding:0.5rem 0.75rem;">
        <span style="cursor:grab;color:var(--text-3);font-size:1rem;flex-shrink:0;">⠿</span>
        <span style="flex:1;font-size:0.85rem;font-weight:700;color:var(--text);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;" title="${escHtml(qText)}">${qi+1}. ${escHtml(qText.substring(0,80))}${qText.length>80?'…':''}</span>
        <button data-hid="${_reg(function(){state.tempQuiz.splice(qi,1);renderQuizPreview();})}" style="background:rgba(239,68,68,0.1);color:#f87171;border:1px solid rgba(239,68,68,0.3);border-radius:6px;padding:3px 7px;font-size:0.72rem;font-weight:800;cursor:pointer;flex-shrink:0;" title="Slett">🗑</button>
      </div>`;
    }).join('');
  // Init drag-and-drop
  const items = preview.querySelectorAll('.preview-item[draggable]');
  items.forEach(item => {
    item.addEventListener('dragstart', e => { dragSrc = item; item.style.opacity='0.4'; e.dataTransfer.effectAllowed='move'; });
    item.addEventListener('dragend', () => { dragSrc=null; items.forEach(i=>{i.style.opacity='1';i.classList.remove('drag-over');}); });
    item.addEventListener('dragover', e => { e.preventDefault(); e.dataTransfer.dropEffect='move'; if(item!==dragSrc){item.classList.add('drag-over');} });
    item.addEventListener('dragleave', () => item.classList.remove('drag-over'));
    item.addEventListener('drop', e => {
      e.preventDefault();
      item.classList.remove('drag-over');
      if (!dragSrc || dragSrc===item) return;
      const fromIdx = parseInt(dragSrc.getAttribute('data-qi'));
      const toIdx = parseInt(item.getAttribute('data-qi'));
      const moved = state.tempQuiz.splice(fromIdx, 1)[0];
      state.tempQuiz.splice(toIdx, 0, moved);
      renderQuizPreview();
    });
  });
}

function loadQuizImgFile(input) {
  const file = input.files[0]; if (!file) return;
  const r = new FileReader();
  r.onload = e => { document.getElementById('quizImg').value = e.target.result; previewQuizImg(); };
  r.readAsDataURL(file);
}
function previewQuizImg() {
  const url = document.getElementById('quizImg')?.value;
  const prev = document.getElementById('quizImgPreview');
  if (prev) prev.innerHTML = url ? `<img src="${escHtml(url)}" class="img-preview-thumb img-safe">` : '';
}
function loadFcImgFile(input, side) {
  const file = input.files[0]; if (!file) return;
  const r = new FileReader();
  r.onload = e => { document.getElementById('fcImg'+side.charAt(0).toUpperCase()+side.slice(1)).value = e.target.result; previewFcImg(side); };
  r.readAsDataURL(file);
}
function previewFcImg(side) {
  const cap = side.charAt(0).toUpperCase()+side.slice(1);
  const url = document.getElementById('fcImg'+cap)?.value;
  const prev = document.getElementById('fcImg'+cap+'Preview');
  if (prev) prev.innerHTML = url ? `<img src="${escHtml(url)}" class="img-preview-thumb img-safe">` : '';
}
function addGlossary() {
  const term = document.getElementById('glossTerm')?.value.trim();
  const def = document.getElementById('glossDef')?.value.trim();
  if (!term || !def) { showToast('Fyll inn begrep og definisjon'); return; }
  state.tempGlossary.push({term, def});
  document.getElementById('glossTerm').value = '';
  document.getElementById('glossDef').value = '';
  _renderGlossPreview();
}
function _renderGlossPreview() {
  const p = document.getElementById('glossPreview'); if (!p) return;
  if (!state.tempGlossary.length) { p.innerHTML=''; return; }
  p.innerHTML = state.tempGlossary.map((g,i) =>
    `<span style="display:inline-flex;align-items:center;gap:4px;background:var(--accent-g);border:1px solid var(--border-2);border-radius:50px;padding:3px 10px;font-size:0.78rem;font-weight:700;color:var(--text);margin:2px;">
      <strong>${escHtml(g.term)}</strong>: ${escHtml(g.def)}
      <button data-hid="${_reg(function(){state.tempGlossary.splice(i,1);_renderGlossPreview();})}" style="background:none;border:none;cursor:pointer;font-size:0.85rem;color:var(--text-3);padding:0 2px;" title="Fjern">✕</button>
    </span>`
  ).join('');
}

function addDiscussion() { setTimeout(updatePublishBarHint,50);
  const q=document.getElementById('discQ')?.value.trim();
  if (!q) { showToast('Skriv inn et drøftingsspørsmål'); return; }
  state.tempDisc.push(q);
  const el=document.getElementById('discQ'); if(el)el.value='';
  showToast('✅ Drøftingsspørsmål lagt til!');
  const preview=document.getElementById('discPreview');
  if(preview)preview.innerHTML=`<span style="color:var(--c3);font-weight:800;">✅ ${state.tempDisc.length} drøftingsspørsmål totalt</span>`;
}

function addWriteTask() { setTimeout(updatePublishBarHint,50);
  const title=document.getElementById('writeTitle')?.value.trim();
  const desc=document.getElementById('writeDesc')?.value.trim();
  const minWords=parseInt(document.getElementById('writeMin')?.value||'100');
  if(!title||!desc){showToast('Fyll inn tittel og instruksjon');return;}
  state.tempWrite.push({title,desc,minWords});
  ['writeTitle','writeDesc'].forEach(id=>{const el=document.getElementById(id);if(el)el.value='';});
  showToast('✅ Skriveoppgave lagt til!');
}

function addVideo() { setTimeout(updatePublishBarHint,50);
  const title=document.getElementById('videoTitle')?.value.trim();
  const url=document.getElementById('videoUrl')?.value.trim();
  const task=document.getElementById('videoTask')?.value.trim();
  if(!url){showToast('Lim inn en URL');return;}
  state.tempVideos.push({title:title||url,url,task});
  ['videoTitle','videoUrl','videoTask'].forEach(id=>{const el=document.getElementById(id);if(el)el.value='';});
  const prev=document.getElementById('manualVideoPreview');if(prev)prev.style.display='none';
  showToast('✅ Video lagt til!');
}

function addFlashcard() { setTimeout(updatePublishBarHint,50);
  const front=document.getElementById('fcFront')?.value.trim();
  const back=document.getElementById('fcBack')?.value.trim();
  if(!front||!back){showToast('Fyll inn begrep og definisjon');return;}
  const imgFront=document.getElementById('fcImgFront')?.value.trim()||'';
  const imgBack=document.getElementById('fcImgBack')?.value.trim()||'';
  state.tempFlashcards.push({front,back,imgFront,imgBack});
  ['fcFront','fcBack','fcImgFront','fcImgBack'].forEach(id=>{const el=document.getElementById(id);if(el)el.value='';});
  const pfp=document.getElementById('fcImgFrontPreview');const pbp=document.getElementById('fcImgBackPreview');
  if(pfp)pfp.innerHTML='';if(pbp)pbp.innerHTML='';
  showToast('✅ Flashcard lagt til!');
  const preview=document.getElementById('fcPreview');
  if(preview)preview.innerHTML=`<span style="color:var(--c3);font-weight:800;">✅ ${state.tempFlashcards.length} flashcards totalt</span>`;
}

// ====== FYLL-INN-BLANKS ======
function _previewBlanks() {
  const text = document.getElementById('blankText')?.value || '';
  const count = (text.match(/___/g)||[]).length;
  const hint = document.getElementById('blankPreviewHint');
  if (hint) hint.innerHTML = count > 0 ? `<span style="color:var(--c3);">✅ ${count} felt funnet</span>` : '<span style="color:var(--text-3);">Ingen ___ funnet ennå</span>';
}
function addBlankTask() { setTimeout(updatePublishBarHint, 50);
  const title = document.getElementById('blankTitle')?.value.trim();
  const rawText = document.getElementById('blankText')?.value.trim();
  if (!rawText || !rawText.includes('___')) { showToast('Teksten trenger minst ett ___ felt'); return; }
  // Extract expected answers from ___[answer] syntax, then strip to ___
  const answers = [];
  const text = rawText.replace(/___\[([^\]]*)\]/g, (_, ans) => { answers.push(ans.trim()); return '___'; });
  // Also handle plain ___ with no expected answer
  const plainCount = (text.match(/___/g) || []).length;
  while (answers.length < plainCount) answers.push('');
  state.tempBlanks.push({ title: title || 'Fyll inn', text, answers });
  ['blankTitle', 'blankText'].forEach(id => { const el = document.getElementById(id); if (el) el.value = ''; });
  const hint = document.getElementById('blankPreviewHint'); if (hint) hint.innerHTML = '';
  const preview = document.getElementById('blankPreview');
  if (preview) preview.innerHTML = `<span style="color:var(--c3);font-weight:800;">✅ ${state.tempBlanks.length} fyll-inn-oppgave${state.tempBlanks.length===1?'':'r'} totalt</span>`;
  showToast('✅ Fyll-inn-oppgave lagt til!');
}
function renderBlanksHTML(m) {
  if (!m.blanks?.length) return '<p style="color:var(--text-3);padding:2rem;">Ingen fyll-inn-oppgaver ennå.</p>';
  return m.blanks.map((b, bi) => {
    const parts = b.text.split('___');
    let inputIdx = 0;
    let html = `<div class="discussion-card"><h3 style="font-weight:800;margin-bottom:1rem;">✏️ ${escHtml(b.title||'Fyll inn')}</h3><div class="blank-text">`;
    parts.forEach((part, pi) => {
      html += escHtml(part).replace(/\n/g, '<br>');
      if (pi < parts.length - 1) {
        html += `<input class="blank-input" type="text" id="blank-${bi}-${inputIdx}" data-bi="${bi}" data-ii="${inputIdx}" autocomplete="off" spellcheck="false">`;
        inputIdx++;
      }
    });
    html += `</div>
    <div style="display:flex;gap:0.75rem;margin-top:1rem;flex-wrap:wrap;">
      <button class="btn-save" data-onclick="checkBlanks" data-onclick-args="${JSON.stringify([bi,inputIdx])}">✅ Sjekk svar</button>
      <button class="btn-cancel" data-onclick="resetBlanks" data-onclick-args="${JSON.stringify([bi,inputIdx])}" style="font-size:0.82rem;">🔄 Nullstill</button>
    </div>
    <div id="blank-result-${bi}" style="margin-top:0.75rem;font-size:0.9rem;font-weight:700;"></div></div>`;
    return html;
  }).join('');
}
function checkBlanks(bi, count) {
  const mi = arbState?.moduleIdx ?? state.currentModule;
  const m = state.modules[mi];
  if (!m) return;
  const b = m.blanks[bi];
  if (!b) return;
  const expectedAnswers = b.answers || [];
  let correct = 0, wrong = 0;
  const hasExpected = expectedAnswers.some(a => a);
  for (let ii = 0; ii < count; ii++) {
    const inp = document.getElementById('blank-' + bi + '-' + ii);
    if (!inp) continue;
    const val = inp.value.trim();
    inp.classList.remove('correct','wrong','partial');
    if (!val) { inp.classList.add('wrong'); wrong++; continue; }
    if (hasExpected && expectedAnswers[ii]) {
      // Compare case-insensitively, accept multiple alternatives separated by /
      const alts = expectedAnswers[ii].split('/').map(a => a.trim().toLowerCase());
      if (alts.includes(val.toLowerCase())) { inp.classList.add('correct'); correct++; }
      else { inp.classList.add('wrong'); wrong++; inp.title = 'Riktig svar: ' + expectedAnswers[ii]; }
    } else {
      inp.classList.add('correct'); correct++; // no expected answer → accept any
    }
  }
  // Save to localStorage
  if (state.student || arbState?.moduleIdx != null) {
    const sKey = (state.student?.name || '_guest') + '_m' + mi + '_blank_' + bi;
    const studentAnswers = [];
    for (let ii = 0; ii < count; ii++) {
      studentAnswers.push(document.getElementById('blank-' + bi + '-' + ii)?.value.trim() || '');
    }
    localStorage.setItem('arb_' + sKey, JSON.stringify({ answers: studentAnswers, at: new Date().toISOString() }));
  }
  const res = document.getElementById('blank-result-' + bi);
  if (res) {
    if (hasExpected) {
      const pct = count > 0 ? Math.round((correct / count) * 100) : 0;
      res.innerHTML = correct === count
        ? `<span style="color:var(--c3);">✅ Perfekt! Alle ${count} svar er riktige!</span>`
        : `<span style="color:${correct>0?'var(--yellow)':'var(--c1)'};">${correct}/${count} riktige${wrong>0?' — hover over røde felt for hint':''}.</span>`;
    } else {
      res.innerHTML = `<span style="color:var(--c3);">✅ ${correct} av ${count} felt er fylt ut</span>`;
    }
  }
  arbMarkDone && arbMarkDone('blank');
}
function resetBlanks(bi, count) {
  for (let ii = 0; ii < count; ii++) {
    const inp = document.getElementById('blank-' + bi + '-' + ii);
    if (inp) { inp.value = ''; inp.classList.remove('correct','wrong'); }
  }
  const res = document.getElementById('blank-result-' + bi); if (res) res.innerHTML = '';
}

// ====== MATCHING GAME ======
let _matchState = { selected: null, matched: new Set(), pairs: [] };
function _renderMatchGame(m, container) {
  // Build pairs from flashcards or glossary (max 8 pairs for playability)
  const rawPairs = (m.flashcards?.length >= 2 ? m.flashcards : m.glossary||[]).slice(0, 8).map(fc => ({
    term: fc.front || fc.term || '',
    def: fc.back || fc.def || ''
  })).filter(p => p.term && p.def);
  if (rawPairs.length < 2) { if (container) container.innerHTML = '<p style="padding:2rem;color:var(--text-3);">Ikke nok par for matching-spill.</p>'; return; }
  _matchState = { selected: null, matched: new Set(), pairs: rawPairs };
  const defs = [...rawPairs.map((_,i)=>i)].sort(()=>Math.random()-0.5);
  if (container) container.innerHTML = `<div class="arb-content-card" id="matchGameCard">
    <h2 style="font-family:'Fredoka One',cursive;font-size:1.4rem;color:var(--text);margin-bottom:0.25rem;">🎯 Match begreper</h2>
    <p style="font-size:0.82rem;color:var(--text-3);margin-bottom:1.25rem;">Klikk et begrep, deretter riktig definisjon.</p>
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:0.75rem;" id="matchGrid">
      <div class="match-col" id="matchTerms">
        ${rawPairs.map((p,i) => `<button class="match-item" id="mterm-${i}" data-onclick="_matchClick" data-onclick-args="${JSON.stringify(['term',i])}">${escHtml(p.term)}</button>`).join('')}
      </div>
      <div class="match-col" id="matchDefs">
        ${defs.map((pi,ri) => `<button class="match-item" id="mdef-${ri}" data-pi="${pi}" data-onclick="_matchClick" data-onclick-args="${JSON.stringify(['def',ri])}">${escHtml(rawPairs[pi].def)}</button>`).join('')}
      </div>
    </div>
    <div id="matchResult" style="text-align:center;margin-top:1rem;font-size:0.9rem;font-weight:800;"></div>
  </div>`;
  // store def→pairIdx mapping
  _matchState.defMap = defs;
}
function _matchClick(side, idx) {
  const st = _matchState;
  if (side === 'term') {
    if (st.matched.has('t' + idx)) return;
    // deselect previous term
    if (st.selected?.side === 'term') {
      const prev = document.getElementById('mterm-' + st.selected.idx);
      if (prev) prev.classList.remove('selected');
    }
    st.selected = { side: 'term', idx };
    const el = document.getElementById('mterm-' + idx);
    if (el) el.classList.add('selected');
  } else {
    if (st.matched.has('d' + idx)) return;
    if (!st.selected || st.selected.side !== 'term') return;
    const termIdx = st.selected.idx;
    const pairIdx = st.defMap[idx];
    const termEl = document.getElementById('mterm-' + termIdx);
    const defEl = document.getElementById('mdef-' + idx);
    if (pairIdx === termIdx) {
      // Correct!
      if (termEl) { termEl.classList.remove('selected'); termEl.classList.add('matched'); termEl.disabled = true; }
      if (defEl) { defEl.classList.add('matched'); defEl.disabled = true; }
      st.matched.add('t' + termIdx);
      st.matched.add('d' + idx);
      st.selected = null;
      if (st.matched.size === st.pairs.length * 2) {
        const res = document.getElementById('matchResult');
        if (res) res.innerHTML = '<span style="color:var(--c3);font-size:1.1rem;">🎉 Alle par matchet! Bra jobba!</span>';
        SND.correct && SND.correct(); launchConfetti && launchConfetti();
        arbSave && arbSave('match_done', 'true');
        arbMarkDone('match');
      }
    } else {
      // Wrong!
      if (termEl) termEl.classList.remove('selected');
      if (defEl) { defEl.classList.add('wrong-flash'); setTimeout(() => defEl.classList.remove('wrong-flash'), 500); }
      st.selected = null;
    }
  }
}

// ====== MODUL-MALER ======
function _saveModuleTemplate() {
  const name = document.getElementById('moduleName')?.value.trim() || 'Uten navn';
  const template = {
    name, emoji: document.getElementById('moduleEmoji')?.value || '📚',
    desc: document.getElementById('moduleDesc')?.value.trim() || '',
    text: document.getElementById('moduleText')?.value.trim() || '',
    quiz: [...(state.tempQuiz||[])],
    discussion: [...(state.tempDisc||[])],
    write: [...(state.tempWrite||[])],
    videos: [...(state.tempVideos||[])],
    flashcards: [...(state.tempFlashcards||[])],
    savedAt: new Date().toLocaleString('no')
  };
  const templates = _lsGet('os_module_templates', []);
  templates.unshift(template);
  if (templates.length > 20) templates.splice(20);
  localStorage.setItem('os_module_templates', JSON.stringify(templates));
  showToast('📋 Mal lagret: ' + name);
}
function _loadModuleTemplateModal() {
  const templates = _lsGet('os_module_templates', []);
  if (!templates.length) { showToast('Ingen lagrede maler ennå. Lagre en mal først!'); return; }
  const modal = document.createElement('div');
  modal.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.5);z-index:9999;display:flex;align-items:center;justify-content:center;padding:1rem;';
  modal.innerHTML = `<div style="background:var(--s1);border:1px solid var(--border);border-radius:18px;padding:1.5rem;max-width:480px;width:100%;max-height:80vh;overflow-y:auto;">
    <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:1rem;">
      <h2 style="margin:0;font-size:1rem;font-weight:800;color:var(--text);">📂 Velg mal</h2>
      <button data-hid="${_reg(function(){this.closest('[style*=\"position:fixed\"]').remove()})}" style="background:none;border:none;cursor:pointer;font-size:1.2rem;color:var(--text-2);">✕</button>
    </div>
    ${templates.map((t, ti) => `<div style="background:var(--s2);border:1px solid var(--border);border-radius:12px;padding:0.75rem 1rem;margin-bottom:0.5rem;display:flex;align-items:center;justify-content:space-between;gap:0.5rem;">
      <div style="min-width:0;">
        <div style="font-weight:800;font-size:0.88rem;color:var(--text);">${escHtml(t.emoji||'📚')} ${escHtml(t.name)}</div>
        <div style="font-size:0.72rem;color:var(--text-3);margin-top:2px;">${t.quiz?.length||0} quiz · ${t.flashcards?.length||0} kort · ${t.savedAt||''}</div>
      </div>
      <div style="display:flex;gap:0.35rem;flex-shrink:0;">
        <button data-onclick="_applyTemplateThenClose" data-onclick-self data-onclick-args="${JSON.stringify([ti])}" style="background:var(--accent);color:#fff;border:none;border-radius:8px;padding:5px 12px;font-size:0.8rem;font-weight:800;cursor:pointer;">Last inn</button>
        <button data-onclick="_deleteTemplate" data-onclick-self data-onclick-arg="${ti}" style="background:rgba(239,68,68,0.1);color:#f87171;border:none;border-radius:8px;padding:5px 8px;font-size:0.8rem;font-weight:800;cursor:pointer;">🗑</button>
      </div>
    </div>`).join('')}
  </div>`;
  document.body.appendChild(modal);
  modal.addEventListener('click', e => { if (e.target === modal) modal.remove(); });
}
function _applyModuleTemplate(ti) {
  const templates = _lsGet('os_module_templates', []);
  const t = templates[ti];
  if (!t) return;
  const nameEl = document.getElementById('moduleName'); if (nameEl) nameEl.value = t.name;
  const emojiEl = document.getElementById('moduleEmoji'); if (emojiEl) emojiEl.value = t.emoji||'📚';
  const descEl = document.getElementById('moduleDesc'); if (descEl) descEl.value = t.desc||'';
  const textEl = document.getElementById('moduleText'); if (textEl) textEl.value = t.text||'';
  state.tempQuiz = [...(t.quiz||[])];
  state.tempDisc = [...(t.discussion||[])];
  state.tempWrite = [...(t.write||[])];
  state.tempVideos = [...(t.videos||[])];
  state.tempFlashcards = [...(t.flashcards||[])];
  renderPreviewPanel();
  renderQuizPreview();
  updatePublishBarHint();
  showToast('📂 Mal lastet: ' + t.name);
}

let _savingModule = false;
async function saveModule() {
  if (_savingModule) return; // prevent double-submit
  if (!state.isTeacher) { showToast('⛔ Kun for lærere'); return; }
  const name=document.getElementById('moduleName')?.value.trim();
  if(!name){showToast('Emnet trenger et navn!');return;}
  _savingModule = true;
  const saveBtn = document.querySelector('[onclick*="saveModule"]');
  if (saveBtn) { saveBtn.disabled = true; saveBtn.textContent = '⏳ Lagrer...'; }
  const wasEditing=editingModuleIdx!==null;
  const s = getAiSettings();
  const module={
    _id: wasEditing ? (state.modules[editingModuleIdx]._id||null) : null,
    name, desc:document.getElementById('moduleDesc')?.value.trim()||'',
    emoji:document.getElementById('moduleEmoji')?.value.trim()||'📚',
    text:document.getElementById('moduleText')?.value.trim()||'',
    quiz:[...state.tempQuiz], discussion:[...state.tempDisc],
    write:[...state.tempWrite], videos:[...state.tempVideos], flashcards:[...state.tempFlashcards], blanks:[...state.tempBlanks],
    subject: (document.getElementById('moduleSubjectFree')?.value.trim()) || (document.getElementById('moduleSubjectSelect')?.value) || (document.getElementById('aiSubject')?.value) || '',
    quizTimer: s.quizTimer || 0,
    language: s.language || 'norsk bokmål',
    glossary: [...state.tempGlossary],
    wordleWords: (document.getElementById('moduleWordleWords')?.value.trim().split(',').map(w=>w.trim().toUpperCase()).filter(w=>w.length>=2&&w.length<=8) || []),
    examMode: document.getElementById('examModeToggle')?.checked || false,
    createdAt: wasEditing?state.modules[editingModuleIdx].createdAt:new Date().toLocaleString('no'),
    updatedAt: wasEditing?new Date().toLocaleString('no'):null,
    publishedAt: wasEditing?state.modules[editingModuleIdx].publishedAt:new Date().toISOString(),
    locked: wasEditing?state.modules[editingModuleIdx].locked:false,
    scheduledFor: wasEditing?state.modules[editingModuleIdx].scheduledFor:null
  };
  if(wasEditing){state.modules[editingModuleIdx]=module;}
  else{state.modules.push(module);}
  try {
    await saveModulesToStorage();
    clearModuleForm();
    renderManageModules();
    renderHomeModules();
    renderTaskModules();
    updateContinueCard();
    showToast(wasEditing?`✅ Endringer lagret i «${name}»!`:`🎉 «${name}» er publisert for elevene!`);
    trTab('emner');
  } finally {
    _savingModule = false;
    const saveBtnAfter = document.querySelector('[onclick*="saveModule"]');
    if (saveBtnAfter) { saveBtnAfter.disabled = false; saveBtnAfter.textContent = wasEditing ? '💾 Lagre endringer' : '🚀 Publiser emne'; }
  }
}

function clearModuleForm() {
  state.tempQuiz=[];state.tempDisc=[];state.tempWrite=[];state.tempVideos=[];state.tempFlashcards=[];state.tempBlanks=[];state.tempGlossary=[];
  const emTog=document.getElementById('examModeToggle');if(emTog)emTog.checked=false;
  _renderGlossPreview();
  ['moduleName','moduleDesc','moduleText','moduleSubjectFree','moduleWordleWords','blankTitle','blankText'].forEach(id=>{const el=document.getElementById(id);if(el)el.value='';});
  const emojiEl=document.getElementById('moduleEmoji');if(emojiEl)emojiEl.value='📚';
  const subjSel=document.getElementById('moduleSubjectSelect');if(subjSel)subjSel.value='';
  ['quizPreview','discPreview','fcPreview','blankPreview'].forEach(id=>{const el=document.getElementById(id);if(el)el.innerHTML='';});
  const saveLabel=document.getElementById('saveModuleLabel');if(saveLabel)saveLabel.textContent='💾 Publiser emnet for elevene!';
  const cancelBtn=document.getElementById('cancelEditBtn');if(cancelBtn)cancelBtn.style.display='none';
  const banner=document.getElementById('editingBanner');if(banner)banner.style.display='none';
  editingModuleIdx=null;
  renderPreviewPanel();
  updatePublishBarHint();
}

function cancelEditModule(){clearModuleForm();}

function quickEditModule(idx){showView('teacher');setTimeout(()=>editModule(idx),80);}

function editModule(idx) {
  const m=state.modules[idx];
  editingModuleIdx=idx;
  trTab('new');
  document.getElementById('moduleName').value=m.name||'';
  document.getElementById('moduleDesc').value=m.desc||'';
  document.getElementById('moduleEmoji').value=m.emoji||'📚';
  document.getElementById('moduleText').value=m.text||'';
  // Fyll fagfelt
  const subjectSel = document.getElementById('moduleSubjectSelect');
  const subjectFree = document.getElementById('moduleSubjectFree');
  if (subjectSel && subjectFree) {
    const knownOptions = Array.from(subjectSel.options).map(o=>o.value);
    if (knownOptions.includes(m.subject||'')) { subjectSel.value=m.subject||''; subjectFree.value=''; }
    else { subjectSel.value=''; subjectFree.value=m.subject||''; }
  }
  state.tempQuiz=JSON.parse(JSON.stringify(m.quiz||[]));
  state.tempDisc=JSON.parse(JSON.stringify(m.discussion||[]));
  state.tempWrite=JSON.parse(JSON.stringify(m.write||[]));
  state.tempVideos=JSON.parse(JSON.stringify(m.videos||[]));
  state.tempFlashcards=JSON.parse(JSON.stringify(m.flashcards||[]));
  state.tempBlanks=JSON.parse(JSON.stringify(m.blanks||[]));
  state.tempGlossary=JSON.parse(JSON.stringify(m.glossary||[]));
  const wordleWordsEl=document.getElementById('moduleWordleWords');if(wordleWordsEl)wordleWordsEl.value=(m.wordleWords||[]).join(', ');
  const emTog=document.getElementById('examModeToggle');if(emTog)emTog.checked=m.examMode||false;
  _renderGlossPreview();
  const saveLabel=document.getElementById('saveModuleLabel');if(saveLabel)saveLabel.textContent='💾 Lagre endringer';
  const cancelBtn=document.getElementById('cancelEditBtn');if(cancelBtn)cancelBtn.style.display='inline-flex';
  const banner=document.getElementById('editingBanner');
  if(banner){banner.style.display='flex';const bn=document.getElementById('editingBannerName');if(bn)bn.textContent=m.name;}
  renderPreviewPanel();
  updatePublishBarHint();
  document.getElementById('view-teacher').scrollIntoView({behavior:'smooth',block:'start'});
  showToast('✏️ Redigerer «'+m.name+'»');
}

async function duplicateModule(idx) {
  const m = state.modules[idx];
  const copy = JSON.parse(JSON.stringify(m));
  copy._id = null;
  copy.name = m.name + ' (kopi)';
  copy.createdAt = new Date().toLocaleString('no');
  copy.updatedAt = null;
  copy.publishedAt = new Date().toISOString();
  state.modules.splice(idx + 1, 0, copy);
  await saveModulesToStorage();
  renderManageModules();
  renderHomeModules();
  renderTaskModules();
  showToast('📋 «' + m.name + '» er kopiert!');
}

async function moveModuleUp(idx) {
  if (!state.isTeacher) { showToast('⛔ Kun for lærere'); return; }
  if (idx === 0) return;
  [state.modules[idx-1], state.modules[idx]] = [state.modules[idx], state.modules[idx-1]];
  await saveModulesToStorage();
  renderManageModules();
  renderHomeModules();
  renderTaskModules();
}

async function moveModuleDown(idx) {
  if (!state.isTeacher) { showToast('⛔ Kun for lærere'); return; }
  if (idx >= state.modules.length - 1) return;
  [state.modules[idx+1], state.modules[idx]] = [state.modules[idx], state.modules[idx+1]];
  await saveModulesToStorage();
  renderManageModules();
  renderHomeModules();
  renderTaskModules();
}

async function deleteModule(idx) {
  if (!state.isTeacher) { showToast('⛔ Kun for lærere'); return; }
  const m = state.modules[idx];
  if (editingModuleIdx === idx) clearModuleForm();
  // Soft-delete: remove from list immediately, allow undo for 5 seconds
  state.modules.splice(idx, 1);
  localStorage.setItem('lh_modules', JSON.stringify(state.modules));
  renderManageModules(); renderHomeModules(); renderTaskModules(); updateContinueCard();
  let undone = false;
  _showUndoToast(`🗑 «${m.name}» slettet`, () => {
    undone = true;
    state.modules.splice(idx, 0, m);
    localStorage.setItem('lh_modules', JSON.stringify(state.modules));
    renderManageModules(); renderHomeModules(); renderTaskModules(); updateContinueCard();
    showToast('↩️ Sletting angret!');
  }, 5000);
  // After 5s, actually delete from Supabase if not undone
  setTimeout(async () => {
    if (!undone && m._id) await DB.deleteModule(m._id);
  }, 5200);
}

function toggleLock(idx) {
  if (!state.isTeacher) { showToast('⛔ Kun for lærere'); return; }
  state.modules[idx].locked=!state.modules[idx].locked;
  if (!state.modules[idx].locked) state.modules[idx].scheduledFor = null;
  saveModulesToStorage();
  renderManageModules();
  renderHomeModules();
  renderTaskModules();
  updateContinueCard();
  showToast(state.modules[idx].locked?'🔒 Emnet er låst':'🔓 Emnet er åpnet');
}

function setScheduled(idx, dtVal) {
  if (!state.isTeacher) { showToast('⛔ Kun for lærere'); return; }
  state.modules[idx].scheduledFor = dtVal || null;
  state.modules[idx].locked = !!dtVal;
  saveModulesToStorage();
  renderManageModules();
  renderHomeModules();
  renderTaskModules();
  if (dtVal) showToast('🕒 Planlagt: ' + new Date(dtVal).toLocaleString('no'));
  else showToast('🗓 Planlegging fjernet');
}

function _checkScheduled() {
  const now = Date.now();
  let changed = false;
  state.modules.forEach(m => {
    if (m.scheduledFor && new Date(m.scheduledFor).getTime() <= now && m.locked) {
      m.locked = false; changed = true;
    }
  });
  if (changed) saveModulesToStorage();
}

function isNewModule(m){return m.publishedAt&&(Date.now()-new Date(m.publishedAt).getTime())<3*24*3600*1000;}

// ── KUNNGJØRINGER ─────────────────────────────────────────────────
const ANNOUNCE_KEY = 'os_announcement';

function saveAnnouncement() {
  const text = document.getElementById('announcementText')?.value.trim();
  const type = document.getElementById('announcementType')?.value || 'info';
  if (!text) { showToast('Skriv en beskjed først!'); return; }
  const obj = { text, type, date: new Date().toLocaleString('no') };
  DB.saveFeedback(ANNOUNCE_KEY, JSON.stringify(obj));
  localStorage.setItem(ANNOUNCE_KEY, JSON.stringify(obj));
  showToast('📢 Kunngjøring sendt til alle elever!');
  loadAnnouncementEditor();
}

function showAnnouncementPreview() {
  const text = document.getElementById('announcementText')?.value.trim();
  const type = document.getElementById('announcementType')?.value || 'info';
  const prev = document.getElementById('announcementPreview');
  if (!prev) return;
  if (!text) { prev.style.display = 'none'; return; }
  const icons = { info: 'ℹ️', viktig: '⚠️', bra: '🎉' };
  const colors = { info: 'rgba(123,143,253,0.1)', viktig: 'rgba(239,68,68,0.1)', bra: 'rgba(34,197,94,0.1)' };
  const borders = { info: 'rgba(123,143,253,0.3)', viktig: 'rgba(239,68,68,0.3)', bra: 'rgba(34,197,94,0.3)' };
  prev.style.display = 'block';
  prev.style.background = colors[type] || colors.info;
  prev.style.borderColor = borders[type] || borders.info;
  prev.innerHTML = `<span style="margin-right:0.4rem;">${icons[type]||'ℹ️'}</span>${escHtml(text)}`;
}

function clearAnnouncement() {
  _showConfirm('Fjerne kunngjøringen?', () => {
    DB.deleteFeedback(ANNOUNCE_KEY);
    localStorage.removeItem(ANNOUNCE_KEY);
    const ta = document.getElementById('announcementText');
    if (ta) ta.value = '';
    const prev = document.getElementById('announcementPreview');
    if (prev) { prev.style.display='none'; prev.innerHTML=''; }
    const status = document.getElementById('announcementStatus');
    if (status) status.textContent = 'Kunngjøringen er fjernet.';
    showToast('🗑 Kunngjøring fjernet');
    hideAnnouncementBanner();
  }, 'Fjern', 'var(--c1)');
}

async function loadAnnouncementEditor() {
  const ta = document.getElementById('announcementText');
  const prev = document.getElementById('announcementPreview');
  const status = document.getElementById('announcementStatus');
  const rows = await DB.loadFeedback(ANNOUNCE_KEY);
  let obj = null;
  if (rows) { try { obj = JSON.parse(rows); } catch {} }
  if (!obj) { obj = _lsGet(ANNOUNCE_KEY, null); }
  if (obj && ta) {
    ta.value = obj.text || '';
    const sel = document.getElementById('announcementType');
    if (sel) sel.value = obj.type || 'info';
    if (prev) { prev.style.display='block'; prev.innerHTML = formatAnnouncementBanner(obj); }
    if (status) status.textContent = 'Sist oppdatert: ' + (obj.date||'');
  }
}

function formatAnnouncementBanner(obj) {
  const styles = {
    info:    'background:#eff6ff;border-left:5px solid #3b82f6;color:#1e40af;',
    viktig:  'background:rgba(245,158,11,0.12);border-left:3px solid #f97316;color:#fbbf24;',
    bra:     'background:#f0fdf4;border-left:5px solid #22c55e;color:#166534;'
  };
  const icons = { info:'ℹ️', viktig:'⚠️', bra:'🎉' };
  const s = styles[obj.type]||styles.info;
  const i = icons[obj.type]||'ℹ️';
  return `<div style="${s}padding:0.875rem 1.25rem;border-radius:10px;font-weight:700;font-size:0.92rem;">${i} ${escHtml(obj.text)}</div>`;
}

async function checkAndShowAnnouncement() {
  // Vis kunngjøring til elever
  const rows = await DB.loadFeedback(ANNOUNCE_KEY);
  let obj = null;
  if (rows) { try { obj = JSON.parse(rows); } catch {} }
  if (!obj) { obj = _lsGet(ANNOUNCE_KEY, null); }
  const banner = document.getElementById('announcementBanner');
  if (!banner) return;
  if (obj && obj.text) {
    banner.innerHTML = formatAnnouncementBanner(obj);
    banner.style.display = 'block';
  } else {
    banner.style.display = 'none';
  }
}

function hideAnnouncementBanner() {
  const banner = document.getElementById('announcementBanner');
  if (banner) banner.style.display = 'none';
}

function renderManageModules() {
  const container=document.getElementById('manageModulesList');
  if(!container)return;
  if(!state.modules.length){container.innerHTML='<p style="color:var(--text-3);">Ingen emner publisert ennå.</p>';return;}
  container.innerHTML=state.modules.map((m,i)=>`
    <div class="module-manage-card">
      <div style="font-size:2rem;flex-shrink:0;">${m.emoji||'📚'}</div>
      <div class="module-manage-info">
        <div class="module-manage-name">${escHtml(m.name)}</div>
        <div class="module-manage-meta">
          ${m.quiz?.length||0} quiz · ${m.discussion?.length||0} drøfting · ${m.flashcards?.length||0} flashcards · ${m.write?.length||0} skriveoppgaver
          ${m.updatedAt?' · ✏️ Redigert '+m.updatedAt:''}
          ${m.locked&&m.scheduledFor?' · <span class="sched-badge">🕒 Publiseres '+new Date(m.scheduledFor).toLocaleString('no')+'</span>':m.locked?' · 🔒 Låst':''}
          ${isNewModule(m)?' · <span style="color:var(--c1);font-weight:800;">NY</span>':''}
        </div>
        <div style="margin-top:0.4rem;display:flex;align-items:center;gap:0.5rem;flex-wrap:wrap;">
          <span style="font-size:0.72rem;font-weight:800;color:var(--text-3);">🕒 Planlegg publisering:</span>
          <input type="datetime-local" id="sched-${i}" value="${m.scheduledFor||''}" data-onchange="_setScheduledEl" data-onchange-arg="${i}" style="font-family:'Nunito',sans-serif;font-size:0.75rem;border:1px solid var(--border-2);border-radius:7px;padding:3px 7px;background:var(--s2);color:var(--text);outline:none;" />
          ${m.scheduledFor?`<button data-hid="${_reg(function(){setScheduled(i,'')})}" style="background:none;border:none;cursor:pointer;color:var(--text-3);font-size:0.8rem;" title="Fjern planlegging">✕</button>`:''}
        </div>
      </div>
      <div class="module-manage-actions">
        <div style="display:flex;flex-direction:column;gap:2px;flex-shrink:0;">
          <button data-onclick="moveModuleUp" data-onclick-arg="${i}" title="Flytt opp" ${i===0?'disabled':''} style="background:var(--s2);border:1px solid var(--border-2);color:var(--text-2);border-radius:6px;width:28px;height:28px;font-size:0.75rem;cursor:pointer;font-family:'Nunito',sans-serif;${i===0?'opacity:0.3;':''}" aria-label="Flytt opp">▲</button>
          <button data-onclick="moveModuleDown" data-onclick-arg="${i}" title="Flytt ned" ${i===state.modules.length-1?'disabled':''} style="background:var(--s2);border:1px solid var(--border-2);color:var(--text-2);border-radius:6px;width:28px;height:28px;font-size:0.75rem;cursor:pointer;font-family:'Nunito',sans-serif;${i===state.modules.length-1?'opacity:0.3;':''}" aria-label="Flytt ned">▼</button>
        </div>
        <button class="pv-edit-btn" style="font-size:0.85rem;padding:8px 14px;" data-onclick="editModule" data-onclick-arg="${i}">✏️ Rediger</button>
        <button data-onclick="duplicateModule" data-onclick-arg="${i}" title="Kopier emnet" style="background:var(--s2);border:1px solid var(--border-2);color:var(--text-2);padding:8px 12px;border-radius:7px;font-size:0.82rem;font-weight:800;cursor:pointer;font-family:'Nunito',sans-serif;">📋 Kopier</button>
        <button data-onclick="toggleLock" data-onclick-arg="${i}" style="background:${m.locked?'var(--c3)':'var(--s2)'};color:${m.locked?'white':'var(--text-2)'};border:1px solid var(--border-2);padding:8px 12px;border-radius:7px;font-size:0.82rem;font-weight:800;cursor:pointer;font-family:'Nunito',sans-serif;">${m.locked?'🔓 Åpne':'🔒 Lås'}</button>
        <button class="pv-del-btn" style="font-size:0.85rem;padding:8px 14px;" data-onclick="deleteModule" data-onclick-arg="${i}">🗑 Slett</button>
      </div>
    </div>`).join('');
}

// ====== PREVIEW PANEL ======
function renderPreviewPanel() {
  const panel=document.getElementById('previewContent');
  if(!panel)return;
  const total=state.tempQuiz.length+state.tempDisc.length+state.tempWrite.length+state.tempVideos.length+state.tempFlashcards.length;
  const totEl=document.getElementById('previewTotals');
  if(totEl)totEl.textContent=total?`${total} oppgaver totalt`:'';
  if(!total){panel.innerHTML='<p style="color:var(--text-3);font-size:0.95rem;padding:1rem 0;">Legg til oppgaver i fanene over – de vises her.</p>';return;}
  let html='';
  if(state.tempQuiz.length){
    html+=`<div class="preview-section"><div class="preview-section-title">❓ Quiz (${state.tempQuiz.length})</div>`;
    state.tempQuiz.forEach((q,i)=>{html+=`<div class="preview-item" id="pvq-${i}">
      <div class="preview-item-content"><div style="font-weight:700;font-size:0.9rem;">${escHtml(q.question)}</div>
      <div style="font-size:0.78rem;color:var(--text-3);margin-top:0.2rem;">✅ ${escHtml(q.a)} / ❌ ${escHtml(q.b)}</div></div>
      <div class="preview-item-actions">
        <button class="pv-edit-btn" data-onclick="pvEditQuiz" data-onclick-arg="${i}">✏️</button>
        <button class="pv-del-btn" data-onclick="pvDelQuiz" data-onclick-arg="${i}">🗑</button>
      </div></div>`;});
    html+='</div>';
  }
  if(state.tempDisc.length){
    html+=`<div class="preview-section"><div class="preview-section-title">💬 Drøfting (${state.tempDisc.length})</div>`;
    state.tempDisc.forEach((d,i)=>{html+=`<div class="preview-item" id="pvd-${i}">
      <div class="preview-item-content"><div style="font-size:0.9rem;">${escHtml(d)}</div></div>
      <div class="preview-item-actions">
        <button class="pv-edit-btn" data-onclick="pvEditDisc" data-onclick-arg="${i}">✏️</button>
        <button class="pv-del-btn" data-onclick="pvDelDisc" data-onclick-arg="${i}">🗑</button>
      </div></div>`;});
    html+='</div>';
  }
  if(state.tempWrite.length){
    html+=`<div class="preview-section"><div class="preview-section-title">✍️ Skriveoppgaver (${state.tempWrite.length})</div>`;
    state.tempWrite.forEach((w,i)=>{html+=`<div class="preview-item" id="pvw-${i}">
      <div class="preview-item-content"><div style="font-weight:700;font-size:0.9rem;">${escHtml(w.title)}</div></div>
      <div class="preview-item-actions">
        <button class="pv-edit-btn" data-onclick="pvEditWrite" data-onclick-arg="${i}">✏️</button>
        <button class="pv-del-btn" data-onclick="pvDelWrite" data-onclick-arg="${i}">🗑</button>
      </div></div>`;});
    html+='</div>';
  }
  if(state.tempVideos.length){
    html+=`<div class="preview-section"><div class="preview-section-title">🎬 Videoer (${state.tempVideos.length})</div>`;
    state.tempVideos.forEach((v,i)=>{
      const ytId=getYtId(v.url);
      html+=`<div class="preview-item" id="pvv-${i}" style="flex-direction:column;align-items:stretch;">
        <div style="display:flex;align-items:flex-start;gap:0.75rem;">
          <div style="flex:1;min-width:0;"><div style="font-weight:700;font-size:0.9rem;">🎬 ${escHtml(v.title)}</div>
          ${ytId?`<div style="font-size:0.75rem;color:var(--c4);margin-top:0.2rem;">YouTube: ${ytId}</div>`:''}
          </div>
          <div style="display:flex;gap:0.35rem;flex-shrink:0;">
            ${ytId?`<button class="pv-edit-btn" style="background:var(--c3);" data-onclick="_toggleVideoEmbedEl" data-onclick-args='["pvembed-${i}","${ytId}"]'>▶</button>`:''}
            <button class="pv-edit-btn" data-onclick="pvEditVideo" data-onclick-arg="${i}">✏️</button>
            <button class="pv-del-btn" data-onclick="pvDelVideo" data-onclick-arg="${i}">🗑</button>
          </div>
        </div>
        ${ytId?`<div id="pvembed-${i}" style="display:none;margin-top:0.5rem;"><iframe width="100%" height="200" src="https://www.youtube.com/embed/${ytId}" frameborder="0" allowfullscreen style="border-radius:10px;display:block;"></iframe></div>`:''}
      </div>`;});
    html+='</div>';
  }
  if(state.tempFlashcards.length){
    html+=`<div class="preview-section"><div class="preview-section-title">🃏 Flashcards (${state.tempFlashcards.length})</div>`;
    state.tempFlashcards.forEach((f,i)=>{html+=`<div class="preview-item" id="pvf-${i}">
      <div class="preview-item-content" style="font-size:0.88rem;"><b>${escHtml(f.front)}</b> → ${escHtml(f.back)}</div>
      <div class="preview-item-actions">
        <button class="pv-edit-btn" data-onclick="pvEditFlash" data-onclick-arg="${i}">✏️</button>
        <button class="pv-del-btn" data-onclick="pvDelFlash" data-onclick-arg="${i}">🗑</button>
      </div></div>`;});
    html+='</div>';
  }
  panel.innerHTML=html;
}

function escHtml(str){return sanitizeHTML(str);}
function _lsGet(key, fallback) { try { return JSON.parse(localStorage.getItem(key) ?? JSON.stringify(fallback)); } catch { return fallback; } }

// Debounce utility — prevents excessive re-renders on rapid input
function _debounce(fn, ms = 200) {
  let t;
  return function(...args) { clearTimeout(t); t = setTimeout(() => fn.apply(this, args), ms); };
}

// Lazy-load a UMD library on first use
function _loadScript(url) {
  return new Promise((resolve, reject) => {
    if (document.querySelector('script[src="' + url + '"]')) { resolve(); return; }
    const s = document.createElement('script');
    s.src = url; s.onload = resolve; s.onerror = () => reject(new Error('Kunne ikke laste bibliotek: ' + url));
    document.head.appendChild(s);
  });
}
const _CDN_MAMMOTH   = 'https://cdnjs.cloudflare.com/ajax/libs/mammoth/1.6.0/mammoth.browser.min.js';
const _CDN_JSZIP     = 'https://cdnjs.cloudflare.com/ajax/libs/jszip/3.10.1/jszip.min.js';
const _CDN_HTML2CANV = 'https://cdnjs.cloudflare.com/ajax/libs/html2canvas/1.4.1/html2canvas.min.js';
const _CDN_PDFJS     = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js';
function _updateCharCount(inputId, maxLen) {
  const el = document.getElementById(inputId);
  const cc = document.getElementById(inputId + '-cc');
  if (!el || !cc) return;
  const len = el.value.length;
  const pct = len / maxLen;
  cc.textContent = len + '/' + maxLen;
  cc.style.color = pct > 0.9 ? '#f87171' : pct > 0.75 ? '#f59e0b' : 'var(--text-3)';
}

function pvDelQuiz(i){_showConfirm('Slette dette quizspørsmålet?',()=>{state.tempQuiz.splice(i,1);renderPreviewPanel();updatePublishBarHint();});}
function pvDelDisc(i){_showConfirm('Slette dette drøftingsspørsmålet?',()=>{state.tempDisc.splice(i,1);renderPreviewPanel();updatePublishBarHint();});}
function pvDelWrite(i){_showConfirm('Slette denne skriveoppgaven?',()=>{state.tempWrite.splice(i,1);renderPreviewPanel();updatePublishBarHint();});}
function pvDelVideo(i){_showConfirm('Slette denne videoen?',()=>{state.tempVideos.splice(i,1);renderPreviewPanel();updatePublishBarHint();});}
function pvDelFlash(i){_showConfirm('Slette dette flashkortet?',()=>{state.tempFlashcards.splice(i,1);renderPreviewPanel();updatePublishBarHint();});}

function pvEditQuiz(i){const q=state.tempQuiz[i];document.getElementById('quizQ').value=q.question;document.getElementById('quizA').value=q.a;document.getElementById('quizB').value=q.b;document.getElementById('quizC').value=q.c;document.getElementById('quizD').value=q.d;document.getElementById('quizExplain').value=q.explain||'';state.tempQuiz.splice(i,1);tcTab('quiz');renderPreviewPanel();}
function pvEditDisc(i){const d=state.tempDisc[i];document.getElementById('discQ').value=d;state.tempDisc.splice(i,1);tcTab('disc');renderPreviewPanel();}
function pvEditWrite(i){const w=state.tempWrite[i];document.getElementById('writeTitle').value=w.title;document.getElementById('writeDesc').value=w.desc;document.getElementById('writeMin').value=w.minWords||100;state.tempWrite.splice(i,1);tcTab('write');renderPreviewPanel();}
function pvEditVideo(i){const v=state.tempVideos[i];document.getElementById('videoTitle').value=v.title;document.getElementById('videoUrl').value=v.url;document.getElementById('videoTask').value=v.task||'';state.tempVideos.splice(i,1);tcTab('video');previewManualVideo();renderPreviewPanel();}
function pvEditFlash(i){const f=state.tempFlashcards[i];document.getElementById('fcFront').value=f.front;document.getElementById('fcBack').value=f.back;state.tempFlashcards.splice(i,1);tcTab('fc');renderPreviewPanel();}

// ====== VIDEO HELPERS ======
function isValidYoutubeUrl(url) {
  try {
    const u = new URL(url);
    return ['youtube.com', 'www.youtube.com', 'youtu.be'].includes(u.hostname);
  } catch { return false; }
}
function getYtId(url){
  if(!url || !isValidYoutubeUrl(url)) return null;
  const m=url.match(/(?:youtube\.com\/(?:watch\?v=|embed\/|shorts\/)|youtu\.be\/)([A-Za-z0-9_-]{11})/);
  return m?m[1]:null;
}
function toggleVideoEmbed(divId,ytId){const el=document.getElementById(divId);if(el)el.style.display=el.style.display==='none'?'block':'none';}
function previewManualVideo(){
  const url=document.getElementById('videoUrl')?.value.trim();
  const previewDiv=document.getElementById('manualVideoPreview');
  if(!previewDiv)return;
  const ytId=getYtId(url);
  if(ytId){
    previewDiv.style.display='block';
    previewDiv.innerHTML=`<div style="background:var(--s2);border-radius:10px;padding:0.75rem;border:2px solid var(--c3);"><div style="font-size:0.8rem;font-weight:800;color:var(--c3);margin-bottom:0.5rem;">✅ YouTube-video gjenkjent:</div><iframe width="100%" height="220" src="https://www.youtube.com/embed/${ytId}" frameborder="0" allowfullscreen style="border-radius:10px;display:block;"></iframe></div>`;
  }else if(url&&url.length>8){previewDiv.style.display='block';previewDiv.innerHTML=`<div style="font-size:0.8rem;color:var(--text-3);padding:0.5rem;">🔗 Lenke registrert (ikke YouTube)</div>`;}
  else{previewDiv.style.display='none';}
}
function svToggleEmbed(divId,ytId){const el=document.getElementById(divId);if(el)el.style.display=el.style.display==='none'?'block':'none';}

// ====== RESULTS ======
function renderResults() {
  const container=document.getElementById('resultsContainer');
  if(!container)return;
  const allAnswers={};
  for(let i=0;i<localStorage.length;i++){const k=localStorage.key(i);if(k&&k.startsWith('arb_')&&!k.includes('_done_'))allAnswers[k]=localStorage.getItem(k);}
  const combined={...state.studentAnswers,...allAnswers};
  const students={};
  Object.entries(combined).forEach(([k,v])=>{
    const parts=k.split('_m');
    const name=parts[0].replace(/^arb_/,'');
    if(!name)return;
    if(!students[name])students[name]=[];
    students[name].push({key:k,val:typeof v==='object'?v.val:v,correct:typeof v==='object'?v.correct:false});
  });
  const roster=getRosterSync();
  roster.forEach(r=>{if(!students[r.name])students[r.name]=[];});
  const statsRow=document.getElementById('resultStatsRow');
  if(statsRow){
    const numStudents=Object.keys(students).length;
    const numAnswers=Object.values(students).flat().length;
    statsRow.innerHTML=`
      <div style="background:linear-gradient(135deg,#eff6ff,#dbeafe);border-radius:12px;padding:0.875rem 1.25rem;flex:1;min-width:120px;"><div style="font-size:1.6rem;font-weight:800;color:var(--c4);">${numStudents}</div><div style="font-size:0.78rem;color:var(--text-2);font-weight:700;">Elever</div></div>
      <div style="background:linear-gradient(135deg,#f0fdf4,#dcfce7);border-radius:12px;padding:0.875rem 1.25rem;flex:1;min-width:120px;"><div style="font-size:1.6rem;font-weight:800;color:var(--c3);">${state.modules.length}</div><div style="font-size:0.78rem;color:var(--text-2);font-weight:700;">Emner</div></div>
      <div style="background:linear-gradient(135deg,#fdf4ff,#fce7ff);border-radius:12px;padding:0.875rem 1.25rem;flex:1;min-width:120px;"><div style="font-size:1.6rem;font-weight:800;color:var(--c5);">${numAnswers}</div><div style="font-size:0.78rem;color:var(--text-2);font-weight:700;">Totale svar</div></div>`;
  }
  if(!Object.keys(students).length){
    container.innerHTML='<p style="color:var(--text-3);">Ingen svar registrert ennå.</p>';
    return;
  }
  container.innerHTML = '';
  const searchInput = document.createElement('input');
  searchInput.type = 'text';
  searchInput.id = 'studentResultSearch';
  searchInput.placeholder = '🔍 Filtrer elev...';
  searchInput.style.cssText = "width:100%;padding:9px 16px;border:1px solid var(--border-2);border-radius:50px;font-family:'Nunito',sans-serif;font-size:0.88rem;outline:none;background:var(--s2);color:var(--text);box-sizing:border-box;margin-bottom:0.875rem;";
  searchInput.addEventListener('input', _debounce(filterStudentResults, 180));
  container.appendChild(searchInput);
  Object.entries(students).forEach(([name,answers], idx) => {
    const row = document.createElement('div');
    row.className = 'student-result-row';
    row.dataset.name = String(name || '').toLowerCase();
    row.style.cssText = 'border:1px solid var(--border);border-radius:14px;margin-bottom:0.75rem;overflow:hidden;';

    const header = document.createElement('div');
    const detailId = 'sr-' + idx;
    header.style.cssText = 'display:flex;align-items:center;justify-content:space-between;padding:0.875rem 1rem;cursor:pointer;background:var(--s2);';
    header.addEventListener('click', () => toggleStudentResults(detailId));

    const left = document.createElement('div');
    const nameEl = document.createElement('div');
    nameEl.style.cssText = 'font-weight:800;color:var(--text);';
    nameEl.textContent = '👤 ' + name;
    const countEl = document.createElement('div');
    countEl.style.cssText = 'font-size:0.78rem;color:var(--text-3);';
    countEl.textContent = answers.length + ' svar';
    left.appendChild(nameEl);
    left.appendChild(countEl);

    const right = document.createElement('div');
    right.style.cssText = 'display:flex;gap:0.4rem;align-items:center;';
    const exportBtn = document.createElement('button');
    exportBtn.textContent = '📋 txt';
    exportBtn.style.cssText = "background:var(--c4);color:white;border:none;padding:5px 10px;border-radius:50px;font-family:'Nunito',sans-serif;font-weight:800;font-size:0.75rem;cursor:pointer;";
    exportBtn.addEventListener('click', (e) => { e.stopPropagation(); exportStudentAnswersTxt(name); });
    const caret = document.createElement('span');
    caret.style.cssText = 'color:var(--text-3);font-size:1rem;';
    caret.textContent = '▼';
    right.appendChild(exportBtn);
    right.appendChild(caret);

    header.appendChild(left);
    header.appendChild(right);

    const detail = document.createElement('div');
    detail.id = detailId;
    detail.style.cssText = 'display:none;padding:0.875rem 1rem;background:var(--s1);border-top:1px solid var(--border);';
    if (!answers.length) {
      const p = document.createElement('p');
      p.style.cssText = 'color:var(--text-3);font-size:0.88rem;';
      p.textContent = 'Ingen svar ennå.';
      detail.appendChild(p);
    } else {
      answers.forEach(a => {
        const item = document.createElement('div');
        item.style.cssText = 'font-size:0.85rem;color:var(--text-2);padding:0.4rem 0;border-bottom:1px solid var(--border);';
        item.textContent = a.key.split('_').slice(-2).join('_') + ': ' + String(a.val).substring(0,120);
        detail.appendChild(item);
      });
    }
    row.appendChild(header);
    row.appendChild(detail);
    container.appendChild(row);
  });
}

function toggleStudentResults(id){const el=document.getElementById(id);if(el)el.style.display=el.style.display==='none'?'block':'none';}

function filterStudentResults() {
  const q = (document.getElementById('studentResultSearch')?.value || '').toLowerCase();
  document.querySelectorAll('.student-result-row').forEach(row => {
    row.style.display = (row.dataset.name || '').includes(q) ? '' : 'none';
  });
}

// ====== INNBOKS: SKRIVEOPPGAVE-INNLEVERINGER ======
async function renderWriteInbox() {
  if (!state.isTeacher) return;
  const container = document.getElementById('inboxContainer');
  const statsRow = document.getElementById('inboxStatsRow');
  const modFilter = document.getElementById('inboxFilterModule');
  const statusFilter = document.getElementById('inboxFilterStatus')?.value || '';
  if (!container) return;

  // Populate module filter
  if (modFilter && modFilter.options.length === 1) {
    state.modules.forEach((m, mi) => {
      if (m.write?.length) {
        const opt = document.createElement('option');
        opt.value = mi;
        opt.textContent = (m.emoji||'📚') + ' ' + m.name;
        modFilter.appendChild(opt);
      }
    });
  }
  const modFilterVal = modFilter?.value;

  // Collect all write answers from studentAnswers
  const inbox = [];
  const allAnswers = state.studentAnswers;
  Object.entries(allAnswers).forEach(([key, val]) => {
    const m = key.match(/^(.+)_m(\d+)_write_(\d+)$/);
    if (!m) return;
    const [, studentName, miStr, wiStr] = m;
    const mi = parseInt(miStr), wi = parseInt(wiStr);
    if (modFilterVal !== '' && modFilterVal !== undefined && parseInt(modFilterVal) !== mi) return;
    const mod = state.modules[mi];
    if (!mod?.write?.[wi]) return;
    const text = typeof val === 'object' ? val.val : val;
    if (!text || text.toString().trim().length < 3) return;
    const fbKey = 'af_' + key;
    const feedback = localStorage.getItem(fbKey) || '';
    if (statusFilter === 'unread' && feedback) return;
    if (statusFilter === 'read' && !feedback) return;
    inbox.push({ key, studentName, mi, wi, mod, task: mod.write[wi], text: text.toString(), feedback, time: typeof val === 'object' ? val.time : '' });
  });

  inbox.sort((a, b) => (b.time||'').localeCompare(a.time||''));

  const total = inbox.length;
  const unread = inbox.filter(i => !i.feedback).length;
  if (statsRow) statsRow.innerHTML = `
    <div style="background:linear-gradient(135deg,rgba(239,68,68,0.1),rgba(239,68,68,0.05));border:1px solid rgba(239,68,68,0.2);border-radius:12px;padding:0.75rem 1.25rem;flex:1;min-width:100px;text-align:center;"><div style="font-size:1.5rem;font-weight:800;color:var(--c1);">${unread}</div><div style="font-size:0.75rem;color:var(--text-2);font-weight:700;">Venter svar</div></div>
    <div style="background:linear-gradient(135deg,rgba(34,197,94,0.1),rgba(34,197,94,0.05));border:1px solid rgba(34,197,94,0.2);border-radius:12px;padding:0.75rem 1.25rem;flex:1;min-width:100px;text-align:center;"><div style="font-size:1.5rem;font-weight:800;color:var(--c3);">${total-unread}</div><div style="font-size:0.75rem;color:var(--text-2);font-weight:700;">Kommentert</div></div>
    <div style="background:linear-gradient(135deg,rgba(123,143,253,0.1),rgba(123,143,253,0.05));border:1px solid rgba(123,143,253,0.2);border-radius:12px;padding:0.75rem 1.25rem;flex:1;min-width:100px;text-align:center;"><div style="font-size:1.5rem;font-weight:800;color:var(--c4);">${total}</div><div style="font-size:0.75rem;color:var(--text-2);font-weight:700;">Totalt</div></div>`;

  if (!inbox.length) {
    container.innerHTML = `<div style="text-align:center;padding:3rem 1rem;color:var(--text-3);"><div style="font-size:2.5rem;margin-bottom:0.75rem;">📭</div><div style="font-weight:800;">Ingen innleveringer${statusFilter==='unread'?' å kommentere':''} ennå</div></div>`;
    return;
  }

  container.innerHTML = inbox.map(item => {
    const safeKey = item.key.replace(/[^a-zA-Z0-9]/g,'_');
    const wordCount = item.text.split(/\s+/).filter(Boolean).length;
    const minWords = item.task.minWords || 0;
    const wordOk = !minWords || wordCount >= minWords;
    return `<div class="inbox-item" id="inboxRow-${safeKey}" style="background:var(--s2);border:1px solid ${item.feedback?'var(--border)':'rgba(239,68,68,0.25)'};border-radius:14px;margin-bottom:0.75rem;overflow:hidden;">
      <div style="padding:0.875rem 1rem;cursor:pointer;display:flex;align-items:flex-start;gap:0.75rem;" data-onclick="_inboxToggle" data-onclick-arg="inboxBody-${safeKey}">
        <div style="flex:1;min-width:0;">
          <div style="display:flex;align-items:center;gap:0.5rem;flex-wrap:wrap;margin-bottom:0.25rem;">
            ${!item.feedback?'<span style="background:rgba(239,68,68,0.15);color:var(--c1);font-size:0.68rem;font-weight:800;padding:2px 8px;border-radius:50px;border:1px solid rgba(239,68,68,0.3);">● Venter</span>':'<span style="background:rgba(34,197,94,0.12);color:var(--c3);font-size:0.68rem;font-weight:800;padding:2px 8px;border-radius:50px;border:1px solid rgba(34,197,94,0.25);">✓ Kommentert</span>'}
            <span style="font-weight:800;font-size:0.88rem;color:var(--text);">👤 ${escHtml(item.studentName)}</span>
            <span style="font-size:0.75rem;color:var(--text-3);">— ${escHtml(item.mod.emoji||'📚')} ${escHtml(item.mod.name)}</span>
          </div>
          <div style="font-size:0.82rem;color:var(--text-2);font-weight:700;">${escHtml(item.task.title||'Skriveoppgave')}</div>
          <div style="font-size:0.78rem;color:${wordOk?'var(--c3)':'var(--c1)'};margin-top:2px;">${wordCount} ord${minWords?` / ${minWords} minimum`:''}</div>
        </div>
        <div style="font-size:0.75rem;color:var(--text-3);flex-shrink:0;margin-top:2px;">${item.time ? relativeTime(item.time) : ''}</div>
      </div>
      <div id="inboxBody-${safeKey}" style="display:none;padding:0 1rem 1rem;">
        <div style="background:var(--s3);border-radius:10px;padding:0.875rem 1rem;margin-bottom:0.75rem;font-size:0.88rem;color:var(--text);line-height:1.7;white-space:pre-wrap;max-height:200px;overflow-y:auto;">${escHtml(item.text)}</div>
        <div style="font-weight:800;font-size:0.82rem;color:var(--text-2);margin-bottom:0.4rem;">💬 Din kommentar til eleven:</div>
        <textarea id="inboxFb-${safeKey}" placeholder="Skriv en kommentar..." style="width:100%;min-height:80px;padding:9px 12px;border:1px solid var(--border-2);border-radius:10px;font-family:'Nunito',sans-serif;font-size:0.88rem;outline:none;background:var(--s3);color:var(--text);resize:vertical;box-sizing:border-box;">${escHtml(item.feedback)}</textarea>
        <div style="display:flex;gap:0.5rem;margin-top:0.5rem;flex-wrap:wrap;">
          <button data-hid="${_reg(function(){_saveInboxFeedback('${item.key}','${safeKey}')})}" style="background:var(--accent);color:#fff;border:none;border-radius:9px;padding:7px 18px;font-weight:800;font-size:0.85rem;cursor:pointer;font-family:'Nunito',sans-serif;">💾 Lagre</button>
          ${item.feedback?`<button data-hid="${_reg(function(){_deleteInboxFeedback('${item.key}','${safeKey}')})}" style="background:rgba(239,68,68,0.1);color:#f87171;border:1px solid rgba(239,68,68,0.25);border-radius:9px;padding:7px 14px;font-weight:800;font-size:0.82rem;cursor:pointer;font-family:'Nunito',sans-serif;">🗑 Slett</button>`:''}
          <span id="inboxFbSaved-${safeKey}" style="display:none;color:var(--c3);font-weight:700;font-size:0.85rem;align-self:center;">✅ Lagret</span>
        </div>
      </div>
    </div>`;
  }).join('');
}
function _inboxToggle(id) {
  const el = document.getElementById(id);
  if (el) el.style.display = el.style.display === 'none' ? 'block' : 'none';
}
async function _saveInboxFeedback(answerKey, safeKey) {
  const ta = document.getElementById('inboxFb-' + safeKey);
  const text = ta?.value.trim() || '';
  const fbKey = 'af_' + answerKey;
  if (text) {
    localStorage.setItem(fbKey, text);
    await DB.saveFeedback(fbKey, text);
  }
  const badge = document.getElementById('inboxFbSaved-' + safeKey);
  if (badge) { badge.style.display = 'inline'; setTimeout(() => badge.style.display = 'none', 2000); }
  // Update border color to show it's now commented
  const row = document.getElementById('inboxRow-' + safeKey);
  if (row) row.style.borderColor = 'var(--border)';
  showToast('💬 Tilbakemelding lagret!');
}
async function _deleteInboxFeedback(answerKey, safeKey) {
  const fbKey = 'af_' + answerKey;
  localStorage.removeItem(fbKey);
  await DB.deleteFeedback(fbKey);
  renderWriteInbox();
}

// ====== GLOBAL CONTENT SEARCH ======
function renderGlobalSearch() {
  const q = (document.getElementById('globalSearchInput')?.value || '').trim().toLowerCase();
  const container = document.getElementById('globalSearchResults');
  if (!container) return;
  if (!q) { container.innerHTML = '<div style="color:var(--text-3);text-align:center;padding:2rem;">Skriv for å søke i alle emner</div>'; return; }
  const results = [];
  state.modules.forEach((m, mi) => {
    const mName = (m.name || '').toLowerCase();
    const mDesc = (m.desc || '').toLowerCase();
    if (mName.includes(q) || mDesc.includes(q)) {
      results.push({ type: 'emne', mi, label: m.name, detail: m.desc || '', emoji: m.emoji || '📚' });
    }
    if (m.text && m.text.toLowerCase().includes(q)) {
      const idx = m.text.toLowerCase().indexOf(q);
      const snippet = m.text.slice(Math.max(0, idx - 40), idx + 80).replace(/\n/g, ' ');
      results.push({ type: 'tekst', mi, label: m.name, detail: snippet, emoji: '📖' });
    }
    (m.quiz || []).forEach((qz, qi) => {
      const qText = ((qz.question || qz.q || '') + ' ' + (qz.a||'') + ' ' + (qz.b||'') + ' ' + (qz.c||'') + ' ' + (qz.d||'')).toLowerCase();
      if (qText.includes(q)) {
        results.push({ type: 'quiz', mi, qi, label: m.name, detail: qz.question || qz.q || '', emoji: '❓' });
      }
    });
    (m.flashcards || []).forEach((fc, fi) => {
      if ((fc.term + ' ' + fc.def).toLowerCase().includes(q)) {
        results.push({ type: 'flashcard', mi, label: m.name, detail: fc.term + ' → ' + fc.def, emoji: '🃏' });
      }
    });
    (m.write || []).forEach((w, wi) => {
      const wText = (w.prompt || w || '').toLowerCase();
      if (wText.includes(q)) {
        results.push({ type: 'skriving', mi, label: m.name, detail: w.prompt || w || '', emoji: '✍️' });
      }
    });
    (m.discussion || []).forEach((d, di) => {
      if ((d || '').toLowerCase().includes(q)) {
        results.push({ type: 'drøfting', mi, label: m.name, detail: d, emoji: '💬' });
      }
    });
  });
  if (!results.length) {
    container.innerHTML = '<div style="color:var(--text-3);text-align:center;padding:2rem;">Ingen treff for «' + escHtml(q) + '»</div>';
    return;
  }
  const highlight = (text) => {
    if (!text) return '';
    const safe = escHtml(text);
    const re = new RegExp('(' + q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + ')', 'gi');
    return safe.replace(re, '<mark style="background:rgba(251,191,36,0.35);border-radius:3px;padding:0 2px;">$1</mark>');
  };
  container.innerHTML = `<div style="font-size:0.82rem;color:var(--text-3);margin-bottom:0.75rem;font-weight:700;">${results.length} treff</div>` +
    results.map(r => `
      <div data-hid="${_reg(function(){trTab('new');editModule(r.mi)})}" style="background:var(--s2);border:1px solid var(--border);border-radius:12px;padding:0.875rem 1rem;margin-bottom:0.6rem;cursor:pointer;transition:border-color 0.15s;">
        <div style="display:flex;align-items:center;gap:0.5rem;margin-bottom:0.2rem;">
          <span>${r.emoji}</span>
          <span style="font-weight:800;font-size:0.88rem;color:var(--text);">${highlight(r.label)}</span>
          <span style="background:var(--s3);color:var(--text-2);font-size:0.73rem;font-weight:800;padding:2px 8px;border-radius:50px;margin-left:auto;">${r.type}</span>
        </div>
        <div style="font-size:0.82rem;color:var(--text-2);line-height:1.4;">${highlight(r.detail.slice(0,120))}${r.detail.length>120?'…':''}</div>
      </div>`).join('');
}

// ====== TEACHER STATISTICS ======
function renderTeacherStats() {
  const container = document.getElementById('statsContent');
  if (!container) return;
  const answers = state.studentAnswers;
  const allKeys = Object.keys(answers);

  if (!allKeys.length) {
    container.innerHTML = `<div style="text-align:center;padding:2rem 1rem;">
      <div style="font-size:2.5rem;margin-bottom:0.75rem;">📊</div>
      <div style="font-weight:800;font-size:1.05rem;color:var(--text);margin-bottom:0.5rem;">Ingen aktivitet ennå</div>
      <div style="font-size:0.88rem;color:var(--text-3);margin-bottom:1.25rem;line-height:1.6;">Statistikk dukker opp her når elever logger inn og svarer på oppgaver.</div>
      <div style="background:var(--s2);border:1px solid var(--border);border-radius:12px;padding:1rem;text-align:left;font-size:0.85rem;color:var(--text-2);line-height:1.7;">
        <div style="font-weight:800;color:var(--accent-h);margin-bottom:0.4rem;">💡 Kom i gang</div>
        <div>1. Opprett et emne under <strong>Nytt emne</strong></div>
        <div>2. Del emnet med elevene dine</div>
        <div>3. Elever logger inn på forsiden og åpner emnet</div>
        <div>4. Svarene vises her automatisk</div>
      </div>
    </div>`;
    return;
  }

  // Topp-statistikk
  const allStudents = new Set(allKeys.map(k => k.split('_m')[0]).filter(Boolean));
  const totalAnswers = allKeys.length;
  const totalCorrect = allKeys.filter(k => { const v = answers[k]; return typeof v === 'object' ? v.correct : false; }).length;
  const correctPct = totalAnswers ? Math.round(totalCorrect / totalAnswers * 100) : 0;

  // Per-modul statistikk
  const perModule = state.modules.map((m, mi) => {
    const modEntries = allKeys.filter(k => k.includes('_m' + mi + '_'));
    const students = new Set(modEntries.map(k => k.split('_m')[0]).filter(Boolean));
    const correct = modEntries.filter(k => { const v = answers[k]; return typeof v === 'object' ? v.correct : false; }).length;
    return { m, mi, students: students.size, answers: modEntries.length, correct };
  }).filter(r => r.answers > 0).sort((a, b) => b.answers - a.answers);

  const topModule = perModule[0];

  container.innerHTML = `
    <!-- Topp 3 stats -->
    <div style="display:flex;gap:0.75rem;flex-wrap:wrap;margin-bottom:1.25rem;">
      <div style="flex:1;min-width:110px;background:linear-gradient(135deg,var(--s2),var(--s3));border:1px solid var(--border);border-radius:14px;padding:1rem 1.25rem;text-align:center;">
        <div style="font-size:1.8rem;font-weight:800;color:var(--accent);">${allStudents.size}</div>
        <div style="font-size:0.78rem;color:var(--text-2);font-weight:700;margin-top:0.15rem;">Elever</div>
      </div>
      <div style="flex:1;min-width:110px;background:linear-gradient(135deg,var(--s2),var(--s3));border:1px solid var(--border);border-radius:14px;padding:1rem 1.25rem;text-align:center;">
        <div style="font-size:1.8rem;font-weight:800;color:var(--green);">${totalAnswers}</div>
        <div style="font-size:0.78rem;color:var(--text-2);font-weight:700;margin-top:0.15rem;">Totale svar</div>
      </div>
      <div style="flex:1;min-width:110px;background:linear-gradient(135deg,var(--s2),var(--s3));border:1px solid var(--border);border-radius:14px;padding:1rem 1.25rem;text-align:center;">
        <div style="font-size:1.8rem;font-weight:800;color:var(--yellow);">${correctPct}%</div>
        <div style="font-size:0.78rem;color:var(--text-2);font-weight:700;margin-top:0.15rem;">Riktige svar</div>
      </div>
    </div>

    ${topModule ? `
    <!-- Mest aktive emne -->
    <div style="background:linear-gradient(135deg,rgba(123,143,253,0.1),rgba(123,143,253,0.05));border:1px solid rgba(123,143,253,0.25);border-radius:12px;padding:0.875rem 1rem;margin-bottom:1.25rem;display:flex;align-items:center;gap:0.75rem;">
      <span style="font-size:1.5rem;">${topModule.m.emoji||'📚'}</span>
      <div>
        <div style="font-size:0.75rem;font-weight:800;color:var(--accent);text-transform:uppercase;letter-spacing:0.04em;margin-bottom:0.1rem;">🏆 Mest aktive emne</div>
        <div style="font-weight:800;color:var(--text);font-size:0.92rem;">${escHtml(topModule.m.name)}</div>
        <div style="font-size:0.75rem;color:var(--text-2);">${topModule.students} elev${topModule.students===1?'':'er'} · ${topModule.answers} svar</div>
      </div>
    </div>` : ''}

    ${perModule.length ? `
    <!-- Per-modul tabell -->
    <div style="font-size:0.75rem;font-weight:800;color:var(--text-3);text-transform:uppercase;letter-spacing:0.06em;margin-bottom:0.6rem;">Emner med aktivitet</div>
    <div style="background:var(--s2);border:1px solid var(--border);border-radius:12px;overflow:hidden;">
      <div style="display:grid;grid-template-columns:1fr auto auto auto;gap:0;padding:0.5rem 1rem;background:var(--s3);border-bottom:1px solid var(--border);">
        <div style="font-size:0.72rem;font-weight:800;color:var(--text-3);">Emne</div>
        <div style="font-size:0.72rem;font-weight:800;color:var(--text-3);text-align:center;padding:0 0.75rem;">Elever</div>
        <div style="font-size:0.72rem;font-weight:800;color:var(--text-3);text-align:center;padding:0 0.75rem;">Svar</div>
        <div style="font-size:0.72rem;font-weight:800;color:var(--text-3);text-align:right;">Riktige</div>
      </div>
      ${perModule.map((r, i) => {
        const cpct = r.answers ? Math.round(r.correct / r.answers * 100) : 0;
        const cpctColor = cpct >= 70 ? 'var(--green)' : cpct >= 40 ? 'var(--yellow)' : 'var(--red)';
        return `<div style="display:grid;grid-template-columns:1fr auto auto auto;gap:0;padding:0.6rem 1rem;border-bottom:1px solid var(--border);background:${i%2===0?'transparent':'rgba(255,255,255,0.01)'};">
          <div style="display:flex;align-items:center;gap:0.5rem;min-width:0;">
            <span style="font-size:1rem;flex-shrink:0;">${r.m.emoji||'📚'}</span>
            <span style="font-size:0.83rem;font-weight:700;color:var(--text);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${escHtml(r.m.name)}</span>
          </div>
          <div style="font-size:0.85rem;font-weight:800;color:var(--text-2);text-align:center;padding:0 0.75rem;">${r.students}</div>
          <div style="font-size:0.85rem;font-weight:800;color:var(--text-2);text-align:center;padding:0 0.75rem;">${r.answers}</div>
          <div style="font-size:0.85rem;font-weight:800;color:${cpctColor};text-align:right;">${cpct}%</div>
        </div>`;
      }).join('')}
    </div>` : '<p style="color:var(--text-3);margin-top:0.5rem;">Ingen emneaktivitet ennå.</p>'}

    ${!perModule.length && allStudents.size === 0 ? `
    <div style="text-align:center;padding:2rem 1rem;color:var(--text-3);">
      <div style="font-size:2.5rem;margin-bottom:0.75rem;">📊</div>
      <div style="font-weight:800;font-size:0.95rem;color:var(--text-2);">Ingen data ennå</div>
      <div style="font-size:0.82rem;margin-top:0.3rem;">Statistikk vises når elever begynner å svare på oppgaver.</div>
    </div>` : ''}

    ${_buildQuizStatsHtml(answers)}
    ${_buildStudentEngagementHtml(answers, allStudents)}
    ${_buildNotOpenedHtml()}
  `;
}

function _buildStudentEngagementHtml(answers, allStudents) {
  if (!allStudents?.size) return '';
  const allKeys = Object.keys(answers);
  // Per-student summary
  const studentData = {};
  allKeys.forEach(k => {
    const studentName = k.split('_m')[0];
    if (!studentName) return;
    if (!studentData[studentName]) studentData[studentName] = { total: 0, correct: 0, modules: new Set() };
    const d = studentData[studentName];
    d.total++;
    if (typeof answers[k] === 'object' && answers[k].correct) d.correct++;
    const mMatch = k.match(/_m(\d+)_/);
    if (mMatch) d.modules.add(mMatch[1]);
  });
  const sorted = Object.entries(studentData).sort((a,b) => b[1].total - a[1].total);
  if (!sorted.length) return '';
  // Per-quiz difficulty: find questions with < 50% correct rate
  const quizDifficulty = {};
  state.modules.forEach((m, mi) => {
    (m.quiz||[]).forEach((q, qi) => {
      const key = `quiz_${qi}`;
      const attempts = allKeys.filter(k => k.includes(`_m${mi}_${key}`));
      if (!attempts.length) return;
      const correct = attempts.filter(k => {
        const v = answers[k]; return typeof v === 'object' ? v.correct : v === 'correct';
      }).length;
      const pct = Math.round(correct / attempts.length * 100);
      if (pct < 50 && attempts.length >= 2) {
        quizDifficulty[`m${mi}_q${qi}`] = { m, q, mi, qi, pct, attempts: attempts.length };
      }
    });
  });
  const hardQ = Object.values(quizDifficulty).sort((a,b)=>a.pct-b.pct).slice(0,5);
  return `
    <div style="margin-top:1.25rem;">
      <div style="font-size:0.75rem;font-weight:800;color:var(--text-3);text-transform:uppercase;letter-spacing:0.06em;margin-bottom:0.6rem;">👥 Elev-engasjement</div>
      <div style="background:var(--s2);border:1px solid var(--border);border-radius:12px;overflow:hidden;margin-bottom:1rem;">
        <div style="display:grid;grid-template-columns:1fr auto auto auto;gap:0;padding:0.4rem 1rem;background:var(--s3);border-bottom:1px solid var(--border);">
          <div style="font-size:0.72rem;font-weight:800;color:var(--text-3);">Elev</div>
          <div style="font-size:0.72rem;font-weight:800;color:var(--text-3);text-align:center;padding:0 0.5rem;">Emner</div>
          <div style="font-size:0.72rem;font-weight:800;color:var(--text-3);text-align:center;padding:0 0.5rem;">Svar</div>
          <div style="font-size:0.72rem;font-weight:800;color:var(--text-3);text-align:right;">Riktige</div>
        </div>
        ${sorted.slice(0,15).map(([name, d], i) => {
          const pct = d.total ? Math.round(d.correct/d.total*100) : 0;
          const color = pct>=70?'var(--green)':pct>=40?'var(--yellow)':'var(--c1)';
          return `<div style="display:grid;grid-template-columns:1fr auto auto auto;gap:0;padding:0.5rem 1rem;border-bottom:1px solid var(--border);background:${i%2?'rgba(255,255,255,0.01)':'transparent'};">
            <div style="font-size:0.83rem;font-weight:700;color:var(--text);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${escHtml(name)}</div>
            <div style="font-size:0.82rem;font-weight:800;color:var(--text-2);text-align:center;padding:0 0.5rem;">${d.modules.size}</div>
            <div style="font-size:0.82rem;font-weight:800;color:var(--text-2);text-align:center;padding:0 0.5rem;">${d.total}</div>
            <div style="font-size:0.82rem;font-weight:800;color:${color};text-align:right;">${pct}%</div>
          </div>`;
        }).join('')}
        ${sorted.length > 15 ? `<div style="padding:0.5rem 1rem;font-size:0.78rem;color:var(--text-3);border-top:1px solid var(--border);">+ ${sorted.length-15} til</div>` : ''}
      </div>
      ${hardQ.length ? `
      <div style="font-size:0.75rem;font-weight:800;color:var(--text-3);text-transform:uppercase;letter-spacing:0.06em;margin-bottom:0.6rem;">🔴 Vanskeligste spørsmål</div>
      <div style="display:flex;flex-direction:column;gap:0.5rem;">
        ${hardQ.map(r => `<div style="background:rgba(239,68,68,0.07);border:1px solid rgba(239,68,68,0.2);border-radius:10px;padding:0.6rem 0.875rem;font-size:0.83rem;">
          <div style="font-weight:800;color:var(--text);">${escHtml(r.m.name)} — Q${r.qi+1}</div>
          <div style="color:var(--text-2);margin-top:2px;">${escHtml((r.q.question||'').substring(0,80))}</div>
          <div style="color:#f87171;font-weight:800;margin-top:3px;font-size:0.78rem;">${r.pct}% riktige (${r.attempts} forsøk)</div>
        </div>`).join('')}
      </div>` : ''}
    </div>`;
}

function _buildNotOpenedHtml() {
  const roster = getRosterSync();
  if (!roster.length || !state.modules.length) return '';
  const rows = state.modules.map((m, mi) => {
    const trackKey = 'os_open_' + (m._id||'mod_'+mi);
    let opened = {};
    try { opened = JSON.parse(localStorage.getItem(trackKey)||'{}'); } catch {}
    const notOpened = roster.filter(s => !opened[s.name]).map(s => s.name);
    if (!notOpened.length) return null;
    return { m, mi, notOpened };
  }).filter(Boolean);
  if (!rows.length) return '';
  return `<div style="margin-top:1.25rem;">
    <div style="font-size:0.75rem;font-weight:800;color:var(--text-3);text-transform:uppercase;letter-spacing:0.06em;margin-bottom:0.6rem;">👁 Elever som ikke har åpnet emnet</div>
    <div style="display:flex;flex-direction:column;gap:0.5rem;">
    ${rows.map(r => `<div style="background:var(--s2);border:1px solid var(--border);border-radius:10px;padding:0.625rem 0.875rem;">
      <div style="font-weight:800;font-size:0.83rem;color:var(--text);margin-bottom:0.3rem;">${r.m.emoji||'📚'} ${escHtml(r.m.name)} — ${r.notOpened.length} elev${r.notOpened.length===1?'':'er'}</div>
      <div style="font-size:0.78rem;color:var(--c1);font-weight:700;">${r.notOpened.slice(0,10).map(n=>escHtml(n)).join(', ')}${r.notOpened.length>10?` og ${r.notOpened.length-10} til`:''}</div>
    </div>`).join('')}
    </div>
  </div>`;
}

function _buildQuizStats(answers) {
  const stats = {};
  Object.entries(answers).forEach(([k, v]) => {
    const m = k.match(/_m(\d+)_quiz_(\d+)$/);
    if (!m) return;
    const key = `${m[1]}_${m[2]}`;
    if (!stats[key]) stats[key] = { correct:0, total:0, mi:+m[1], qi:+m[2] };
    stats[key].total++;
    if (typeof v === 'object' ? v.correct : v === 'correct') stats[key].correct++;
  });
  return stats;
}

function _buildQuizStatsHtml(answers) {
  const stats = _buildQuizStats(answers);
  const entries = Object.values(stats).sort((a,b) => a.mi - b.mi || a.qi - b.qi);
  if (!entries.length) return '';
  // Group by module
  const byModule = {};
  entries.forEach(e => {
    if (!byModule[e.mi]) byModule[e.mi] = [];
    byModule[e.mi].push(e);
  });
  const rows = Object.entries(byModule).map(([mi, qs]) => {
    const mod = state.modules[+mi];
    if (!mod) return '';
    const qRows = qs.map(e => {
      const q = (mod.quiz||[])[e.qi];
      const qText = q ? escHtml(q.question) : `Spørsmål ${e.qi+1}`;
      const pct = e.total ? Math.round(e.correct/e.total*100) : 0;
      const barColor = pct >= 70 ? 'var(--green)' : pct >= 40 ? 'var(--yellow)' : 'var(--red)';
      return `<div style="padding:0.5rem 0.75rem;border-bottom:1px solid var(--border);">
        <div style="display:flex;align-items:center;justify-content:space-between;gap:0.5rem;flex-wrap:wrap;">
          <div style="font-size:0.82rem;color:var(--text);font-weight:600;flex:1;">${pct<50?'⚠️ ':''}${qText}</div>
          <div style="font-size:0.78rem;font-weight:800;color:${barColor};white-space:nowrap;">${pct}% (${e.correct}/${e.total})</div>
        </div>
        <div class="q-stat-bar-wrap"><div class="q-stat-bar-fill" style="width:${pct}%;background:${barColor};"></div></div>
      </div>`;
    }).join('');
    return `<div style="margin-bottom:1rem;background:var(--s2);border:1px solid var(--border);border-radius:12px;overflow:hidden;">
      <div style="padding:0.5rem 0.75rem;background:var(--s3);border-bottom:1px solid var(--border);font-size:0.8rem;font-weight:800;color:var(--text);">${mod.emoji||'📚'} ${escHtml(mod.name)}</div>
      ${qRows}
    </div>`;
  }).join('');
  return `<div style="margin-top:1.5rem;">
    <div style="font-size:0.75rem;font-weight:800;color:var(--text-3);text-transform:uppercase;letter-spacing:0.06em;margin-bottom:0.75rem;">📊 Statistikk per spørsmål</div>
    ${rows}
  </div>`;
}

// ====== CLASS ROSTER ======
async function _refreshRoster() {
  try { await loadRosterCached(); } catch(e) { showToast('❌ Kunne ikke hente elevliste'); return; }
  renderClassRoster();
  showToast('✅ Elevliste oppdatert');
}
function renderClassRoster() {
  const container=document.getElementById('classRosterContainer');
  if(!container)return;
  const roster=getRosterSync();
  if(!roster.length){
    container.innerHTML=`<div style="text-align:center;padding:3rem 1rem;color:var(--text-3);">
      <div style="font-size:3rem;margin-bottom:1rem;">🏫</div>
      <div style="font-weight:800;font-size:1rem;margin-bottom:0.5rem;color:var(--text-2);">Ingen elever ennå</div>
      <div style="font-size:0.85rem;">Elever dukker opp her så snart de logger inn.</div>
    </div>`;
    return;
  }
  const byClass={};
  roster.forEach(s=>{const cls=s.cls||'Ukjent';if(!byClass[cls])byClass[cls]=[];byClass[cls].push(s);});
  const sortedClasses=Object.entries(byClass).sort(([a],[b])=>a==='Ukjent'?1:b==='Ukjent'?-1:a.localeCompare(b,'no'));
  container.innerHTML=`<div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(280px,1fr));gap:1rem;">` +
    sortedClasses.map(([cls,students])=>`
    <div style="background:var(--s1);border-radius:16px;border:1px solid var(--border);overflow:hidden;">
      <div style="padding:0.875rem 1.1rem;background:var(--s2);border-bottom:1px solid var(--border);display:flex;align-items:center;justify-content:space-between;">
        <div style="font-weight:800;font-size:0.95rem;color:var(--text);display:flex;align-items:center;gap:0.5rem;">
          <span style="font-size:1.2rem;">${cls==='Ukjent'?'❓':'🏫'}</span> ${escHtml(cls)}
        </div>
        <span style="font-size:0.75rem;font-weight:800;background:var(--s3);border:1px solid var(--border-2);padding:2px 8px;border-radius:50px;color:var(--text-3);">${students.length} elev${students.length===1?'':'er'}</span>
      </div>
      <div style="padding:0.5rem 0.5rem;">
        ${students.map((s,i)=>`
          <div style="display:flex;align-items:center;justify-content:space-between;padding:0.5rem 0.6rem;border-radius:8px;transition:background 0.15s;">
            <span style="display:flex;align-items:center;gap:0.5rem;font-size:0.88rem;font-weight:700;color:var(--text);">
              <span style="width:24px;height:24px;border-radius:50%;background:var(--s3);border:1px solid var(--border-2);display:flex;align-items:center;justify-content:center;font-size:0.65rem;font-weight:800;color:var(--text-3);">${i+1}</span>
              ${escHtml(s.name)}
            </span>
            <div style="display:flex;gap:4px;">
              <button data-onclick="viewStudentDetail" data-onclick-arg="${escHtml(s.name)}" title="Se svar" style="background:var(--s3);border:1px solid var(--border-2);color:var(--text-2);cursor:pointer;font-size:0.78rem;padding:4px 7px;border-radius:6px;transition:all 0.15s;line-height:1;font-family:'Nunito',sans-serif;font-weight:800;">📋</button>
              <button data-onclick="removeStudent" data-onclick-arg="${escHtml(s.name)}" title="Fjern elev" style="background:transparent;border:none;color:var(--text-3);cursor:pointer;font-size:0.85rem;padding:4px 6px;border-radius:6px;transition:all 0.15s;line-height:1;">🗑</button>
            </div>
          </div>`).join('')}
      </div>
    </div>`).join('') + `</div>`;
  renderGroups();
}

function viewStudentDetail(studentName) {
  const el = document.getElementById('studentDetailContent');
  if (!el) return;
  const roster = getRosterSync();
  const studentInfo = roster.find(s => s.name === studentName) || {};
  const cls = studentInfo.cls || '–';
  const allAnswers = state.studentAnswers;

  // Filtrer svar for denne eleven
  const prefix = studentName + '_m';
  const studentKeys = Object.entries(allAnswers).filter(([k]) => k.startsWith(prefix));
  const totalAnswers = studentKeys.length;
  const correctAnswers = studentKeys.filter(([,v]) => typeof v === 'object' ? v.correct : false).length;

  // Bygg HTML
  let html = `
    <div style="display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:1.25rem;padding-bottom:1rem;border-bottom:1px solid var(--border);">
      <div>
        <h2 style="margin:0 0 0.25rem;font-size:1.05rem;font-weight:800;color:var(--text);display:flex;align-items:center;gap:8px;">
          <span style="font-size:1.4rem;">👤</span>${escHtml(studentName)}
        </h2>
        <div style="font-size:0.8rem;color:var(--text-2);">Klasse: <b style="color:var(--text);">${escHtml(cls)}</b> &nbsp;·&nbsp; ${totalAnswers} svar &nbsp;·&nbsp; ${totalAnswers?Math.round(correctAnswers/totalAnswers*100):0}% riktige</div>
      </div>
      <div style="display:flex;gap:0.4rem;align-items:center;">
        <button data-onclick="exportStudentAnswersTxt" data-onclick-arg="${escHtml(studentName)}" style="display:flex;align-items:center;gap:5px;background:var(--s3);border:1px solid var(--border-2);color:var(--text-2);padding:7px 12px;border-radius:8px;font-family:'Nunito',sans-serif;font-weight:800;font-size:0.8rem;cursor:pointer;">📥 Eksporter</button>
        <button data-onclick="closeModal" data-onclick-arg="studentDetailModal" style="background:var(--s3);border:1px solid var(--border-2);color:var(--text-2);width:30px;height:30px;border-radius:7px;cursor:pointer;display:flex;align-items:center;justify-content:center;min-height:0;">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
        </button>
      </div>
    </div>`;

  if (!totalAnswers) {
    html += `<div style="text-align:center;padding:2rem 1rem;color:var(--text-3);"><div style="font-size:2rem;margin-bottom:0.5rem;">📭</div><div>Ingen svar registrert ennå.</div></div>`;
  } else {
    state.modules.forEach((m, mi) => {
      const modEntries = studentKeys.filter(([k]) => k.includes('_m' + mi + '_'));
      if (!modEntries.length) return;
      const modCorrect = modEntries.filter(([,v]) => typeof v === 'object' ? v.correct : false).length;
      html += `
        <div style="margin-bottom:0.875rem;background:var(--s2);border:1px solid var(--border);border-radius:12px;overflow:hidden;">
          <div style="padding:0.75rem 1rem;background:var(--s3);border-bottom:1px solid var(--border);display:flex;align-items:center;justify-content:space-between;">
            <div style="font-weight:800;font-size:0.88rem;color:var(--text);display:flex;align-items:center;gap:6px;">${m.emoji||'📚'} ${escHtml(m.name)}</div>
            <span style="font-size:0.75rem;font-weight:800;color:var(--text-3);">${modEntries.length} svar · ${modEntries.length?Math.round(modCorrect/modEntries.length*100):0}% riktige</span>
          </div>
          <div style="padding:0.5rem 0.75rem;">
            ${modEntries.map(([k,v])=>{
              const taskKey = k.split('_m'+mi+'_')[1] || k;
              const val = typeof v === 'object' ? v.val : v;
              const correct = typeof v === 'object' ? v.correct : null;
              const time = typeof v === 'object' ? v.time : '';
              return `<div id="srow-${k.replace(/[^a-zA-Z0-9]/g,'_')}" style="padding:0.4rem 0;border-bottom:1px solid var(--border);">
                <div style="display:flex;align-items:flex-start;gap:0.5rem;">
                  ${correct !== null ? `<span style="font-size:0.75rem;flex-shrink:0;margin-top:0.1rem;">${correct?'✅':'❌'}</span>` : ''}
                  <div style="flex:1;min-width:0;">
                    <div style="font-size:0.72rem;color:var(--text-3);font-weight:700;margin-bottom:1px;">${escHtml(taskKey)}</div>
                    <div style="font-size:0.82rem;color:var(--text);word-break:break-word;">${escHtml(String(val).substring(0,200))}${String(val).length>200?'…':''}</div>
                    ${time?`<div style="font-size:0.68rem;color:var(--text-3);margin-top:1px;" title="${escHtml(time)}">${relativeTime(time)}</div>`:''}
                  </div>
                  <button data-hid="${_reg(function(){openAnswerFeedback('${escHtml(k)}','srow-${k.replace(/[^a-zA-Z0-9]/g,\'_\')}')})}"  id="afbtn-${k.replace(/[^a-zA-Z0-9]/g,'_')}" title="Kommenter svar" style="background:none;border:none;cursor:pointer;font-size:0.9rem;flex-shrink:0;color:var(--text-3);" class="print-hide">💬</button>
                </div>
                <div id="afinline-${k.replace(/[^a-zA-Z0-9]/g,'_')}"></div>
              </div>`;
            }).join('')}
          </div>
        </div>`;
    });
  }

  html += `<div style="margin-top:1.25rem;border-top:1px solid var(--border);padding-top:1rem;">
    <div style="font-weight:800;font-size:0.88rem;color:var(--text);margin-bottom:0.5rem;">💬 Tilbakemelding til eleven</div>
    <textarea id="teacherFeedbackInput" maxlength="500" placeholder="Skriv en personlig melding til eleven – vises ved neste innlogging..." style="width:100%;min-height:80px;padding:9px 12px;border:1px solid var(--border-2);border-radius:10px;font-family:'Nunito',sans-serif;font-size:0.88rem;outline:none;background:var(--s3);color:var(--text);resize:vertical;box-sizing:border-box;"></textarea>
    <div style="display:flex;gap:0.5rem;margin-top:0.5rem;align-items:center;">
      <button data-onclick="saveTeacherFeedback" data-onclick-arg="${escHtml(studentName)}" style="background:var(--accent);color:#fff;border:none;border-radius:9px;padding:0.5rem 1.1rem;font-weight:800;font-size:0.85rem;cursor:pointer;">💾 Lagre</button>
      <span id="feedbackSavedMsg" style="display:none;color:var(--c3);font-weight:700;font-size:0.85rem;">✅ Lagret</span>
    </div>
  </div>`;

  el.innerHTML = html;
  // Load existing feedback
  (async () => {
    const fbText = await DB.loadFeedback('feedback_' + studentName);
    const ta = document.getElementById('teacherFeedbackInput');
    if (ta && fbText) ta.value = fbText;
  })();
  const modal = document.getElementById('studentDetailModal');
  if (modal) modal.classList.add('open');
}

async function removeStudent(name){
  _showConfirm('Fjern ' + name + ' fra klasselisten?', async () => {
    const roster=getRosterSync().filter(r=>r.name!==name);
    _rosterCache=roster;
    await DB.saveRoster(roster);
    renderClassRoster();
  }, 'Fjern', 'var(--c1)');
}

// ====== ELEVGRUPPER ======
function _loadGroups() { try { return JSON.parse(localStorage.getItem('os_groups')||'[]'); } catch(e) { return []; } }
function _saveGroups(groups) { localStorage.setItem('os_groups', JSON.stringify(groups)); }

async function openGroupModal(editId) {
  if (!state.isTeacher) { showToast('⛔ Kun for lærere'); return; }
  // Always refresh roster before opening so the member list is up-to-date
  try { await loadRosterCached(); } catch(e) {}
  const modal = document.getElementById('groupModal');
  const titleEl = document.getElementById('groupModalTitle');
  const nameInput = document.getElementById('groupNameInput');
  const membersList = document.getElementById('groupMembersList');
  const editIdInput = document.getElementById('groupEditId');
  if (!modal) return;

  const roster = getRosterSync();
  const groups = _loadGroups();
  const editing = editId ? groups.find(g => g.id === editId) : null;

  if (titleEl) titleEl.textContent = editing ? 'Rediger gruppe' : 'Ny gruppe';
  if (nameInput) nameInput.value = editing ? editing.name : '';
  if (editIdInput) editIdInput.value = editId || '';

  if (membersList) {
    if (!roster.length) {
      membersList.innerHTML = '<div style="padding:0.5rem;color:var(--text-3);font-size:0.85rem;">Ingen elever registrert</div>';
    } else {
      membersList.innerHTML = roster.map(s => {
        const checked = editing && editing.members.includes(s.name) ? 'checked' : '';
        return `<label style="display:flex;align-items:center;gap:0.6rem;padding:0.35rem 0.5rem;border-radius:7px;cursor:pointer;font-size:0.88rem;font-weight:700;color:var(--text);">
          <input type="checkbox" value="${escHtml(s.name)}" ${checked} style="width:15px;height:15px;accent-color:var(--accent);flex-shrink:0;">
          ${escHtml(s.name)}<span style="font-size:0.75rem;color:var(--text-3);margin-left:auto;">${escHtml(s.cls||'')}</span>
        </label>`;
      }).join('');
    }
  }
  modal.style.display = 'flex';
  setTimeout(() => { if (nameInput) nameInput.focus(); }, 80);
}
function closeGroupModal() {
  const modal = document.getElementById('groupModal');
  if (modal) modal.style.display = 'none';
}
function saveGroup() {
  if (!state.isTeacher) { showToast('⛔ Kun for lærere'); return; }
  const name = document.getElementById('groupNameInput')?.value.trim();
  if (!name) { showToast('⚠️ Skriv inn et gruppenavn'); return; }
  const members = [...document.querySelectorAll('#groupMembersList input[type=checkbox]:checked')].map(c => c.value);
  const editId = document.getElementById('groupEditId')?.value;
  const groups = _loadGroups();
  if (editId) {
    const idx = groups.findIndex(g => g.id === editId);
    if (idx >= 0) { groups[idx].name = name; groups[idx].members = members; }
  } else {
    const rnd = crypto.getRandomValues(new Uint8Array(3));
    const rndStr = Array.from(rnd, b => b.toString(36)).join('');
    groups.push({ id: Date.now().toString(36) + rndStr, name, members });
  }
  _saveGroups(groups);
  renderGroups();
  closeGroupModal();
  showToast('👥 Gruppe lagret!');
}
function deleteGroup(id) {
  if (!state.isTeacher) { showToast('⛔ Kun for lærere'); return; }
  _showConfirm('Slette denne gruppen?', () => {
    _saveGroups(_loadGroups().filter(g => g.id !== id));
    renderGroups();
  });
}
function renderGroups() {
  const container = document.getElementById('groupsList');
  if (!container) return;
  const groups = _loadGroups();
  if (!groups.length) {
    container.innerHTML = '<div style="text-align:center;padding:1.5rem 1rem;color:var(--text-3);font-size:0.88rem;">Ingen grupper opprettet ennå. Klikk «+ Ny gruppe» for å starte.</div>';
    return;
  }
  container.innerHTML = `<div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(220px,1fr));gap:0.875rem;">` +
    groups.map(g => `
    <div style="background:var(--s1);border:1px solid var(--border);border-radius:14px;padding:1rem;">
      <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:0.6rem;">
        <div style="font-weight:800;font-size:0.95rem;color:var(--text);">👥 ${escHtml(g.name)}</div>
        <div style="display:flex;gap:4px;">
          <button data-onclick="openGroupModal" data-onclick-arg="${g.id}" title="Rediger" style="background:var(--s3);border:1px solid var(--border-2);color:var(--text-2);padding:4px 7px;border-radius:6px;cursor:pointer;font-size:0.78rem;font-family:'Nunito',sans-serif;font-weight:800;">✏️</button>
          <button data-onclick="deleteGroup" data-onclick-arg="${g.id}" title="Slett" style="background:transparent;border:none;color:var(--text-3);padding:4px 6px;border-radius:6px;cursor:pointer;font-size:0.82rem;">🗑</button>
        </div>
      </div>
      <div style="font-size:0.78rem;color:var(--text-3);font-weight:700;margin-bottom:0.35rem;">${g.members.length} elev${g.members.length===1?'':'er'}</div>
      <div style="font-size:0.82rem;color:var(--text-2);line-height:1.6;">${g.members.slice(0,8).map(m=>escHtml(m)).join(', ')}${g.members.length>8?` og ${g.members.length-8} til…`:''}</div>
    </div>`).join('') + '</div>';
}

// ====== LÆRERFEEDBACK ======
async function saveTeacherFeedback(studentName) {
  if (!state.isTeacher) { showToast('⛔ Kun for lærere'); return; }
  const text = document.getElementById('teacherFeedbackInput')?.value.trim();
  if (text) await DB.saveFeedback('feedback_' + studentName, text);
  else await DB.deleteFeedback('feedback_' + studentName);
  const msg = document.getElementById('feedbackSavedMsg');
  if (msg) { msg.style.display = 'inline'; setTimeout(() => msg.style.display = 'none', 2000); }
}

function openAnswerFeedback(answerKey, rowId) {
  if (!state.isTeacher) { showToast('⛔ Kun for lærere'); return; }
  const slotId = 'afinline-' + answerKey.replace(/[^a-zA-Z0-9]/g,'_');
  const slot = document.getElementById(slotId);
  if (!slot) return;
  if (slot.querySelector('.af-inline-editor')) { slot.innerHTML=''; return; }
  const storageKey = 'af_' + answerKey;
  const existing = localStorage.getItem(storageKey) || '';
  slot.innerHTML = `<textarea class="af-inline-editor" id="afta-${slotId}" placeholder="Skriv en kommentar til dette svaret...">${escHtml(existing)}</textarea>
    <div style="display:flex;gap:0.5rem;align-items:center;">
      <button class="af-inline-save" data-onclick="_saveAnswerFeedback" data-onclick-args="${escHtml(JSON.stringify([answerKey,slotId]))}">💾 Lagre kommentar</button>
      ${existing?`<button data-onclick="_deleteAnswerFeedback" data-onclick-args="${escHtml(JSON.stringify([answerKey,slotId]))}" style="background:none;border:none;cursor:pointer;color:var(--red);font-size:0.78rem;font-weight:700;">🗑 Slett</button>`:''}
    </div>`;
}
async function _saveAnswerFeedback(answerKey, slotId) {
  const ta = document.getElementById('afta-' + slotId);
  const text = ta?.value.trim()||'';
  const storageKey = 'af_' + answerKey;
  if (text) {
    localStorage.setItem(storageKey, text);
    await DB.saveFeedback(storageKey, text);
  } else {
    localStorage.removeItem(storageKey);
    await DB.deleteFeedback(storageKey);
  }
  const slot = document.getElementById(slotId);
  if (slot) {
    if (text) slot.innerHTML = `<div class="af-box"><strong>💬 Kommentar:</strong> ${escHtml(text)}</div>`;
    else slot.innerHTML='';
  }
  const btn = document.getElementById('afbtn-' + answerKey.replace(/[^a-zA-Z0-9]/g,'_'));
  if (btn) btn.classList.toggle('af-has-comment', !!text);
  showToast(text ? '✅ Kommentar lagret' : '🗑 Kommentar slettet');
}
async function _deleteAnswerFeedback(answerKey, slotId) {
  await _saveAnswerFeedback(answerKey, slotId);
}
function showFeedbackNotice(text, key) {
  const id = 'fbNoticeModal';
  let el = document.getElementById(id);
  if (!el) {
    el = document.createElement('div');
    el.id = id;
    el.className = 'modal-overlay';
    document.body.appendChild(el);
  }
  el.style.display = 'flex';
  el.innerHTML = `<div class="modal-box" style="max-width:440px;width:92vw;text-align:center;">
    <div style="font-size:2.5rem;margin-bottom:0.75rem;">💬</div>
    <h3 style="font-family:'Fredoka One',cursive;font-size:1.2rem;color:var(--text);margin:0 0 0.75rem;">Melding fra læreren</h3>
    <div style="background:var(--s2);border-radius:12px;padding:1rem 1.25rem;text-align:left;font-size:0.92rem;color:var(--text);line-height:1.7;margin-bottom:1.25rem;border:1px solid var(--border);">${escHtml(text)}</div>
    <button data-onclick="_dismissFeedback" data-onclick-args="${escHtml(JSON.stringify([id,key]))}" style="background:var(--accent);color:#fff;border:none;border-radius:12px;padding:0.65rem 2rem;font-weight:800;font-size:0.95rem;cursor:pointer;">OK 👍</button>
  </div>`;
}

// ====== FEEDBACK ======
async function openFeedback(studentName,answerKey,previewText){
  const existing=await DB.loadFeedback(answerKey);
  const text=prompt(`Tilbakemelding til ${studentName}:\n"${previewText}"`,existing);
  if(text===null)return;
  if(text){await DB.saveFeedback(answerKey,text);showToast('💬 Tilbakemelding lagret!');}
  else{await DB.deleteFeedback(answerKey);showToast('🗑 Tilbakemelding slettet');}
}

// ====== EXPORT ======
function downloadFile(name,content,type){
  const blob=new Blob([content],{type});
  const a=document.createElement('a');a.href=URL.createObjectURL(blob);a.download=name;a.click();URL.revokeObjectURL(a.href);
}
function getStudentAnswersText(studentName){
  const answers=Object.entries(state.studentAnswers).filter(([k])=>k.startsWith(studentName));
  let txt=`SkOla – Svar fra ${studentName}\n${'='.repeat(40)}\n\n`;
  state.modules.forEach((m,mi)=>{
    const modAnswers=answers.filter(([k])=>k.includes('_m'+mi+'_'));
    if(!modAnswers.length)return;
    txt+=`📚 ${m.name}\n${'-'.repeat(30)}\n`;
    modAnswers.forEach(([k,v])=>{txt+=`${k.split('_').slice(-2).join('_')}: ${typeof v==='object'?v.val:v}\n`;});
    txt+='\n';
  });
  return txt;
}
function exportStudentAnswersTxt(name){downloadFile(name+'_svar.txt',getStudentAnswersText(name),'text/plain');}
function exportAllAnswersTxt(){
  const students=[...new Set(Object.keys(state.studentAnswers).map(k=>k.split('_m')[0]))];
  const content=students.map(s=>getStudentAnswersText(s)).join('\n\n'+'='.repeat(50)+'\n\n');
  downloadFile('alle_svar.txt',content,'text/plain');
}

// ====== AI HELPERS ======

/**
 * Token-bucket rate limiter for Anthropic API calls.
 * Allows burst up to _AI_RL_BURST calls, then 1 call per _AI_RL_INTERVAL_MS.
 * Also persists a rolling window so the limit survives page interactions.
 */
const _AI_RL_MAX   = 8;    // max calls per window
const _AI_RL_WIN   = 60000; // 60-second rolling window
const _aiCallLog   = [];    // timestamps of recent calls

function _aiRateLimitCheck() {
  const now = Date.now();
  // Drop entries outside the window
  while (_aiCallLog.length && now - _aiCallLog[0] > _AI_RL_WIN) _aiCallLog.shift();
  if (_aiCallLog.length >= _AI_RL_MAX) {
    const waitSec = Math.ceil((_AI_RL_WIN - (now - _aiCallLog[0])) / 1000);
    return { ok: false, waitSec };
  }
  _aiCallLog.push(now);
  return { ok: true };
}

/**
 * Drop-in replacement for fetch() targeting the Anthropic API.
 * Enforces per-minute rate limiting before the network call is made.
 */
async function _anthropicFetch(url, options) {
  const rl = _aiRateLimitCheck();
  if (!rl.ok) {
    showToast(`⏳ For mange AI-kall. Vent ${rl.waitSec}s og prøv igjen.`);
    const err = new Error('RateLimit');
    err.isRateLimit = true;
    throw err;
  }
  return fetch(url, options);
}

function getApiKey() {
  if (_decryptedApiKey) return _decryptedApiKey;
  const raw = localStorage.getItem('olaskole_apikey');
  if (!raw) return '';
  if (!_sessionEncKey) { showToast('🔐 Re-autentisering kreves for å bruke AI-nøkkel'); return ''; }
  try {
    const payload = JSON.parse(raw);
    SecurityUtils.decrypt(payload.ciphertext, _sessionEncKey, payload.iv).then(v => { _decryptedApiKey = v; }).catch(() => {});
  } catch {}
  return _decryptedApiKey;
}

function _aiCheckQuota() {
  const today = new Date().toISOString().slice(0,10);
  const storKey = 'ai_quota_' + today;
  const used = parseInt(localStorage.getItem(storKey)||'0', 10);
  const limit = parseInt(localStorage.getItem('ai_daily_limit')||'20', 10);
  if (used >= limit) return false;
  localStorage.setItem(storKey, String(used + 1));
  return true;
}
async function aiCallJSON(prompt, spinnerId, maxTokens=2000) {
  const key=getApiKey();
  if(!key){showToast('⚠️ Ingen API-nøkkel — lagre den under ⚙️ Innstillinger');return{error:'Ingen API-nøkkel'};}
  if(!_aiCheckQuota()){showToast('⚠️ Daglig AI-kvote nådd (20 kall). Prøv igjen i morgen, eller øk grensen i innstillinger.');return{error:'Kvote nådd'};}
  const spinner=document.getElementById(spinnerId);
  const spinnerBtn=spinner?.closest('button');
  if(spinner)spinner.style.display='inline-block';
  if(spinnerBtn){spinnerBtn.disabled=true;spinnerBtn.style.opacity='0.65';}
  try{
    const res=await _anthropicFetch('https://api.anthropic.com/v1/messages',{
      method:'POST',
      headers:{'Content-Type':'application/json','x-api-key':getApiKey(),'anthropic-version':'2023-06-01','anthropic-dangerous-direct-browser-access':'true'},
      body:JSON.stringify({model:'claude-haiku-4-5-20251001',max_tokens:maxTokens,messages:[{role:'user',content:prompt}]})
    });
    if(res.status===401){localStorage.removeItem('olaskole_apikey');return{error:'Ugyldig API-nøkkel'};}
    if(!res.ok)return{error:'API-feil ('+res.status+')'};
    const data=await res.json();
    const text=data.content?.[0]?.text||'';
    // Robust JSON extraction: strip markdown fences, find outermost { } or [ ]
    let t=text.replace(/```json\s*/gi,'').replace(/```\s*/gi,'').trim();
    const starts=[t.indexOf('{'),t.indexOf('[')].filter(x=>x!==-1);
    if(starts.length){
      const start=Math.min(...starts);
      const isObj=t[start]==='{';
      const end=isObj?t.lastIndexOf('}'):t.lastIndexOf(']');
      if(end>start) t=t.slice(start,end+1);
    }
    try{return JSON.parse(t);}
    catch{return{error:'AI svarte ikke med gyldig JSON. Prøv igjen.'};}
  }catch(e){return{error:e.message};}
  finally{
    if(spinner)spinner.style.display='none';
    if(spinnerBtn){spinnerBtn.disabled=false;spinnerBtn.style.opacity='';}
  }
}

async function generateWithAI() {
  const text=document.getElementById('moduleText')?.value.trim();
  if(!text){showToast('Skriv inn fagtekst først!');return;}
  const s=getAiSettings();
  const p=`Du er norsk ungdomsskolelærer. Klassetrinn: ${s.klasse}. Vanskelighetsgrad: ${s.vanske}.${s.fag?' Fag: '+s.fag+'.':''}${s.customPrompt?' Ekstra instruksjon: '+s.customPrompt:''}
Lag oppgaver basert på denne fagteksten:
"""
${text.substring(0,2500)}
"""
Svar KUN med rå JSON, ingen forklaring, ingen markdown, ingen kodeblokker:
{"quiz":[{"question":"...","a":"riktig","b":"feil","c":"feil","d":"feil","explain":"..."}],"discussion":["..."],"write":{"title":"...","desc":"...","minWords":150},"flashcards":[{"front":"...","back":"..."}]}
Lag eksakt: ${s.quizCount} quiz-spørsmål, ${s.discCount} drøftingsspørsmål, ${s.fcCount} flashcards.${s.writeTasks?' Inkluder skriveoppgave.':' Sett write til null.'}
Alt på ${s.language}. Kortfattede svar.`;
  const res=await aiCallJSON(p,'aiSpinner',2000);
  const resultEl=document.getElementById('aiResult');
  if(!resultEl)return;
  if(!res||res.error){resultEl.innerHTML=`<div style="color:var(--c1);font-weight:800;">❌ ${escHtml(res?.error||'Feil')}</div>`;resultEl.style.display='block';return;}
  _aiDraft = {
    quiz: res.quiz?.length ? res.quiz : [],
    discussion: res.discussion?.length ? res.discussion : [],
    flashcards: res.flashcards?.length ? res.flashcards : [],
    write: (res.write && s.writeTasks) ? res.write : null,
  };
  const total = (_aiDraft.quiz?.length||0)+(_aiDraft.discussion?.length||0)+(_aiDraft.flashcards?.length||0)+(_aiDraft.write?1:0);
  if (total === 0) {
    resultEl.innerHTML = `<div style="color:var(--yellow);font-weight:800;">⚠️ AI returnerte ingen oppgaver. Prøv igjen med annen eller lengre tekst.</div>`;
    resultEl.style.display = 'block'; return;
  }
  _renderAiDraftUI('aiResult');
}

async function generateAll() {
  const text = document.getElementById('moduleText')?.value.trim();
  if (!text) { showToast('⚠️ Skriv inn fagtekst først!'); return; }
  const btn = document.getElementById('genAllSpinner')?.closest('button');
  if (btn) { btn.disabled = true; btn.style.opacity = '0.65'; }
  try {
    await generateWithAI();
  } finally {
    if (btn) { btn.disabled = false; btn.style.opacity = ''; }
  }
}

// ====== AI DRAFT SELECTION UI ======
let _aiDraft = null;

function _renderAiDraftUI(resultElId) {
  const elId = resultElId || 'aiResult';
  const el = document.getElementById(elId);
  if (!el || !_aiDraft) return;
  const regenIcon = `<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="23 4 23 10 17 10"/><polyline points="1 20 1 14 7 14"/><path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"/></svg>`;
  const row = (type, idx, inner) =>
    `<label class="ai-draft-row" id="ai-draft-${type}-${idx}">
      <input type="checkbox" class="ai-draft-cb" data-type="${type}" data-idx="${idx}" data-el="${elId}" checked style="width:16px;height:16px;accent-color:var(--accent);flex-shrink:0;cursor:pointer;margin-top:2px;">
      <div style="flex:1;min-width:0;">${inner}</div>
      <span id="ai-row-spin-${type}-${idx}" class="ai-spinner" style="display:none;border-top-color:var(--accent);flex-shrink:0;"></span>
      <button class="ai-regen-btn" data-onclick="_aiRegenerateItem" data-onclick-args="${escHtml(JSON.stringify([type,idx,elId]))}" title="Generer nytt" type="button">${regenIcon}</button>
    </label>`;
  const total = (_aiDraft.quiz?.length||0) + (_aiDraft.discussion?.length||0) + (_aiDraft.flashcards?.length||0) + (_aiDraft.write?1:0);
  let html = `<div style="font-size:0.78rem;font-weight:800;color:var(--accent);margin-bottom:0.75rem;display:flex;align-items:center;gap:0.5rem;">
    ✨ ${total} oppgave${total===1?'':'r'} generert – velg hvilke du vil legge til:
  </div>`;
  if (_aiDraft.quiz?.length) {
    html += `<div class="ai-draft-section"><div class="ai-draft-section-title">❓ Quiz (${_aiDraft.quiz.length})</div>`;
    _aiDraft.quiz.forEach((q, i) => {
      html += row('quiz', i, `<div style="font-weight:700;font-size:0.87rem;">${escHtml(q.question)}</div>
        <div style="font-size:0.75rem;color:var(--text-3);margin-top:0.15rem;">✅ ${escHtml(q.a||'')} &nbsp;·&nbsp; ❌ ${escHtml(q.b||'')}</div>`);
    });
    html += '</div>';
  }
  if (_aiDraft.discussion?.length) {
    html += `<div class="ai-draft-section"><div class="ai-draft-section-title">💬 Drøfting (${_aiDraft.discussion.length})</div>`;
    _aiDraft.discussion.forEach((d, i) => {
      html += row('disc', i, `<div style="font-size:0.87rem;">${escHtml(d)}</div>`);
    });
    html += '</div>';
  }
  if (_aiDraft.flashcards?.length) {
    html += `<div class="ai-draft-section"><div class="ai-draft-section-title">🃏 Flashcards (${_aiDraft.flashcards.length})</div>`;
    _aiDraft.flashcards.forEach((f, i) => {
      html += row('fc', i, `<div style="font-size:0.87rem;"><b>${escHtml(f.front)}</b> <span style="color:var(--text-3);">→</span> ${escHtml(f.back)}</div>`);
    });
    html += '</div>';
  }
  if (_aiDraft.write) {
    html += `<div class="ai-draft-section"><div class="ai-draft-section-title">✍️ Skriveoppgave</div>`;
    html += row('write', 0, `<div style="font-size:0.87rem;"><b>${escHtml(_aiDraft.write.title)}</b>
      <div style="font-size:0.75rem;color:var(--text-3);margin-top:0.1rem;">${escHtml(_aiDraft.write.desc||'')}</div></div>`);
    html += '</div>';
  }
  html += `<div class="ai-draft-actions">
    <button class="btn-success" data-onclick="_aiUseSelected" data-onclick-arg="${elId}" type="button">✅ Legg til valgte</button>
    <button class="ai-draft-mini-btn" data-onclick="_aiSelectAll" data-onclick-args="${escHtml(JSON.stringify([true,elId]))}" type="button">Velg alle</button>
    <button class="ai-draft-mini-btn" data-onclick="_aiSelectAll" data-onclick-args="${escHtml(JSON.stringify([false,elId]))}" type="button">Fjern alle</button>
  </div>`;
  el.style.display = 'block';
  el.innerHTML = html;
}

function _aiSelectAll(checked, elId) {
  document.querySelectorAll(`#${elId||'aiResult'} .ai-draft-cb`).forEach(cb => cb.checked = checked);
}

function _aiUseSelected(elId) {
  if (!_aiDraft) return;
  let added = 0;
  document.querySelectorAll(`#${elId||'aiResult'} .ai-draft-cb`).forEach(cb => {
    if (!cb.checked) return;
    const type = cb.dataset.type, idx = parseInt(cb.dataset.idx);
    if (type === 'quiz'  && _aiDraft.quiz?.[idx])        { state.tempQuiz.push(_aiDraft.quiz[idx]); added++; }
    if (type === 'disc'  && _aiDraft.discussion?.[idx])  { state.tempDisc.push(_aiDraft.discussion[idx]); added++; }
    if (type === 'fc'    && _aiDraft.flashcards?.[idx])  { state.tempFlashcards.push(_aiDraft.flashcards[idx]); added++; }
    if (type === 'write' && idx === 0 && _aiDraft.write) { state.tempWrite.push(_aiDraft.write); added++; }
  });
  _aiDraft = null;
  const el = document.getElementById(elId || 'aiResult');
  if (el) el.innerHTML = `<div style="background:rgba(34,197,94,0.1);border:1px solid rgba(34,197,94,0.3);border-radius:10px;padding:0.7rem 1rem;font-weight:800;color:var(--c3);">✅ ${added} oppgave${added===1?'':'r'} lagt til i forhåndsvisningen</div>`;
  renderPreviewPanel();
  updatePublishBarHint();
  showToast(`✅ ${added} oppgave${added===1?'':'r'} lagt til!`);
}

async function _aiRegenerateItem(type, idx, elId) {
  if (!_aiDraft) return;
  const s = getAiSettings();
  const text = document.getElementById('moduleText')?.value.trim() || '';
  const ctx = text ? `\nBasert på tekst: """\n${text.substring(0,1200)}\n"""` : '';
  const row = document.getElementById(`ai-draft-${type}-${idx}`);
  const btn = row?.querySelector('.ai-regen-btn');
  const spinnerId = `ai-row-spin-${type}-${idx}`;
  if (btn) { btn.disabled = true; btn.style.display = 'none'; }
  let prompt = '';
  if (type === 'quiz') {
    prompt = `Du er norsk ungdomsskolelærer. Klasse: ${s.klasse}. Vanskelighetsgrad: ${s.vanske}.${ctx}
Lag ETT nytt, variert flervalg-spørsmål. Svar KUN med JSON: {"question":"...","a":"riktig svar","b":"feil","c":"feil","d":"feil","explain":"..."} Alt på ${s.language}.`;
  } else if (type === 'disc') {
    prompt = `Lag ETT nytt drøftingsspørsmål for ungdomsskolen (${s.klasse}, ${s.vanske}).${ctx} Svar KUN med JSON: {"q":"..."} Alt på ${s.language}.`;
  } else if (type === 'fc') {
    prompt = `Lag ETT nytt flashcard (begrep → forklaring) for ${s.klasse}.${ctx} Svar KUN med JSON: {"front":"...","back":"..."} Alt på ${s.language}.`;
  } else if (type === 'write') {
    prompt = `Lag EN ny skriveoppgave for ${s.klasse}.${ctx} Svar KUN med JSON: {"title":"...","desc":"...","minWords":150} Alt på ${s.language}.`;
  }
  const res = await aiCallJSON(prompt, spinnerId, 1000);
  if (res && !res.error) {
    if (type === 'quiz'  && res.question) _aiDraft.quiz[idx] = res;
    else if (type === 'disc'  && (res.q || res.question)) _aiDraft.discussion[idx] = res.q || res.question;
    else if (type === 'fc'   && res.front)  _aiDraft.flashcards[idx] = res;
    else if (type === 'write' && res.title) _aiDraft.write = res;
    _renderAiDraftUI(elId);
    showToast('🔄 Nytt spørsmål generert!');
  } else {
    if (btn) { btn.disabled = false; btn.style.display = ''; }
    const sp = document.getElementById(spinnerId);
    if (sp) sp.style.display = 'none';
    showToast('❌ Feil ved regenerering');
  }
}

async function generateFromGoal(){
  const s=getAiSettings();
  const goal=document.getElementById('aiGoalSelect')?.value||'';
  if(!s.fag && !goal && !s.customPrompt){showToast('Skriv inn et fag, tema eller fritekst-instruks først');return;}
  const kontekst = goal
    ? `Fag: ${s.fag}. Kompetansemål: "${goal}".`
    : s.fag
      ? `Tema/fag: "${s.fag}".`
      : '';
  const p=`Du er lærer. Klassetrinn: ${s.klasse}. Vanskelighetsgrad: ${s.vanske}. ${kontekst}${s.customPrompt?' Ekstra instruksjon: '+s.customPrompt:''}
Svar KUN med rå JSON, ingen forklaring, ingen markdown, ingen kodeblokker. Formatet er:
{"quiz":[{"question":"...","a":"riktig svar","b":"feil","c":"feil","d":"feil","explain":"..."}],"discussion":["spørsmål..."],"flashcards":[{"front":"begrep","back":"forklaring"}]}
Lag eksakt: ${s.quizCount} quiz-spørsmål, ${s.discCount} drøftingsspørsmål, ${s.fcCount} flashcards. Alt på ${s.language}. Kortfattede svar.`;
  const res=await aiCallJSON(p,'goalGenSpinner',2000);
  const resultEl=document.getElementById('goalGenResult');
  if(!resultEl)return;
  if(!res||res.error){resultEl.style.display='block';resultEl.innerHTML=`<span style="color:var(--c1);">❌ ${escHtml(res?.error||'Feil')}</span>`;return;}
  _aiDraft = {
    quiz: res.quiz?.length ? res.quiz : [],
    discussion: res.discussion?.length ? res.discussion : [],
    flashcards: res.flashcards?.length ? res.flashcards : [],
    write: null,
  };
  _renderAiDraftUI('goalGenResult');
}

async function aiGenerateSingleQuiz(){
  if (!state.isTeacher) { showToast('⛔ Kun for lærere'); return; }
  const topic=document.getElementById('aiQuizTopic')?.value.trim();
  if(!topic){showToast('Skriv inn et tema');return;}
  const s=getAiSettings();
  const resultEl=document.getElementById('sqResult');
  if(resultEl){resultEl.style.display='block';resultEl.innerHTML='<span style="color:var(--text-2);">⏳ Lager spørsmål...</span>';}
  const p=`Lag ETT flervalg-spørsmål for ${s.klasse} (${s.vanske}) om: "${topic}". Svar KUN med JSON: {"question":"...","a":"riktig","b":"feil","c":"feil","d":"feil","explain":"..."} Alt på ${s.language}.`;
  const res=await aiCallJSON(p,'sqSpinner');
  if(!res||res.error){if(resultEl)resultEl.innerHTML=`<span style="color:var(--c1);">❌ ${escHtml(res?.error||'Feil')}</span>`;return;}
  if(resultEl)resultEl.innerHTML=`<div style="background:var(--s1);border-radius:12px;padding:1rem;border:1px solid var(--c3);">
    <div style="font-weight:800;margin-bottom:0.5rem;">❓ ${escHtml(res.question)}</div>
    <div style="font-size:0.88rem;color:var(--text-2);">✅ A: ${escHtml(res.a)}<br>❌ B: ${escHtml(res.b)}<br>❌ C: ${escHtml(res.c)}<br>❌ D: ${escHtml(res.d)}</div>
    <button class="btn-success" style="margin-top:0.75rem;padding:8px 18px;" onclick='useSqResult(${JSON.stringify(res).replace(/"/g,"&quot;")})'>➕ Bruk</button>
  </div>`;
}
function useSqResult(res){
  document.getElementById('quizQ').value=res.question||'';
  document.getElementById('quizA').value=res.a||'';
  document.getElementById('quizB').value=res.b||'';
  document.getElementById('quizC').value=res.c||'';
  document.getElementById('quizD').value=res.d||'';
  document.getElementById('quizExplain').value=res.explain||'';
  const el=document.getElementById('sqResult');if(el)el.style.display='none';
  document.getElementById('aiQuizTopic').value='';
}

async function aiImportQuizFromText() {
  if (!state.isTeacher) { showToast('⛔ Kun for lærere'); return; }
  const text = document.getElementById('aiImportText')?.value.trim();
  const fb = document.getElementById('aiImportFeedback');
  if (!text) { showToast('⚠️ Lim inn en tekst først'); return; }
  const count = parseInt(document.getElementById('aiImportCount')?.value || '5');
  if (fb) fb.innerHTML = '<span style="color:var(--text-2);">⏳ Genererer spørsmål...</span>';
  const prompt = `Du er norsk lærer. Lag ${count} flervalgsspørsmål på norsk for ungdomsskoleelever basert på følgende tekst:\n"""\n${text.substring(0,3000)}\n"""\nSvar KUN med JSON: {"questions":[{"q":"...","opts":["A","B","C","D"],"correct":0,"explanation":"..."}]}`;
  const res = await aiCallJSON(prompt, 'aiImportSpinner', 2500);
  if (!res || res.error || !res.questions?.length) {
    if (fb) fb.innerHTML = `<span style="color:var(--c1);">❌ ${escHtml(res?.error || 'Ingen spørsmål generert')}</span>`;
    return;
  }
  res.questions.forEach(item => {
    state.tempQuiz.push({ q: item.q, opts: (item.opts||[]).slice(0,4),
      correct: Math.min(item.correct ?? 0, (item.opts?.length||1)-1), explanation: item.explanation||'' });
  });
  renderQuizPreview();
  if (fb) fb.innerHTML = `<span style="color:var(--c3);">✅ ${res.questions.length} spørsmål lagt til!</span>`;
  showToast(`✨ ${res.questions.length} spørsmål generert!`);
}
// ====== SPØRSMÅLSBANK ======
function _renderQbank() {
  const el = document.getElementById('qbankContent');
  if (!el) return;
  const pool = [];
  (state.modules || []).forEach((m, mi) => {
    (m.quiz || []).forEach((q, qi) => {
      pool.push({ mi, qi, q: q.question||q.q||'', opts: q.opts||[q.a,q.b,q.c,q.d].filter(Boolean), correct: q.correct??0, explanation: q.explain||q.explanation||'', module: m.name });
    });
  });
  if (!pool.length) { el.innerHTML = '<p style="font-size:0.83rem;color:var(--text-3);">Ingen spørsmål i eksisterende moduler ennå.</p>'; return; }
  const qbSearch = el.querySelector('#qbankSearch')?.value || '';
  const filtered = qbSearch ? pool.filter(p => p.q.toLowerCase().includes(qbSearch.toLowerCase()) || p.module.toLowerCase().includes(qbSearch.toLowerCase())) : pool;
  el.innerHTML = `<input id="qbankSearch" type="text" placeholder="Søk i spørsmål..." data-oninput="_renderQbankDebounced" value="${escHtml(qbSearch)}"
    style="width:100%;padding:7px 11px;border:1px solid var(--border-2);border-radius:8px;font-family:'Nunito',sans-serif;font-size:0.85rem;outline:none;background:var(--s3);color:var(--text);margin-bottom:0.5rem;box-sizing:border-box;">
    <div style="max-height:220px;overflow-y:auto;display:flex;flex-direction:column;gap:0.35rem;">
    ${filtered.slice(0,30).map((p, li) => `<div class="qbank-item">
      <div style="flex:1;min-width:0;">
        <div style="font-weight:700;font-size:0.82rem;color:var(--text);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${escHtml(p.q.substring(0,100))}</div>
        <div style="font-size:0.72rem;color:var(--text-3);margin-top:2px;">📚 ${escHtml(p.module)}</div>
      </div>
      <button data-onclick="_qbankAdd" data-onclick-args="${JSON.stringify([p.mi,p.qi])}" style="background:var(--accent-g);color:var(--accent-h);border:1px solid rgba(79,110,247,0.3);border-radius:7px;padding:4px 9px;font-size:0.75rem;font-weight:800;cursor:pointer;flex-shrink:0;">＋ Legg til</button>
    </div>`).join('')}
    ${filtered.length > 30 ? `<div style="font-size:0.75rem;color:var(--text-3);text-align:center;padding:4px;">… og ${filtered.length-30} til (bruk søket for å filtrere)</div>` : ''}
    </div>`;
}
function _qbankAdd(mi, qi) {
  const q = state.modules[mi]?.quiz?.[qi];
  if (!q) return;
  state.tempQuiz.push({ question: q.question||q.q||'', a: q.a||(q.opts?.[0]||''), b: q.b||(q.opts?.[1]||''), c: q.c||(q.opts?.[2]||''), d: q.d||(q.opts?.[3]||''), explain: q.explanation||q.explain||'' });
  renderQuizPreview();
  showToast('✅ Spørsmål lagt til!');
}

function importKahootCsv() {
  if (!state.isTeacher) { showToast('⛔ Kun for lærere'); return; }
  const raw = document.getElementById('kahootCsvText')?.value.trim();
  const fb = document.getElementById('kahootFeedback');
  if (!raw) { showToast('⚠️ Lim inn CSV-tekst'); return; }
  const lines = raw.split('\n').filter(l => l.trim() && !/^Question/i.test(l.trim()));
  let added = 0;
  lines.forEach(line => {
    const cols = line.split(',').map(c => c.trim().replace(/^"|"$/g,''));
    if (cols.length < 6) return;
    const [q, a1, a2, a3, a4, , correctRaw] = cols;
    const correct = parseInt(correctRaw) - 1;
    if (!q || isNaN(correct)) return;
    const opts = [a1, a2, a3, a4].filter(Boolean);
    if (opts.length < 2) return;
    state.tempQuiz.push({ q, opts, correct: Math.min(correct, opts.length-1), explanation: '' });
    added++;
  });
  if (added) {
    renderQuizPreview();
    if (fb) fb.innerHTML = `<span style="color:var(--c3);">✅ ${added} spørsmål importert!</span>`;
    showToast(`📥 ${added} spørsmål importert fra Kahoot!`);
  } else {
    if (fb) fb.innerHTML = `<span style="color:var(--c1);">⚠️ Ingen gyldige spørsmål funnet – sjekk formatet</span>`;
    showToast('⚠️ Ingen gyldige spørsmål funnet – sjekk formatet');
  }
}

async function aiGenerateSingleDisc(){
  if (!state.isTeacher) { showToast('⛔ Kun for lærere'); return; }
  const topic=document.getElementById('aiDiscTopic')?.value.trim();
  if(!topic){showToast('Skriv inn et tema');return;}
  const s=getAiSettings();
  const resultEl=document.getElementById('sdResult');
  if(resultEl){resultEl.style.display='block';resultEl.innerHTML='<span style="color:var(--text-2);">⏳ Lager spørsmål...</span>';}
  const p=`Lag 2 drøftingsspørsmål for ${s.klasse} om: "${topic}". Svar KUN med JSON: {"questions":["...","..."]} Alt på ${s.language}.`;
  const res=await aiCallJSON(p,'sdSpinner');
  if(!res||res.error){if(resultEl)resultEl.innerHTML=`<span style="color:var(--c1);">❌ ${escHtml(res?.error||'Feil')}</span>`;return;}
  const qs=res.questions||[];
  if(resultEl)resultEl.innerHTML=`<div style="display:flex;flex-direction:column;gap:0.5rem;">`+
    qs.map(q=>`<div style="background:var(--s1);border-radius:10px;padding:0.875rem;border:1px solid var(--c5);">
      <div style="font-size:0.92rem;font-weight:700;margin-bottom:0.5rem;">💬 ${escHtml(q)}</div>
      <button style="background:var(--c5);color:white;border:none;padding:6px 14px;border-radius:50px;font-family:'Nunito',sans-serif;font-weight:800;font-size:0.82rem;cursor:pointer;" data-onclick="useSdResult" data-onclick-args="${escHtml(JSON.stringify([q]))}">➕ Bruk</button>
    </div>`).join('')+`</div>`;
}
function useSdResult(q){const el=document.getElementById('discQ');if(el)el.value=q;const r=document.getElementById('sdResult');if(r)r.style.display='none';}

async function aiGenerateWriteTask(){
  if (!state.isTeacher) { showToast('⛔ Kun for lærere'); return; }
  const topic=document.getElementById('aiWriteTopic')?.value.trim();
  if(!topic){showToast('Skriv inn et tema');return;}
  const s=getAiSettings();
  const resultEl=document.getElementById('swResult');
  if(resultEl){resultEl.style.display='block';resultEl.innerHTML='<span style="color:var(--text-2);">⏳ Lager skriveoppgave...</span>';}
  const p=`Lag EN skriveoppgave for ${s.klasse} om: "${topic}". Svar KUN med JSON: {"title":"...","desc":"Instruksjon til eleven...","minWords":150} Alt på ${s.language}.`;
  const res=await aiCallJSON(p,'swSpinner');
  if(!res||res.error){if(resultEl)resultEl.innerHTML=`<span style="color:var(--c1);">❌ ${escHtml(res?.error||'Feil')}</span>`;return;}
  if(resultEl)resultEl.innerHTML=`<div style="background:var(--s1);border-radius:12px;padding:1rem;border:1px solid var(--c3);">
    <div style="font-weight:800;margin-bottom:0.3rem;">✍️ ${escHtml(res.title)}</div>
    <div style="font-size:0.88rem;color:var(--text-2);margin-bottom:0.5rem;">${escHtml(res.desc)}</div>
    <div style="font-size:0.8rem;color:var(--text-3);">Min. ${res.minWords} ord</div>
    <button class="btn-success" style="margin-top:0.75rem;padding:7px 16px;" onclick='useSwResult(${JSON.stringify(res).replace(/"/g,"&quot;")})'>➕ Bruk</button>
  </div>`;
}
function useSwResult(res){
  document.getElementById('writeTitle').value=res.title||'';
  document.getElementById('writeDesc').value=res.desc||'';
  document.getElementById('writeMin').value=res.minWords||100;
  const el=document.getElementById('swResult');if(el)el.style.display='none';
}

async function aiGenerateVideo(){
  if (!state.isTeacher) { showToast('⛔ Kun for lærere'); return; }
  const topic=document.getElementById('aiVideoTopic')?.value.trim();
  if(!topic){showToast('Skriv inn et tema');return;}
  const s=getAiSettings();
  const resultEl=document.getElementById('svResult');
  if(resultEl){resultEl.style.display='block';resultEl.innerHTML='<div style="color:var(--text-2);padding:0.5rem 0;">⏳ Søker etter videoer…</div>';}
  const p=`Du er norsk ungdomsskolelærer (${s.klasse}).${s.fag?' Fag: '+s.fag+'.':''} Foreslå 3 YouTube-videoer om: "${topic}" for norske ungdomsskoleelever.
Bruk kun kjente kanaler (NRK Skole, Crash Course, Kurzgesagt, Khan Academy osv.). Kun foreslå videoer du er sikker på eksisterer.
Svar KUN med JSON: {"videos":[{"title":"...","ytId":"11-tegns-ID eller null","searchUrl":"https://www.youtube.com/results?search_query=...","channel":"...","task":"Refleksjonsoppgave...","confident":true}]}`;
  const res=await aiCallJSON(p,'svSpinner',2000);
  if(!res||res.error){if(resultEl)resultEl.innerHTML=`<span style="color:var(--c1);">❌ ${escHtml(res?.error||'Feil')}</span>`;return;}
  const vids=res.videos||[];
  if(resultEl)resultEl.innerHTML=`<div style="display:flex;flex-direction:column;gap:0.875rem;">`+
    vids.map((v,i)=>{
      const ytId=v.ytId&&v.ytId.length===11?v.ytId:null;
      const finalUrl=ytId?`https://www.youtube.com/watch?v=${ytId}`:(v.searchUrl||'');
      const safeV=JSON.stringify({title:v.title,url:finalUrl,task:v.task||''}).replace(/'/g,"&#39;").replace(/"/g,"&quot;");
      return `<div style="background:var(--s1);border-radius:14px;padding:0.875rem;border:1px solid var(--border);">
        ${ytId?`<img src="https://img.youtube.com/vi/${ytId}/mqdefault.jpg" style="width:100%;border-radius:10px;margin-bottom:0.5rem;cursor:pointer;" loading="lazy" data-hid="${_reg(function(){svToggleEmbed('svembed-${i}','${ytId}')})}" /><div id="svembed-${i}" style="display:none;margin-bottom:0.5rem;"><iframe width="100%" height="200" src="https://www.youtube.com/embed/${ytId}" frameborder="0" allowfullscreen style="border-radius:10px;"></iframe></div>`
        :`<div style="background:var(--s2);border-radius:10px;padding:1rem;text-align:center;margin-bottom:0.5rem;"><a href="${escHtml(v.searchUrl||'')}" target="_blank" style="color:var(--c4);font-weight:800;">🔍 Søk på YouTube</a></div>`}
        <div style="font-weight:800;font-size:0.92rem;margin-bottom:0.2rem;">🎬 ${escHtml(v.title)}</div>
        ${v.channel?`<div style="font-size:0.75rem;color:var(--text-3);margin-bottom:0.3rem;">📺 ${escHtml(v.channel)}</div>`:''}
        ${v.task?`<div style="font-size:0.82rem;color:var(--text-2);background:var(--s2);border-radius:8px;padding:0.5rem;margin:0.4rem 0;">📋 ${escHtml(v.task)}</div>`:''}
        <div style="display:flex;gap:0.4rem;flex-wrap:wrap;margin-top:0.5rem;">
          ${ytId?`<button style="background:var(--c3);color:white;border:none;padding:6px 12px;border-radius:50px;font-family:'Nunito',sans-serif;font-weight:800;font-size:0.78rem;cursor:pointer;" data-hid="${_reg(function(){svToggleEmbed('svembed-${i}','${ytId}')})}">▶ Spill av</button>`:''}
          <a href="${escHtml(v.searchUrl||finalUrl)}" target="_blank" style="background:var(--s3);color:var(--text-2);padding:6px 12px;border-radius:50px;font-family:'Nunito',sans-serif;font-weight:800;font-size:0.78rem;text-decoration:none;">🔍 Søk</a>
          <button style="background:var(--c4);color:white;border:none;padding:6px 14px;border-radius:50px;font-family:'Nunito',sans-serif;font-weight:800;font-size:0.78rem;cursor:pointer;" onclick='useSvResult(${safeV})'>➕ Legg til</button>
        </div>
      </div>`;
    }).join('')+'</div>';
}
function useSvResult(v){
  document.getElementById('videoTitle').value=v.title||'';
  document.getElementById('videoUrl').value=v.url||'';
  document.getElementById('videoTask').value=v.task||'';
  const el=document.getElementById('svResult');if(el)el.style.display='none';
  previewManualVideo();
  showToast('✅ Video lagt i skjema – trykk «Legg til» for å lagre');
}

async function aiGenerateFlashcards(){
  const topic=document.getElementById('aiFcTopic')?.value.trim();
  if(!topic){showToast('Skriv inn et tema');return;}
  const s=getAiSettings();
  const resultEl=document.getElementById('fcAiResult');
  if(resultEl){resultEl.style.display='block';resultEl.innerHTML='<span style="color:var(--text-2);">⏳ Lager flashcards...</span>';}
  const p=`Lag ${s.fcCount} flashcards for ${s.klasse} (${s.vanske}) om: "${topic}". Svar KUN med JSON: {"cards":[{"front":"Begrep","back":"Definisjon"}]} Alt på ${s.language}.`;
  const res=await aiCallJSON(p,'fcAiSpinner');
  if(!res||res.error){if(resultEl)resultEl.innerHTML=`<span style="color:var(--c1);">❌ ${escHtml(res?.error||'Feil')}</span>`;return;}
  const cards=res.cards||[];
  if(resultEl)resultEl.innerHTML=`<div style="font-weight:800;margin-bottom:0.5rem;">📋 ${cards.length} flashcards:</div>
    <div style="display:flex;flex-direction:column;gap:0.3rem;margin-bottom:0.75rem;">${cards.map(c=>`<div style="background:var(--s2);border-radius:8px;padding:0.5rem 0.875rem;font-size:0.88rem;border:1px solid var(--border);"><b>${escHtml(c.front)}</b> → ${escHtml(c.back)}</div>`).join('')}</div>
    <button class="btn-success" style="padding:8px 18px;" onclick='useFcAiResult(${JSON.stringify(cards).replace(/'/g,"&#39;").replace(/"/g,"&quot;")})'>➕ Legg til alle</button>`;
}
function useFcAiResult(cards){
  cards.forEach(c=>state.tempFlashcards.push({front:c.front,back:c.back}));
  const el=document.getElementById('fcPreview');if(el)el.innerHTML=`<span style="color:var(--c3);font-weight:800;">✅ ${state.tempFlashcards.length} flashcards totalt</span>`;
  const r=document.getElementById('fcAiResult');if(r)r.style.display='none';
  renderPreviewPanel();updatePublishBarHint();
}

async function generateFromFile(){
  if(!uploadedFileText&&!uploadedFileBase64){showToast('Last opp et dokument først');return;}
  const s=getAiSettings();
  const spinner=document.getElementById('fileAiSpinner');
  if(spinner)spinner.style.display='inline-block';
  const textEl=document.getElementById('moduleText');
  let msgContent=[];
  if(uploadedFileMime==='application/pdf'&&uploadedFileBase64){
    msgContent=[{type:'document',source:{type:'base64',media_type:'application/pdf',data:uploadedFileBase64}},{type:'text',text:`Klassetrinn: ${s.klasse}. Vanskelighetsgrad: ${s.vanske}. Lag ${s.quizCount} quiz-spørsmål, ${s.discCount} drøftingsspørsmål og ${s.fcCount} flashcards fra dette dokumentet. Svar KUN med JSON: {"quiz":[...],"discussion":[...],"flashcards":[...]}`}];
  }else{
    msgContent=[{type:'text',text:`Klassetrinn: ${s.klasse}. Lag oppgaver fra:\n${uploadedFileText.substring(0,4000)}\nSvar KUN med JSON: {"quiz":[{"question":"...","a":"...","b":"...","c":"...","d":"...","explain":"..."}],"discussion":["..."],"flashcards":[{"front":"...","back":"..."}]}`}];
  }
  try{
    const key=getApiKey();if(!key){showToast('Ingen API-nøkkel!');return;}
    const res=await _anthropicFetch('https://api.anthropic.com/v1/messages',{method:'POST',headers:{'Content-Type':'application/json','x-api-key':key,'anthropic-version':'2023-06-01','anthropic-dangerous-direct-browser-access':'true'},body:JSON.stringify({model:'claude-sonnet-4-20250514',max_tokens:1800,messages:[{role:'user',content:msgContent}]})});
    const data=await res.json();
    const text=data.content?.[0]?.text||'';
    const clean=text.replace(/```json|```/g,'').trim();
    const parsed=JSON.parse(clean);
    if(parsed.quiz?.length)parsed.quiz.forEach(q=>state.tempQuiz.push(q));
    if(parsed.discussion?.length)parsed.discussion.forEach(d=>state.tempDisc.push(d));
    if(parsed.flashcards?.length)parsed.flashcards.forEach(f=>state.tempFlashcards.push(f));
    const resultEl=document.getElementById('fileAiResult');
    if(resultEl){resultEl.style.display='block';resultEl.innerHTML=`<div style="background:#dcfce7;border-radius:12px;padding:1rem;border:2px solid var(--c3);font-weight:800;color:#166534;">✅ Generert fra dokument!</div>`;}
    renderPreviewPanel();updatePublishBarHint();showToast('✅ Oppgaver generert fra dokument!');
  }catch(e){showToast('❌ Feil: '+e.message);}
  finally{if(spinner)spinner.style.display='none';}
}

function useFileAsText(){
  const el=document.getElementById('moduleText');
  if(el&&uploadedFileText){el.value=uploadedFileText;showToast('📋 Tekst lagt inn i fagtekstfeltet!');}
}

function handleFileDrop(e){
  e.preventDefault();
  const dz=document.getElementById('dropZoneFile');
  if(dz){dz.style.background='rgba(255,255,255,0.06)';}
  const file=e.dataTransfer.files[0];
  if(file)processFile(file);
}
function handleFileSelect(e){const file=e.target.files[0];if(file)processFile(file);}
function clearFile(){
  uploadedFileText='';uploadedFileName='';uploadedFileBase64='';uploadedFileMime='';
  const fpb=document.getElementById('filePreviewBox');if(fpb)fpb.style.display='none';
  const fs=document.getElementById('fileStatus');if(fs)fs.style.display='none';
  const far=document.getElementById('fileAiResult');if(far)far.style.display='none';
  const dz=document.getElementById('dropZoneFile');
  if(dz){const dl=document.getElementById('dropLabel');if(dl)dl.textContent='Last opp dokument';}
}

async function processFile(file){
  uploadedFileName=file.name;
  uploadedFileMime=file.type;
  const statusEl=document.getElementById('fileStatus');
  const previewBox=document.getElementById('filePreviewBox');
  const previewName=document.getElementById('filePreviewName');
  const previewText=document.getElementById('filePreviewText');
  if(statusEl){statusEl.style.display='block';statusEl.style.background='#f0f9ff';statusEl.style.color='#0369a1';statusEl.textContent='⏳ Leser fil: '+file.name;}
  try{
    if(file.type==='application/pdf'){
      const ab=await file.arrayBuffer();
      const arr=new Uint8Array(ab);
      let binary='';arr.forEach(b=>binary+=String.fromCharCode(b));
      uploadedFileBase64=btoa(binary);
      uploadedFileText='[PDF-dokument lastet opp: '+file.name+']';
    }else if(file.name.endsWith('.docx')||file.name.endsWith('.doc')){
      const ab=await file.arrayBuffer();
      await _loadScript(_CDN_MAMMOTH);
      const htmlResult=await mammoth.convertToHtml({arrayBuffer:ab});
      const rawResult=await mammoth.extractRawText({arrayBuffer:ab});
      uploadedFileText=rawResult.value;
      if(previewText){previewText.innerHTML=sanitizeHTML(htmlResult.value.substring(0,1200)+(htmlResult.value.length>1200?'…':''));previewText._isHtml=true;}
    }else if(file.name.endsWith('.pptx')){
      const ab=await file.arrayBuffer();
      await _loadScript(_CDN_JSZIP);
      const zip=await JSZip.loadAsync(ab);
      let text='';
      const slideFiles=Object.keys(zip.files).filter(f=>f.match(/ppt\/slides\/slide\d+\.xml/)).sort();
      for(let i=0;i<slideFiles.length;i++){const xml=await zip.files[slideFiles[i]].async('text');const matches=xml.match(/<a:t>([^<]*)<\/a:t>/g)||[];const content=matches.map(m=>m.replace(/<[^>]+>/g,'')).join(' ').trim();if(content)text+='--- Lysbilde '+(i+1)+' ---\n'+content+'\n\n';}
      uploadedFileText=text;
    }else{uploadedFileText=await file.text();}
    if(statusEl){statusEl.style.background='#dcfce7';statusEl.style.color='#166534';statusEl.textContent='✅ '+file.name+' lastet inn';}
    if(previewBox)previewBox.style.display='block';
    if(previewName)previewName.textContent=file.name;
    if(previewText&&!previewText._isHtml){previewText.textContent=uploadedFileText.substring(0,400)+(uploadedFileText.length>400?'...':'');}
    if(previewText)previewText._isHtml=false;
    const dl=document.getElementById('dropLabel');if(dl)dl.textContent='📄 '+file.name;
  }catch(e){if(statusEl){statusEl.style.background='#fee2e2';statusEl.style.color='#991b1b';statusEl.textContent='❌ Feil ved lesing: '+e.message;}}
}


// ====== URL ANALYSE ======
let uploadedImageBase64 = '';
let uploadedImageMime = '';
let uploadedImageName = '';

async function generateFromUrl() {
  const urlInput = document.getElementById('aiUrlInput');
  const url = urlInput?.value.trim();
  if (!url || !url.startsWith('http')) { showToast('Lim inn en gyldig URL (https://...)'); return; }
  const spinner = document.getElementById('urlAiSpinner');
  const statusEl = document.getElementById('urlStatus');
  const resultEl = document.getElementById('urlAiResult');
  if (spinner) spinner.style.display = 'inline-block';
  if (statusEl) { statusEl.style.display = 'block'; statusEl.style.background = 'rgba(255,255,255,0.08)'; statusEl.style.color = 'rgba(255,255,255,0.7)'; statusEl.textContent = '⏳ Henter innhold fra ' + url + '...'; }
  if (resultEl) resultEl.style.display = 'none';

  const key = getApiKey();
  if (!key) { showToast('Ingen API-nøkkel!'); if (spinner) spinner.style.display = 'none'; return; }

  try {
    const s = getAiSettings();
    // Use Claude directly with the URL - it will use web_search/fetch capability
    // We send the URL as context and ask Claude to generate tasks
    const prompt = `Gå til denne nettsiden og les innholdet: ${url}

Basert på innholdet på siden, lag følgende oppgaver for ${s.klasse} (${s.vanske}):
- ${s.quizCount} flervalg quiz-spørsmål (4 alternativer, ett riktig)
- ${s.discCount} drøftingsspørsmål
- ${s.fcCount} flashcards med begrep og forklaring

${s.fag ? 'Fag: ' + s.fag + '.' : ''} ${s.customPrompt ? 'Ekstra instruksjon: ' + s.customPrompt : ''}

Svar KUN med JSON (ingen annen tekst):
{"quiz":[{"question":"...","a":"riktig svar","b":"feil","c":"feil","d":"feil","explain":"..."}],"discussion":["..."],"flashcards":[{"front":"Begrep","back":"Forklaring"}]}

Alt på ${s.language}.`;

    const res = await _anthropicFetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-api-key': key, 'anthropic-version': '2023-06-01', 'anthropic-dangerous-direct-browser-access': 'true' },
      body: JSON.stringify({
        model: 'claude-sonnet-4-20250514',
        max_tokens: 2000,
        tools: [{ type: 'web_search_20250305', name: 'web_search' }],
        messages: [{ role: 'user', content: prompt }]
      })
    });
    const data = await res.json();
    // Extract text from potentially mixed content blocks
    const fullText = (data.content || []).map(b => b.type === 'text' ? b.text : '').join('');
    const clean = fullText.replace(/```json|```/g, '').trim();
    // Find the JSON object in the response
    const jsonMatch = clean.match(/\{[\s\S]*\}/);
    if (!jsonMatch) throw new Error('Fikk ikke gyldig svar fra AI');
    const parsed = JSON.parse(jsonMatch[0]);

    let added = 0;
    if (parsed.quiz?.length) { parsed.quiz.forEach(q => state.tempQuiz.push(q)); added += parsed.quiz.length; }
    if (parsed.discussion?.length) { parsed.discussion.forEach(d => state.tempDisc.push(d)); added += parsed.discussion.length; }
    if (parsed.flashcards?.length) { parsed.flashcards.forEach(f => state.tempFlashcards.push(f)); added += parsed.flashcards.length; }

    if (statusEl) { statusEl.style.background = 'rgba(34,197,94,0.15)'; statusEl.style.color = '#4ade80'; statusEl.textContent = `✅ Hentet innhold og genererte ${added} oppgaver fra ${url}`; }
    renderPreviewPanel(); updatePublishBarHint();
    showToast('✅ ' + added + ' oppgaver generert fra URL!');
  } catch (e) {
    if (statusEl) { statusEl.style.background = 'rgba(239,68,68,0.15)'; statusEl.style.color = '#f87171'; statusEl.textContent = '❌ Feil: ' + e.message; }
    showToast('❌ ' + e.message);
  } finally {
    if (spinner) spinner.style.display = 'none';
  }
}

// ====== BILDE OPPLASTING ======
function handleImgDrop(e) {
  e.preventDefault();
  document.getElementById('imgDropZone').style.borderColor = 'rgba(255,255,255,0.2)';
  const file = e.dataTransfer.files[0];
  if (file) processImage(file);
}
function handleImgSelect(e) {
  const file = e.target.files[0];
  if (file) processImage(file);
}
function clearImg() {
  uploadedImageBase64 = ''; uploadedImageMime = ''; uploadedImageName = '';
  const pb = document.getElementById('imgPreviewBox'); if (pb) pb.style.display = 'none';
  const dl = document.getElementById('imgDropLabel'); if (dl) dl.textContent = 'Last opp bilde';
  const inp = document.getElementById('imgUploadInput'); if (inp) inp.value = '';
  const res = document.getElementById('imgAiResult'); if (res) res.style.display = 'none';
}

async function processImage(file) {
  if (!file.type.startsWith('image/')) { showToast('Kun bildefiler støttes'); return; }
  if (file.size > 5 * 1024 * 1024) { showToast('Bildet er for stort (maks 5 MB)'); return; }
  uploadedImageMime = file.type;
  uploadedImageName = file.name;

  const reader = new FileReader();
  reader.onload = (e) => {
    const dataUrl = e.target.result;
    uploadedImageBase64 = dataUrl.split(',')[1];

    // Show preview
    const pb = document.getElementById('imgPreviewBox'); if (pb) pb.style.display = 'block';
    const thumb = document.getElementById('imgPreviewThumb'); if (thumb) thumb.src = dataUrl;
    const name = document.getElementById('imgPreviewName'); if (name) name.textContent = file.name;
    const desc = document.getElementById('imgPreviewDesc'); if (desc) desc.textContent = `${(file.size/1024).toFixed(0)} KB · ${file.type.split('/')[1].toUpperCase()}`;
    const dl = document.getElementById('imgDropLabel'); if (dl) dl.textContent = '✅ ' + file.name;
    showToast('✅ Bilde lastet inn – klar til analyse');
  };
  reader.readAsDataURL(file);
}

async function generateFromImage() {
  if (!uploadedImageBase64) { showToast('Last opp et bilde først'); return; }
  const spinner = document.getElementById('imgAiSpinner');
  const resultEl = document.getElementById('imgAiResult');
  const descEl = document.getElementById('imgPreviewDesc');
  if (spinner) spinner.style.display = 'inline-block';
  if (descEl) descEl.textContent = '⏳ Analyserer bilde...';

  const key = getApiKey();
  if (!key) { showToast('Ingen API-nøkkel!'); if (spinner) spinner.style.display = 'none'; return; }

  try {
    const s = getAiSettings();
    const prompt = `Se på dette bildet og lag undervisningsoppgaver for ${s.klasse} (${s.vanske}) basert på hva du ser.${s.fag ? ' Fag: ' + s.fag + '.' : ''}${s.customPrompt ? ' ' + s.customPrompt : ''}

Lag: ${s.quizCount} flervalg quiz-spørsmål, ${s.discCount} drøftingsspørsmål, ${s.fcCount} flashcards.

Svar KUN med JSON:
{"quiz":[{"question":"...","a":"riktig","b":"feil","c":"feil","d":"feil","explain":"..."}],"discussion":["..."],"flashcards":[{"front":"Begrep","back":"Forklaring"}],"bildebeskrivelse":"Kort beskrivelse av bildet"}

Alt på ${s.language}.`;

    const res = await _anthropicFetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-api-key': key, 'anthropic-version': '2023-06-01', 'anthropic-dangerous-direct-browser-access': 'true' },
      body: JSON.stringify({
        model: 'claude-sonnet-4-20250514',
        max_tokens: 2000,
        messages: [{
          role: 'user',
          content: [
            { type: 'image', source: { type: 'base64', media_type: uploadedImageMime, data: uploadedImageBase64 } },
            { type: 'text', text: prompt }
          ]
        }]
      })
    });
    const data = await res.json();
    const text = (data.content || []).map(b => b.type === 'text' ? b.text : '').join('');
    const jsonMatch = text.replace(/```json|```/g, '').trim().match(/\{[\s\S]*\}/);
    if (!jsonMatch) throw new Error('Fikk ikke gyldig JSON fra AI');
    const parsed = JSON.parse(jsonMatch[0]);

    let added = 0;
    if (parsed.quiz?.length) { parsed.quiz.forEach(q => state.tempQuiz.push(q)); added += parsed.quiz.length; }
    if (parsed.discussion?.length) { parsed.discussion.forEach(d => state.tempDisc.push(d)); added += parsed.discussion.length; }
    if (parsed.flashcards?.length) { parsed.flashcards.forEach(f => state.tempFlashcards.push(f)); added += parsed.flashcards.length; }

    if (descEl) descEl.textContent = `✅ ${parsed.bildebeskrivelse || 'Analysert'}`;
    if (resultEl) {
      resultEl.style.display = 'block';
      resultEl.innerHTML = `<div style="background:rgba(34,197,94,0.12);border-radius:10px;padding:0.875rem;border:1px solid rgba(34,197,94,0.3);font-weight:700;color:#4ade80;font-size:0.88rem;">
        ✅ Genererte ${added} oppgaver fra bildet${parsed.bildebeskrivelse ? '<br><span style="color:rgba(255,255,255,0.5);font-weight:600;">'+escHtml(parsed.bildebeskrivelse)+'</span>' : ''}
      </div>`;
    }
    renderPreviewPanel(); updatePublishBarHint();
    showToast('✅ ' + added + ' oppgaver fra bilde!');
  } catch (e) {
    if (descEl) descEl.textContent = '❌ Feil: ' + e.message;
    showToast('❌ ' + e.message);
  } finally {
    if (spinner) spinner.style.display = 'none';
  }
}
// ====== END URL/IMAGE ======

// ====== RELATIVE TIME ======
function relativeTime(dateStr) {
  if (!dateStr) return '';
  const d = new Date(dateStr);
  if (isNaN(d.getTime())) return String(dateStr);
  const diff = Date.now() - d.getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'akkurat nå';
  if (mins < 60) return `for ${mins} min siden`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `for ${hrs} time${hrs > 1 ? 'r' : ''} siden`;
  const days = Math.floor(hrs / 24);
  if (days < 7) return `for ${days} dag${days > 1 ? 'er' : ''} siden`;
  return d.toLocaleDateString('no');
}

// ====== TOAST ======
function showToast(msg, duration=3200){
  let t=document.getElementById('globalToast');
  if(!t){t=document.createElement('div');t.id='globalToast';t.className='toast';t.setAttribute('aria-live','polite');t.setAttribute('role','status');document.body.appendChild(t);}
  t.textContent = msg;
  t.style.setProperty('--toast-dur', duration + 'ms');
  // Re-trigger ::after animation by toggling show
  t.classList.remove('show');
  requestAnimationFrame(() => {
    requestAnimationFrame(() => { t.classList.add('show'); });
  });
  clearTimeout(t._timer);
  t._timer=setTimeout(()=>t.classList.remove('show'), duration);
}

function _showUndoToast(msg, onUndo, duration=5000) {
  let t = document.getElementById('globalToast');
  if (!t) { t = document.createElement('div'); t.id = 'globalToast'; t.className = 'toast'; t.setAttribute('aria-live','polite'); t.setAttribute('role','status'); document.body.appendChild(t); }
  t.innerHTML = '';
  const span = document.createElement('span'); span.textContent = msg;
  const btn = document.createElement('button');
  btn.textContent = 'Angre'; btn.style.cssText = 'margin-left:0.75rem;background:rgba(255,255,255,0.25);border:none;border-radius:6px;padding:3px 10px;font-weight:800;cursor:pointer;color:inherit;font-size:0.85rem;';
  btn.onclick = () => { t.classList.remove('show'); clearTimeout(t._timer); onUndo(); };
  const bar = document.createElement('div'); bar.className = 'toast-bar'; bar.style.animation = 'none';
  t.appendChild(span); t.appendChild(btn); t.appendChild(bar);
  t.classList.add('show');
  requestAnimationFrame(() => requestAnimationFrame(() => { bar.style.animation = `toastShrink ${duration}ms linear forwards`; }));
  clearTimeout(t._timer); t._timer = setTimeout(() => t.classList.remove('show'), duration);
}

// ===== STYLED CONFIRM DIALOG =====
function _showConfirm(msg, onYes, yesLabel='Slett', yesColor='var(--c1)') {
  const ov = document.createElement('div');
  ov.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.65);backdrop-filter:blur(6px);z-index:9999;display:flex;align-items:center;justify-content:center;animation:fadeIn 0.15s ease;';
  ov.innerHTML = `<div style="background:var(--s2);border:1px solid var(--border-2);border-radius:16px;padding:1.5rem 1.75rem;max-width:320px;width:90%;text-align:center;box-shadow:0 8px 40px rgba(0,0,0,0.8);">
    <p style="color:var(--text);font-size:0.95rem;font-weight:600;margin:0 0 1.25rem;line-height:1.5;">${escHtml(msg)}</p>
    <div style="display:flex;gap:0.75rem;justify-content:center;">
      <button id="_cfNo" style="padding:9px 22px;border-radius:8px;border:1px solid var(--border-2);background:var(--s3);color:var(--text-2);cursor:pointer;font-weight:600;font-size:0.9rem;">Avbryt</button>
      <button id="_cfYes" style="padding:9px 22px;border-radius:8px;border:none;background:${yesColor};color:white;cursor:pointer;font-weight:700;font-size:0.9rem;">${yesLabel}</button>
    </div>
  </div>`;
  document.body.appendChild(ov);
  const close = () => ov.remove();
  ov.querySelector('#_cfYes').onclick = () => { close(); onYes(); };
  ov.querySelector('#_cfNo').onclick = close;
  ov.addEventListener('click', e => { if (e.target === ov) close(); });
  ov.querySelector('#_cfNo').focus();
}

// ===== TEKST-TIL-TALE =====
function ttsSpeak(text, btnEl) {
  if (!window.speechSynthesis) { showToast('⚠️ Nettleseren din støtter ikke tale'); return; }
  if (window.speechSynthesis.speaking) {
    window.speechSynthesis.cancel();
    if (btnEl) { btnEl.textContent = '🔊 Les høyt'; btnEl.classList.remove('speaking'); }
    return;
  }
  const utt = new SpeechSynthesisUtterance(text);
  utt.lang = 'nb-NO'; utt.rate = 0.95; utt.pitch = 1;
  const trySpeak = () => {
    const voices = speechSynthesis.getVoices();
    const no = voices.find(v => v.lang.startsWith('nb') || v.lang.startsWith('no'));
    if (no) utt.voice = no;
    utt.onend = () => { if (btnEl) { btnEl.textContent = '🔊 Les høyt'; btnEl.classList.remove('speaking'); } };
    utt.onerror = () => { if (btnEl) { btnEl.textContent = '🔊 Les høyt'; btnEl.classList.remove('speaking'); } };
    if (btnEl) { btnEl.textContent = '⏹ Stopp'; btnEl.classList.add('speaking'); }
    speechSynthesis.speak(utt);
  };
  if (speechSynthesis.getVoices().length === 0) {
    speechSynthesis.onvoiceschanged = () => { speechSynthesis.onvoiceschanged = null; trySpeak(); };
  } else {
    trySpeak();
  }
}

// ====== CONFETTI ======
function launchConfetti(){
  if (_usSettings && _usSettings.confetti === false) return;
  const colors=['#FF6B6B','#FFD93D','#6BCB77','#4D96FF','#C77DFF'];
  for(let i=0;i<60;i++){
    const el=document.createElement('div');
    el.style.cssText=`position:fixed;top:-10px;left:${Math.random()*100}vw;width:${6+Math.random()*8}px;height:${6+Math.random()*8}px;background:${colors[Math.floor(Math.random()*colors.length)]};border-radius:${Math.random()>0.5?'50%':'2px'};z-index:9999;pointer-events:none;animation:confettiFall ${1.5+Math.random()}s ease-in forwards;`;
    document.body.appendChild(el);setTimeout(()=>el.remove(),3000);
  }
}
if(!document.getElementById('confettiStyle')){const s=document.createElement('style');s.id='confettiStyle';s.textContent='@keyframes confettiFall{to{transform:translateY(110vh) rotate(720deg);opacity:0;}}';document.head.appendChild(s);}


// ╔══════════════════════════════════════════════════════════════╗
// ║       OLASKOLE DATABASE LAYER  ·  Supabase backend          ║
// ║  Falls back to localStorage when not configured             ║
// ╚══════════════════════════════════════════════════════════════╝

// ════════════════════════════════════════════════════════════════
//  OLASKOLE · DATABASE LAYER
//  Supabase REST API · localStorage fallback
//  URL og nøkkel settes i Innstillinger (kryptert i localStorage).
// ════════════════════════════════════════════════════════════════
let SB_URL = '';
let SB_KEY = '';

function isDbConfigured() {
  return !!(SB_URL && SB_KEY);
}

const DB = {
  // ── Intern hjelper: send en REST-forespørsel til Supabase ──────────
  async _q(method, table, params, body) {
    if (!isDbConfigured()) return null;
    const url = SB_URL + '/rest/v1/' + table + (params ? '?' + params : '');
    const headers = {
      'apikey':        SB_KEY,
      'Authorization': 'Bearer ' + SB_KEY,
      'Content-Type':  'application/json',
      'Prefer':        (method === 'POST') ? 'resolution=merge-duplicates,return=minimal'
                     : (method === 'DELETE') ? 'return=minimal'
                     : (method === 'PATCH')  ? 'return=minimal'
                     : ''
    };
    try {
      const res = await fetch(url, {
        method,
        headers,
        body: body !== undefined ? JSON.stringify(body) : undefined
      });
      if (!res.ok) {
        const err = await res.text();
        console.error('[DB]', method, table, res.status, err.substring(0, 200));
        return null;
      }
      const text = await res.text();
      return (text && text !== 'null') ? JSON.parse(text) : [];
    } catch (e) {
      // «Failed to fetch» betyr vanligvis at Supabase-prosjektet er på pause
      // Gå til supabase.com → åpne prosjektet → klikk «Resume project»
      if (e.message === 'Failed to fetch' || e.message.includes('fetch')) {
        console.error('[DB] KAN IKKE NÅ SUPABASE – prosjektet er sannsynligvis på pause!\n→ Gå til supabase.com, åpne prosjektet og klikk «Resume project»');
        DB._paused = true;
      } else {
        console.error('[DB] fetch-feil:', method, table, e.message);
      }
      return null;
    }
  },

  // ── MODULER (lærers innhold) ───────────────────────────────────────
  async loadModules() {
    const rows = await this._q('GET', 'os_modules', 'order=created_at.asc&select=id,data,sort_order');
    if (rows === null) {
      try { return JSON.parse(localStorage.getItem('lh_modules') || '[]'); } catch { return []; }
    }
    if (rows.length === 0) return [];

    // ── Dedupliser: grupper på data._id, behold kun én rad per modul ──
    // Rader uten data._id er gamle/korrupte og skal slettes
    const keepIds   = [];   // rad-IDer vi beholder
    const deleteIds = [];   // rad-IDer vi sletter
    const seenModIds = new Map(); // data._id → rad-id

    rows.forEach(r => {
      const modId = r.data && r.data._id;
      if (!modId) {
        // Rad uten _id i data – slett den
        deleteIds.push(r.id);
      } else if (seenModIds.has(modId)) {
        // Duplikat – slett den (beholder den første)
        deleteIds.push(r.id);
      } else {
        seenModIds.set(modId, r.id);
        keepIds.push(r);
      }
    });

    // Slett søppel-rader fra Supabase i bakgrunnen
    if (deleteIds.length > 0) {
      console.log('[DB] Rydder', deleteIds.length, 'duplikat/korrupte rader fra Supabase');
      for (const did of deleteIds) {
        this._q('DELETE', 'os_modules', 'id=eq.' + did);
      }
    }

    // Sorter på sort_order
    keepIds.sort((a, b) => (a.sort_order || 0) - (b.sort_order || 0));
    const mods = keepIds.map(r => r.data).filter(Boolean);
    localStorage.setItem('lh_modules', JSON.stringify(mods));
    return mods;
  },

  async saveModules(modules) {
    // Filtrer vekk demo-moduler – de skal aldri lagres til Supabase
    const realModules = modules.filter(m => !m._isDemo);
    realModules.forEach((m, i) => {
      if (!m._id) { const b = crypto.getRandomValues(new Uint8Array(4)); m._id = 'mod_' + Date.now() + '_' + i + '_' + Array.from(b, x => x.toString(36)).join(''); }
    });
    localStorage.setItem('lh_modules', JSON.stringify(realModules));
    for (let i = 0; i < realModules.length; i++) {
      const m = realModules[i];
      const ok = await this._q('POST', 'os_modules', null, [{ id: m._id, data: m, sort_order: i }]);
      if (ok === null) return false;
    }
    return true;
  },

  async deleteModule(moduleId) {
    console.log('[DB] deleteModule:', moduleId);
    await this._q('DELETE', 'os_modules', 'id=eq.' + moduleId);
  },

  // ── ELEVSVAR ──────────────────────────────────────────────────────
  async loadAnswers(studentName) {
    if (!studentName) {
      try { return JSON.parse(localStorage.getItem('lh_answers') || '{}'); } catch { return {}; }
    }
    const rows = await this._q('GET', 'os_answers',
      'student_name=eq.' + encodeURIComponent(studentName) + '&select=answer_key,value,correct');
    if (rows === null) {
      try { return JSON.parse(localStorage.getItem('lh_answers') || '{}'); } catch { return {}; }
    }
    const obj = {};
    rows.forEach(r => { obj[r.answer_key] = { val: r.value, correct: r.correct }; });
    localStorage.setItem('lh_answers', JSON.stringify(obj));
    return obj;
  },

  async saveAnswer(studentName, studentClass, answerKey, val, correct) {
    const local = _lsGet('lh_answers', {});
    local[answerKey] = { val, correct: !!correct };
    localStorage.setItem('lh_answers', JSON.stringify(local));
    if (!studentName) return;
    await this._q('POST', 'os_answers', null, [{
      answer_key:    answerKey,
      student_name:  studentName,
      student_class: studentClass || '',
      value:         typeof val === 'string' ? val : JSON.stringify(val),
      correct:       !!correct,
      updated_at:    new Date().toISOString()
    }]);
  },

  // ── FREMDRIFT (arbeid-svar) ───────────────────────────────────────
  async loadProgress(studentName) {
    if (!studentName) {
      const prog = {};
      for (let i = 0; i < localStorage.length; i++) {
        const k = localStorage.key(i);
        if (k && k.startsWith('arb_')) prog[k] = localStorage.getItem(k);
      }
      return prog;
    }
    const rows = await this._q('GET', 'os_progress',
      'student_name=eq.' + encodeURIComponent(studentName) + '&select=progress_key,value');
    if (!rows) return {};
    const obj = {};
    rows.forEach(r => { obj[r.progress_key] = r.value; localStorage.setItem(r.progress_key, r.value); });
    return obj;
  },

  async saveProgress(studentName, studentClass, progressKey, value) {
    localStorage.setItem(progressKey, String(value));
    if (!studentName) return;
    await this._q('POST', 'os_progress', null, [{
      progress_key:  progressKey,
      student_name:  studentName,
      student_class: studentClass || '',
      value:         String(value),
      updated_at:    new Date().toISOString()
    }]);
  },

  // ── TILBAKEMELDINGER ──────────────────────────────────────────────
  async saveFeedback(key, text) {
    localStorage.setItem('feedback_' + key, text);
    await this._q('POST', 'os_feedback', null, [{ feedback_key: key, text, updated_at: new Date().toISOString() }]);
  },

  async loadFeedback(key) {
    const rows = await this._q('GET', 'os_feedback', 'feedback_key=eq.' + encodeURIComponent(key) + '&select=text');
    if (!rows || !rows.length) return localStorage.getItem('feedback_' + key) || '';
    return rows[0].text || '';
  },

  async deleteFeedback(key) {
    localStorage.removeItem('feedback_' + key);
    await this._q('DELETE', 'os_feedback', 'feedback_key=eq.' + encodeURIComponent(key));
  },

  // ── ELEVLISTE ─────────────────────────────────────────────────────
  async loadRoster() {
    const rows = await this._q('GET', 'os_roster', 'select=id,data&order=created_at.asc');
    if (!rows || rows.length === 0) {
      try { return JSON.parse(localStorage.getItem('olaskole_roster') || '[]'); } catch { return []; }
    }
    const roster = rows.map(r => r.data);
    localStorage.setItem('olaskole_roster', JSON.stringify(roster));
    return roster;
  },

  async saveRoster(roster) {
    localStorage.setItem('olaskole_roster', JSON.stringify(roster));
    await this._q('DELETE', 'os_roster', 'id=neq.___none___');
    if (roster.length) {
      const rows = roster.map((s, i) => ({
        id: 'r_' + String(s.name || i).toLowerCase().replace(/[^a-z0-9]/g, '_').substring(0, 30) + '_' + i,
        data: s,
        created_at: new Date().toISOString()
      }));
      await this._q('POST', 'os_roster', null, rows);
    }
  },

  // ── HIGH SCORES ───────────────────────────────────────────────────
  async saveHighscores(quizName, players, questionCount) {
    const rows = Object.values(players).map(p => ({
      id: quizName.replace(/[^a-z0-9]/gi, '_').substring(0, 30)
        + '_' + String(p.username || '').replace(/[^a-z0-9]/gi, '_').substring(0, 20)
        + '_' + Date.now(),
      quiz_name:   quizName,
      player_name: p.username || 'Ukjent',
      score:       p.score || 0,
      questions:   questionCount || 0,
      played_at:   new Date().toISOString()
    }));
    if (rows.length) await this._q('POST', 'os_highscores', null, rows);
  },

  async loadHighscores(quizName) {
    const filter = quizName
      ? 'quiz_name=eq.' + encodeURIComponent(quizName) + '&order=score.desc&limit=100'
      : 'order=score.desc&limit=200';
    const rows = await this._q('GET', 'os_highscores', filter + '&select=id,quiz_name,player_name,score,questions,played_at');
    return rows || [];
  },

  async deleteHighscore(id) {
    await this._q('DELETE', 'os_highscores', 'id=eq.' + encodeURIComponent(id));
  },

  // ── LIVE QUIZ ─────────────────────────────────────────────────────
  // (brukes av GAME-objektet nedenfor)

  // ── DIAGNOSTIKK ───────────────────────────────────────────────────
  async testConnection() {
    DB._paused = false;
    try {
      const res = await fetch(SB_URL + '/rest/v1/os_game_sessions?limit=0', {
        headers: { 'apikey': SB_KEY, 'Authorization': 'Bearer ' + SB_KEY }
      });
      if (!res.ok) return { ok: false, msg: '❌ HTTP ' + res.status + ' – sjekk nøkkel/URL' };
    } catch (e) {
      return {
        ok: false,
        paused: true,
        msg: '⏸️ Supabase-prosjektet er på PAUSE!\n\nGå til supabase.com → åpne prosjektet → klikk «Resume project» → vent 30 sekunder → prøv igjen.'
      };
    }
    const rows = await this._q('GET', 'os_modules', 'limit=1&select=id');
    if (rows === null) return { ok: false, msg: '⚠️ Tilkoblet, men tabellene mangler. Kjør SQL-skjemaet!' };
    return { ok: true, msg: '✅ Alt OK! (' + rows.length + ' emne(r) i database)' };
  }
};


// ── Progress cache (populated on student login) ────────────────
let _progressCache = {};

async function dbSaveProgress(key, val) {
  _progressCache[key] = String(val);
  await DB.saveProgress(state.student?.name, state.student?.cls, key, val);
}
function dbGetProgress(key) {
  return _progressCache[key] || localStorage.getItem(key);
}

// ── Roster cache ───────────────────────────────────────────────
let _rosterCache = [];
async function loadRosterCached() {
  _rosterCache = await DB.loadRoster();
  return _rosterCache;
}
function getRosterSync() { return _rosterCache; }

// ════════════════════════════════════════════════════════
//  DATABASE SETTINGS UI  –  Supabase
// ════════════════════════════════════════════════════════

const DB_SQL_SCHEMA = `-- ============================================================
-- SkOla – Supabase oppsett
-- Lim inn ALT dette i SQL Editor og trykk RUN.
-- Trygt å kjøre flere ganger.
-- ============================================================

-- TABELLER
create table if not exists os_modules (
  id text primary key,
  data jsonb not null,
  sort_order int default 0,
  created_at timestamptz default now()
);

create table if not exists os_answers (
  answer_key text primary key,
  student_name text not null,
  student_class text default '',
  value text,
  correct boolean default false,
  updated_at timestamptz default now()
);

create table if not exists os_progress (
  progress_key text primary key,
  student_name text not null,
  student_class text default '',
  value text,
  updated_at timestamptz default now()
);

create table if not exists os_feedback (
  feedback_key text primary key,
  text text,
  updated_at timestamptz default now()
);

create table if not exists os_roster (
  id text primary key,
  data jsonb not null,
  created_at timestamptz default now()
);

create table if not exists os_games (
  code text primary key,
  data jsonb not null,
  updated_at timestamptz default now()
);

create table if not exists os_highscores (
  id text primary key,
  quiz_name text not null,
  player_name text not null,
  score int not null,
  questions int default 0,
  played_at timestamptz default now()
);

-- INDEXES
create index if not exists idx_answers_student  on os_answers(student_name);
create index if not exists idx_progress_student on os_progress(student_name);

-- ROW LEVEL SECURITY (aktiver for alle tabeller)
alter table os_modules    enable row level security;
alter table os_answers    enable row level security;
alter table os_progress   enable row level security;
alter table os_feedback   enable row level security;
alter table os_roster     enable row level security;
alter table os_games      enable row level security;
alter table os_highscores enable row level security;

-- POLICIES (slett gamle og lag nye – trygt å kjøre på nytt)
drop policy if exists "allow_all_modules"    on os_modules;
drop policy if exists "allow_all_answers"    on os_answers;
drop policy if exists "allow_all_progress"   on os_progress;
drop policy if exists "allow_all_feedback"   on os_feedback;
drop policy if exists "allow_all_roster"     on os_roster;
drop policy if exists "allow_all_games"      on os_games;
drop policy if exists "allow_all_highscores" on os_highscores;

create policy "allow_all_modules"    on os_modules    for all to anon using (true) with check (true);
create policy "allow_all_answers"    on os_answers    for all to anon using (true) with check (true);
create policy "allow_all_progress"   on os_progress   for all to anon using (true) with check (true);
create policy "allow_all_feedback"   on os_feedback   for all to anon using (true) with check (true);
create policy "allow_all_roster"     on os_roster     for all to anon using (true) with check (true);
create policy "allow_all_games"      on os_games      for all to anon using (true) with check (true);
create policy "allow_all_highscores" on os_highscores for all to anon using (true) with check (true);
`;

function copyDbSchema() {
  navigator.clipboard.writeText(DB_SQL_SCHEMA)
    .then(() => showToast('📋 SQL-skjema kopiert!'))
    .catch(() => {
      const ta = document.createElement('textarea');
      ta.value = DB_SQL_SCHEMA;
      document.body.appendChild(ta);
      ta.select();
      document.execCommand('copy');
      document.body.removeChild(ta);
      showToast('📋 SQL-skjema kopiert!');
    });
}

async function saveDbConfig() {
  const url = (document.getElementById('sbUrlInput')?.value || '').trim().replace(/\/$/, '');
  const key = (document.getElementById('sbKeyInput')?.value || '').trim();
  if (!url || !key) { showDbFeedback('Fyll inn både Project URL og API-nøkkel', false); return; }
  if (!/^https:\/\/[a-z0-9-]+\.supabase\.co$/i.test(url)) { showDbFeedback('Ugyldig Supabase URL-format', false); return; }
  if (!_sessionEncKey) { showDbFeedback('🔐 Logg inn på nytt for å lagre krypterte DB-verdier', false); return; }
  const encUrl = await SecurityUtils.encrypt(url, _sessionEncKey);
  const encKey = await SecurityUtils.encrypt(key, _sessionEncKey);
  localStorage.setItem('os_sb_url', JSON.stringify(encUrl));
  localStorage.setItem('os_sb_key', JSON.stringify(encKey));
  _decryptedSbUrl = url;
  _decryptedSbKey = key;
  SB_URL = url;
  SB_KEY = key;
  showDbFeedback('⏳ Tester tilkobling…', true);
  const result = await DB.testConnection();
  showDbStatus();
  if (result.ok) {
    showDbFeedback('✅ ' + result.msg, true);
    showToast('✅ Supabase koblet til! Laster emner…');
    state.modules = await DB.loadModules();
    await loadRosterCached();
    renderHomeModules();
    renderTaskModules();
  } else {
    showDbFeedback('❌ ' + result.msg, false);
  }
}

function checkKeyEmbedded() {
  return false;
}

async function saveKeyToFile() {
  showDbFeedback('⚠️ Denne funksjonen er deaktivert av sikkerhetshensyn.', false);
}

async function testDbConnection() {
  showDbFeedback('⏳ Tester…', true);
  const result = await DB.testConnection();
  if (result.paused) {
    showDbFeedback('⏸️ SUPABASE ER PÅ PAUSE – gå til supabase.com, åpne prosjektet og klikk «Resume project». Vent 30 sek og prøv igjen.', false);
    const warn = document.getElementById('dbSqlWarning');
    if (warn) {
      warn.style.display = 'block';
      warn.innerHTML = '<div style="font-weight:800;color:#991b1b;margin-bottom:0.5rem;">⏸️ Supabase-prosjektet er på PAUSE!</div><div style="font-size:0.82rem;color:#7f1d1d;line-height:1.7;margin-bottom:0.75rem;">Gratisplanen setter prosjektet på pause etter 1 uke uten aktivitet.<br><b>Slik fikser du det:</b><br>1. Gå til <a href="https://supabase.com" target="_blank" style="color:#dc2626;font-weight:800;">supabase.com</a> og logg inn<br>2. Åpne prosjektet ditt<br>3. Klikk den store oransje knappen <b>«Resume project»</b><br>4. Vent ca. 30 sekunder<br>5. Kom tilbake og trykk 🔬 Diagnose på nytt</div><button data-onclick="testDbConnection" style="background:#dc2626;color:white;border:none;padding:9px 20px;border-radius:50px;font-family:\'Nunito\',sans-serif;font-weight:800;font-size:0.88rem;cursor:pointer;">🔄 Prøv igjen</button>';
    }
  } else {
    showDbFeedback(result.msg, result.ok);
    const warn = document.getElementById('dbSqlWarning');
    if (warn) warn.style.display = (!result.ok && result.msg.includes('tabellene mangler')) ? 'block' : 'none';
  }
}

async function runDbDiagnose() {
  const panel = document.getElementById('dbDiagnosePanel');
  const log = document.getElementById('dbDiagnoseLog');
  if (!panel || !log) return;
  panel.style.display = 'block';
  log.innerHTML = '';

  const dlog = (msg, color='#a3e635') => {
    log.innerHTML += '<div style="color:' + color + ';margin-bottom:2px;">' + msg + '</div>';
    panel.scrollTop = panel.scrollHeight;
  };

  dlog('🔬 SkOla DB Diagnose', '#FFD93D');
  dlog('URL: ' + SB_URL, '#aaa');
  dlog('Nøkkel: ' + SB_KEY.substring(0,20) + '...', '#aaa');
  dlog('─────────────────────────────');

  // TEST 1: Grunnleggende tilkobling
  dlog('TEST 1: Tilkobling til Supabase...', '#FFD93D');
  try {
    const r = await fetch(SB_URL + '/rest/v1/', {
      headers: { 'apikey': SB_KEY, 'Authorization': 'Bearer ' + SB_KEY }
    });
    if (r.ok || r.status === 200) {
      dlog('TEST 1: ✅ Tilkoblet (HTTP ' + r.status + ')', '#6BCB77');
    } else {
      dlog('TEST 1: ❌ HTTP ' + r.status, '#FF6B6B');
      if (r.status === 401) dlog('  → Ugyldig API-nøkkel. Sjekk anon public key.', '#FF6B6B');
    }
  } catch(e) {
    dlog('TEST 1: ❌ KAN IKKE NÅ SUPABASE', '#FF6B6B');
    dlog('  ┌─────────────────────────────────────────┐', '#FFD93D');
    dlog('  │  SUPABASE ER SANNSYNLIGVIS PÅ PAUSE!    │', '#FFD93D');
    dlog('  │  1. Gå til supabase.com                 │', '#FFD93D');
    dlog('  │  2. Åpne prosjektet ditt                │', '#FFD93D');
    dlog('  │  3. Klikk «Resume project»              │', '#FFD93D');
    dlog('  │  4. Vent 30 sekunder                    │', '#FFD93D');
    dlog('  │  5. Kjør diagnose på nytt               │', '#FFD93D');
    dlog('  └─────────────────────────────────────────┘', '#FFD93D');
    return;
  }

  // TEST 2: Les moduler
  dlog('TEST 2: Leser os_modules...', '#FFD93D');
  const rows = await DB._q('GET', 'os_modules', 'select=id,sort_order&order=sort_order.asc');
  if (rows === null) {
    dlog('TEST 2: ❌ Lesing feilet – tabell mangler eller RLS blokkerer', '#FF6B6B');
    dlog('  → Kjør SQL-skjemaet i Supabase SQL Editor!', '#FFD93D');
  } else {
    dlog('TEST 2: ✅ ' + rows.length + ' emner i databasen', '#6BCB77');
    rows.forEach((r, i) => dlog('  ' + (i+1) + '. id=' + r.id, '#aaa'));
  }

  // TEST 3: Skriv en rad
  dlog('TEST 3: Skriver testrad...', '#FFD93D');
  const tid = 'diag_' + Date.now();
  const wr = await DB._q('POST', 'os_modules', null, [{ id: tid, data: { name: 'DIAGNOSETEST', _id: tid }, sort_order: 9999 }]);
  if (wr === null) {
    dlog('TEST 3: ❌ Skriving feilet!', '#FF6B6B');
    dlog('  → RLS policy mangler (kjør SQL-skjema) eller nøkkel har ikke skrivetilgang', '#FFD93D');
  } else {
    dlog('TEST 3: ✅ Skriving OK', '#6BCB77');
    // Read back
    const rb = await DB._q('GET', 'os_modules', 'id=eq.' + tid + '&select=id');
    dlog('TEST 3b: Les tilbake: ' + (rb && rb.length ? '✅ OK' : '❌ Ikke funnet'), rb && rb.length ? '#6BCB77' : '#FF6B6B');
    // Cleanup
    await DB._q('DELETE', 'os_modules', 'id=eq.' + tid);
    dlog('TEST 3c: ✅ Opprydding OK', '#6BCB77');
  }

  // TEST 4: Sjekk alle tabeller
  dlog('TEST 4: Sjekker alle tabeller...', '#FFD93D');
  const tables = ['os_modules','os_answers','os_progress','os_feedback','os_roster','os_games','os_highscores'];
  for (const t of tables) {
    const r = await DB._q('GET', t, 'select=*&limit=0');
    dlog('  ' + t + ': ' + (r !== null ? '✅' : '❌ MANGLER – kjør SQL!'), r !== null ? '#6BCB77' : '#FF6B6B');
  }

  dlog('─────────────────────────────');
  dlog('✅ Diagnose ferdig!', '#FFD93D');
}

async function migrateToDb() {
  // DB er alltid klar (nøkkel er hardkodet)
  showDbFeedback('⏳ Migrerer lokale data til Supabase…', true);

  const localMods = _lsGet('lh_modules', []);
  if (localMods.length) { await DB.saveModules(localMods); state.modules = localMods; }

  const localAns = _lsGet('lh_answers', {});
  for (const [k, v] of Object.entries(localAns)) {
    const studentName = k.split('_m')[0];
    await DB.saveAnswer(studentName, '', k, v.val || '', v.correct || false);
  }

  for (let i = 0; i < localStorage.length; i++) {
    const k = localStorage.key(i);
    if (k && k.startsWith('arb_')) {
      const parts = k.split('_');
      await DB.saveProgress(parts[1] || '', '', k, localStorage.getItem(k));
    }
  }

  const localRoster = _lsGet('olaskole_roster', []);
  if (localRoster.length) await DB.saveRoster(localRoster);

  const modsN = localMods.length;
  const ansN  = Object.keys(localAns).length;
  showDbFeedback(`✅ Ferdig! ${modsN} emner, ${ansN} svar, ${localRoster.length} elever migrert.`, true);
  showToast('✅ Alle lokale data er nå i Supabase!');
}

function clearDbConfig() {
  _showConfirm('Fjerne Supabase-tilkobling? Data i databasen beholdes.', () => {
    localStorage.removeItem('os_sb_url');
    localStorage.removeItem('os_sb_key');
    SB_URL = '';
    SB_KEY = '';
    _decryptedSbUrl = '';
    _decryptedSbKey = '';
    showToast('⚠️ Supabase-tilkobling fjernet');
    showDbStatus();
    showDbFeedback('Tilkobling fjernet. Bruker lokal lagring.', true);
  }, 'Fjern', 'var(--c1)');
}

function showDbFeedback(msg, ok) {
  const el = document.getElementById('dbFeedback');
  if (!el) return;
  el.style.display = 'block';
  el.textContent   = msg;
  el.style.background = ok ? '#dcfce7' : '#fee2e2';
  el.style.color      = ok ? '#166534' : '#991b1b';
}

function showDbStatus() {
  const el = document.getElementById('dbStatus');
  if (!el) return;
  if (!isDbConfigured()) {
    el.style.background = 'rgba(239,68,68,0.1)';
    el.style.color = '#991b1b';
    el.textContent = '❌ Supabase ikke konfigurert';
    const pill0 = document.getElementById('dbNavPill');
    if (pill0) { pill0.style.display = 'inline-block'; pill0.style.background = '#ef4444'; pill0.title = 'Database: ikke konfigurert'; }
    return;
  }
  const short = SB_URL.replace('https://', '').split('.')[0];
  el.style.background = '#dcfce7';
  el.style.color = '#166534';
  el.textContent = '✅ Supabase: ' + short + '.supabase.co – kjør 🔬 Diagnose for å verifisere';
  const ui = document.getElementById('sbUrlInput');
  const ki = document.getElementById('sbKeyInput');
  if (ui && !ui.value) ui.value = SB_URL;
  if (ki && !ki.value) ki.value = SB_KEY;
  const pill = document.getElementById('dbNavPill');
  if (pill) { pill.style.display = 'inline-block'; pill.style.background = '#059669'; pill.title = 'Database: Supabase tilkoblet'; }
}


async function arbExportAnswers() {
  if (arbState.moduleIdx === null || !state.student) { showToast('⚠️ Ingen elev eller emne valgt'); return; }
  const m = state.modules[arbState.moduleIdx];
  if (!m) { showToast('⚠️ Fant ikke emnet'); return; }
  showToast('⏳ Genererer Word-fil…');
  try {
    let txt = 'SkOla – Svar fra ' + state.student.name + '\n';
    txt += 'Emne: ' + m.name + '\n' + '='.repeat(40) + '\n\n';
    (m.discussion||[]).forEach((d,di) => {
      const val = arbLoad('disc_'+di);
      if (val) txt += '💬 ' + d + '\n→ ' + val + '\n\n';
    });
    (m.write||[]).forEach((w,wi) => {
      const val = arbLoad('write_'+wi);
      if (val) txt += '✍️ ' + (w.title||'Skriveoppgave') + '\n→ ' + val + '\n\n';
    });
    const blob = await generateDocx('SkOla – ' + m.name, txt);
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = (state.student.name + '_' + (m.name||'svar')).replace(/[^a-z0-9_]/gi,'_') + '.docx';
    a.click(); URL.revokeObjectURL(a.href);
    showToast('📄 Svar eksportert til Word!');
  } catch(e) { showToast('❌ Feil ved Word-eksport: ' + e.message); }
}

// ====== DOCX GENERATOR ======
async function generateDocx(title, bodyText) {
  await _loadScript(_CDN_JSZIP);
  const zip = new JSZip();
  // Strip non-BMP characters (emoji etc.) that are invalid in XML 1.0
  const escXml = s => s
    .replace(/[^\u0009\u000A\u000D\u0020-\uD7FF\uE000-\uFFFD]/g, '')
    .replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
  const paras = bodyText.split('\n').map(line =>
    '<w:p><w:r><w:t xml:space="preserve">' + escXml(line) + '</w:t></w:r></w:p>'
  ).join('');
  zip.file('[Content_Types].xml',
    '<?xml version="1.0" encoding="UTF-8"?>' +
    '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">' +
    '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
    '<Default Extension="xml" ContentType="application/xml"/>' +
    '<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>' +
    '</Types>');
  zip.file('_rels/.rels',
    '<?xml version="1.0" encoding="UTF-8"?>' +
    '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
    '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>' +
    '</Relationships>');
  zip.file('word/document.xml',
    '<?xml version="1.0" encoding="UTF-8"?>' +
    '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>' +
    '<w:p><w:r><w:rPr><w:b/><w:sz w:val="32"/></w:rPr><w:t>' + escXml(title) + '</w:t></w:r></w:p>' +
    paras + '<w:sectPr/></w:body></w:document>');
  zip.file('word/_rels/document.xml.rels',
    '<?xml version="1.0" encoding="UTF-8"?>' +
    '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"></Relationships>');
  return await zip.generateAsync({type:'blob', mimeType:'application/vnd.openxmlformats-officedocument.wordprocessingml.document'});
}

async function exportAllAnswersDocx() {
  const students=[...new Set(Object.keys(state.studentAnswers).map(k=>k.split('_m')[0]))];
  const content=students.map(s=>getStudentAnswersText(s)).join('\n\n'+'='.repeat(50)+'\n\n');
  const blob = await generateDocx('SkOla – Alle svar', content);
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = 'alle_svar.docx';
  a.click(); URL.revokeObjectURL(a.href);
  showToast('📄 Eksportert til Word!');
}

// ====== MICROSOFT GRAPH API ======
async function exportToOneNote(title, htmlContent) {
  const token = localStorage.getItem('olaskole_ms_token');
  if (!token) { showToast('⚠️ Ikke koblet til Microsoft 365 – gå til Innstillinger'); return; }
  const page = '<!DOCTYPE html><html><head><title>' + title + '</title></head><body>' + htmlContent + '</body></html>';
  try {
    const res = await fetch('https://graph.microsoft.com/v1.0/me/onenote/pages', {
      method: 'POST',
      headers: { 'Authorization': 'Bearer ' + token, 'Content-Type': 'text/html; charset=utf-8' },
      body: page
    });
    if (res.ok) { showToast('📓 Sendt til OneNote!'); }
    else { const err = await res.json().catch(()=>({error:{message:res.status}})); showToast('❌ OneNote: ' + (err.error?.message || res.status)); }
  } catch(e) { showToast('❌ Feil: ' + e.message); }
}

async function uploadToOneDrive(filename, blob) {
  const token = localStorage.getItem('olaskole_ms_token');
  if (!token) { showToast('⚠️ Ikke koblet til Microsoft 365 – gå til Innstillinger'); return; }
  try {
    const ab = await blob.arrayBuffer();
    const res = await fetch('https://graph.microsoft.com/v1.0/me/drive/root:/SkOla/' + encodeURIComponent(filename) + ':/content', {
      method: 'PUT',
      headers: { 'Authorization': 'Bearer ' + token, 'Content-Type': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' },
      body: ab
    });
    if (res.ok) { showToast('☁️ Lastet opp til OneDrive!'); }
    else { const err = await res.json().catch(()=>({error:{message:res.status}})); showToast('❌ OneDrive: ' + (err.error?.message || res.status)); }
  } catch(e) { showToast('❌ Feil: ' + e.message); }
}

async function arbExportToOneNote() {
  if (arbState.moduleIdx === null || !state.student) { showToast('⚠️ Ingen elev eller emne valgt'); return; }
  const m = state.modules[arbState.moduleIdx]; if (!m) return;
  const escHtml = s => s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
  let html = '<h1>SkOla &ndash; ' + escHtml(m.name) + '</h1><p><b>Elev:</b> ' + escHtml(state.student.name) + '</p><hr/>';
  (m.discussion||[]).forEach((d,di) => { const val=arbLoad('disc_'+di); if(val) html += '<h3>' + escHtml(d) + '</h3><p>' + escHtml(val).replace(/\n/g,'<br/>') + '</p>'; });
  (m.write||[]).forEach((w,wi) => { const val=arbLoad('write_'+wi); if(val) html += '<h3>' + escHtml(w.title||'Skriveoppgave') + '</h3><p>' + escHtml(val).replace(/\n/g,'<br/>') + '</p>'; });
  await exportToOneNote('SkOla – ' + m.name, html);
}

async function arbExportToOneDrive() {
  if (arbState.moduleIdx === null || !state.student) { showToast('⚠️ Ingen elev eller emne valgt'); return; }
  const m = state.modules[arbState.moduleIdx]; if (!m) { showToast('⚠️ Fant ikke emnet'); return; }
  try {
    let txt = 'SkOla – Svar fra ' + state.student.name + '\nEmne: ' + m.name + '\n' + '='.repeat(40) + '\n\n';
    (m.discussion||[]).forEach((d,di) => { const val=arbLoad('disc_'+di); if(val) txt += '💬 '+d+'\n→ '+val+'\n\n'; });
    (m.write||[]).forEach((w,wi) => { const val=arbLoad('write_'+wi); if(val) txt += '✍️ '+(w.title||'Skriveoppgave')+'\n→ '+val+'\n\n'; });
    const fname = (state.student.name + '_' + (m.name||'svar')).replace(/[^a-z0-9_]/gi,'_') + '.docx';
    const blob = await generateDocx('SkOla – ' + m.name, txt);
    await uploadToOneDrive(fname, blob);
  } catch(e) { showToast('❌ Feil ved OneDrive-opplasting: ' + e.message); }
}

// ====== WORDCLOUD & VOTING ENGINE ======
const BAD_WORDS = ['faen','helvete','jævla','drit','fuck','shit','bitch','asshole','idiot','dumme','hore','kuk','fitte','ræv'];
const WC = {
  mode: 'word',      // 'word' | 'poll'
  wordMode: 'free',  // 'free' | 'locked'
  session: null,     // current session object
  results: [],       // live responses
  pollOptions: [],
  refreshTimer: null
};

function wcInit() {
  const teacherPanel = document.getElementById('wc-teacher-panel');
  const studentPanel = document.getElementById('wc-student-panel');
  if (!teacherPanel || !studentPanel) return;
  if (state.isTeacher) {
    teacherPanel.style.display = 'block';
    studentPanel.style.display = 'none';
    wcRenderTeacher();
  } else {
    teacherPanel.style.display = 'none';
    studentPanel.style.display = 'block';
  }
}

function wcShowSetup() {
  document.getElementById('wc-setup').style.display = 'block';
  document.getElementById('wc-new-btn').style.display = 'none';
}
function wcHideSetup() {
  document.getElementById('wc-setup').style.display = 'none';
  document.getElementById('wc-new-btn').style.display = 'flex';
}

function wcSetMode(mode) {
  WC.mode = mode;
  document.getElementById('wc-btn-word').classList.toggle('active', mode==='word');
  document.getElementById('wc-btn-poll').classList.toggle('active', mode==='poll');
  document.getElementById('wc-word-mode-options').style.display = mode==='word' ? 'block' : 'none';
  document.getElementById('wc-poll-options-wrap').style.display = mode==='poll' ? 'block' : 'none';
}
function wcSetWordMode(wm) {
  WC.wordMode = wm;
  document.getElementById('wc-btn-free').classList.toggle('active', wm==='free');
  document.getElementById('wc-btn-locked').classList.toggle('active', wm==='locked');
  document.getElementById('wc-locked-words-wrap').style.display = wm==='locked' ? 'block' : 'none';
}

function wcGenCode() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ';
  const bytes = crypto.getRandomValues(new Uint8Array(4));
  let c = '';
  for (let i=0;i<4;i++) c += chars[bytes[i] % chars.length];
  return c;
}

async function wcStartSession() {
  const title = document.getElementById('wc-title')?.value.trim();
  if (!title) { showToast('Skriv inn en tittel / et spørsmål'); return; }
  const code = wcGenCode();
  const pollOpts = WC.mode==='poll' ? (document.getElementById('wc-poll-opts')?.value||'').split('\n').map(s=>s.trim()).filter(Boolean) : [];
  const allowedWords = WC.wordMode==='locked' ? (document.getElementById('wc-allowed-words')?.value||'').split(',').map(s=>s.trim()).filter(Boolean) : [];
  const session = {
    code, title,
    mode: WC.mode,
    wordMode: WC.mode==='word' ? WC.wordMode : null,
    allowedWords,
    pollOptions: pollOpts,
    maxPerStudent: parseInt(document.getElementById('wc-max-per-student')?.value)||3,
    filterBad: document.getElementById('wc-filter-bad')?.value==='1',
    anonymous: document.getElementById('wc-anon')?.value==='1',
    active: true,
    responses: []
  };
  WC.session = session;
  WC.results = [];
  // Save to localStorage (works across tabs on same device) + Supabase-like key
  localStorage.setItem('os_wc_session', JSON.stringify(session));
  wcRenderTeacher();
  showToast('Økt startet! Kode: ' + code);
  wcStartRefresh();
}

function wcEndSession() {
  if (!confirm('Avslutt økten?')) return;
  WC.session = null;
  localStorage.removeItem('os_wc_session');
  if (WC.refreshTimer) { clearInterval(WC.refreshTimer); WC.refreshTimer=null; }
  wcRenderTeacher();
}

function wcStartRefresh() {
  if (WC.refreshTimer) clearInterval(WC.refreshTimer);
  WC.refreshTimer = setInterval(wcPollResponses, 2000);
}

function wcPollResponses() {
  const raw = localStorage.getItem('os_wc_responses_' + (WC.session?.code||''));
  if (!raw) return;
  try {
    const responses = JSON.parse(raw);
    if (!Array.isArray(responses)) throw new Error('Unexpected format');
    WC.results = responses;
    const cnt = document.getElementById('wc-response-count');
    if (cnt) cnt.textContent = responses.length + ' svar';
    const showingResults = document.getElementById('wc-results-panel')?.style.display !== 'none';
    if (showingResults) wcRenderResults();
    wcRenderResponsesList();
  } catch(e) {
    console.warn('[WC] wcPollResponses parse error:', e);
    WC.results = [];
  }
}

function wcRenderTeacher() {
  const active = document.getElementById('wc-active');
  const noSession = document.getElementById('wc-no-session');
  if (!WC.session) {
    if (active) active.style.display = 'none';
    if (noSession) noSession.style.display = 'block';
    return;
  }
  if (noSession) noSession.style.display = 'none';
  if (active) {
    active.style.display = 'block';
    document.getElementById('wc-active-code').textContent = WC.session.code;
    document.getElementById('wc-active-subtitle').textContent = WC.session.title;
  }
  wcRenderResponsesList();
  wcStartRefresh();
}

function wcToggleResults() {
  const panel = document.getElementById('wc-results-panel');
  const exportBtns = document.getElementById('wc-export-btns');
  const btn = document.getElementById('wc-show-results-btn');
  const showing = panel.style.display !== 'none';
  panel.style.display = showing ? 'none' : 'block';
  if (exportBtns) exportBtns.style.display = showing ? 'none' : 'flex';
  btn.textContent = showing ? 'Vis resultater' : 'Skjul resultater';
  if (!showing) wcRenderResults();
}

function wcRenderResults() {
  const canvas = document.getElementById('wc-cloud-canvas');
  if (!canvas) return;
  if (WC.session.mode === 'poll') {
    wcRenderPoll(canvas);
  } else {
    wcRenderCloud(canvas);
  }
}

function wcRenderCloud(canvas) {
  const freq = {};
  WC.results.forEach(r => {
    (r.words||[]).forEach(w => {
      const key = w.toLowerCase().trim();
      if (key) freq[key] = (freq[key]||0) + 1;
    });
  });
  if (Object.keys(freq).length === 0) {
    canvas.innerHTML = '';
    const empty = document.createElement('div');
    empty.style.cssText = 'color:var(--text-3);font-size:0.9rem;';
    empty.textContent = 'Ingen svar ennå';
    canvas.appendChild(empty);
    return;
  }
  const maxF = Math.max(...Object.values(freq));
  const colors = ['var(--accent-h)','var(--green)','var(--yellow)','var(--purple)','#60a5fa','#f472b6'];
  const sorted = Object.entries(freq).sort((a,b)=>b[1]-a[1]);
  canvas.innerHTML = '';
  sorted.forEach(([word, count]) => {
    const size = 0.85 + (count/maxF)*2.2;
    const color = colors[Math.abs(word.charCodeAt(0)) % colors.length];
    const chip = document.createElement('span');
    chip.className = 'wc-word-chip';
    chip.style.cssText = `font-size:${size}rem;color:${color};background:${color}22;padding:${0.2+count/maxF*0.4}em ${0.5+count/maxF*0.3}em;`;
    chip.appendChild(document.createTextNode(word));
    const sup = document.createElement('sup');
    sup.style.cssText = 'font-size:0.55em;opacity:0.7;margin-left:2px;';
    sup.textContent = String(count);
    chip.appendChild(sup);
    canvas.appendChild(chip);
  });
}

function wcRenderPoll(canvas) {
  const freq = {};
  (WC.session.pollOptions||[]).forEach(opt => freq[opt] = 0);
  WC.results.forEach(r => {
    const v = r.vote;
    if (v) freq[v] = (freq[v]||0)+1;
  });
  const total = Object.values(freq).reduce((a,b)=>a+b,0);
  if (total === 0) {
    canvas.innerHTML = '';
    const empty = document.createElement('div');
    empty.style.cssText = 'color:var(--text-3);font-size:0.9rem;';
    empty.textContent = 'Ingen svar ennå';
    canvas.appendChild(empty);
    return;
  }
  canvas.innerHTML = '';
  const wrap = document.createElement('div');
  wrap.style.cssText = 'width:100%;padding:0.5rem;';
  Object.entries(freq).forEach(([opt, cnt]) => {
    const pct = total ? Math.round(cnt/total*100) : 0;
    const barWrap = document.createElement('div');
    barWrap.className = 'wc-poll-bar-wrap';
    const label = document.createElement('div');
    label.className = 'wc-poll-bar-label';
    const l = document.createElement('span');
    l.textContent = opt;
    const r = document.createElement('span');
    r.textContent = `${cnt} (${pct}%)`;
    label.appendChild(l);
    label.appendChild(r);
    const bar = document.createElement('div');
    bar.className = 'wc-poll-bar';
    const fill = document.createElement('div');
    fill.className = 'wc-poll-bar-fill';
    fill.style.width = pct + '%';
    bar.appendChild(fill);
    barWrap.appendChild(label);
    barWrap.appendChild(bar);
    wrap.appendChild(barWrap);
  });
  canvas.appendChild(wrap);
}

function wcRenderResponsesList() {
  const list = document.getElementById('wc-responses-list');
  if (!list) return;
  list.innerHTML = '';
  if (!WC.results.length) return;
  const title = document.createElement('div');
  title.style.cssText = 'font-weight:800;font-size:0.88rem;color:var(--text-2);margin-bottom:0.5rem;text-transform:uppercase;letter-spacing:0.05em;';
  title.textContent = `Svar (${WC.results.length})`;
  list.appendChild(title);
  WC.results.forEach((r, i) => {
    const row = document.createElement('div');
    row.className = 'wc-response-item';
    const nameEl = document.createElement('span');
    nameEl.style.cssText = 'color:var(--text-2);font-size:0.82rem;';
    nameEl.textContent = WC.session.anonymous ? 'Anonym' : (r.name || 'Ukjent');
    const wordsEl = document.createElement('span');
    wordsEl.style.cssText = 'font-weight:700;';
    const words = WC.session.mode==='poll' ? [r.vote||''] : (r.words||[]);
    wordsEl.textContent = words.join(', ');
    const btn = document.createElement('button');
    btn.style.cssText = 'background:none;border:none;color:var(--text-3);cursor:pointer;padding:2px 6px;font-size:0.8rem;border-radius:4px;min-height:unset;';
    btn.title = 'Fjern';
    btn.innerHTML = '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>';
    btn.addEventListener('click', () => wcRemoveResponse(i));
    row.appendChild(nameEl);
    row.appendChild(wordsEl);
    row.appendChild(btn);
    list.appendChild(row);
  });
}

function wcRemoveResponse(i) {
  WC.results.splice(i,1);
  const key = 'os_wc_responses_'+(WC.session?.code||'');
  localStorage.setItem(key, JSON.stringify(WC.results));
  wcRenderResponsesList();
  const showingResults = document.getElementById('wc-results-panel')?.style.display !== 'none';
  if (showingResults) wcRenderResults();
  document.getElementById('wc-response-count').textContent = WC.results.length+' svar';
}

// STUDENT SIDE
async function wcCheckActiveSession() {
  // Try to find any active session
  const raw = localStorage.getItem('os_wc_session');
  if (!raw) return;
  try {
    const sess = JSON.parse(raw);
    if (sess.active) wcAutoJoin(sess);
  } catch(e) {}
}

function wcJoinSession() {
  const code = document.getElementById('wc-code-input')?.value.trim().toUpperCase();
  if (!code || code.length !== 4) { showToast('Skriv inn en 4-bokstavs kode'); return; }
  const raw = localStorage.getItem('os_wc_session');
  if (!raw) { showToast('Fant ingen økt med den koden'); return; }
  try {
    const sess = JSON.parse(raw);
    if (sess.code !== code) { showToast('Feil kode – prøv igjen'); return; }
    if (!sess.active) { showToast('Denne økten er avsluttet'); return; }
    wcAutoJoin(sess);
  } catch(e) { showToast('Noe gikk galt'); }
}

function wcAutoJoin(sess) {
  document.getElementById('wc-join-wrap').style.display = 'none';
  const active = document.getElementById('wc-student-active');
  active.style.display = 'block';
  document.getElementById('wc-student-title').textContent = sess.title;
  const inputArea = document.getElementById('wc-student-input-area');
  inputArea.innerHTML = '';
  if (sess.mode === 'poll') {
    const wrap = document.createElement('div');
    wrap.style.cssText = 'display:flex;flex-direction:column;gap:0.5rem;';
    (sess.pollOptions||[]).forEach(opt => {
      const btn = document.createElement('button');
      btn.style.cssText = "padding:0.875rem 1rem;background:var(--s2);border:2px solid var(--border-2);border-radius:10px;color:var(--text);font-family:'Nunito',sans-serif;font-weight:700;font-size:0.95rem;cursor:pointer;text-align:left;transition:all 0.18s;";
      btn.textContent = opt;
      btn.addEventListener('mouseover', function(){ this.style.borderColor='var(--accent)'; });
      btn.addEventListener('mouseout', function(){ this.style.borderColor='var(--border-2)'; });
      btn.addEventListener('click', () => wcSubmitPoll(opt, sess.code));
      wrap.appendChild(btn);
    });
    inputArea.appendChild(wrap);
  } else {
    if (sess.wordMode==='locked' && sess.allowedWords?.length) {
      const wrap = document.createElement('div');
      wrap.style.cssText = 'display:flex;flex-wrap:wrap;gap:0.4rem;margin-bottom:0.75rem;';
      (sess.allowedWords||[]).forEach(w => {
        const btn = document.createElement('button');
        btn.style.cssText = "padding:0.4rem 0.875rem;background:var(--s2);border:1px solid var(--border-2);border-radius:50px;color:var(--text-2);font-family:'Nunito',sans-serif;font-weight:700;font-size:0.85rem;cursor:pointer;";
        btn.textContent = w;
        btn.addEventListener('click', () => wcAddWordChip(w));
        wrap.appendChild(btn);
      });
      inputArea.appendChild(wrap);
    } else {
      const input = document.createElement('input');
      input.type = 'text';
      input.id = 'wc-word-input';
      input.placeholder = 'Skriv et ord...';
      const btn = document.createElement('button');
      btn.className = 'btn-primary';
      btn.style.cssText = 'margin-top:0.5rem;width:100%;';
      btn.textContent = 'Send svar';
      btn.addEventListener('click', () => wcSubmitWords(sess.code));
      inputArea.appendChild(input);
      inputArea.appendChild(btn);
    }
  }
}

function wcAddWordChip(word) {
  showToast('Sendt: ' + word);
  document.getElementById('wc-student-result-msg').style.display='block';
  document.getElementById('wc-student-result-msg').textContent='✅ Svaret ditt er registrert!';
}

function wcSubmitWords(code) {
  const input = document.getElementById('wc-word-input');
  const word = input?.value.trim();
  if (!word) { showToast('Skriv et ord'); return; }
  const raw = localStorage.getItem('os_wc_session');
  if (!raw) return;
  const sess = JSON.parse(raw);
  if (sess.filterBad) {
    const lower = word.toLowerCase();
    const found = BAD_WORDS.filter(b => lower.includes(b));
    if (found.length) { showToast('Ugyldig ord – prøv igjen'); return; }
  }
  const key = 'os_wc_responses_' + code;
  const existing = _lsGet(key, []);
  existing.push({name: state.student||'Anonym', words:[word], ts:Date.now()});
  localStorage.setItem(key, JSON.stringify(existing));
  if (input) input.value = '';
  const resultMsg = document.getElementById('wc-student-result-msg');
  if (resultMsg) { resultMsg.style.display='block'; resultMsg.textContent='✅ «'+word+'» er sendt!'; }
  const inputArea = document.getElementById('wc-student-input-area');
  if (inputArea) {
    inputArea.innerHTML = '';
    const ok = document.createElement('div');
    ok.style.cssText = 'text-align:center;padding:1.25rem;background:rgba(34,197,94,0.1);border:1px solid rgba(34,197,94,0.3);border-radius:12px;font-weight:800;color:var(--c3);font-size:1rem;';
    ok.textContent = '✅ Svaret ditt er registrert!';
    const txt = document.createElement('div');
    txt.style.cssText = 'font-size:0.8rem;font-weight:600;color:var(--text-3);margin-top:0.3rem;';
    txt.textContent = '«' + word + '»';
    ok.appendChild(txt);
    inputArea.appendChild(ok);
  }
  showToast('✅ Sendt!');
}

function wcSubmitPoll(vote, code) {
  const key = 'os_wc_responses_' + code;
  const existing = _lsGet(key, []);
  existing.push({name: state.student||'Anonym', vote, ts:Date.now()});
  localStorage.setItem(key, JSON.stringify(existing));
  document.getElementById('wc-student-result-msg').style.display='block';
  document.getElementById('wc-student-result-msg').textContent='✅ Stemmen din er registrert: «'+vote+'»';
  const inputArea = document.getElementById('wc-student-input-area');
  if (inputArea) inputArea.style.opacity='0.4';
  showToast('Stemme registrert!');
}

function wcExport(fmt) {
  const canvas = document.getElementById('wc-cloud-canvas');
  if (!canvas) return;
  if (fmt === 'csv') {
    const rows = WC.results.map(r => [
      WC.session.anonymous ? 'Anonym' : (r.name||'Ukjent'),
      WC.session.mode==='poll' ? (r.vote||'') : (r.words||[]).join(', ')
    ]);
    const csv = [['Navn','Svar'], ...rows].map(r=>r.map(c=>'"'+String(c).replace(/"/g,'""')+'"').join(',')).join('\n');
    const a = document.createElement('a');
    a.href = 'data:text/csv;charset=utf-8,' + encodeURIComponent(csv);
    a.download = 'ordsky-resultater.csv';
    a.click();
    return;
  }
  _loadScript(_CDN_HTML2CANV).then(() => {
    html2canvas(canvas, {backgroundColor:'#08090e'}).then(c => {
      const a = document.createElement('a');
      a.href = c.toDataURL(fmt==='jpg'?'image/jpeg':'image/png');
      a.download = 'ordsky.'+(fmt==='jpg'?'jpg':'png');
      a.click();
    });
  }).catch(() => showToast('Eksport krever html2canvas – åpne siden i nettleser'));
}
// ====== END WORDCLOUD ENGINE ======



// ====== GAME ZONE (lazy-loaded via games.js) ======
// Functions: gzInit, gzStartWordle, gzStartWorldle, gzStartWhoami,
//            worldleAcHover, whoamiAcHover, gsLoadSessions, gsLoadActiveBanner,
//            crPopulateModules, crSwitchTab — all live in games.js.

let _gamesLoaded = false;
const _GAMES_JS_URL = window._GAMES_JS_URL || './games.js';

function _loadGames() {
  if (_gamesLoaded) return Promise.resolve();
  return _loadScript(_GAMES_JS_URL).then(() => { _gamesLoaded = true; });
}

// Stubs — replaced by real implementations once games.js is loaded.
// They lazy-load games.js on first call, then re-invoke themselves.
function gzInit()                { _loadGames().then(() => gzInit()); }
function gsLoadSessions()        { _loadGames().then(() => gsLoadSessions()); }
function gsLoadActiveBanner()    { _loadGames().then(() => gsLoadActiveBanner()); }
function crPopulateModules()     { _loadGames().then(() => crPopulateModules()); }
function crSwitchTab(t)          { _loadGames().then(() => crSwitchTab(t)); }
function worldleAcHover(i)       { /* guard: only fires after games.js is loaded */ }
function whoamiAcHover(i)        { /* guard: only fires after games.js is loaded */ }


// ====== ACCESSIBILITY INIT ======
// Apply role="dialog" + aria-modal + aria-hidden to all modal overlays on load
window.addEventListener('DOMContentLoaded', () => {
  document.querySelectorAll('.modal-overlay').forEach(overlay => {
    overlay.setAttribute('aria-hidden', 'true');
    const inner = overlay.querySelector('.modal');
    if (inner && !inner.hasAttribute('role')) {
      inner.setAttribute('role', 'dialog');
      inner.setAttribute('aria-modal', 'true');
      // Find a heading to use as label
      const heading = inner.querySelector('h1,h2,h3');
      if (heading) {
        if (!heading.id) heading.id = 'modal-title-' + Math.random().toString(36).slice(2,7);
        inner.setAttribute('aria-labelledby', heading.id);
      }
    }
  });
});

// ====== KEYBOARD SHORTCUTS (student working view) ======
document.addEventListener('keydown', e => {
  // Skip if user is typing in an input/textarea
  const tag = document.activeElement?.tagName;
  const inInput = tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || document.activeElement?.isContentEditable;
  const arbDetail = document.getElementById('arb-detail');
  const arbVisible = arbDetail && arbDetail.style.display !== 'none';

  // Flashcard: Space = flip, Left/Right/j/k = prev/next
  if (arbVisible && !inInput) {
    const fcInner = document.getElementById('arbFcInner');
    if (fcInner) {
      if (e.key === ' ' || e.key === 'f') { e.preventDefault(); fcInner.classList.toggle('flipped'); _arbAnnounce(fcInner.classList.contains('flipped') ? 'Kortets bakside' : 'Kortets forside'); return; }
      if (e.key === 'ArrowRight' || e.key === 'l') { e.preventDefault(); arbFcNext(); return; }
      if (e.key === 'ArrowLeft' || e.key === 'h') { e.preventDefault(); arbFcPrev(); return; }
      // Rating shortcuts when flipped
      if (fcInner.classList.contains('flipped')) {
        if (e.key === '1') { e.preventDefault(); arbFcRate('hard'); return; }
        if (e.key === '2') { e.preventDefault(); arbFcRate('ok'); return; }
        if (e.key === '3') { e.preventDefault(); arbFcRate('easy'); return; }
      }
    }

    // Quiz: number keys 1-4 to select answer
    const opts = [...document.querySelectorAll('#arbTaskContent .arb-opt:not([disabled])')];
    if (opts.length && !e.ctrlKey && !e.metaKey && !e.altKey) {
      const n = parseInt(e.key);
      if (n >= 1 && n <= opts.length) { e.preventDefault(); opts[n - 1].click(); return; }
    }
    // Quiz: Arrow up/down to move focus between options
    if ((e.key === 'ArrowUp' || e.key === 'ArrowDown') && opts.length) {
      const cur = opts.indexOf(document.activeElement);
      if (cur !== -1) {
        e.preventDefault();
        const next = (cur + (e.key === 'ArrowDown' ? 1 : -1) + opts.length) % opts.length;
        opts[next].focus();
        return;
      }
    }
  }
});

// Screen reader live region announcer
function _arbAnnounce(msg) {
  let r = document.getElementById('_arbAnnouncer');
  if (!r) {
    r = document.createElement('div');
    r.id = '_arbAnnouncer';
    r.setAttribute('aria-live', 'polite');
    r.setAttribute('aria-atomic', 'true');
    r.style.cssText = 'position:absolute;left:-9999px;width:1px;height:1px;overflow:hidden;';
    document.body.appendChild(r);
  }
  r.textContent = '';
  requestAnimationFrame(() => { r.textContent = msg; });
}

// ====== INIT ======
(async () => {
  try {
    await loadState();
  } catch(e) { console.error('loadState failed:', e); }
  try {
    await loadRosterCached();
  } catch(e) { console.error('loadRosterCached failed:', e); }
  try {
    renderHomeModules();
    renderTaskModules();
  } catch(e) { console.error('renderModules failed:', e); }
  try {
    showDbStatus();
  } catch(e) {}

  // Skjul splash-skjerm etter at appen er klar
  const splash = document.getElementById('appSplash');
  if (splash) { splash.classList.add('hidden'); setTimeout(() => { splash.style.display = 'none'; }, 450); }

  // Vis GDPR-banner hvis ikke allerede akseptert
  if (!localStorage.getItem('gdpr_ok')) {
    const gdprBanner = document.getElementById('gdprBanner');
    if (gdprBanner) {
      gdprBanner.style.display = 'flex';
      document.getElementById('gdprAcceptBtn')?.addEventListener('click', () => {
        localStorage.setItem('gdpr_ok', '1');
        gdprBanner.style.opacity = '0';
        gdprBanner.style.transition = 'opacity 0.3s';
        setTimeout(() => { gdprBanner.style.display = 'none'; }, 320);
      });
    }
  }

  // Vis kunngjøring til elever
  try {
    await checkAndShowAnnouncement();
  } catch(e) {}
  // Gjenopprett siste visning (unntatt teacher-panel)
  try {
    const lastView = localStorage.getItem('os_last_view');
    if (lastView && lastView !== 'teacher' && document.getElementById('view-' + lastView)) {
      if (lastView === 'arbeid') arbOpen();
      else showView(lastView);
    }
  } catch(e) {}

  // Pause quiz timers when tab loses focus (fair for timed quizzes)
  let _quizPauseTime = null;
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) {
      _quizPauseTime = Date.now();
      Object.keys(_quizTimers).forEach(qi => clearInterval(_quizTimers[qi]));
    } else if (_quizPauseTime !== null) {
      // Resume timers — they'll restart on next render (timers are per-render)
      _quizPauseTime = null;
    }
  });

  // Autosave for lærer – lagre emne-skjema hvert 30 sek
  window._teacherAutosaveInterval = setInterval(() => {
    if (!state.isTeacher) return;
    const name = document.getElementById('moduleName')?.value.trim();
    if (!name) return;
    localStorage.setItem('os_autosave', JSON.stringify({
      name,
      desc: document.getElementById('moduleDesc')?.value||'',
      text: document.getElementById('moduleText')?.value||'',
      emoji: document.getElementById('moduleEmoji')?.value||'',
      savedAt: new Date().toLocaleTimeString('no')
    }));
  }, 30000);
})();

// PDF.js is loaded on demand — worker is configured after load
function _ensurePdfJs() {
  return _loadScript(_CDN_PDFJS).then(() => {
    if (window.pdfjsLib && !window.pdfjsLib.GlobalWorkerOptions.workerSrc) {
      window.pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';
    }
  });
}

// Demo module if empty – vis kun visuelt, lagre IKKE til DB
if (!state.modules.length) {
  state.modules = [{
    _id: 'demo_demokrati_og_samfunn',
    name: 'Demokrati og samfunn',
    desc: 'Hva er demokrati, og hvordan fungerer det?',
    emoji: '🗳️',
    text: 'Demokrati er en styreform der folket bestemmer. Ordet demokrati kommer fra gresk og betyr "folkestyre". I et demokrati har alle borgere rett til å si sin mening og delta i valg.\n\nNorge er et representativt demokrati. Det betyr at vi velger representanter (politikere) til Stortinget, som tar beslutninger på vegne av befolkningen. Valg holdes hvert fjerde år.\n\nYtringsfriheten er en grunnleggende rettighet i demokratiet. Den gir oss rett til å si hva vi mener uten å bli straffet. Pressefrihet og rettssikkerhet er også viktige pilarer i demokratiet.',
    quiz: [
      { question: 'Hva betyr ordet demokrati?', a: 'Folkestyre', b: 'Kongestyre', c: 'Gudestyre', d: 'Statsstyre', explain: 'Demokrati kommer fra gresk: demos (folk) + kratos (styre).' },
      { question: 'Hvor ofte holdes det valg til Stortinget i Norge?', a: 'Hvert 4. år', b: 'Hvert 2. år', c: 'Hvert 6. år', d: 'Hvert år', explain: 'Stortingsvalg holdes hvert fjerde år i september.' },
      { question: 'Hva er ytringsfrihet?', a: 'Retten til å si sin mening fritt', b: 'Retten til å stemme', c: 'Retten til utdanning', d: 'Retten til arbeid', explain: 'Ytringsfrihet betyr at du kan uttrykke deg fritt uten å bli straffet.' }
    ],
    discussion: [
      'Hva synes du er de viktigste fordelene med demokrati som styreform? Sammenlign med andre styreformer.',
      'Har alle borgere like stor innflytelse i et demokrati? Diskuter fordeler og ulemper med det representative demokratiet.'
    ],
    write: [{ title: 'Skriv om demokratiets utfordringer', desc: 'Skriv en tekst om hvilke utfordringer demokratiet møter i dagens samfunn. Bruk eksempler fra Norge og verden.', minWords: 150 }],
    videos: [{ title: 'Hva er demokrati?', url: 'https://www.youtube.com/watch?v=dkSgVlCqeOE', task: 'Hva er de tre viktigste kjennetegnene ved demokrati som nevnes i videoen?' }],
    flashcards: [
      { front: 'Demokrati', back: 'Folkestyre – et politisk system der folket bestemmer.' },
      { front: 'Ytringsfrihet', back: 'Retten til å si og skrive hva man mener.' },
      { front: 'Stortinget', back: 'Norges nasjonalforsamling med 169 representanter.' },
      { front: 'Valg', back: 'Prosess der borgerne velger sine politiske representanter.' }
    ],
    createdAt: new Date().toLocaleString('no'),
    _isDemo: true
  }];
  renderHomeModules();
  renderTaskModules();
  updateContinueCard();
}


// ── Arb write helpers ─────────────────────────────────────────
let _arbTimers = {};

function arbAutoSave(wi, minWords) {
  clearTimeout(_autoSaveTimers['w'+wi]);
  _autoSaveTimers['w'+wi] = setTimeout(() => {
    const el = document.getElementById('arb-write-'+wi);
    if (!el) return;
    arbSave('write_'+wi, el.value);
    const dot = document.getElementById('arb-autosave-dot-'+wi);
    if (dot) { dot.style.display='inline'; setTimeout(()=>dot.style.display='none',2000); }
  }, 1500);
}

function arbToggleTimer(wi) {
  const key = 'wtimer_'+wi;
  const btnEl = document.getElementById('arb-timer-btn-'+wi);
  const displayEl = document.getElementById('arb-timer-'+wi);
  if (_arbTimers[key]) {
    clearInterval(_arbTimers[key]);
    delete _arbTimers[key];
    if (btnEl) btnEl.textContent = '▶ Start';
  } else {
    let secs = 0;
    _arbTimers[key] = setInterval(() => {
      secs++;
      const m = String(Math.floor(secs/60)).padStart(2,'0');
      const s = String(secs%60).padStart(2,'0');
      if (displayEl) displayEl.textContent = '⏱ '+m+':'+s;
    }, 1000);
    if (btnEl) btnEl.textContent = '⏸ Stopp';
  }
}
// ====== ARBEID (Student work mode) ======
let arbState = { moduleIdx: null, fcIndex: 0, completedTasks: {}, fcQueue: [], fcPhase: 'study' };

async function arbOpen() {
  showView('arbeid');
  document.getElementById('tasksTab')?.classList.add('active');
  // Show skeleton cards while fetching from DB
  _showSkeletons('arbModuleGrid', Math.min(state.modules.length || 6, 9));
  try {
    state.modules = await DB.loadModules();
  } catch(e) {
    // DB failed — loadModules already fell back to localStorage
  }
  if (!state.student) {
    document.getElementById('arbLoginPrompt').style.display = 'block';
    arbRenderModuleGrid();
    return;
  }
  document.getElementById('arbLoginPrompt').style.display = 'none';
  arbRenderModuleGrid();
}

function arbLogin() {
  const name = document.getElementById('arbNameInput').value.trim();
  const cls = document.getElementById('arbClassInput').value.trim();
  if (!name) { showToast('⚠️ Skriv inn navnet ditt!'); return; }
  state.student = { name, cls, joinedAt: new Date().toLocaleString('no') };
  localStorage.setItem('lh_student', JSON.stringify(state.student));
  document.getElementById('roleBadge').textContent = '🎓 ' + name;
  document.getElementById('arbLoginPrompt').style.display = 'none';
  arbRenderModuleGrid();
}

function arbShowDashboard() {
  const dash = document.getElementById('arbDashboard');
  if (!dash) return;
  if (dash.style.display !== 'none') { dash.style.display = 'none'; return; }
  const name = state.student?.name || '_guest';
  const prefix = 'arb_' + name + '_';
  // Compute per-module progress
  let totalDone = 0, totalTasks = 0, completedModules = 0;
  const modRows = state.modules.map((m, i) => {
    const tasks = countTasks(m);
    const done = arbGetModuleProgress(i);
    totalDone += done; totalTasks += tasks;
    if (tasks > 0 && done >= tasks) completedModules++;
    const pct = tasks > 0 ? Math.round((done / tasks) * 100) : 0;
    const bar = `<div style="height:6px;background:var(--s3);border-radius:99px;overflow:hidden;margin-top:4px;"><div style="height:100%;width:${pct}%;background:var(--c3);border-radius:99px;transition:width 0.4s;"></div></div>`;
    return `<div style="display:flex;align-items:center;gap:0.75rem;padding:8px 0;border-bottom:1px solid var(--border);">
      <span style="font-size:1.3rem;">${m.emoji||'📚'}</span>
      <div style="flex:1;min-width:0;">
        <div style="font-weight:700;font-size:0.88rem;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${escHtml(m.name)}</div>
        ${bar}
      </div>
      <span style="font-weight:800;font-size:0.85rem;color:${pct===100?'#4ade80':'var(--text-2)'};">${pct}%</span>
    </div>`;
  }).join('');
  // Streak: count distinct days with any arb_ key activity (using timestamps in localStorage)
  const activityDays = new Set();
  Object.keys(localStorage).filter(k => k.startsWith(prefix)).forEach(k => {
    try { const v = JSON.parse(localStorage.getItem(k)); if (v?.at) activityDays.add(v.at.slice(0,10)); } catch(e){}
  });
  const streak = activityDays.size;
  // Achievements
  const achievements = [];
  if (completedModules >= 1) achievements.push({emoji:'🏅', label:'Første emne fullført'});
  if (completedModules >= 5) achievements.push({emoji:'🥈', label:'5 emner fullført'});
  if (completedModules >= 10) achievements.push({emoji:'🥇', label:'10 emner fullført'});
  if (streak >= 3) achievements.push({emoji:'🔥', label:'3-dagers streak'});
  if (streak >= 7) achievements.push({emoji:'⚡', label:'7-dagers streak'});
  const overallPct = totalTasks > 0 ? Math.round((totalDone/totalTasks)*100) : 0;
  dash.style.display = 'block';
  dash.innerHTML = `
    <div style="background:var(--s1);border-radius:18px;padding:1.5rem;box-shadow:var(--shadow);margin-bottom:1rem;">
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:1rem;flex-wrap:wrap;gap:0.5rem;">
        <div style="font-family:'Fredoka One',cursive;font-size:1.4rem;">📊 Min fremgang</div>
        <button data-onclick="_hideArbDashboard" style="background:none;border:none;font-size:1.2rem;cursor:pointer;color:var(--text-2);">✕</button>
      </div>
      <div style="display:grid;grid-template-columns:repeat(3,1fr);gap:1rem;margin-bottom:1.25rem;">
        <div style="background:var(--s2);border-radius:14px;padding:1rem;text-align:center;">
          <div style="font-size:1.8rem;font-family:'Fredoka One',cursive;color:var(--accent);">${completedModules}</div>
          <div style="font-size:0.78rem;color:var(--text-2);font-weight:700;">Fullførte emner</div>
        </div>
        <div style="background:var(--s2);border-radius:14px;padding:1rem;text-align:center;">
          <div style="font-size:1.8rem;font-family:'Fredoka One',cursive;color:var(--c3);">${overallPct}%</div>
          <div style="font-size:0.78rem;color:var(--text-2);font-weight:700;">Totalt fullført</div>
        </div>
        <div style="background:var(--s2);border-radius:14px;padding:1rem;text-align:center;">
          <div style="font-size:1.8rem;font-family:'Fredoka One',cursive;color:#f59e0b;">${streak}🔥</div>
          <div style="font-size:0.78rem;color:var(--text-2);font-weight:700;">Aktive dager</div>
        </div>
      </div>
      ${achievements.length ? `<div style="margin-bottom:1.25rem;">
        <div style="font-weight:800;font-size:0.82rem;color:var(--text-2);margin-bottom:0.5rem;">MERKER</div>
        <div style="display:flex;flex-wrap:wrap;gap:0.5rem;">${achievements.map(a=>`<span style="background:var(--s2);border:1px solid var(--border-2);border-radius:50px;padding:5px 14px;font-size:0.82rem;font-weight:800;">${a.emoji} ${a.label}</span>`).join('')}</div>
      </div>` : ''}
      <div style="font-weight:800;font-size:0.82rem;color:var(--text-2);margin-bottom:0.5rem;">EMNER</div>
      <div style="max-height:260px;overflow-y:auto;">${modRows || '<div style="color:var(--text-3);text-align:center;padding:1rem;">Ingen data ennå</div>'}</div>
    </div>`;
}

function arbRenderModuleGrid() {
  const grid = document.getElementById('arbModuleGrid');
  const empty = document.getElementById('arbEmpty');
  if (!grid) return;
  _arbInvalidateProgressCache(); // ensure fresh before bulk render
  _arbBuildProgressCache(); // pre-build once, O(N) instead of O(N²)
  // Show/hide progress button
  const progBtn = document.getElementById('arbProgressBtn');
  if (progBtn) progBtn.style.display = state.student ? 'flex' : 'none';
  if (state.modules.length === 0) {
    grid.innerHTML = ''; empty.style.display = 'block'; return;
  }
  empty.style.display = 'none';
  // Search field
  let searchEl = document.getElementById('arbModuleSearch');
  if (!searchEl) {
    searchEl = document.createElement('input');
    searchEl.type = 'text';
    searchEl.id = 'arbModuleSearch';
    searchEl.placeholder = '🔍 Søk emner...';
    let _searchDebounce;
    searchEl.oninput = () => { clearTimeout(_searchDebounce); _searchDebounce = setTimeout(filterArbModules, 150); };
    searchEl.style.cssText = 'width:100%;padding:10px 16px;border:1px solid var(--border-2);border-radius:50px;font-family:\'Nunito\',sans-serif;font-size:0.92rem;outline:none;background:var(--s2);color:var(--text);margin-bottom:1rem;box-sizing:border-box;';
    grid.parentNode.insertBefore(searchEl, grid);
  }
  // Restore previous search query
  const savedQ = sessionStorage.getItem('arb_search_q');
  if (savedQ && savedQ !== searchEl.value) searchEl.value = savedQ;
  const colors = ['#FF6B6B','#4D96FF','#6BCB77','#FFD93D','#C77DFF'];
  const today = new Date(); today.setHours(0,0,0,0);
  grid.innerHTML = state.modules.map((m, i) => {
    // Check if locked or scheduled
    const isLocked = m.locked === true;
    const scheduledDate = m.scheduledFor ? new Date(m.scheduledFor) : null;
    const isScheduledFuture = scheduledDate && scheduledDate > today;
    const isBlocked = isLocked || isScheduledFuture;
    const tasks = countTasks(m);
    const done = arbGetModuleProgress(i);
    const pct = tasks > 0 ? Math.round((done / tasks) * 100) : 0;
    const chips = [];
    if (m.text) chips.push('📖 Tekst');
    if (m.quiz?.length) chips.push(`❓ ${m.quiz.length} quiz`);
    if (m.discussion?.length) chips.push(`💬 ${m.discussion.length} drøfting`);
    if (m.write?.length) chips.push(`✍️ Skriving`);
    if (m.flashcards?.length) chips.push(`🃏 Flashcards`);
    if (m.blanks?.length) chips.push(`✏️ Fyll inn`);
    if (isBlocked) {
      const openMsg = isScheduledFuture
        ? `Åpner ${scheduledDate.toLocaleDateString('no')}`
        : '🔒 Låst av lærer';
      return `<div class="arb-module-card" style="position:relative;opacity:0.55;cursor:default;pointer-events:none;" title="${openMsg}">
        <div style="position:absolute;top:0;left:0;right:0;height:5px;background:var(--border-2);border-radius:20px 20px 0 0;"></div>
        <span style="position:absolute;top:10px;right:10px;font-size:1.1rem;">🔒</span>
        <span class="arb-emoji" style="filter:grayscale(1);">${m.emoji||'📚'}</span>
        <h3 style="color:var(--text-3);">${escHtml(m.name)}</h3>
        <p style="color:var(--text-3);font-size:0.8rem;">${openMsg}</p>
      </div>`;
    }
    return `<div class="arb-module-card" data-onclick="arbOpenModule" data-onclick-arg="${i}" style="position:relative;--i:${i}">
      <div style="position:absolute;top:0;left:0;right:0;height:5px;background:${colors[i%5]};border-radius:20px 20px 0 0;"></div>
      ${pct === 100 ? '<span style="position:absolute;top:12px;right:12px;background:rgba(34,197,94,0.2);color:#4ade80;font-size:0.68rem;font-weight:800;padding:2px 8px;border-radius:50px;border:1px solid rgba(34,197,94,0.3);">✅ Fullført</span>' : ''}
      <span class="arb-emoji">${m.emoji||'📚'}</span>
      <h3>${escHtml(m.name)}</h3>
      <p>${escHtml(m.desc||'')}</p>
      <div class="arb-module-meta">${chips.map(c=>`<span class="arb-meta-chip">${c}</span>`).join('')}</div>
      <div class="arb-progress-bar"><div class="arb-progress-fill" style="width:${pct}%"></div></div>
      <div style="font-size:0.78rem;color:var(--text-3);font-weight:700;margin-top:0.3rem;">${pct > 0 ? pct+'% fullført' : 'Ikke startet'}</div>
    </div>`;
  }).join('');
  filterArbModules();
  _staggerCards('#arbModuleGrid .arb-module-card');
}

function _staggerCards(_containerSelector) {
  // CSS animation-delay via --i custom property handles stagger — no JS timers needed
}

function _showSkeletons(gridId, count = 6) {
  const grid = document.getElementById(gridId);
  if (grid) grid.innerHTML = Array(count).fill('<div class="skeleton-card"></div>').join('');
}

function filterArbModules() {
  const searchEl = document.getElementById('arbModuleSearch');
  const q = (searchEl?.value || '').toLowerCase();
  sessionStorage.setItem('arb_search_q', q); // persist across navigations
  document.querySelectorAll('#arbModuleGrid .arb-module-card').forEach(card => {
    const name = card.querySelector('h3')?.textContent.toLowerCase() || '';
    card.style.display = name.includes(q) ? '' : 'none';
  });
}

// Module progress cache — built once per grid render, invalidated on arbSave
let _arbProgressCache = null;
let _arbProgressCacheUser = null;
function _arbBuildProgressCache() {
  const sKey = state.student ? state.student.name : '_guest';
  if (_arbProgressCache && _arbProgressCacheUser === sKey) return;
  _arbProgressCache = {};
  _arbProgressCacheUser = sKey;
  const prefix = `arb_${sKey}_`;
  Object.keys(localStorage).forEach(k => {
    if (!k.startsWith(prefix)) return;
    const rest = k.slice(prefix.length); // m3_quiz_2
    const mMatch = rest.match(/^m(\d+)_(\w+)/);
    if (!mMatch) return;
    const mi = mMatch[1];
    const taskType = mMatch[2];
    if (!_arbProgressCache[mi]) _arbProgressCache[mi] = new Set();
    _arbProgressCache[mi].add(taskType);
  });
}
function arbGetModuleProgress(moduleIdx) {
  if (!state.modules[moduleIdx]) return 0;
  _arbBuildProgressCache();
  return _arbProgressCache[String(moduleIdx)]?.size || 0;
}
function _arbInvalidateProgressCache() { _arbProgressCache = null; }

function arbOpenModule(idx) {
  arbState.moduleIdx = idx;
  arbState.fcIndex = 0;
  const m = state.modules[idx];
  // Track module opens per student
  if (state.student) {
    const trackKey = 'os_open_' + (m?._id||'mod_'+idx);
    const opened = _lsGet(trackKey, {});
    opened[state.student.name] = new Date().toISOString();
    localStorage.setItem(trackKey, JSON.stringify(opened));
    DB.saveFeedback(trackKey, JSON.stringify(opened)).catch(()=>{});
  }
  document.getElementById('arb-select').style.display = 'none';
  document.getElementById('arb-detail').style.display = 'block';
  document.getElementById('arbDetailTitle').textContent = (m.emoji||'📚') + ' ' + m.name;
  document.getElementById('arbDetailStudent').textContent = state.student ? ('👤 ' + state.student.name + (state.student.cls ? ' · ' + state.student.cls : '')) : '';
  arbRenderTabs(m);
  arbUpdateProgress(idx);
}

function arbBackToList() {
  document.getElementById('arb-select').style.display = 'block';
  document.getElementById('arb-detail').style.display = 'none';
  arbRenderModuleGrid(); // refresh progress
}

function arbRenderTabs(m) {
  const tabs = [];
  if (m.text) tabs.push({ id:'text', label:'📖 Tekst' });
  if (m.quiz?.length) tabs.push({ id:'quiz', label:`❓ Quiz (${m.quiz.length})` });
  if (m.discussion?.length) tabs.push({ id:'disc', label:`💬 Drøfting (${m.discussion.length})` });
  if (m.write?.length) tabs.push({ id:'write', label:`✍️ Skriveoppgave` });
  if (m.videos?.length) tabs.push({ id:'video', label:`🎬 Video` });
  if (m.flashcards?.length) tabs.push({ id:'fc', label:`🃏 Flashcards (${m.flashcards.length})` });
  if (m.blanks?.length) tabs.push({ id:'blank', label:`✏️ Fyll inn` });
  if (m.flashcards?.length >= 2 || m.glossary?.length >= 2) tabs.push({ id:'match', label:`🎯 Match` });

  const bar = document.getElementById('arbTaskTabs');
  bar.innerHTML = tabs.map((t,i) => `
    <button class="arb-task-tab${i===0?' active':''}" id="arbTab-${t.id}" data-onclick="arbSwitchTab" data-onclick-arg="${t.id}">${t.label}</button>
  `).join('');
  if (tabs.length) arbRenderTab(tabs[0].id, m);
}

function arbSwitchTab(type) {
  document.querySelectorAll('.arb-task-tab').forEach(b => b.classList.remove('active'));
  const btn = document.getElementById('arbTab-' + type);
  if (btn) btn.classList.add('active');
  arbRenderTab(type, state.modules[arbState.moduleIdx]);
  const tc = document.getElementById('arbTaskContent');
  if (tc) { tc.classList.remove('tab-fade'); void tc.offsetWidth; tc.classList.add('tab-fade'); }
}

function _arbScrollTop() {
  const panel = document.getElementById('arbWorkContainer') || document.getElementById('view-arbeid');
  if (panel) panel.scrollTo({ top: 0, behavior: 'smooth' });
  else window.scrollTo({ top: 0, behavior: 'smooth' });
}
// ===== GLOSSARY HELPER =====
function _applyGlossary(html, glossary) {
  if (!glossary || !glossary.length) return html;
  glossary.forEach(g => {
    if (!g.term) return;
    const re = new RegExp('\\b(' + g.term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + ')\\b', 'gi');
    html = html.replace(re, `<span class="gloss-term" tabindex="0" data-def="${escHtml(g.def||'')}" title="${escHtml(g.def||'')}">$1</span>`);
  });
  return html;
}

// ===== TEKST-MARKERING =====
function _markSKey() { return arbSKey ? arbSKey() : (state.currentStudent || ''); }
function _markSave(moduleIdx, markObj) {
  const key = `os_marks_${_markSKey()}_m${moduleIdx}`;
  const marks = _lsGet(key, []);
  marks.push({...markObj, id: Date.now()});
  localStorage.setItem(key, JSON.stringify(marks));
}
function _markLoad(moduleIdx) {
  return _lsGet(`os_marks_${_markSKey()}_m${moduleIdx}`, []);
}
function _markDelete(moduleIdx, id) {
  const key = `os_marks_${_markSKey()}_m${moduleIdx}`;
  const marks = _markLoad(moduleIdx).filter(m => m.id !== id);
  localStorage.setItem(key, JSON.stringify(marks));
}
function _reapplyMarks(moduleIdx, bodyId) {
  const body = document.getElementById(bodyId||'arb-text-body') || document.getElementById('tasks-text-body');
  if (!body) return;
  const marks = _markLoad(moduleIdx);
  marks.forEach(mark => {
    const re = new RegExp('(' + mark.text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + ')', 'g');
    body.innerHTML = body.innerHTML.replace(re, `<mark class="text-mark" data-color="${escHtml(mark.color)}" data-id="${mark.id}" data-hid="${_reg(function(){_markClickMenu(this,moduleIdx)})}" title="${escHtml(mark.note||'')}">$1</mark>`);
  });
}
function _initMarkSelection(moduleIdx) {
  const body = document.getElementById('arb-text-body');
  if (!body) return;
  body.addEventListener('mouseup', () => {
    const sel = window.getSelection();
    if (!sel || sel.isCollapsed || sel.toString().trim().length < 2) return;
    _showMarkPopover(sel.toString().trim(), moduleIdx);
  });
}
let _markPopoverEl = null;
let _markPopoverBodyId = null;
function _showMarkPopover(selectedText, moduleIdx, bodyId) {
  _hideMarkPopover();
  _markPopoverBodyId = bodyId || 'arb-text-body';
  const sel = window.getSelection();
  if (!sel.rangeCount) return;
  const range = sel.getRangeAt(0);
  const rect = range.getBoundingClientRect();
  const pop = document.createElement('div');
  pop.className = 'mark-popover print-hide';
  pop.style.top = (rect.top + window.scrollY - 50) + 'px';
  pop.style.left = (rect.left + window.scrollX) + 'px';
  const safeText = selectedText.replace(/'/g,"\\'");
  pop.innerHTML = `<span style="font-size:0.78rem;font-weight:800;color:var(--text-2);margin-right:4px;">Merk:</span>` +
    ['yellow','green','pink'].map(c => `<button class="mark-color-btn" style="background:${c==='yellow'?'rgba(253,224,71,0.7)':c==='green'?'rgba(134,239,172,0.7)':'rgba(249,168,212,0.7)'};" data-onclick="_doMark" data-onclick-args="${escHtml(JSON.stringify([c,selectedText,moduleIdx,_markPopoverBodyId]))}"></button>`).join('') +
    `<button data-onclick="_hideMarkPopover" style="background:none;border:none;cursor:pointer;color:var(--text-2);font-size:0.9rem;padding:0 4px;">✕</button>`;
  document.body.appendChild(pop);
  _markPopoverEl = pop;
  setTimeout(() => document.addEventListener('click', _hideMarkPopover, {once:true}), 100);
}
function _hideMarkPopover() {
  if (_markPopoverEl) { _markPopoverEl.remove(); _markPopoverEl = null; }
}
function _doMark(color, text, moduleIdx, bodyId) {
  const bid = bodyId || _markPopoverBodyId || 'arb-text-body';
  // Replace popover with inline note-input step
  const pop = _markPopoverEl;
  if (!pop) return;
  const safeColor = color === 'yellow' ? 'rgba(253,224,71,0.7)' : color === 'green' ? 'rgba(134,239,172,0.7)' : 'rgba(249,168,212,0.7)';
  pop.innerHTML = `<div style="width:12px;height:12px;border-radius:50%;background:${safeColor};flex-shrink:0;"></div>
    <textarea id="_markNoteInput" placeholder="Notat (valgfritt)" style="width:160px;height:46px;font-size:0.78rem;background:var(--s2);color:var(--text);border:1px solid var(--border-2);border-radius:6px;padding:4px 7px;resize:none;outline:none;font-family:inherit;" maxlength="200"></textarea>
    <button id="_markSaveBtn" style="background:var(--accent);color:white;border:none;border-radius:6px;padding:5px 10px;cursor:pointer;font-size:0.82rem;font-weight:700;flex-shrink:0;">✓</button>
    <button data-onclick="_hideMarkPopover" style="background:none;border:none;cursor:pointer;color:var(--text-2);font-size:0.9rem;padding:0 3px;flex-shrink:0;">✕</button>`;
  const ta = pop.querySelector('#_markNoteInput');
  const saveBtn = pop.querySelector('#_markSaveBtn');
  const doSave = () => {
    const note = ta.value.trim();
    _hideMarkPopover();
    _markSave(moduleIdx, {text, color, note});
    _reapplyMarks(moduleIdx, bid);
  };
  saveBtn.onclick = doSave;
  ta.addEventListener('keydown', e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); doSave(); } });
  setTimeout(() => ta.focus(), 50);
}
function _markClickMenu(el, moduleIdx, bodyId) {
  const bid = bodyId || 'arb-text-body';
  const id = parseInt(el.getAttribute('data-id'));
  _showConfirm('Fjerne denne markeringen?', () => {
    _markDelete(moduleIdx, id);
    _reapplyMarks(moduleIdx, bid);
  }, 'Fjern', 'var(--c1)');
}
function _showMarksPanel(moduleIdx, bodyId) {
  const panelId = bodyId === 'tasks-text-body' ? `tasks-marks-panel-${moduleIdx}` : `arb-marks-panel-${moduleIdx}`;
  const panel = document.getElementById(panelId);
  if (!panel) return;
  const marks = _markLoad(moduleIdx);
  if (!marks.length) { panel.innerHTML = '<div class="marks-panel"><p style="font-size:0.82rem;color:var(--text-3);">Ingen markeringer ennå. Marker tekst for å lagre notater.</p></div>'; return; }
  panel.innerHTML = `<div class="marks-panel"><h3>📝 Mine markeringer (${marks.length})</h3>` +
    marks.map(m => `<div class="mark-item"><div class="mark-item-dot" data-color="${escHtml(m.color)}"></div><div><div class="mark-item-text">${escHtml(m.text)}</div>${m.note?`<div class="mark-item-note">${escHtml(m.note)}</div>`:''}</div></div>`).join('') +
    '</div>';
}

function arbRenderTab(type, m) {
  const container = document.getElementById('arbTaskContent');
  _arbScrollTop();
  if (type === 'text') {
    const textHtml = _applyGlossary(escHtml(m.text||''), m.glossary||[]);
    const mi = arbState.moduleIdx;
    container.innerHTML = `<div class="arb-content-card">
      <div style="display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:0.5rem;margin-bottom:1rem;">
        <h2 style="font-family:'Fredoka One',cursive;font-size:1.5rem;color:var(--text);margin:0;">📖 ${escHtml(m.name)}</h2>
        <button class="tts-btn print-hide" id="ttsBtnText" data-onclick="ttsSpeak" data-onclick-args='[null,"arb-text-body"]'>🔊 Les høyt</button>
      </div>
      <div class="arb-text-content" id="arb-text-body" style="white-space:pre-wrap;">${textHtml}</div>
      <button class="tts-btn print-hide" style="margin-top:1rem;" data-onclick="_showMarksPanel" data-onclick-args='[${mi}]'>📝 Mine markeringer</button>
      <div id="arb-marks-panel-${mi}"></div>
    </div>`;
    _reapplyMarks(mi);
    _initMarkSelection(mi);
    arbMarkDone('text');
  } else if (type === 'quiz') {
    arbRenderQuiz(m);
  } else if (type === 'disc') {
    arbRenderDisc(m);
  } else if (type === 'write') {
    arbRenderWrite(m);
  } else if (type === 'video') {
    arbRenderVideo(m);
  } else if (type === 'fc') {
    arbRenderFlashcards(m);
  } else if (type === 'blank') {
    container.innerHTML = `<div class="arb-content-card">${renderBlanksHTML(m)}</div>`;
    arbMarkDone('blank');
  } else if (type === 'match') {
    _renderMatchGame(m, container);
  }
}

let _quizOneAtATime = false;
let _quizCurrentIdx = 0;
function _quizCardStateKey() { return 'qcard_' + arbState.moduleIdx + '_' + (state.student?.name||'guest'); }
function _quizSaveCardState() { sessionStorage.setItem(_quizCardStateKey(), JSON.stringify({ one: _quizOneAtATime, idx: _quizCurrentIdx })); }
function _quizRestoreCardState() { try { const s = JSON.parse(sessionStorage.getItem(_quizCardStateKey())||'null'); if (s) { _quizOneAtATime = s.one||false; _quizCurrentIdx = s.idx||0; } } catch(e){} }

function arbRenderQuiz(m) {
  _quizRestoreCardState();
  _quizAnswered.clear();
  if (m.examMode && m.quiz?.length) { _arbExamRender(m); return; }
  const container = document.getElementById('arbTaskContent');
  const totalQ = m.quiz.length;
  const answeredCount = m.quiz.filter((q, qi) => arbLoad(`quiz_${qi}`) !== null).length;
  const correctCount = m.quiz.filter((q, qi) => arbLoad(`quiz_${qi}`) === 'correct').length;
  const allAnswered = answeredCount === totalQ;

  // One-at-a-time mode
  if (_quizOneAtATime) {
    _quizSaveCardState();
    _arbRenderQuizCard(m, _quizCurrentIdx);
    return;
  }

  let html = `<div class="arb-content-card">
    <div style="display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:0.75rem;margin-bottom:1.25rem;">
      <h2 style="font-family:'Fredoka One',cursive;font-size:1.4rem;color:var(--text);margin:0;">Quiz</h2>
      <div style="display:flex;gap:0.5rem;flex-wrap:wrap;align-items:center;">
        <button data-onclick="_arbShowCardMode" style="background:var(--s3);color:var(--accent);border:1px solid var(--border-2);padding:6px 16px;border-radius:50px;font-family:'Nunito',sans-serif;font-weight:800;font-size:0.82rem;cursor:pointer;" title="Én og én modus">🃏 Kortmodus</button>
        ${!allAnswered && answeredCount > 0 ? `<button data-onclick="_scrollToNextQuiz" style="background:var(--s3);color:var(--accent);border:1px solid var(--border-2);padding:6px 16px;border-radius:50px;font-family:'Nunito',sans-serif;font-weight:800;font-size:0.82rem;cursor:pointer;">↓ Neste ubesvarte</button>` : ''}
      </div>
    </div>`;
  m.quiz.forEach((q, qi) => {
    const savedAns = arbLoad(`quiz_${qi}`);
    const answered = savedAns !== null;
    const opts = shuffleArr([
      { text: q.a, correct: true },
      { text: q.b, correct: false },
      ...(q.c ? [{ text: q.c, correct: false }] : []),
      ...(q.d ? [{ text: q.d, correct: false }] : [])
    ]);
    const answerClass = answered ? (savedAns === 'correct' ? 'answered' : 'answered-wrong') : '';
    const qImgHtml = q.img ? `<img src="${escHtml(q.img)}" class="task-img img-safe" alt="" loading="lazy">` : '';
    html += `<div class="arb-quiz-card ${answerClass}" id="arb-qcard-${qi}">
      ${qImgHtml}
      <div style="display:flex;align-items:flex-start;justify-content:space-between;gap:0.5rem;margin-bottom:0.5rem;">
        <div class="arb-quiz-question" style="margin:0;">${qi+1}. ${escHtml(q.question)}</div>
        <button class="tts-btn print-hide" style="padding:4px 10px;font-size:0.75rem;flex-shrink:0;" data-onclick="_ttsSpeakSelf" data-onclick-self data-onclick-args="${escHtml(JSON.stringify([q.question]))}">🔊</button>
      </div>
      <div class="arb-options">
        ${opts.map((o,oi) => {
          let cls = '';
          if (answered) { cls = o.correct ? 'reveal-correct' : ''; }
          return `<button class="arb-opt ${cls}" id="arb-opt-${qi}-${oi}" ${answered?'disabled':''} data-onclick="arbCheckAnswer" data-onclick-args="${escHtml(JSON.stringify([qi,o.correct,oi,q.explain||'',opts.map(x=>x.correct)]))}}">${escHtml(o.text)}</button>`;
        }).join('')}
      </div>
      ${answered ? `<div class="arb-feedback ${savedAns==='correct'?'ok':'fail'}">${savedAns==='correct' ? '✅ Riktig!' : '❌ Feil'} ${q.explain ? '– '+escHtml(q.explain) : ''}</div>` : ''}
      <div id="arb-af-${qi}" class="print-hide"></div>
    </div>`;
  });
  if (allAnswered) {
    html += `<div style="text-align:center;padding:1.25rem 0 0.5rem;">
      <div style="font-size:1.15rem;font-weight:800;color:var(--text);margin-bottom:0.75rem;">
        ${correctCount >= totalQ * 0.8 ? '🏆' : correctCount >= totalQ * 0.5 ? '👍' : '📚'} ${correctCount}/${totalQ} riktige
      </div>
      <button data-onclick="arbResetQuiz" data-onclick-arg="${arbState.moduleIdx}" style="background:var(--s3);color:var(--text-2);border:1px solid var(--border-2);padding:10px 24px;border-radius:50px;font-family:'Nunito',sans-serif;font-weight:800;font-size:0.9rem;cursor:pointer;">🔄 Prøv på nytt</button>
    </div>`;
  }
  html += '</div>';
  container.innerHTML = html;
  // Load teacher comments for answered questions
  m.quiz.forEach((q, qi) => {
    const sKey2 = arbSKey();
    const fullKey = `${sKey2}_m${arbState.moduleIdx}_quiz_${qi}`;
    const storKey = 'af_' + fullKey;
    const comment = localStorage.getItem(storKey);
    if (comment) {
      const slot = document.getElementById('arb-af-' + qi);
      if (slot) slot.innerHTML = `<div class="af-box"><strong>💬 Lærer:</strong> ${escHtml(comment)}</div>`;
    }
  });
  // Also async-load from DB
  (async () => {
    for (let qi2 = 0; qi2 < m.quiz.length; qi2++) {
      const sKey3 = arbSKey();
      const fullKey = `${sKey3}_m${arbState.moduleIdx}_quiz_${qi2}`;
      const storKey = 'af_' + fullKey;
      const dbComment = await DB.loadFeedback(storKey);
      if (dbComment) {
        localStorage.setItem(storKey, dbComment);
        const slot = document.getElementById('arb-af-' + qi2);
        if (slot) slot.innerHTML = `<div class="af-box"><strong>💬 Lærer:</strong> ${escHtml(dbComment)}</div>`;
      }
    }
  })();
}

function _arbRenderQuizCard(m, qi) {
  const container = document.getElementById('arbTaskContent');
  const totalQ = m.quiz.length;
  // Find first unanswered if current is already answered
  while (qi < totalQ && arbLoad(`quiz_${qi}`) !== null) qi++;
  if (qi >= totalQ) {
    // All answered
    const correctCount = m.quiz.filter((q, i) => arbLoad(`quiz_${i}`) === 'correct').length;
    container.innerHTML = `<div class="arb-content-card" style="text-align:center;padding:2rem;">
      <div style="font-size:3rem;margin-bottom:0.5rem;">${correctCount >= totalQ*0.8?'🏆':correctCount>=totalQ*0.5?'👍':'📚'}</div>
      <div style="font-family:'Fredoka One',cursive;font-size:1.6rem;color:var(--text);margin-bottom:0.5rem;">Quiz fullført!</div>
      <div style="font-size:1.1rem;font-weight:800;color:var(--text-2);margin-bottom:1.5rem;">${correctCount}/${totalQ} riktige</div>
      <div style="display:flex;gap:0.75rem;justify-content:center;flex-wrap:wrap;">
        <button data-onclick="_arbShowAllQuiz" style="background:var(--s3);color:var(--text);border:1px solid var(--border-2);padding:10px 22px;border-radius:50px;font-family:'Nunito',sans-serif;font-weight:800;font-size:0.9rem;cursor:pointer;">📋 Se alle</button>
        <button data-onclick="_arbResetQuizAll" style="background:var(--accent);color:#fff;border:none;padding:10px 22px;border-radius:50px;font-family:'Nunito',sans-serif;font-weight:800;font-size:0.9rem;cursor:pointer;">🔄 Prøv igjen</button>
      </div>
    </div>`;
    arbMarkDone('quiz');
    return;
  }
  _quizCurrentIdx = qi;
  const q = m.quiz[qi];
  const opts = shuffleArr([
    { text: q.a, correct: true },
    { text: q.b, correct: false },
    ...(q.c ? [{ text: q.c, correct: false }] : []),
    ...(q.d ? [{ text: q.d, correct: false }] : [])
  ]);
  const qImgHtml = q.img ? `<img src="${escHtml(q.img)}" class="task-img img-safe" alt="">` : '';
  container.innerHTML = `<div class="arb-content-card">
    <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:1rem;flex-wrap:wrap;gap:0.5rem;">
      <div style="font-size:0.82rem;font-weight:800;color:var(--text-2);">Spørsmål ${qi+1} av ${totalQ}</div>
      <button data-onclick="_arbShowAllQuiz" style="background:none;border:1px solid var(--border-2);border-radius:50px;padding:4px 14px;font-family:'Nunito',sans-serif;font-weight:800;font-size:0.78rem;cursor:pointer;color:var(--text-2);">📋 Alle spørsmål</button>
    </div>
    <div style="width:100%;height:4px;background:var(--s3);border-radius:99px;margin-bottom:1.25rem;overflow:hidden;">
      <div style="height:100%;width:${Math.round((qi/totalQ)*100)}%;background:var(--accent);border-radius:99px;transition:width 0.3s;"></div>
    </div>
    ${qImgHtml}
    <div class="arb-quiz-question" style="font-size:1.1rem;margin-bottom:1.25rem;">${escHtml(q.question)}</div>
    <div class="arb-options" id="cardOpts">
      ${opts.map((o,oi) => `<button class="arb-opt" data-onclick="arbCheckAnswerCard" data-onclick-args="${escHtml(JSON.stringify([qi,o.correct,oi,q.explain||'',opts.map(x=>x.correct)]))}}">${escHtml(o.text)}</button>`).join('')}
    </div>
    <div id="cardFeedback"></div>
  </div>`;
}

function arbCheckAnswerCard(qi, isCorrect, optIdx, explain, correctMap) {
  const optsEl = document.getElementById('cardOpts');
  if (!optsEl) return;
  optsEl.querySelectorAll('.arb-opt').forEach((b, i) => {
    b.disabled = true;
    if (correctMap[i]) b.classList.add('reveal-correct');
  });
  optsEl.querySelectorAll('.arb-opt')[optIdx].classList.add(isCorrect ? 'correct' : 'wrong');
  if (isCorrect) { SND.correct(); launchConfetti(); } else { SND.wrong(); }
  const fb = document.getElementById('cardFeedback');
  if (fb) {
    fb.className = 'arb-feedback ' + (isCorrect ? 'ok' : 'fail');
    fb.innerHTML = (isCorrect ? '✅ Riktig!' : '❌ Feil') + (explain ? ' – ' + escHtml(explain) : '');
    // Add next button
    const nextBtn = document.createElement('button');
    nextBtn.textContent = qi + 1 < state.modules[arbState.moduleIdx].quiz.length ? 'Neste →' : 'Se resultat';
    nextBtn.style.cssText = 'margin-top:0.75rem;background:var(--accent);color:#fff;border:none;padding:10px 24px;border-radius:50px;font-family:\'Nunito\',sans-serif;font-weight:800;font-size:0.92rem;cursor:pointer;display:block;';
    nextBtn.onclick = () => { _quizCurrentIdx = qi + 1; _quizSaveCardState(); _arbRenderQuizCard(state.modules[arbState.moduleIdx], _quizCurrentIdx); };
    fb.appendChild(nextBtn);
  }
  arbSave(`quiz_${qi}`, isCorrect ? 'correct' : 'wrong');
  arbMarkDone('quiz');
  arbUpdateProgress(arbState.moduleIdx);
}

const _quizAnswered = new Set(); // race condition guard
function arbCheckAnswer(qi, isCorrect, optIdx, explain, correctMap) {
  if (_quizAnswered.has(qi)) return; // prevent double-submit (race with timer)
  _quizAnswered.add(qi);
  const card = document.getElementById('arb-qcard-' + qi);
  if (!card) return;
  // Disable all buttons
  card.querySelectorAll('.arb-opt').forEach((b, i) => {
    b.disabled = true;
    if (correctMap[i]) b.classList.add('reveal-correct');
  });
  const chosen = card.querySelectorAll('.arb-opt')[optIdx];
  if (isCorrect) { SND.correct(); launchConfetti(); } else { SND.wrong(); }
  chosen.classList.add(isCorrect ? 'correct' : 'wrong');
  // Show feedback
  const fb = document.createElement('div');
  fb.className = 'arb-feedback ' + (isCorrect ? 'ok' : 'fail');
  fb.textContent = (isCorrect ? '✅ Riktig!' : '❌ Feil') + (explain ? ' – ' + explain : '');
  card.appendChild(fb);
  card.classList.add(isCorrect ? 'answered' : 'answered-wrong');
  setTimeout(() => fb.scrollIntoView({ behavior: 'smooth', block: 'nearest' }), 120);
  arbSave(`quiz_${qi}`, isCorrect ? 'correct' : 'wrong');
  arbMarkDone('quiz');
  arbUpdateProgress(arbState.moduleIdx);
  // Show teacher comment if exists
  const fullKey = `${arbSKey()}_m${arbState.moduleIdx}_quiz_${qi}`;
  const storKey = 'af_' + fullKey;
  const comment = localStorage.getItem(storKey);
  const afSlot = document.getElementById('arb-af-' + qi);
  if (afSlot && comment) afSlot.innerHTML = `<div class="af-box"><strong>💬 Lærer:</strong> ${escHtml(comment)}</div>`;
}

function arbResetQuiz(moduleIdx) {
  const sKey = arbSKey();
  const prefix = `arb_${sKey}_m${moduleIdx}_quiz_`;
  Object.keys(localStorage).filter(k => k.startsWith(prefix)).forEach(k => localStorage.removeItem(k));
  const m = state.modules[moduleIdx];
  if (m) arbRenderQuiz(m);
}

function _scrollToNextQuiz() {
  const cards = document.querySelectorAll('.arb-quiz-card:not(.answered):not(.answered-wrong)');
  if (cards[0]) cards[0].scrollIntoView({ behavior: 'smooth', block: 'center' });
}

// ===== EKSAMEN-MODUS =====
let _examState = null;
function _arbExamRender(m) {
  _examState = { qi: 0, results: [], startTime: Date.now() };
  _arbExamShowQuestion(m);
}
function _arbExamShowQuestion(m) {
  const container = document.getElementById('arbTaskContent');
  const q = m.quiz[_examState.qi];
  const total = m.quiz.length;
  const pct = Math.round(_examState.qi / total * 100);
  const opts = shuffleArr([
    {text:q.a, correct:true},
    {text:q.b, correct:false},
    ...(q.c?[{text:q.c,correct:false}]:[]),
    ...(q.d?[{text:q.d,correct:false}]:[])
  ]);
  _examState.currentOpts = opts;
  const imgHtml = q.img ? `<img src="${escHtml(q.img)}" class="task-img img-safe" loading="lazy">` : '';
  const isLast = _examState.qi + 1 >= total;
  container.innerHTML = `<div class="arb-content-card">
    <div class="exam-q-counter">Spørsmål ${_examState.qi+1} av ${total}</div>
    <div class="exam-progress"><div class="exam-progress-fill" style="width:${pct}%"></div></div>
    ${imgHtml}
    <div class="arb-quiz-question" style="margin-bottom:1rem;">${escHtml(q.question)}</div>
    <div class="arb-options" id="examOpts">
      ${opts.map((o,oi)=>`<button class="arb-opt" id="exam-opt-${oi}" data-onclick="_examSelectOpt" data-onclick-args="${escHtml(JSON.stringify([oi,o.correct,q.question,q.a||'',opts.map(x=>x.correct)]))}}">${escHtml(o.text)}</button>`).join('')}
    </div>
    <div id="examNext" style="display:none;margin-top:1rem;">
      <button id="examNextBtn" style="background:var(--accent);color:white;border:none;padding:11px 28px;border-radius:50px;font-family:'Nunito',sans-serif;font-weight:800;font-size:1rem;cursor:pointer;">${isLast?'Se resultat 🎓':'Neste →'}</button>
    </div>
  </div>`;
}
function _examSelectOpt(oi, isCorrect, qText, correctText, correctMap) {
  if (document.getElementById('examNext').style.display !== 'none') return;
  _examState.results[_examState.qi] = { correct: isCorrect, qText, correctText };
  document.querySelectorAll('.arb-opt').forEach((b,i) => {
    b.disabled = true;
    if (correctMap[i]) b.style.background='rgba(34,197,94,0.15)';
    if (i===oi && !isCorrect) b.style.background='rgba(239,68,68,0.15)';
  });
  const nextBtn = document.getElementById('examNextBtn');
  if (nextBtn) nextBtn.onclick = () => {
    const m = state.modules[arbState.moduleIdx];
    _examState.qi++;
    if (_examState.qi < m.quiz.length) { _arbExamShowQuestion(m); }
    else { _arbExamShowResult(m); }
  };
  document.getElementById('examNext').style.display='block';
}
function _arbExamShowResult(m) {
  const container = document.getElementById('arbTaskContent');
  const results = _examState.results;
  const trueCorrect = results.filter(r=>r&&r.correct).length;
  const elapsed = Math.round((Date.now()-_examState.startTime)/1000);
  const mins = Math.floor(elapsed/60), secs = elapsed%60;
  const scoreColor = trueCorrect/m.quiz.length>=0.7?'var(--green)':trueCorrect/m.quiz.length>=0.4?'var(--yellow)':'var(--red)';
  const rows = m.quiz.map((q,qi) => {
    const r = results[qi];
    const isCorr = r && r.correct;
    return `<div style="padding:6px 0;border-bottom:1px solid var(--border);font-size:0.82rem;display:flex;align-items:flex-start;gap:0.5rem;">
      <span style="flex-shrink:0;">${isCorr?'✅':'❌'}</span>
      <div><div style="color:var(--text);font-weight:600;">${escHtml(q.question)}</div>
      ${!isCorr?`<div style="color:var(--c3);font-size:0.78rem;margin-top:2px;">Riktig: ${escHtml(q.a)}</div>`:''}
      </div>
    </div>`;
  }).join('');
  container.innerHTML = `<div class="arb-content-card exam-result-card">
    <div style="font-size:2.5rem;margin-bottom:0.5rem;">🎓</div>
    <div class="exam-score-big" style="color:${scoreColor}">${trueCorrect}/${m.quiz.length}</div>
    <div style="font-size:1rem;font-weight:700;color:var(--text-2);margin:0.5rem 0 0.25rem;">${Math.round(trueCorrect/m.quiz.length*100)}% riktige</div>
    <div style="font-size:0.82rem;color:var(--text-3);margin-bottom:1.5rem;">Tid brukt: ${mins>0?mins+'m ':''}${secs}s</div>
    <div style="text-align:left;max-width:400px;margin:0 auto;">${rows}</div>
  </div>`;
  arbMarkDone('quiz');
  arbUpdateProgress(arbState.moduleIdx);
  _examState = null;
}

function arbRenderDisc(m) {
  const container = document.getElementById('arbTaskContent');
  let html = `<div class="arb-content-card">
    <h2 style="font-family:'Fredoka One',cursive;font-size:1.4rem;color:var(--text);margin-bottom:1.25rem;">💬 Drøfting</h2>`;
  m.discussion.forEach((d, di) => {
    const saved = arbLoad(`disc_${di}`) || '';
    html += `<div class="arb-disc-card">
      <div class="arb-disc-prompt">💬 ${escHtml(d)}</div>
      <textarea id="arb-disc-${di}" rows="4" style="width:100%;padding:10px 12px;border:2px solid var(--border-2);border-radius:10px;font-family:'Nunito',sans-serif;font-size:0.92rem;resize:vertical;outline:none;background:var(--s2);color:var(--text);transition:border-color 0.2s;" class="focus-accent" placeholder="Skriv svaret ditt her..." data-oninput="_arbDiscCountEl" data-oninput-arg="${di}">${escHtml(saved)}</textarea>
      <div style="display:flex;align-items:center;justify-content:space-between;gap:0.5rem;margin-top:0.6rem;flex-wrap:wrap;">
        <div style="display:flex;align-items:center;gap:0.5rem;">
          <button data-onclick="arbSaveDisc" data-onclick-arg="${di}" style="background:var(--c4);color:white;border:none;padding:8px 18px;border-radius:50px;font-family:'Nunito',sans-serif;font-weight:800;font-size:0.85rem;cursor:pointer;">💾 Lagre svar</button>
          <span class="arb-save-indicator" id="arb-disc-saved-${di}">✓ Lagret!</span>
        </div>
        <span id="arb-disc-count-${di}" style="font-size:0.75rem;color:var(--text-3);font-weight:700;">${saved.trim() ? saved.trim().split(/\s+/).filter(w=>w).length : 0} ord</span>
      </div>
    </div>`;
  });
  html += '</div>';
  container.innerHTML = html;
}

function arbDiscCount(di, val) {
  const el = document.getElementById('arb-disc-count-' + di);
  const wordCount = val.trim() ? val.trim().split(/\s+/).filter(w => w).length : 0;
  if (el) el.textContent = wordCount + ' ord';
}
function arbSaveDisc(di) {
  const val = (document.getElementById('arb-disc-' + di)?.value || '').trim();
  if (!val) { showToast('⚠️ Skriv minst ett ord før du lagrer.'); return; }
  arbSave(`disc_${di}`, val);
  arbMarkDone('disc');
  const ind = document.getElementById('arb-disc-saved-' + di);
  if (ind) { ind.style.display = 'inline'; setTimeout(() => ind.style.display = 'none', 2000); }
  arbUpdateProgress(arbState.moduleIdx);
}

function arbRenderWrite(m) {
  const container = document.getElementById('arbTaskContent');
  let html = `<div class="arb-content-card">
    <h2 style="font-family:'Fredoka One',cursive;font-size:1.4rem;color:var(--text);margin-bottom:1.25rem;">✍️ Skriveoppgave</h2>`;
  m.write.forEach((w, wi) => {
    const saved = arbLoad(`write_${wi}`) || '';
    const wordCount = saved.split(/\s+/).filter(x=>x).length;
    const minOk = wordCount >= (w.minWords||100);
    html += `<div class="arb-write-card">
      <div style="font-weight:800;font-size:1rem;color:var(--text);margin-bottom:0.4rem;">✍️ ${escHtml(w.title)}</div>
      ${w.desc ? `<div style="font-size:0.88rem;color:var(--text-2);margin-bottom:0.75rem;background:var(--s3);border-radius:8px;padding:8px 12px;">📋 ${escHtml(w.desc)}</div>` : ''}
      <div style="display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:0.5rem;margin-bottom:0.5rem;">
        <div style="font-size:0.82rem;color:var(--text-3);font-weight:700;">Minimum ${w.minWords||100} ord</div>
        <div style="display:flex;align-items:center;gap:0.5rem;">
          <span id="arb-timer-${wi}" style="font-family:'Fredoka One',cursive;font-size:0.95rem;color:var(--c4);">⏱ 00:00</span>
          <button data-onclick="arbToggleTimer" data-onclick-arg="${wi}" id="arb-timer-btn-${wi}" style="background:var(--c4);color:white;border:none;padding:4px 12px;border-radius:50px;font-family:'Nunito',sans-serif;font-weight:800;font-size:0.75rem;cursor:pointer;">▶ Start</button>
        </div>
      </div>
      <textarea id="arb-write-${wi}" rows="8" style="width:100%;padding:12px 14px;border:2px solid var(--border-2);border-radius:10px;font-family:'Nunito',sans-serif;font-size:0.93rem;resize:vertical;outline:none;line-height:1.6;background:var(--s2);color:var(--text);transition:border-color 0.2s;" placeholder="Skriv besvarelsen din her..." data-oninput="_arbWriteCountEl" data-oninput-args="${escHtml(JSON.stringify([wi,w.minWords||100]))}" class="focus-accent">${escHtml(saved)}</textarea>
      <div style="height:3px;background:var(--border);border-radius:99px;margin-top:0.5rem;overflow:hidden;">
        <div id="arb-wc-bar-${wi}" style="height:100%;width:${Math.min(wordCount/(w.minWords||100),1)*100}%;background:var(--c3);transition:width 0.3s;border-radius:99px;"></div>
      </div>
      <div style="display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:0.5rem;margin-top:0.5rem;">
        <div style="display:flex;align-items:center;gap:0.5rem;"><div class="arb-wordcount${minOk?' ok':''}" id="arb-wc-${wi}">${wordCount} ord${minOk?' ✅':' (trenger '+(w.minWords||100)+' ord)'}</div><span id="arb-autosave-dot-${wi}" style="display:none;font-size:0.73rem;color:var(--c3);font-weight:700;">● Lagret automatisk</span></div>
        <div style="display:flex;align-items:center;gap:0.5rem;">
          <button data-onclick="arbSaveWrite" data-onclick-args="${JSON.stringify([wi,w.minWords||100])}" style="background:var(--c4);color:white;border:none;padding:8px 18px;border-radius:50px;font-family:'Nunito',sans-serif;font-weight:800;font-size:0.85rem;cursor:pointer;">💾 Lagre</button>
          <span class="arb-save-indicator" id="arb-write-saved-${wi}">✓ Lagret!</span>
        </div>
      </div>
    </div>`;
  });
  html += '</div>';
  container.innerHTML = html;
}

function arbWriteCount(wi, minWords) {
  const val = document.getElementById('arb-write-' + wi).value;
  const count = val.split(/\s+/).filter(x=>x).length;
  const ok = count >= minWords;
  const el = document.getElementById('arb-wc-' + wi);
  if (el) {
    el.textContent = count + ' ord' + (ok ? ' ✅' : ' (trenger '+minWords+' ord)');
    el.className = 'arb-wordcount' + (ok ? ' ok' : '');
  }
  const bar = document.getElementById('arb-wc-bar-' + wi);
  if (bar) bar.style.width = (Math.min(count / minWords, 1) * 100) + '%';
}

function arbSaveWrite(wi, minWords) {
  const val = document.getElementById('arb-write-' + wi).value;
  arbSave(`write_${wi}`, val);
  arbMarkDone('write');
  const ind = document.getElementById('arb-write-saved-' + wi);
  if (ind) { ind.style.display = 'inline'; setTimeout(() => ind.style.display = 'none', 2000); }
  arbUpdateProgress(arbState.moduleIdx);
  arbWriteCount(wi, minWords);
}

function arbRenderVideo(m) {
  const container = document.getElementById('arbTaskContent');
  let html = `<div class="arb-content-card">
    <h2 style="font-family:'Fredoka One',cursive;font-size:1.4rem;color:var(--text);margin-bottom:1.25rem;">🎬 Video</h2>`;
  m.videos.forEach((v, vi) => {
    const ytId = v.url ? v.url.match(/(?:v=|youtu\.be\/)([^&?/]+)/)?.[1] : null;
    html += `<div style="background:var(--s2);border-radius:14px;padding:1.25rem;margin-bottom:1rem;border:1px solid var(--border);">
      <div style="font-weight:800;font-size:1rem;color:var(--text);margin-bottom:0.75rem;">🎬 ${escHtml(v.title)}</div>
      ${ytId ? `<div style="position:relative;padding-top:56.25%;border-radius:12px;overflow:hidden;margin-bottom:0.75rem;">
        <iframe style="position:absolute;top:0;left:0;width:100%;height:100%;border:none;" src="https://www.youtube.com/embed/${ytId}" allowfullscreen></iframe>
      </div>` : (v.url ? `<a href="${escHtml(v.url)}" target="_blank" style="color:var(--c4);font-weight:700;font-size:0.9rem;">${escHtml(v.url)}</a>` : '')}
      ${v.task ? `<div style="background:rgba(245,158,11,0.1);border-radius:10px;padding:0.75rem 1rem;font-size:0.88rem;font-weight:600;color:var(--text-2);border-left:3px solid var(--c2);">📋 ${escHtml(v.task)}</div>` : ''}
    </div>`;
  });
  html += '</div>';
  container.innerHTML = html;
  arbMarkDone('video');
}

function arbRenderFlashcards(m) {
  const allIdx = (m.flashcards || []).map((_, i) => i);
  const mi = arbState.moduleIdx;
  // Sort: due cards first, then future cards
  allIdx.sort((a, b) => {
    const aDue = _sm2IsDue(mi, a) ? 0 : 1;
    const bDue = _sm2IsDue(mi, b) ? 0 : 1;
    return aDue - bDue;
  });
  arbState.fcQueue = allIdx;
  arbState.fcPhase = 'study';
  arbState.fcIndex = arbState.fcQueue[0] ?? 0;
  arbRenderFcCard(m);
}

function arbRenderFcCard(m) {
  _arbScrollTop();
  const container = document.getElementById('arbTaskContent');
  const cards = m.flashcards || [];
  const i = arbState.fcIndex;
  const card = cards[i];
  const qLen = arbState.fcQueue.length;
  const pos = cards.length - qLen + 1;
  const fcFrontContent = (card.imgFront ? `<img src="${escHtml(card.imgFront)}" style="max-height:80px;border-radius:6px;margin-bottom:6px;display:block;" loading="lazy" class="img-safe">` : '') + escHtml(card.front);
  const fcBackContent = (card.imgBack ? `<img src="${escHtml(card.imgBack)}" style="max-height:80px;border-radius:6px;margin-bottom:6px;display:block;" loading="lazy" class="img-safe">` : '') + escHtml(card.back);
  container.innerHTML = `<div class="arb-content-card">
    <div style="display:flex;align-items:center;justify-content:space-between;gap:0.5rem;margin-bottom:0.5rem;">
      <h2 style="font-family:'Fredoka One',cursive;font-size:1.4rem;color:var(--text);margin:0;">🃏 Flashcards</h2>
      <button class="tts-btn print-hide" data-onclick="_ttsSpeakSelf" data-onclick-self data-onclick-args="${escHtml(JSON.stringify([card.front]))}">🔊 Les høyt</button>
    </div>
    <div class="arb-fc-hint">Klikk på kortet for å snu det — vurder deg selv!${state.student ? (() => { const days = _sm2DaysUntil(arbState.moduleIdx, i); return days > 0 ? ` <span style="font-size:0.72rem;background:rgba(34,197,94,0.15);color:var(--c3);border-radius:50px;padding:1px 8px;font-weight:700;">📅 Forfaller om ${days} dag${days===1?'':'er'}</span>` : ' <span style="font-size:0.72rem;background:rgba(245,158,11,0.15);color:var(--c2);border-radius:50px;padding:1px 8px;font-weight:700;">⏰ Forfalt</span>'; })() : ''}</div>
    <div class="arb-fc-wrapper">
      <div class="arb-fc-inner" id="arbFcInner" data-onclick="_toggleArbFC">
        <div class="arb-fc-face arb-fc-front" style="flex-direction:column;">${fcFrontContent}</div>
        <div class="arb-fc-face arb-fc-back" style="flex-direction:column;">${fcBackContent}</div>
      </div>
    </div>
    <div class="arb-fc-nav">
      <span></span>
      <span class="arb-fc-counter">${pos} / ${cards.length}</span>
      <span></span>
    </div>
    <div id="arbFcRating" style="display:flex;gap:0.5rem;justify-content:center;margin-top:0.75rem;flex-wrap:wrap;">
      <button data-onclick="arbFcRate" data-onclick-arg="hard" style="background:rgba(239,68,68,0.15);color:var(--c1);border:1px solid rgba(239,68,68,0.3);border-radius:10px;padding:0.5rem 1rem;font-weight:700;cursor:pointer;font-size:0.9rem;transition:background 0.15s;">❌ Vanskelig</button>
      <button data-onclick="arbFcRate" data-onclick-arg="ok" style="background:rgba(245,158,11,0.15);color:var(--c2);border:1px solid rgba(245,158,11,0.3);border-radius:10px;padding:0.5rem 1rem;font-weight:700;cursor:pointer;font-size:0.9rem;transition:background 0.15s;">🤔 Usikker</button>
      <button data-onclick="arbFcRate" data-onclick-arg="easy" style="background:rgba(34,197,94,0.15);color:var(--c3);border:1px solid rgba(34,197,94,0.3);border-radius:10px;padding:0.5rem 1rem;font-weight:700;cursor:pointer;font-size:0.9rem;transition:background 0.15s;">✅ Kunne det</button>
    </div>
  </div>`;
}

function arbFcNext() {
  const m = state.modules[arbState.moduleIdx];
  if (arbState.fcIndex < (m.flashcards.length - 1)) { arbState.fcIndex++; arbRenderFcCard(m); }
}
function arbFcPrev() {
  if (arbState.fcIndex > 0) { arbState.fcIndex--; arbRenderFcCard(state.modules[arbState.moduleIdx]); }
}
// ====== SPACED REPETITION SM-2 ======
function _sm2GuestId() {
  let id = sessionStorage.getItem('sm2_guest_id');
  if (!id) { const b = crypto.getRandomValues(new Uint8Array(6)); id = 'g_' + Array.from(b, x => x.toString(36)).join(''); sessionStorage.setItem('sm2_guest_id', id); }
  return id;
}
function _sm2Key(mi, ci) { return 'sm2_' + (state.student?.name || _sm2GuestId()) + '_m' + mi + '_' + ci; }
function _sm2Load(mi, ci) {
  try { return JSON.parse(localStorage.getItem(_sm2Key(mi,ci))) || null; } catch { return null; }
}
function _sm2Save(mi, ci, data) { localStorage.setItem(_sm2Key(mi,ci), JSON.stringify(data)); }
function _sm2Update(mi, ci, rating) {
  const today = new Date(); today.setHours(0,0,0,0);
  const d = _sm2Load(mi, ci) || { rep: 0, interval: 1, ef: 2.5, due: null };
  if (rating === 'hard') {
    d.ef = Math.max(1.3, d.ef - 0.2);
    d.rep = 0;
    d.interval = 1;
  } else {
    // Correct response
    if (rating === 'easy') d.ef = Math.min(3.0, d.ef + 0.1);
    // SM-2 proper progression: rep 0→1d, rep 1→6d, rep 2+→interval*ef
    if (d.rep === 0) { d.interval = 1; }
    else if (d.rep === 1) { d.interval = 6; }
    else { d.interval = Math.max(1, Math.round(d.interval * d.ef)); }
    d.rep = (d.rep || 0) + 1;
  }
  const due = new Date(today); due.setDate(due.getDate() + d.interval);
  d.due = due.toISOString().slice(0, 10);
  _sm2Save(mi, ci, d);
  return d;
}
function _sm2IsDue(mi, ci) {
  const d = _sm2Load(mi, ci);
  if (!d?.due) return true; // never reviewed → due
  const today = new Date(); today.setHours(0,0,0,0);
  return new Date(d.due) <= today;
}
function _sm2DaysUntil(mi, ci) {
  const d = _sm2Load(mi, ci);
  if (!d?.due) return 0;
  const today = new Date(); today.setHours(0,0,0,0);
  return Math.ceil((new Date(d.due) - today) / 86400000);
}

function arbFcRate(rating) {
  const m = state.modules[arbState.moduleIdx];
  const idx = arbState.fcIndex;
  arbSave('fc_' + idx + '_rating', rating);
  if (state.student) _sm2Update(arbState.moduleIdx, idx, rating);
  arbState.fcQueue.shift();
  if (rating === 'hard') {
    const insertAt = Math.min(3, arbState.fcQueue.length);
    arbState.fcQueue.splice(insertAt, 0, idx);
  } else if (rating === 'ok' && arbState.fcPhase === 'study') {
    arbState.fcQueue.push(idx);
  }
  if (!arbState.fcQueue.length) { _arbFcShowSummary(m); return; }
  arbState.fcIndex = arbState.fcQueue[0];
  arbRenderFcCard(m);
}
function _arbFcShowSummary(m) {
  arbMarkDone('fc');
  const cards = m.flashcards || [];
  let hard = 0, ok = 0, easy = 0;
  cards.forEach((_, i) => {
    const r = arbLoad('fc_' + i + '_rating');
    if (r === 'hard') hard++;
    else if (r === 'ok') ok++;
    else if (r === 'easy') easy++;
  });
  const repeatCount = hard + ok;
  const container = document.getElementById('arbTaskContent');
  container.innerHTML = `<div class="arb-content-card" style="text-align:center;">
    <div style="font-size:3rem;margin-bottom:0.5rem;">🎉</div>
    <h2 style="font-family:'Fredoka One',cursive;font-size:1.5rem;color:var(--text);margin-bottom:1rem;">Runden er ferdig!</h2>
    <div style="display:flex;gap:1rem;justify-content:center;margin-bottom:1.5rem;flex-wrap:wrap;">
      <div style="background:rgba(239,68,68,0.15);border:1px solid rgba(239,68,68,0.25);border-radius:12px;padding:0.75rem 1.25rem;"><div style="font-size:1.5rem;font-weight:900;color:var(--c1);">${hard}</div><div style="font-size:0.8rem;color:var(--text-2);">Vanskelig</div></div>
      <div style="background:rgba(245,158,11,0.15);border:1px solid rgba(245,158,11,0.25);border-radius:12px;padding:0.75rem 1.25rem;"><div style="font-size:1.5rem;font-weight:900;color:var(--c2);">${ok}</div><div style="font-size:0.8rem;color:var(--text-2);">Usikker</div></div>
      <div style="background:rgba(34,197,94,0.15);border:1px solid rgba(34,197,94,0.25);border-radius:12px;padding:0.75rem 1.25rem;"><div style="font-size:1.5rem;font-weight:900;color:var(--c3);">${easy}</div><div style="font-size:0.8rem;color:var(--text-2);">Kunne det</div></div>
    </div>
    <div style="display:flex;gap:0.75rem;justify-content:center;flex-wrap:wrap;">
      ${repeatCount > 0 ? `<button data-onclick="_arbFcRestart" data-onclick-arg="repeat" style="background:var(--accent);color:#fff;border:none;border-radius:12px;padding:0.7rem 1.25rem;font-weight:700;cursor:pointer;font-size:0.95rem;">🔄 Øv på ${repeatCount} kort til</button>` : ''}
      <button data-onclick="_arbFcRestart" data-onclick-arg="all" style="background:var(--s2);color:var(--text);border:1px solid var(--border);border-radius:12px;padding:0.7rem 1.25rem;font-weight:700;cursor:pointer;font-size:0.95rem;">🔁 Start på nytt</button>
    </div>
  </div>`;
}
function _arbFcRestart(mode) {
  const m = state.modules[arbState.moduleIdx];
  const cards = m.flashcards || [];
  if (mode === 'repeat') {
    arbState.fcQueue = cards.map((_, i) => i).filter(i => {
      const r = arbLoad('fc_' + i + '_rating');
      return r === 'hard' || r === 'ok';
    });
  } else {
    arbState.fcQueue = cards.map((_, i) => i);
  }
  arbState.fcPhase = 'study';
  if (!arbState.fcQueue.length) { showToast('Ingen kort å øve på!'); return; }
  arbState.fcIndex = arbState.fcQueue[0];
  arbRenderFcCard(m);
}

// ---- Storage helpers ----
function arbSKey() {
  return state.student ? state.student.name.replace(/\s+/g,'_') : '_guest';
}
function arbSave(taskKey, val) {
  const key = `arb_${arbSKey()}_m${arbState.moduleIdx}_${taskKey}`;
  const strVal = typeof val === 'string' ? val : JSON.stringify(val);
  localStorage.setItem(key, strVal);
  _progressCache[key] = strVal;
  _arbInvalidateProgressCache();
  DB.saveProgress(state.student?.name, state.student?.cls, key, strVal);
}
function arbLoad(taskKey) {
  const key = `arb_${arbSKey()}_m${arbState.moduleIdx}_${taskKey}`;
  return _progressCache[key] || localStorage.getItem(key);
}
function arbMarkDone(type) {
  const key = `arb_${arbSKey()}_m${arbState.moduleIdx}_done_${type}`;
  localStorage.setItem(key, '1');
  _progressCache[key] = '1';
  DB.saveProgress(state.student?.name, state.student?.cls, key, '1');
  updateStudentProgress();
}

function arbUpdateProgress(moduleIdx) {
  const m = state.modules[moduleIdx];
  if (!m) return;
  const types = [];
  if (m.text) types.push('text');
  if (m.quiz?.length) types.push('quiz');
  if (m.discussion?.length) types.push('disc');
  if (m.write?.length) types.push('write');
  if (m.videos?.length) types.push('video');
  if (m.flashcards?.length) types.push('fc');
  const sKey = arbSKey();
  const done = types.filter(t => dbGetProgress(`arb_${sKey}_m${moduleIdx}_done_${t}`)).length;
  const pct = types.length > 0 ? Math.round(done / types.length * 100) : 0;
  const circle = document.getElementById('arbProgressCircle');
  const pctEl = document.getElementById('arbProgressPct');
  if (circle) { const offset = 138.2 * (1 - pct/100); circle.style.strokeDashoffset = offset; }
  if (pctEl) pctEl.textContent = pct + '%';
  const topBar = document.getElementById('arbTopProgressBar');
  if (topBar) topBar.style.width = pct + '%';
  // Jubel ved 100%
  const prevKey = `arb_${arbSKey()}_m${moduleIdx}_celebrated`;
  if (pct === 100 && types.length > 0 && !sessionStorage.getItem(prevKey)) {
    sessionStorage.setItem(prevKey, '1');
    launchConfetti();
    setTimeout(() => _showCompletionModal(moduleIdx), 400);
  }
}

function _showCompletionModal(moduleIdx) {
  const m = state.modules[moduleIdx];
  if (!m) return;
  // Find next unlocked module
  const nextIdx = state.modules.findIndex((mod, i) => i > moduleIdx && !mod.locked);
  const nextMod = nextIdx !== -1 ? state.modules[nextIdx] : null;
  const ov = document.createElement('div');
  ov.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.65);backdrop-filter:blur(8px);z-index:9998;display:flex;align-items:center;justify-content:center;animation:fadeIn 0.2s ease;';
  ov.innerHTML = `<div style="background:linear-gradient(135deg,var(--s1),var(--s2));border:1px solid var(--border-2);border-radius:20px;padding:2rem 2.25rem;max-width:380px;width:92%;text-align:center;box-shadow:0 20px 60px rgba(0,0,0,0.6);">
    <div style="font-size:3rem;margin-bottom:0.75rem;">🎉</div>
    <div style="font-family:'Fredoka One',cursive;font-size:1.5rem;color:var(--text);margin-bottom:0.4rem;">Bra jobba!</div>
    <div style="font-size:0.9rem;color:var(--text-2);margin-bottom:1.5rem;">Du har fullført alle oppgavene i <strong>${escHtml(m.name)}</strong>!</div>
    ${nextMod ? `<div style="background:var(--s3);border:1px solid var(--border-2);border-radius:12px;padding:0.875rem 1rem;margin-bottom:1rem;text-align:left;cursor:pointer;" data-onclick="_openNextModule" data-onclick-arg="${nextIdx}">
      <div style="font-size:0.72rem;font-weight:800;color:var(--text-3);text-transform:uppercase;letter-spacing:0.05em;margin-bottom:0.2rem;">Neste emne</div>
      <div style="font-weight:800;color:var(--text);font-size:0.92rem;">${nextMod.emoji||'📚'} ${escHtml(nextMod.name)}</div>
    </div>` : ''}
    <button data-onclick="_removeClosestModal" data-onclick-self style="width:100%;padding:11px;background:var(--accent);color:white;border:none;border-radius:11px;font-family:'Nunito',sans-serif;font-weight:800;font-size:0.95rem;cursor:pointer;">Fortsett</button>
  </div>`;
  ov.addEventListener('click', e => { if (e.target === ov) ov.remove(); });
  document.body.appendChild(ov);
}

function crShow(phase) {
  ['cr-setup','cr-lobby-view','cr-question-view','cr-scoreboard-view'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.style.display = 'none';
  });
  const el = document.getElementById('cr-' + phase);
  if (el) el.style.display = 'block';
}

function sjShow(phase) {
  ['sj-enter','sj-highscores','sj-waiting','sj-question','sj-answered','sj-result','sj-gameover'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.style.display = 'none';
  });
  const el = document.getElementById('sj-' + phase);
  if (el) el.style.display = 'block';
}

function previewLiveQuiz() {
  const sel = document.getElementById('crModuleSelect');
  if (!sel?.value) { showToast('⚠️ Velg et emne først'); return; }
  const mod = state.modules[parseInt(sel.value)];
  if (!mod?.quiz?.length) { showToast('⚠️ Ingen quiz-spørsmål i dette emnet'); return; }
  const listHtml = mod.quiz.map((q, i) => `<div style="padding:8px 0;border-bottom:1px solid var(--border);font-size:0.88rem;color:var(--text);"><strong style="color:var(--text-3);">${i+1}.</strong> ${escHtml(q.question)}</div>`).join('');
  const ov = document.createElement('div');
  ov.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.65);backdrop-filter:blur(6px);z-index:9999;display:flex;align-items:center;justify-content:center;animation:fadeIn 0.15s ease;';
  ov.innerHTML = `<div style="background:var(--s2);border:1px solid var(--border-2);border-radius:16px;padding:1.5rem 1.75rem;max-width:480px;width:92%;max-height:80vh;overflow-y:auto;">
    <div style="font-weight:800;font-size:1.1rem;color:var(--text);margin-bottom:1rem;">${mod.emoji||'📚'} ${escHtml(mod.name)} — ${mod.quiz.length} spørsmål</div>
    ${listHtml}
    <button data-onclick="_removeClosestModal" data-onclick-self style="margin-top:1rem;background:var(--s3);color:var(--text-2);border:1px solid var(--border-2);padding:9px 24px;border-radius:50px;font-family:'Nunito',sans-serif;font-weight:800;font-size:0.9rem;cursor:pointer;width:100%;">Lukk</button>
  </div>`;
  document.body.appendChild(ov);
  ov.addEventListener('click', e => { if (e.target === ov) ov.remove(); });
}

// ---- Teacher: Create game ----
async function crCreateGame() {
  if (!state.isTeacher) { showToast('⛔ Kun lærer kan starte quiz!'); return; }
  const sel = document.getElementById('crModuleSelect');
  if (!sel || !sel.value) { showToast('⚠️ Velg et emne først!'); return; }
  const modIdx = parseInt(sel.value);
  const mod = state.modules[modIdx];
  if (!mod || !mod.quiz || mod.quiz.length === 0) { showToast('⚠️ Dette emnet har ingen quizspørsmål!'); return; }
  const timeLimit = parseInt(document.getElementById('crTimeLimit').value) || 20;

  const code = crGenerateCode();
  crGame = {
    code, timeLimit,
    questions: mod.quiz.map(q => ({
      question: q.question,
      options: shuffleArr([
        { letter: 'a', text: q.a, correct: true },
        { letter: 'b', text: q.b, correct: false },
        { letter: 'c', text: q.c, correct: false },
        { letter: 'd', text: q.d, correct: false }
      ]),
      explain: q.explain || ''
    })),
    players: {},      // username -> { score, avatar, answers:[] }
    currentQ: -1,
    timerInterval: null,
    timeLeft: timeLimit,
    phase: 'lobby',
    revealed: false
  };

  // Store quiz name for highscores
  const _selEl = document.getElementById('crModuleSelect');
  crGame._quizName = _selEl ? (_selEl.options[_selEl.selectedIndex]?.text || 'Quiz') : 'Quiz';
  const remoteData = { code, phase:'lobby', players:{}, currentQ:-1, timeLimit, questions: crGame.questions };
  crGame._remote = remoteData;
  localStorage.setItem('cr_game', JSON.stringify(remoteData));

  // Show lobby immediately, then save to cloud
  crShow('lobby-view');
  document.getElementById('crCodeDisplay').textContent = code;

  await GAME.save(code, remoteData);
  crStartPolling();
}

function crStartPolling() {
  if (crGame._pollInterval) clearInterval(crGame._pollInterval);
  crGame._pollInterval = setInterval(async () => {
    const data = await GAME.load(crGame.code);
    if (!data) return;
    crGame._remote = data;
    // Merge in any new players
    crGame.players = data.players || {};
    crRefreshLobby();
    // Check for student answers during question phase
    if (crGame.phase === 'question') {
      const answered = Object.values(crGame.players).filter(p => p.answers && p.answers[crGame.currentQ] !== undefined).length;
      const total = Object.keys(crGame.players).length;
      const el = document.getElementById('crAnsweredCount');
      if (el) el.textContent = `${answered} av ${total} har svart`;
    }
  }, 1000);
}

function crRefreshLobby() {
  const players = Object.values(crGame.players);
  document.getElementById('crPlayerCount').textContent = `${players.length} elev${players.length !== 1 ? 'er' : ''} tilkoblet`;
  document.getElementById('crPlayerGrid').innerHTML = players.map(p =>
    `<div class="cr-player-chip">${p.avatar} ${p.username}</div>`
  ).join('');
}

async function crStartQuiz() {
  if (Object.keys(crGame.players).length === 0) {
    if (!confirm('Ingen elever er tilkoblet ennå. Start likevel?')) return;
  }
  crGame.phase = 'question';
  SND.start();
  SND.startBg();
  crNextQuestion();
}

async function crNextQuestion() {
  crGame.currentQ++;
  crGame.revealed = false;
  if (crGame.currentQ >= crGame.questions.length) { crShowFinalScoreboard(); return; }

  const q = crGame.questions[crGame.currentQ];
  crGame.timeLeft = crGame.timeLimit;
  crShow('question-view');

  document.getElementById('crQProgress').textContent = `Spørsmål ${crGame.currentQ+1} av ${crGame.questions.length}`;
  document.getElementById('crQText').textContent = q.question;
  document.getElementById('crNextBtn').style.display = 'none';
  document.getElementById('crRevealBtn').style.display = 'inline-flex';

  const opts = document.getElementById('crOptions');
  const colors = ['opt-a','opt-b','opt-c','opt-d'];
  const labels = ['🔴 A','🔵 B','🟢 C','🟣 D'];
  opts.innerHTML = q.options.map((o, i) =>
    `<button class="cr-option ${colors[i]}" id="crOpt${i}">${labels[i]} — ${o.text}</button>`
  ).join('');

  // Broadcast question to students
  await crBroadcast({ phase:'question', currentQ: crGame.currentQ, question: q.question, options: q.options.map(o => o.text), timeLimit: crGame.timeLimit });

  // Start timer
  if (crGame.timerInterval) clearInterval(crGame.timerInterval);
  const circumference = 188.5;
  crGame.timerInterval = setInterval(() => {
    crGame.timeLeft--;
    document.getElementById('crTimerText').textContent = crGame.timeLeft;
    const offset = circumference * (1 - crGame.timeLeft / crGame.timeLimit);
    document.getElementById('crTimerCircle').style.strokeDashoffset = offset;
    document.getElementById('crTimerCircle').style.stroke = crGame.timeLeft <= 5 ? 'var(--c1)' : crGame.timeLeft <= 10 ? 'var(--c2)' : 'var(--c3)';
    if (crGame.timeLeft <= 5 && crGame.timeLeft > 0) SND.tick();
    if (crGame.timeLeft <= 0) { clearInterval(crGame.timerInterval); crRevealAnswer(); }
  }, 1000);
}

async function crRevealAnswer() {
  if (crGame.revealed) return;
  crGame.revealed = true;
  SND.stopBg();
  if (crGame.timerInterval) clearInterval(crGame.timerInterval);
  document.getElementById('crRevealBtn').style.display = 'none';
  document.getElementById('crNextBtn').style.display = 'inline-flex';

  const q = crGame.questions[crGame.currentQ];
  const correctIdx = q.options.findIndex(o => o.correct);

  // Highlight correct/wrong on teacher screen
  q.options.forEach((o, i) => {
    const btn = document.getElementById('crOpt' + i);
    if (!btn) return;
    btn.classList.add(i === correctIdx ? 'correct' : 'wrong');
    if (i === correctIdx && q.explain) btn.title = q.explain;
  });

  // FETCH FRESH data from Supabase to get all player answers
  const freshData = await GAME.load(crGame.code);
  if (freshData && freshData.players) {
    crGame.players = freshData.players;
    crGame._remote = freshData;
  }

  // Score all players
  const timeSpent = crGame.timeLimit - crGame.timeLeft;
  const maxScore = 1000;
  Object.values(crGame.players).forEach(p => {
    const ans = p.answers?.[crGame.currentQ];
      if (!ans) return;
    const isCorrect = (ans.idx !== undefined) ? (ans.idx === correctIdx) : false;
      if (isCorrect) {
      const timePct = Math.max(0, 1 - (ans.timeSpent || timeSpent) / crGame.timeLimit);
      const pts = Math.round(maxScore * (0.5 + 0.5 * timePct));
      p.score = (p.score || 0) + pts;
      ans.points = pts;
      ans.correct = true;
        } else {
      ans.correct = false;
      ans.points = 0;
    }
  });

  // Broadcast result with updated scores to all students
  await crBroadcast({ phase: 'revealed', correctIdx, players: crGame.players, currentQ: crGame.currentQ });
}

async function crShowFinalScoreboard() {
  if (crGame._pollInterval) clearInterval(crGame._pollInterval);
  SND.stopBg();
  SND.gameover();
  crShow('scoreboard-view');
  await crBroadcast({ phase:'gameover', players: crGame.players });

  // Save highscores to Supabase
  const quizName = crGame._quizName || 'Quiz';
  try { await DB.saveHighscores(quizName, crGame.players, crGame.questions.length); } catch(e) {}

  const sorted = Object.values(crGame.players).sort((a,b) => (b.score||0)-(a.score||0));
  const medals = ['🥇','🥈','🥉'];
  document.getElementById('crScoreboard').innerHTML = sorted.map((p,i) => `
    <div class="cr-score-row">
      <div class="cr-rank">${medals[i] || (i+1)}</div>
      <div style="font-size:1.4rem">${p.avatar}</div>
      <div class="cr-name">${p.username}</div>
      <div class="cr-pts">${p.score||0} poeng</div>
    </div>`).join('') || '<p style="color:var(--text-3);">Ingen spillere</p>';

  // Button to see full highscores
  const sb = document.getElementById('crScoreboard');
  if (sb) sb.insertAdjacentHTML('afterend', `
    <div style="margin-top:1.5rem;padding:1rem;background:#f0f9ff;border-radius:14px;border:2px solid var(--c4);text-align:center;">
      <div style="font-weight:800;color:var(--c4);margin-bottom:0.5rem;">🏆 Resultater lagret!</div>
      <button data-onclick="_crSwitchTabHsSetup" style="background:var(--c4);color:white;border:none;padding:9px 20px;border-radius:50px;font-family:'Nunito',sans-serif;font-weight:800;font-size:0.88rem;cursor:pointer;">Se alle high scores →</button>
    </div>`);
}

async function crCancelGame() {
  if (crGame?._pollInterval) clearInterval(crGame._pollInterval);
  if (crGame?.timerInterval) clearInterval(crGame.timerInterval);
  if (crGame?.code) await GAME.delete(crGame.code);
  localStorage.removeItem('cr_game');
  crGame = null;
  crShow('setup');
}

function crEndGame() {
  crCancelGame();
  showView('join');
}

function crPlayAgain() {
  if (crGame?._pollInterval) clearInterval(crGame._pollInterval);
  crGame = null;
  crShow('setup');
  crPopulateModules();
}

async function crBroadcast(update) {
  // Always fetch fresh state first to avoid overwriting player answers
  const fresh = await GAME.load(crGame.code);
  const base = fresh || crGame._remote || {};
  const merged = Object.assign({}, base, update);
  // Never overwrite players with empty if fresh has them
  if (update.players) merged.players = update.players;
  else if (fresh && fresh.players) merged.players = fresh.players;
  crGame._remote = merged;
  localStorage.setItem('cr_game', JSON.stringify(merged));
  await GAME.save(crGame.code, merged);
}

// ---- Student: Join & Play ----
async function sjJoinGame() {
  const code = (document.getElementById('sjCodeInput').value || '').trim().toUpperCase();
  if (code.length !== 4) { sjShowError('Koden må være 4 tegn!'); return; }

  const joinBtn = document.getElementById('sjJoinBtn');
  if (joinBtn) { joinBtn.textContent = '⏳ Kobler til…'; joinBtn.disabled = true; }

  // Try cloud first, then localStorage fallback
  let data = await GAME.load(code);
  if (!data) {
    // localStorage fallback for same-device testing
    const raw = localStorage.getItem('cr_game');
    if (raw) {
      const local = JSON.parse(raw);
      if (local.code === code) data = local;
    }
  }

  if (joinBtn) { joinBtn.textContent = '🎮 Bli med!'; joinBtn.disabled = false; }

  if (!data) { sjShowError('Fant ingen aktiv quiz med den koden. Sjekk koden og prøv igjen!'); return; }
  if (data.phase !== 'lobby') { sjShowError('Spillet er allerede i gang. Vent til neste runde!'); return; }

  const username = crGenerateUsername();
  const avatar = ANIMALS[Math.floor(Math.random()*ANIMALS.length)];
  sjGame = { code, username, avatar, score: 0, answers: {}, currentQ: -1 };

  // Register player in cloud
  if (!data.players) data.players = {};
  data.players[username] = { username, avatar, score: 0, answers: {} };
  await GAME.save(code, data);
  localStorage.setItem('cr_game', JSON.stringify(data));

  document.getElementById('sjUsername').textContent = username;
  document.getElementById('sjAvatar').textContent = avatar;
  document.getElementById('sjCodeShow').textContent = code;
  sjShow('waiting');
  sjStartPolling();
}

function sjShowError(msg) {
  const el = document.getElementById('sjError');
  el.style.display = 'block';
  el.textContent = '❌ ' + msg;
}

function sjStartPolling() {
  if (sjGame._pollInterval) clearInterval(sjGame._pollInterval);
  sjGame._noDataCount = 0;
  sjGame._lastPhase = null;
  sjGame._pollInterval = setInterval(async () => {
    let data = await GAME.load(sjGame.code);
    if (!data) {
      // fallback to localStorage
      const raw = localStorage.getItem('cr_game');
      data = raw ? JSON.parse(raw) : null;
    }
    if (!data) {
      sjGame._noDataCount = (sjGame._noDataCount || 0) + 1;
      if (sjGame._noDataCount > 10) { clearInterval(sjGame._pollInterval); sjShow('gameover'); }
      return;
    }
    sjGame._noDataCount = 0;
    // Update local backup
    localStorage.setItem('cr_game', JSON.stringify(data));

    const phaseKey = data.phase + '_' + data.currentQ;
    if (phaseKey === sjGame._lastPhase) return; // no change

    if (data.phase === 'question' && data.currentQ !== undefined && data.currentQ !== sjGame.currentQ) {
      sjGame._lastPhase = phaseKey;
      sjGame.currentQ = data.currentQ;
      sjGame.questionStart = Date.now();
      sjGame.answered = false;
      sjShowQuestion(data);
    } else if (data.phase === 'revealed' && data.currentQ === sjGame.currentQ) {
      sjGame._lastPhase = phaseKey;
      sjShowResult(data);
    } else if (data.phase === 'gameover') {
      sjGame._lastPhase = phaseKey;
      clearInterval(sjGame._pollInterval);
      sjShowGameOver(data);
    }
  }, 800);
}

function sjShowQuestion(data) {
  document.getElementById('sjQNum').textContent = `Spørsmål ${data.currentQ + 1}`;
  document.getElementById('sjQText').textContent = data.question || '';
  const opts = data.options || [];
  const btns = document.querySelectorAll('.cr-answer-btn');
  btns.forEach((btn, i) => {
    btn.textContent = opts[i] || '';
    btn.disabled = false;
    btn.style.opacity = '1';
    btn.style.background = '';
    btn.style.color = '';
    btn.style.transform = '';
  });
  sjShow('question');

  // Timer bar
  let elapsed = 0;
  const total = data.timeLimit || 20;
  if (sjGame._timerBar) clearInterval(sjGame._timerBar);
  sjGame._timerBar = setInterval(() => {
    elapsed++;
    const pct = Math.max(0, 100 - (elapsed / total * 100));
    const bar = document.getElementById('sjTimerBar');
    if (bar) bar.style.width = pct + '%';
    if (elapsed >= total) clearInterval(sjGame._timerBar);
  }, 1000);
}

async function sjAnswer(idx) {
  if (sjGame.answered) return;
  sjGame.answered = true;
  SND.click();
  const timeSpent = (Date.now() - (sjGame.questionStart || Date.now())) / 1000;
  if (sjGame._timerBar) clearInterval(sjGame._timerBar);

  // Disable all buttons immediately
  document.querySelectorAll('.cr-answer-btn').forEach(b => b.disabled = true);

  // Save answer to cloud - store as idx so scoring works
  const gameData = await GAME.load(sjGame.code) || _lsGet('cr_game', {});
  if (!gameData.players) gameData.players = {};
  if (!gameData.players[sjGame.username]) {
    gameData.players[sjGame.username] = { username: sjGame.username, avatar: sjGame.avatar, score: 0, answers: {} };
  }
  if (!gameData.players[sjGame.username].answers) gameData.players[sjGame.username].answers = {};
  gameData.players[sjGame.username].answers[sjGame.currentQ] = { idx: idx, timeSpent: timeSpent };
  localStorage.setItem('cr_game', JSON.stringify(gameData));
  await GAME.save(sjGame.code, gameData);

  document.getElementById('sjAnsweredIcon').textContent = '✅';
  document.getElementById('sjAnsweredMsg').textContent = 'Svar registrert!';
  document.getElementById('sjCurrentScore').textContent = `Poeng: ${sjGame.score}`;
  sjShow('answered');
}

function sjShowResult(data) {
  const playerData = data.players?.[sjGame.username];
  const ans = playerData?.answers?.[sjGame.currentQ];
  const correct = ans?.correct;
  const pts = ans?.points || 0;
  if (playerData) sjGame.score = playerData.score || sjGame.score;

  // Highlight correct/wrong buttons on question screen before switching
  if (data.correctIdx !== undefined) {
    document.querySelectorAll('.cr-answer-btn').forEach((btn, i) => {
      btn.disabled = true;
      if (i === data.correctIdx) {
        btn.style.background = '#6BCB77'; btn.style.color = 'white'; btn.style.transform = 'scale(1.05)';
      } else if (ans && ans.idx === i) {
        btn.style.background = '#FF6B6B'; btn.style.color = 'white';
      } else {
        btn.style.opacity = '0.45';
      }
    });
  }

  if (correct) SND.correct(); else if (correct === false) SND.wrong();
  document.getElementById('sjResultIcon').textContent = correct ? '🎉' : '😅';
  document.getElementById('sjResultMsg').textContent = correct ? 'Riktig svar! 🎊' : 'Ikke riktig denne gang';
  document.getElementById('sjPointsGained').textContent = correct ? `+${pts} poeng` : '+0 poeng';
  document.getElementById('sjTotalScore').textContent = `Totalt: ${sjGame.score} poeng`;
  sjShow('result');
}

function sjShowGameOver(data) {
  const sorted = Object.values(data.players || {}).sort((a,b) => (b.score||0)-(a.score||0));
  const rank = sorted.findIndex(p => p.username === sjGame.username) + 1;
  const finalScore = data.players?.[sjGame.username]?.score ?? sjGame.score;
  document.getElementById('sjFinalScore').textContent = finalScore;
  document.getElementById('sjFinalRank').textContent = rank > 0 ? `Du ble nr. ${rank} av ${sorted.length}` : '';

  // Show mini scoreboard on student gameover screen
  const medals = ['🥇','🥈','🥉'];
  const miniBoard = document.createElement('div');
  miniBoard.style.cssText = 'margin:1.25rem auto;max-width:320px;text-align:left;';
  miniBoard.innerHTML = `<div style="font-family:'Fredoka One',cursive;font-size:1.1rem;color:var(--text);margin-bottom:0.75rem;text-align:center;">🏆 Resultater</div>` +
    sorted.slice(0,5).map((p,i) => `
      <div style="display:flex;align-items:center;gap:0.6rem;padding:0.5rem 0.75rem;border-radius:10px;background:${p.username===sjGame.username?'rgba(245,158,11,0.15)':'var(--s2)'};margin-bottom:0.35rem;border:${p.username===sjGame.username?'2px solid var(--c2)':'1px solid var(--border)'}">
        <span style="font-size:1.2rem;min-width:1.8rem;">${medals[i]||i+1}</span>
        <span style="font-size:1.1rem;">${p.avatar}</span>
        <span style="flex:1;font-weight:800;font-size:0.88rem;">${p.username}</span>
        <span style="font-weight:900;color:var(--c4);">${p.score||0}</span>
      </div>`).join('');

  const rankEl = document.getElementById('sjFinalRank');
  if (rankEl) rankEl.insertAdjacentElement('afterend', miniBoard);

  sjShow('gameover');
}

function shuffleArr(arr) {
  const a = [...arr];
  for (let i = a.length-1; i > 0; i--) {
    const j = Math.floor(Math.random()*(i+1));
    [a[i],a[j]] = [a[j],a[i]];
  }
  return a;
}
// ════════════════════════════════════════════════════════════════
//  SOUND SYSTEM – Web Audio API (no external files needed)
// ════════════════════════════════════════════════════════════════
const SND = (() => {
  let ctx = null;
  let bgGain = null;
  let bgSource = null;
  let bgPlaying = false;

  function getCtx() {
    if (!ctx) ctx = new (window.AudioContext || window.webkitAudioContext)();
    return ctx;
  }

  // Play a simple tone burst
  function tone(freq, dur=0.12, vol=0.18, type='sine', delay=0) {
    if (_usSettings && _usSettings.sound === false) return;
    try {
      const c = getCtx();
      const osc = c.createOscillator();
      const gain = c.createGain();
      osc.connect(gain); gain.connect(c.destination);
      osc.type = type;
      osc.frequency.setValueAtTime(freq, c.currentTime + delay);
      gain.gain.setValueAtTime(0, c.currentTime + delay);
      gain.gain.linearRampToValueAtTime(vol, c.currentTime + delay + 0.01);
      gain.gain.exponentialRampToValueAtTime(0.001, c.currentTime + delay + dur);
      osc.start(c.currentTime + delay);
      osc.stop(c.currentTime + delay + dur + 0.05);
    } catch(e) {}
  }

  // ── Correct answer: ascending jingle ──
  function correct() {
    tone(523, 0.1, 0.2, 'triangle');          // C5
    tone(659, 0.1, 0.2, 'triangle', 0.1);     // E5
    tone(784, 0.15, 0.25, 'triangle', 0.2);   // G5
    tone(1047, 0.2, 0.22, 'triangle', 0.32);  // C6
  }

  // ── Wrong answer: descending thud ──
  function wrong() {
    tone(300, 0.08, 0.15, 'sawtooth');
    tone(220, 0.1, 0.15, 'sawtooth', 0.1);
    tone(160, 0.18, 0.12, 'sawtooth', 0.2);
  }

  // ── Answer submitted (neutral click) ──
  function click() {
    tone(660, 0.06, 0.1, 'sine');
  }

  // ── Timer tick ──
  function tick() {
    tone(880, 0.04, 0.06, 'square');
  }

  // ── Quiz start fanfare ──
  function start() {
    [0, 0.12, 0.24, 0.38].forEach((d, i) => {
      const notes = [523, 587, 659, 784];
      tone(notes[i], 0.14, 0.18, 'triangle', d);
    });
  }

  // ── Game over flourish ──
  function gameover() {
    const seq = [784, 659, 784, 1047];
    seq.forEach((f, i) => tone(f, 0.18, 0.2, 'triangle', i * 0.18));
  }

  // ── Background quiz music (subtle looping) ──
  function startBg() {
    if (bgPlaying) return;
    try {
      const c = getCtx();
      bgGain = c.createGain();
      bgGain.gain.setValueAtTime(0.04, c.currentTime);
      bgGain.connect(c.destination);

      // Simple pentatonic loop: C D E G A C
      const scale = [262, 294, 330, 392, 440, 523];
      const pattern = [0,2,4,3,1,4,2,0, 5,3,1,2,4,0,3,5];
      let step = 0;
      const BPM = 108;
      const beat = 60 / BPM;

      function playBeat() {
        if (!bgPlaying) return;
        const noteIdx = pattern[step % pattern.length];
        const freq = scale[noteIdx];
        const osc = c.createOscillator();
        const g = c.createGain();
        osc.connect(g); g.connect(bgGain);
        osc.type = 'triangle';
        osc.frequency.setValueAtTime(freq, c.currentTime);
        g.gain.setValueAtTime(0.3, c.currentTime);
        g.gain.exponentialRampToValueAtTime(0.001, c.currentTime + beat * 0.7);
        osc.start(c.currentTime);
        osc.stop(c.currentTime + beat);
        step++;
        if (bgPlaying) setTimeout(playBeat, beat * 1000);
      }
      bgPlaying = true;
      playBeat();
    } catch(e) {}
  }

  function stopBg() {
    bgPlaying = false;
    if (bgGain) {
      try { bgGain.gain.setValueAtTime(bgGain.gain.value, getCtx().currentTime);
            bgGain.gain.exponentialRampToValueAtTime(0.001, getCtx().currentTime + 0.5); }
      catch(e) {}
    }
  }

  return { correct, wrong, click, tick, start, gameover, startBg, stopBg };
})();

// ── ORD-OPPSLAG (høyreklikk → "Hva betyr ordet?") ──────────────────
(function() {
  // Lag kontekstmeny-element
  const menu = document.createElement('div');
  menu.id = 'wordContextMenu';
  menu.style.cssText = `
    display:none;position:fixed;z-index:9999;
    background:var(--dark);color:white;
    border-radius:12px;padding:6px;
    box-shadow:0 8px 32px rgba(0,0,0,0.35);
    font-family:'Nunito',sans-serif;min-width:180px;
  `;
  menu.innerHTML = `
    <button id="wordLookupBtn" style="
      width:100%;background:none;border:none;color:white;
      font-family:'Nunito',sans-serif;font-weight:800;font-size:0.9rem;
      padding:10px 14px;border-radius:8px;cursor:pointer;text-align:left;
      display:flex;align-items:center;gap:8px;transition:background 0.15s;
    "
      >
      📖 Hva betyr ordet?
    </button>
  `;
  document.body.appendChild(menu);

  // Lag popup-boks for forklaring
  const popup = document.createElement('div');
  popup.id = 'wordPopup';
  popup.style.cssText = `
    display:none;position:fixed;z-index:10000;
    background:var(--s2);color:var(--text);
    border-radius:18px;padding:1.25rem 1.5rem;
    box-shadow:0 12px 48px rgba(0,0,0,0.2);
    font-family:'Nunito',sans-serif;max-width:320px;min-width:220px;
    border:3px solid var(--c4);
  `;
  popup.innerHTML = `
    <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:0.75rem;">
      <span id="wordPopupWord" style="font-weight:900;font-size:1.1rem;color:var(--c4);"></span>
      <button data-onclick="_hideWordPopup"
        style="background:none;border:none;cursor:pointer;font-size:1.2rem;color:var(--text-3);padding:0 0 0 8px;">✕</button>
    </div>
    <div id="wordPopupBody" style="font-size:0.92rem;line-height:1.65;color:var(--text);"></div>
  `;
  document.body.appendChild(popup);

  let selectedWord = '';

  // Høyreklikk-lytter
  document.addEventListener('contextmenu', function(e) {
    // Finn markert eller klikket ord
    const sel = window.getSelection();
    let word = sel && sel.toString().trim();

    // Hvis ingen markering, finn ordet under musepekeren
    if (!word) {
      const el = e.target;
      const text = el.textContent || '';
      const range = document.caretRangeFromPoint ? document.caretRangeFromPoint(e.clientX, e.clientY) : null;
      if (range) {
        range.expand('word');
        word = range.toString().trim();
      }
    }

    // Fjern skilletegn
    word = word.replace(/[^a-zA-ZæøåÆØÅa-zA-Z0-9\-]/g, '').trim();

    if (!word || word.length < 2) {
      menu.style.display = 'none';
      return;
    }

    selectedWord = word;

    // Plasser menyen ved musepekeren
    e.preventDefault();
    menu.style.display = 'block';
    let x = e.clientX, y = e.clientY;
    if (x + 200 > window.innerWidth) x = window.innerWidth - 210;
    if (y + 60 > window.innerHeight) y = window.innerHeight - 70;
    menu.style.left = x + 'px';
    menu.style.top = y + 'px';
  });

  // Skjul meny ved klikk utenfor
  document.addEventListener('click', function(e) {
    if (!menu.contains(e.target)) menu.style.display = 'none';
  });
  let _ctxScrollRaf;
  document.addEventListener('scroll', function() {
    if (_ctxScrollRaf) return;
    _ctxScrollRaf = requestAnimationFrame(() => { menu.style.display = 'none'; _ctxScrollRaf = null; });
  }, { passive: true, capture: true });

  // Klikk på "Hva betyr ordet?"
  document.getElementById('wordLookupBtn').addEventListener('click', async function() {
    menu.style.display = 'none';
    if (!selectedWord) return;

    // Plasser popup nær der menyen var
    const mx = parseInt(menu.style.left) || 200;
    const my = parseInt(menu.style.top) || 200;
    popup.style.display = 'block';
    let px = mx, py = my + 10;
    if (px + 340 > window.innerWidth) px = window.innerWidth - 340;
    if (py + 200 > window.innerHeight) py = my - 210;
    popup.style.left = px + 'px';
    popup.style.top = py + 'px';

    document.getElementById('wordPopupWord').textContent = selectedWord;
    document.getElementById('wordPopupBody').innerHTML =
      '<span style="color:var(--text-3);font-style:italic;">⏳ Slår opp...</span>';

    const apiKey = getApiKey();
    if (!apiKey) {
      document.getElementById('wordPopupBody').innerHTML =
        '<span style="color:#e53e3e;">⚠️ Ingen API-nøkkel satt. Gå til ⚙️ Innstillinger og legg inn nøkkel.</span>';
      return;
    }

    try {
      const res = await _anthropicFetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': apiKey,
          'anthropic-version': '2023-06-01',
          'anthropic-dangerous-direct-browser-access': 'true'
        },
        body: JSON.stringify({
          model: 'claude-haiku-4-5-20251001',
          max_tokens: 200,
          messages: [{
            role: 'user',
            content: `Forklar ordet "${selectedWord}" kort og enkelt på norsk for en ungdomsskoleelev. 
Inkluder:
1. Norsk oversettelse (hvis det er et engelsk ord)
2. Kort forklaring (1-2 setninger)
3. Et kort eksempel

Svar BARE med selve forklaringen, ingen ekstra tekst.`
          }]
        })
      });
      const data = await res.json();
      const text = data.content?.[0]?.text || 'Kunne ikke slå opp ordet.';
      // Formater teksten litt
      const html = text
        .replace(/\n\n/g, '<br><br>')
        .replace(/\n/g, '<br>')
        .replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>');
      document.getElementById('wordPopupBody').innerHTML = html;
    } catch(e) {
      document.getElementById('wordPopupBody').innerHTML =
        '<span style="color:#e53e3e;">⚠️ Kunne ikke koble til AI. Sjekk internett og API-nøkkel.</span>';
    }
  });
})();

// ═══════════════════════════════════════════════════════
// GLOBALE TASTATURSNARVEI
// ═══════════════════════════════════════════════════════
document.addEventListener('keydown', function(e) {
  // Escape: handled by closeModal/_modalStack in openModal system — no duplicate needed
  // Ctrl+K / Cmd+K: hurtigsøk på hjemside
  if ((e.ctrlKey || e.metaKey) && e.key === 'k') {
    const homeView = document.getElementById('view-home');
    if (homeView?.classList.contains('active')) {
      e.preventDefault();
      const search = document.getElementById('moduleSearch');
      if (search) { search.focus(); search.select(); showToast('🔍 Søk etter emner...'); }
      return;
    }
  }
  // Escape: avslutt fokus-modus
  if (e.key === 'Escape' && document.body.classList.contains('focus-mode')) {
    exitFocusMode(); return;
  }
  // Ctrl+S / Cmd+S: lagre om i lærerpanel
  if ((e.ctrlKey || e.metaKey) && e.key === 's') {
    const teacherView = document.getElementById('view-teacher');
    if (teacherView?.classList.contains('active') && state.isTeacher) {
      e.preventDefault();
      const publishBtn = document.querySelector('.publish-bar .btn-primary');
      if (publishBtn) { publishBtn.click(); showToast('💾 Lagret!'); }
    }
  }
  // 1/2/3: flashcard rating
  if (!e.ctrlKey && !e.metaKey && (e.key === '1' || e.key === '2' || e.key === '3')) {
    const tag = document.activeElement?.tagName;
    if (!['INPUT','TEXTAREA','SELECT'].includes(tag) && document.getElementById('arbTaskContent')?.querySelector('.arb-fc-wrapper')) {
      if (e.key === '1') arbFcRate('hard');
      else if (e.key === '2') arbFcRate('ok');
      else if (e.key === '3') arbFcRate('easy');
    }
  }
  // ?: vis hurtigtaster (ikke i input-felt)
  if (e.key === '?' && !e.ctrlKey && !e.metaKey) {
    const tag = document.activeElement?.tagName;
    if (!['INPUT','TEXTAREA','SELECT'].includes(tag) && !document.activeElement?.isContentEditable) {
      e.preventDefault();
      openShortcutsModal();
    }
  }
}, true);

function openShortcutsModal() {
  const m = document.getElementById('shortcutsModal');
  if (m) m.classList.add('open');
}

// ═══════════════════════════════════════════════════════
// PWA INSTALL PROMPT
// ═══════════════════════════════════════════════════════
let _pwaPrompt = null;
window.addEventListener('beforeinstallprompt', e => {
  e.preventDefault();
  _pwaPrompt = e;
  if (!localStorage.getItem('os_pwa_dismissed')) {
    setTimeout(_pwaShowBanner, 3500);
  }
});
window.addEventListener('appinstalled', () => { _pwaHideBanner(); });

function _pwaShowBanner() {
  if (document.getElementById('pwaBanner') || !_pwaPrompt) return;
  const b = document.createElement('div');
  b.id = 'pwaBanner';
  b.innerHTML = `
    <div class="pwa-text">📲 <strong>Legg til SkOla</strong><br><span style="font-size:0.78rem;font-weight:600;color:var(--text-2);">på hjemskjermen for raskere tilgang</span></div>
    <button class="pwa-install-btn" data-onclick="_pwaInstall">Legg til</button>
    <button class="pwa-dismiss-btn" data-onclick="_pwaDismiss" aria-label="Lukk">×</button>`;
  document.body.appendChild(b);
}
function _pwaInstall() {
  if (!_pwaPrompt) return;
  _pwaPrompt.prompt();
  _pwaPrompt.userChoice.then(() => { _pwaHideBanner(); _pwaPrompt = null; });
}
function _pwaDismiss() {
  localStorage.setItem('os_pwa_dismissed', '1');
  _pwaHideBanner();
}
function _pwaHideBanner() {
  const b = document.getElementById('pwaBanner');
  if (b) b.remove();
}

// ═══════════════════════════════════════════════════════
// SWIPE-NAVIGASJON PÅ MOBIL
// ═══════════════════════════════════════════════════════
(function() {
  const NAV_ORDER = ['home', 'arbeid', 'join', 'wc', 'spill'];
  let _tx = 0, _ty = 0;

  function _currentView() {
    const v = document.querySelector('.view.active');
    return v ? v.id.replace('view-', '') : 'home';
  }

  document.addEventListener('touchstart', function(e) {
    _tx = e.touches[0].clientX;
    _ty = e.touches[0].clientY;
  }, { passive: true });

  document.addEventListener('touchend', function(e) {
    const dx = e.changedTouches[0].clientX - _tx;
    const dy = e.changedTouches[0].clientY - _ty;
    // Ignorer vertikale scroll-bevegelser og korte swipes
    if (Math.abs(dy) > Math.abs(dx) || Math.abs(dx) < 60) return;
    // Ignorer swipe inne i tekstfelter, knapper og scrollbare elementer
    const tag = e.target.tagName;
    if (tag === 'TEXTAREA' || tag === 'INPUT' || tag === 'SELECT') return;
    const scrollable = e.target.closest('[data-no-swipe], .task-tabs, .nav-tabs, .mobile-nav, .modal-overlay');
    if (scrollable) return;

    const cur = _currentView();
    const idx = NAV_ORDER.indexOf(cur);
    if (idx === -1) return;

    if (dx < -60 && idx < NAV_ORDER.length - 1) {
      // Sveip venstre → neste fane
      const next = NAV_ORDER[idx + 1];
      if (next === 'arbeid') arbOpen(); else showView(next);
    } else if (dx > 60 && idx > 0) {
      // Sveip høyre → forrige fane
      const prev = NAV_ORDER[idx - 1];
      if (prev === 'arbeid') arbOpen(); else showView(prev);
    }
  }, { passive: true });
})();

// ====== EVENT DELEGATION (replaces inline onclick/oninput/onchange/onkeydown handlers) ======
(function() {
  // Call a named global function with optional args
  // data-onclick="fn"                         → fn()
  // data-onclick="fn" data-onclick-arg="3"    → fn(3)
  // data-onclick="fn" data-onclick-args="[1,true,'x']" → fn(1,true,'x')
  // data-onclick="fn" data-onclick-self       → fn(element)
  // data-onclick="fn" data-onclick-args="[1]" data-onclick-self → fn(element,1)
  function _dispatch(el, extra) {
    const fn = window[el.dataset.onclick];
    if (typeof fn !== 'function') return;
    let args = [];
    if (el.dataset.onclickArgs !== undefined) {
      try { args = JSON.parse(el.dataset.onclickArgs); } catch {}
    } else if (el.dataset.onclickArg !== undefined) {
      args = [_parseArg(el.dataset.onclickArg)];
    }
    if ('onclickSelf' in el.dataset) args = [el, ...args];
    if (extra !== undefined) args = [...args, extra];
    fn(...args);
  }

  // Handler registry delegation (data-hid)
  document.addEventListener('click', function(e) {
    const el = e.target.closest('[data-hid]');
    if (!el) return;
    const fn = _H[el.dataset.hid];
    if (typeof fn === 'function') fn.call(el, e);
  });

  // Click delegation — finds innermost element with data-onclick
  document.addEventListener('click', function(e) {
    const el = e.target.closest('[data-onclick]');
    if (!el) return;
    if ('onclickOverlay' in el.dataset && e.target !== el) return;
    _dispatch(el);
  });

  // Input delegation
  document.addEventListener('input', function(e) {
    const el = e.target.closest('[data-oninput]');
    if (!el) return;
    const fn = window[el.dataset.oninput];
    if (typeof fn !== 'function') return;
    if ('oninputVal' in el.dataset) { fn(e.target.value); return; }
    if ('oninputEl' in el.dataset) { fn(el); return; }
    // Support data-oninput-args / data-oninput-arg (passes element as first arg)
    if (el.dataset.oninputArgs !== undefined) {
      let args = []; try { args = JSON.parse(el.dataset.oninputArgs); } catch {}
      fn(el, ...args);
    } else if (el.dataset.oninputArg !== undefined) {
      const a = el.dataset.oninputArg;
      const v = (a==='true'?true:a==='false'?false:!isNaN(a)&&a!==''?Number(a):a);
      fn(el, v);
    } else { fn(); }
  });

  // Change delegation
  document.addEventListener('change', function(e) {
    const el = e.target;
    if (!el.dataset.onchange) return;
    const fn = window[el.dataset.onchange];
    if (typeof fn !== 'function') return;
    if ('onchangeChecked' in el.dataset) { fn(el.dataset.onchangeArg, el.checked); return; }
    if ('onchangeEl' in el.dataset) { fn(el); return; }
    if ('onchangeVal' in el.dataset) { fn(e.target.value); return; }
    // Support data-onchange-arg (passes value as second arg with the index)
    if (el.dataset.onchangeArg !== undefined) {
      const a = el.dataset.onchangeArg;
      const v = (!isNaN(a) && a !== '' ? Number(a) : a);
      fn(v, e.target.value);
      return;
    }
    fn();
  });

  // Keydown delegation
  document.addEventListener('keydown', function(e) {
    const el = e.target;
    if (el.dataset.onkeydownEnter && e.key === 'Enter') {
      const fn = window[el.dataset.onkeydownEnter];
      if (typeof fn === 'function') fn();
    }
    if (el.dataset.onkeydown) {
      const fn = window[el.dataset.onkeydown];
      if (typeof fn === 'function') fn(e);
    }
  });

  // Space/Enter for role=button elements with data-onclick (accessibility)
  document.addEventListener('keydown', function(e) {
    if (e.key !== 'Enter' && e.key !== ' ') return;
    const el = e.target.closest('[data-onclick][role="button"]');
    if (!el) return;
    e.preventDefault();
    _dispatch(el);
  });

  // File input trigger delegation
  document.addEventListener('click', function(e) {
    const btn = e.target.closest('[data-trigger-click]');
    if (!btn) return;
    document.getElementById(btn.dataset.triggerClick)?.click();
  });

  function _parseArg(v) {
    if (v === undefined || v === null || v === '') return undefined;
    if (v === 'true') return true;
    if (v === 'false') return false;
    const n = Number(v);
    if (!isNaN(n) && v !== '') return n;
    return v;
  }
})();

// Wrapper functions for multi-call inline handlers
function _crSwitchTabHs() { crSwitchTab('hs'); loadHighscoreView(); }
function _renderQbankDeferred() { setTimeout(_renderQbank, 50); }
const _renderQbankDebounced = _debounce(_renderQbank, 200);
function _oninputUppercase(el) { el.value = el.value.toUpperCase(); }
function _oninputUppercaseAlnum(el) { el.value = el.value.toUpperCase().replace(/[^A-Z0-9]/g, ''); }

// Wrapper functions for complex inline handler cases
function _moduleNameInput() { updatePublishBarHint(); _updateCharCount('moduleName', 80); }
function _quizQInput() { _updateCharCount('quizQ', 400); }
function _fcImgFrontInput() { previewFcImg('front'); }
function _fcImgBackInput() { previewFcImg('back'); }
function _fcImgFrontFile(el) { loadFcImgFile(el, 'front'); }
function _fcImgBackFile(el) { loadFcImgFile(el, 'back'); }
function _onchangeCompGoals(val) { updateCompetenceGoals(); syncAiSubjectFromSelect(val); }

// Wrappers for dynamic HTML (JS-generated innerHTML) event handlers
function _removeById(id) { document.getElementById(id)?.remove(); }
function _removeByIdThenTab(id, tab) { document.getElementById(id)?.remove(); trTab(tab); }
function _removeClosestModal(el) { el.closest('.modal-overlay, [style*="position:fixed"]')?.remove(); }
function _removeClosestTemplateRow(el, ti) {
  if (!confirm('Slette malen?')) return;
  const ts = _lsGet('os_module_templates', []);
  ts.splice(ti, 1);
  localStorage.setItem('os_module_templates', JSON.stringify(ts));
  el.closest('.template-row')?.remove();
}
function _deleteTemplate(el, ti) {
  if(confirm('Slette malen?')){
    const ts=_lsGet('os_module_templates',[]);
    ts.splice(ti,1);
    localStorage.setItem('os_module_templates',JSON.stringify(ts));
    el.closest('.template-row')?.remove();
  }
}
function _applyTemplateThenClose(el, ti) {
  _applyModuleTemplate(ti);
  el.closest('[style*="position:fixed"]')?.remove();
}
function _pvStudentSwitchTab(key, el) { pvStudentSwitchTab(key, el, pvStudentMod); }
function _toggleFC() { document.getElementById('currentFC')?.classList.toggle('flipped'); }
function _markTextToggle(el, mi) { _markClickMenu(el, mi, 'tasks-text-body'); }
function _switchTaskTabEl(key, el) { switchTaskTab(key, el); }
function _countWordsEl(el, wi, min) { countWords(wi, min); }
function _toggleVideoEmbedEl(embedId, ytId) { toggleVideoEmbed(embedId, ytId); }
function _ttsSpeakSelf(el, text) { ttsSpeak(text, el); }
function _arbDiscCountEl(el, di) { arbDiscCount(di, el.value); }
function _arbWriteCountEl(el, wi, minWords) { arbWriteCount(wi, minWords); arbAutoSave(wi, minWords); }
function _callWindowFn(fnName) { const fn = window[fnName]; if (typeof fn === 'function') fn(); }
function _applyWriteTemplateEl(wi, val) { applyWriteTemplate(wi, val); }
function _setScheduledEl(i, val) { setScheduled(i, val); }
function _dismissFeedback(id, key) { const el = document.getElementById(id); if (el) el.style.display = 'none'; DB.deleteFeedback(key); }
function _openNextModule(nextIdx) { document.querySelector('[style*="position:fixed"]')?.remove(); openModule(nextIdx); }
function _arbShowAllQuiz() { _quizOneAtATime=false; arbRenderQuiz(state.modules[arbState.moduleIdx]); }
function _arbShowCardMode() { _quizOneAtATime=true; _quizCurrentIdx=0; arbRenderQuiz(state.modules[arbState.moduleIdx]); }
function _arbResetQuizAll() { arbResetQuiz(arbState.moduleIdx); _quizCurrentIdx=0; }
function _crSwitchTabHsSetup() { crSwitchTab('hs'); loadHighscoreView(); crShow('setup'); }
function _hideArbDashboard() { const d=document.getElementById('arbDashboard'); if(d) d.style.display='none'; }
function _hideWordPopup() { const p=document.getElementById('wordPopup'); if(p) p.style.display='none'; }
function _toggleArbFC() { document.getElementById('arbFcInner')?.classList.toggle('flipped'); }

// Autocomplete blur handlers (replaced inline onblur with data-onblur-autocomplete)
document.addEventListener('focusout', function(e) {
  const id = e.target.dataset.onblurAutocomplete;
  if (!id) return;
  setTimeout(() => {
    const ac = document.getElementById(id);
    if (ac) ac.style.display = 'none';
  }, 200);
});

// Focus-accent-h for inputs with custom focus color (replaced inline onfocus/onblur)
document.addEventListener('focusin', function(e) {
  if (e.target.classList.contains('focus-accent-h')) {
    e.target.style.borderColor = 'var(--accent-h)';
  }
});
document.addEventListener('focusout', function(e) {
  if (e.target.classList.contains('focus-accent-h')) {
    e.target.style.borderColor = '';
  }
});

// Worldle/Whoami autocomplete hover delegation
document.addEventListener('mouseover', function(e) {
  const el = e.target.closest('[data-ac-hover]');
  if (el) { worldleAcHover(Number(el.dataset.acHover)); return; }
  const el2 = e.target.closest('[data-whoami-hover]');
  if (el2) { whoamiAcHover(Number(el2.dataset.whoamiHover)); }
});

// CSP-safe image error handler (replaces class="img-safe")
document.addEventListener('error', function(e) {
  if (e.target.tagName === 'IMG' && e.target.classList.contains('img-safe')) {
    e.target.style.display = 'none';
  }
}, true); // capture phase — error doesn't bubble

// Drag-and-drop zone delegation (data-drop-zone="file|img")
document.addEventListener('dragover', function(e) {
  const zone = e.target.closest('[data-drop-zone]');
  if (!zone) return;
  e.preventDefault();
  if (zone.dataset.dropZone === 'file') zone.style.background = 'rgba(255,255,255,0.12)';
  else zone.style.borderColor = 'var(--accent-h)';
});
document.addEventListener('dragleave', function(e) {
  const zone = e.target.closest('[data-drop-zone]');
  if (!zone) return;
  if (zone.dataset.dropZone === 'file') zone.style.background = 'rgba(255,255,255,0.06)';
  else zone.style.borderColor = 'rgba(255,255,255,0.2)';
});
document.addEventListener('drop', function(e) {
  const zone = e.target.closest('[data-drop-zone]');
  if (!zone) return;
  if (zone.dataset.dropZone === 'file') {
    zone.style.background = 'rgba(255,255,255,0.06)';
    handleFileDrop(e);
  } else {
    zone.style.borderColor = 'rgba(255,255,255,0.2)';
    handleImgDrop(e);
  }
});
