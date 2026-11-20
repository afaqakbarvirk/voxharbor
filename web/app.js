/* VoxHarbor Console: two JsSIP softphones over WebSocket with live WebRTC stats. */
'use strict';

/* ---------- icons (inline SVG, stroke = currentColor) ---------- */
const ICON = {
  phone: '<path d="M22 16.9v3a2 2 0 0 1-2.2 2 19.8 19.8 0 0 1-8.6-3.1 19.5 19.5 0 0 1-6-6A19.8 19.8 0 0 1 2.1 4.2 2 2 0 0 1 4.1 2h3a2 2 0 0 1 2 1.7c.1.9.4 1.8.7 2.7a2 2 0 0 1-.5 2.1L8 9.8a16 16 0 0 0 6 6l1.3-1.3a2 2 0 0 1 2.1-.4c.9.3 1.8.6 2.7.7a2 2 0 0 1 1.7 2z"/>',
  hangup: '<g transform="rotate(135 12 12)"><path d="M22 16.9v3a2 2 0 0 1-2.2 2 19.8 19.8 0 0 1-8.6-3.1 19.5 19.5 0 0 1-6-6A19.8 19.8 0 0 1 2.1 4.2 2 2 0 0 1 4.1 2h3a2 2 0 0 1 2 1.7c.1.9.4 1.8.7 2.7a2 2 0 0 1-.5 2.1L8 9.8a16 16 0 0 0 6 6l1.3-1.3a2 2 0 0 1 2.1-.4c.9.3 1.8.6 2.7.7a2 2 0 0 1 1.7 2z"/></g>',
  mic: '<rect x="9" y="2" width="6" height="12" rx="3"/><path d="M19 10v1a7 7 0 0 1-14 0v-1M12 18v4M8 22h8"/>',
  micOff: '<rect x="9" y="2" width="6" height="12" rx="3"/><path d="M19 10v1a7 7 0 0 1-14 0v-1M12 18v4M8 22h8M3 3l18 18"/>',
  grid: '<circle cx="6" cy="6" r="1.2"/><circle cx="12" cy="6" r="1.2"/><circle cx="18" cy="6" r="1.2"/><circle cx="6" cy="12" r="1.2"/><circle cx="12" cy="12" r="1.2"/><circle cx="18" cy="12" r="1.2"/><circle cx="6" cy="18" r="1.2"/><circle cx="12" cy="18" r="1.2"/><circle cx="18" cy="18" r="1.2"/>',
  backspace: '<path d="M21 4H8l-7 8 7 8h13a2 2 0 0 0 2-2V6a2 2 0 0 0-2-2z"/><path d="M18 9l-6 6M12 9l6 6"/>',
  eye: '<path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/>',
  eyeOff: '<path d="M17.9 17.9A10.4 10.4 0 0 1 12 20C5 20 1 12 1 12a18.5 18.5 0 0 1 5.1-5.9M9.9 4.2A9.7 9.7 0 0 1 12 4c7 0 11 8 11 8a18.6 18.6 0 0 1-2.2 3.2M1 1l22 22"/><path d="M14.1 14.1a3 3 0 1 1-4.2-4.2"/>',
  sliders: '<path d="M4 21v-7M4 10V3M12 21v-9M12 8V3M20 21v-5M20 12V3M1 14h6M9 8h6M17 16h6"/>',
  list: '<path d="M8 6h13M8 12h13M8 18h13M3.5 6h.01M3.5 12h.01M3.5 18h.01"/>',
  sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/>',
  moon: '<path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z"/>',
  x: '<path d="M18 6L6 18M6 6l12 12"/>',
  wave: '<path d="M2 12h4l3-7 5 14 3-7h5"/>',
  server: '<rect x="3" y="3" width="18" height="7" rx="2"/><rect x="3" y="14" width="18" height="7" rx="2"/><path d="M7 6.5h.01M7 17.5h.01"/>',
  menu: '<path d="M4 6h16M4 12h11M4 18h7"/>',
  user: '<circle cx="12" cy="8" r="4"/><path d="M4 21a8 8 0 0 1 16 0"/>',
  logout: '<path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4M16 17l5-5-5-5M21 12H9"/>',
  check: '<path d="M20 6L9 17l-5-5"/>',
};
const svg = (name) => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICON[name] || ''}</svg>`;
function setIcon(el, name) {
  el.querySelector(':scope > svg')?.remove();
  el.insertAdjacentHTML('afterbegin', svg(name));
}
function hydrateIcons(root) {
  root.querySelectorAll('[data-icon]').forEach((el) => setIcon(el, el.dataset.icon));
}

/* ---------- constants ---------- */
const QUICK = [
  { num: '9196', label: 'Echo', icon: 'wave' },
  { num: '9999', label: 'Which node', icon: 'server' },
  { num: '5000', label: 'IVR', icon: 'menu' },
  { other: true, label: 'Other line', icon: 'user' },
];
const NAMES = { 9196: 'Echo test', 9999: 'Which node', 5000: 'Demo IVR' };
const KEYS = [['1', ''], ['2', 'ABC'], ['3', 'DEF'], ['4', 'GHI'], ['5', 'JKL'], ['6', 'MNO'],
  ['7', 'PQRS'], ['8', 'TUV'], ['9', 'WXYZ'], ['*', ''], ['0', '+'], ['#', '']];
const BAR_PROFILE = [.35, .55, .8, 1, .7, .9, .6, .85, 1, .65, .5, .75, .45, .3];
const MEDIA = { mediaConstraints: { audio: true, video: false }, pcConfig: { iceServers: [] } };

/* ---------- helpers ---------- */
const $ = (id) => document.getElementById(id);
const store = {
  get(k) { try { return JSON.parse(localStorage.getItem('vh:' + k)); } catch { return null; } },
  set(k, v) { try { localStorage.setItem('vh:' + k, JSON.stringify(v)); } catch { /* storage unavailable */ } },
};
const pad2 = (n) => String(n).padStart(2, '0');
const fmtDur = (ms) => { const s = Math.floor(ms / 1000); return `${pad2(Math.floor(s / 60))}:${pad2(s % 60)}`; };
hydrateIcons(document);

/* ---------- theme ---------- */
const rootEl = document.documentElement;
const isDark = () => (rootEl.dataset.theme ? rootEl.dataset.theme === 'dark'
  : matchMedia('(prefers-color-scheme: dark)').matches);
function applyTheme(t) {
  if (t) rootEl.dataset.theme = t; else delete rootEl.dataset.theme;
  setIcon($('themeBtn'), isDark() ? 'sun' : 'moon');
}
applyTheme(store.get('theme'));
$('themeBtn').onclick = () => { const t = isDark() ? 'light' : 'dark'; store.set('theme', t); applyTheme(t); };

/* ---------- toasts ---------- */
function toast(msg, kind = '') {
  const el = document.createElement('div');
  el.className = `toast ${kind}`;
  el.textContent = msg;
  $('toasts').append(el);
  setTimeout(() => { el.classList.add('out'); setTimeout(() => el.remove(), 300); }, 3800);
}

/* ---------- event log drawer ---------- */
const logEl = $('log');
let unread = 0;
function renderEmptyLog() {
  if (!logEl.children.length) logEl.innerHTML = '<li class="empty">No events yet</li>';
}
function log(tag, msg, kind = '') {
  logEl.querySelector('.empty')?.remove();
  const li = document.createElement('li');
  const t = new Date();
  li.className = kind;
  li.innerHTML = '<span class="dot"></span><time></time><span class="tag"></span><span class="msg"></span>';
  li.querySelector('time').textContent = `${pad2(t.getHours())}:${pad2(t.getMinutes())}:${pad2(t.getSeconds())}`;
  li.querySelector('.tag').textContent = tag;
  li.querySelector('.msg').textContent = msg;
  logEl.prepend(li);
  while (logEl.children.length > 300) logEl.lastChild.remove();
  if (kind === 'err' && !$('drawer').classList.contains('open')) {
    unread += 1;
    $('logBadge').textContent = unread > 9 ? '9+' : unread;
    $('logBadge').hidden = false;
  }
}
function openDrawer() {
  $('drawer').classList.add('open'); $('scrim').hidden = false;
  unread = 0; $('logBadge').hidden = true;
}
function closeDrawer() { $('drawer').classList.remove('open'); $('scrim').hidden = true; }
$('logBtn').onclick = () => ($('drawer').classList.contains('open') ? closeDrawer() : openDrawer());
$('closeDrawer').onclick = closeDrawer;
$('scrim').onclick = closeDrawer;
$('clearLog').onclick = () => { logEl.innerHTML = ''; renderEmptyLog(); };
renderEmptyLog();

/* ---------- connection settings ---------- */
const DEFAULTS = {
  ws: `${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/ws`,
  domain: location.hostname || 'localhost',
};
let settings = { ...DEFAULTS, ...(store.get('settings3') || {}) };
const dlg = $('settingsDlg');
$('settingsBtn').onclick = () => {
  $('wsUrl').value = settings.ws; $('sipDomain').value = settings.domain;
  dlg.showModal();
};
dlg.addEventListener('close', () => {
  if (dlg.returnValue !== 'save') return;
  settings = { ws: $('wsUrl').value.trim() || DEFAULTS.ws, domain: $('sipDomain').value.trim() || DEFAULTS.domain };
  store.set('settings3', settings);
  toast('Settings saved. Sign in again to apply.', 'ok');
});

/* ---------- gateway indicator ---------- */
function updateGateway() {
  const online = lines.filter((l) => l.registered).length;
  const connecting = lines.some((l) => l.state === 'connecting');
  const gw = $('gw');
  gw.dataset.tone = online ? 'ok' : connecting ? 'busy' : 'off';
  $('gwText').textContent = online ? `${online} line${online > 1 ? 's' : ''} online`
    : connecting ? 'Connecting…' : 'All lines offline';
}

/* ---------- incoming ring (WebAudio, no asset) ---------- */
let audioCtx;
function ringer() {
  try { audioCtx = audioCtx || new (window.AudioContext || window.webkitAudioContext)(); } catch { return () => {}; }
  let stopped = false, timer;
  const burst = () => {
    if (stopped) return;
    [0, 0.45].forEach((offset) => {
      const o = audioCtx.createOscillator(), g = audioCtx.createGain();
      o.frequency.value = 480; g.gain.value = 0.05;
      o.connect(g).connect(audioCtx.destination);
      o.start(audioCtx.currentTime + offset); o.stop(audioCtx.currentTime + offset + 0.35);
    });
    timer = setTimeout(burst, 2600);
  };
  burst();
  return () => { stopped = true; clearTimeout(timer); };
}

/* ---------- softphone line ---------- */
const lines = [];
let activeLine = null;

class Line {
  constructor(id, defaultUser) {
    this.id = id;
    this.ua = null;
    this.session = null;
    this.state = 'offline';      // offline | connecting | idle | outgoing | incoming | incall | ended
    this.registered = false;
    this.user = '';
    this.timers = [];
    this.stopRing = null;

    const node = $('phoneTpl').content.firstElementChild.cloneNode(true);
    this.el = node;
    this.r = {};
    node.querySelectorAll('[data-ref]').forEach((el) => { this.r[el.dataset.ref] = el; });
    hydrateIcons(node);

    this.r.avatar.textContent = id;
    this.r.name.textContent = `Line ${id}`;
    this.r.heroTitle.textContent = `Sign in to Line ${id}`;
    const prefs = store.get('line' + id) || {};
    this.r.user.value = prefs.user || defaultUser;
    if (prefs.pass) { this.r.pass.value = prefs.pass; this.r.remember.checked = true; }

    this.buildKeypad(this.r.keypad, (k) => this.press(k));
    this.buildKeypad(this.r.dtmf, (k) => this.sendDtmf(k));
    this.buildQuick();
    this.buildBars(this.r.barsOut);
    this.buildBars(this.r.barsIn);
    this.bind();

    $('phones').append(node);
    this.render();
  }

  log(msg, kind) { log(this.id, msg, kind); }

  /* ----- building blocks ----- */
  buildKeypad(container, onPress) {
    KEYS.forEach(([digit, letters]) => {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'key';
      b.dataset.key = digit;
      b.innerHTML = `<b>${digit}</b><small>${letters}</small>`;
      b.onclick = () => onPress(digit);
      container.append(b);
    });
  }

  buildQuick() {
    this.otherTile = null;
    QUICK.forEach((q) => {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'tile';
      b.innerHTML = `<span class="ti">${svg(q.icon)}</span><span class="tl"></span><span class="tn"></span>`;
      b.querySelector('.tl').textContent = q.label;
      b.querySelector('.tn').textContent = q.num || '';
      if (q.soon) {
        b.disabled = true;
        b.title = 'Arrives in a later phase';
        b.insertAdjacentHTML('beforeend', '<span class="soon">Soon</span>');
      }
      if (q.other) this.otherTile = b;
      b.onclick = () => {
        const num = q.other ? this.otherLine()?.user : q.num;
        if (!num) { toast('Sign in on the other line first'); return; }
        this.r.number.value = num;
        this.call(num);
      };
      this.r.quick.append(b);
    });
  }

  buildBars(container) {
    BAR_PROFILE.forEach(() => container.append(document.createElement('i')));
  }

  bind() {
    const r = this.r;
    r.login.addEventListener('submit', (e) => { e.preventDefault(); this.signIn(); });
    r.eye.onclick = () => {
      const show = r.pass.type === 'password';
      r.pass.type = show ? 'text' : 'password';
      setIcon(r.eye, show ? 'eyeOff' : 'eye');
    };
    r.number.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') { e.preventDefault(); this.call(r.number.value); }
    });
    r.back.onclick = () => { r.number.value = r.number.value.slice(0, -1); };
    r.callBtn.onclick = () => this.call(r.number.value);
    r.signout.onclick = () => this.signOut();
    r.hangBtn.onclick = () => this.hangup();
    r.answerBtn.onclick = () => this.answer();
    r.muteBtn.onclick = () => this.toggleMute();
    r.padBtn.onclick = () => {
      r.dtmf.hidden = !r.dtmf.hidden;
      r.padBtn.classList.toggle('on', !r.dtmf.hidden);
    };
    this.el.addEventListener('pointerdown', () => setActive(this));
    this.el.addEventListener('focusin', () => setActive(this));
  }

  otherLine() { return lines.find((l) => l !== this && l.registered); }

  /* ----- view ----- */
  render() {
    const view = { offline: 'offline', connecting: 'offline', idle: 'idle' }[this.state] || 'call';
    this.el.dataset.view = view;
    this.el.dataset.state = this.state;
    const [text, tone] = {
      offline: ['Offline', 'off'],
      connecting: ['Connecting', 'busy'],
      idle: ['Online', 'ok'],
      outgoing: ['Calling', 'ring'],
      incoming: ['Incoming', 'ring'],
      incall: ['In call', 'live'],
      ended: ['Call ended', 'off'],
    }[this.state];
    this.r.statusText.textContent = text;
    this.r.status.dataset.tone = tone;
    this.r.extLabel.textContent = this.registered ? `Extension ${this.user}` : 'Not signed in';

    const connecting = this.state === 'connecting';
    this.r.connectBtn.disabled = connecting;
    this.r.connectBtn.textContent = connecting ? 'Signing in…' : 'Sign in';
    this.r.user.disabled = this.r.pass.disabled = connecting;

    const incoming = this.state === 'incoming';
    const live = this.state === 'incall';
    this.r.answerBtn.hidden = !incoming;
    this.r.muteBtn.hidden = this.r.padBtn.hidden = !live;
    this.r.hangBtn.disabled = this.state === 'ended';
    if (!live) this.r.dtmf.hidden = true;

    lines.forEach((l) => {
      if (!l.otherTile) return;
      const other = l.otherLine();
      l.otherTile.querySelector('.tn').textContent = other ? other.user : '—';
    });
    updateGateway();
  }

  /* ----- registration ----- */
  signIn() {
    const user = this.r.user.value.trim();
    const pass = this.r.pass.value;
    if (!user || !pass) { toast('Enter extension and password', 'err'); return; }
    if (!window.JsSIP) { toast('SIP library failed to load', 'err'); return; }
    store.set('line' + this.id, this.r.remember.checked ? { user, pass } : { user });

    let socket;
    try { socket = new JsSIP.WebSocketInterface(settings.ws); }
    catch (e) { toast(`Bad WebSocket URL: ${e.message}`, 'err'); return; }

    this.user = user;
    this.state = 'connecting';
    this.render();

    const ua = new JsSIP.UA({
      sockets: [socket],
      uri: `sip:${user}@${settings.domain}`,
      authorization_user: user,
      password: pass,
      display_name: `Line ${this.id}`,
      user_agent: 'VoxHarbor-Web',
      session_timers: false,
      register_expires: 300,
    });
    this.ua = ua;
    const mine = (fn) => (...args) => { if (this.ua === ua) fn(...args); };

    ua.on('connected', mine(() => this.log(`WebSocket connected (${settings.ws})`)));
    ua.on('disconnected', mine(() => {
      if (this.registered) toast(`Line ${this.id}: connection lost, retrying…`, 'err');
      this.log('WebSocket disconnected', 'err');
    }));
    ua.on('registered', mine(() => {
      const first = !this.registered;
      this.registered = true;
      if (this.state === 'connecting') this.state = 'idle';
      if (first) { this.log(`Registered as ${user}`, 'ok'); toast(`Line ${this.id} online as ${user}`, 'ok'); }
      this.render();
    }));
    ua.on('unregistered', mine(() => {
      this.registered = false;
      if (!this.session) this.state = 'offline';
      this.render();
    }));
    ua.on('registrationFailed', mine((e) => {
      const why = e.response ? `${e.response.status_code} ${e.response.reason_phrase}` : e.cause;
      this.log(`Sign-in failed: ${why}`, 'err');
      toast(`Line ${this.id}: sign-in failed (${why})`, 'err');
      this.stopUA();
      this.state = 'offline';
      this.render();
    }));
    ua.on('newRTCSession', mine((e) => this.onSession(e.session, e.originator, e.request)));
    ua.start();
  }

  stopUA() {
    const ua = this.ua;
    this.ua = null;
    this.registered = false;
    if (ua) { try { ua.stop(); } catch { /* already stopped */ } }
  }

  signOut() {
    if (this.session) { try { this.session.terminate(); } catch { /* ended */ } }
    this.stopUA();
    this.state = 'offline';
    this.log('Signed out');
    this.render();
  }

  /* ----- dialing ----- */
  press(k) {
    this.r.number.value += k;
    this.flashKey(this.r.keypad, k);
  }

  flashKey(container, k) {
    const b = container.querySelector(`[data-key="${CSS.escape(k)}"]`);
    if (!b) return;
    b.classList.add('flash');
    setTimeout(() => b.classList.remove('flash'), 120);
  }

  keyboard(k) {
    if (this.state === 'incall') this.sendDtmf(k);
    else if (this.state === 'idle') this.press(k);
  }

  call(target) {
    target = String(target || '').trim();
    if (!this.registered) { toast('Sign in first', 'err'); return; }
    if (!target) { toast('Enter a number first'); this.r.number.focus(); return; }
    if (this.session) return;
    this.log(`Calling ${target}…`);
    try { this.ua.call(`sip:${target}@${settings.domain}`, MEDIA); }
    catch (e) { toast(`Could not start call: ${e.message}`, 'err'); }
  }

  answer() { if (this.session && this.state === 'incoming') this.session.answer(MEDIA); }

  hangup() {
    if (!this.session) return;
    try { this.session.terminate(); } catch { /* already ended */ }
  }

  toggleMute() {
    if (!this.session) return;
    const muted = this.session.isMuted().audio;
    if (muted) this.session.unmute({ audio: true }); else this.session.mute({ audio: true });
    setIcon(this.r.muteBtn, muted ? 'mic' : 'micOff');
    this.r.muteBtn.classList.toggle('on', !muted);
    this.r.muteBtn.title = muted ? 'Mute' : 'Unmute';
  }

  sendDtmf(k) {
    if (!this.session || !this.session.isEstablished()) return;
    this.session.sendDTMF(k);
    this.flashKey(this.r.dtmf, k);
    this.log(`DTMF ${k}`);
  }

  /* ----- call lifecycle ----- */
  onSession(session, originator, request) {
    const incoming = originator === 'remote';
    if (this.session) {
      if (incoming) session.terminate({ status_code: 486, reason_phrase: 'Busy Here' });
      return;
    }
    this.session = session;

    const num = incoming ? request.from.uri.user : session.remote_identity.uri.user;
    const fromLine = lines.find((l) => l !== this && l.user === num);
    const title = NAMES[num] || (fromLine ? `Line ${fromLine.id}` : (incoming && request.from.display_name) || num);
    this.r.peer.textContent = title;
    this.r.peerSub.textContent = title === num ? '' : num;
    this.r.peerAvatar.textContent = '';
    if (fromLine) this.r.peerAvatar.textContent = fromLine.id;
    else setIcon(this.r.peerAvatar, num === '9999' ? 'server' : NAMES[num] ? 'wave' : 'user');

    this.resetCallUi();
    this.state = incoming ? 'incoming' : 'outgoing';
    this.r.callState.textContent = incoming ? 'Incoming call' : 'Calling…';
    if (incoming) {
      this.log(`Incoming call from ${num}`);
      toast(`Line ${this.id}: incoming call from ${title}`);
      this.stopRing = ringer();
      setActive(this);
    }
    this.render();

    const attach = () => this.attachRemote();
    session.on('peerconnection', (e) => e.peerconnection.addEventListener('track', attach));
    if (session.connection) session.connection.addEventListener('track', attach);

    session.on('progress', () => {
      if (!incoming) this.r.callState.textContent = 'Ringing…';
      attach();
    });
    session.on('accepted', () => { this.stopRinging(); attach(); });
    session.on('confirmed', () => {
      this.state = 'incall';
      this.log(`Connected with ${num}`, 'ok');
      attach();
      const start = Date.now();
      const tick = () => { this.r.callState.textContent = `Connected · ${fmtDur(Date.now() - start)}`; };
      tick();
      this.timers.push(setInterval(tick, 500), setInterval(() => this.pollStats(), 300));
      this.render();
    });
    session.on('ended', (e) => this.endCall(e.cause === 'Terminated' ? 'Call ended' : `Call ended · ${e.cause}`));
    session.on('failed', (e) => {
      const code = e.message && e.message.status_code ? ` (${e.message.status_code} ${e.message.reason_phrase})` : '';
      const quiet = ['Canceled', 'Rejected'].includes(e.cause) && !code;
      this.endCall(`Call failed · ${e.cause}${code}`, quiet ? '' : 'err');
    });
  }

  attachRemote() {
    const pc = this.session && this.session.connection;
    if (!pc) return;
    const tracks = pc.getReceivers().map((r) => r.track).filter((t) => t && t.kind === 'audio');
    if (!tracks.length) return;
    const cur = this.r.audio.srcObject;
    if (cur && cur.getAudioTracks()[0] === tracks[0]) return;
    this.r.audio.srcObject = new MediaStream(tracks);
    this.r.audio.play().catch(() => toast('Click anywhere on the page to enable audio', 'err'));
  }

  stopRinging() { if (this.stopRing) { this.stopRing(); this.stopRing = null; } }

  endCall(reason, kind = '') {
    this.stopRinging();
    this.timers.forEach(clearInterval);
    this.timers = [];
    this.session = null;
    this.r.audio.srcObject = null;
    this.setBars(this.r.barsOut, 0);
    this.setBars(this.r.barsIn, 0);
    this.log(reason, kind);
    if (kind === 'err') toast(`Line ${this.id}: ${reason}`, 'err');
    this.state = 'ended';
    this.r.callState.textContent = reason;
    this.render();
    setTimeout(() => {
      if (this.state !== 'ended') return;
      this.state = this.registered ? 'idle' : 'offline';
      this.render();
    }, kind === 'err' ? 2600 : 1400);
  }

  resetCallUi() {
    this.flowLogged = false;
    this.r.sFlow.hidden = true;
    this.r.sCodec.textContent = 'codec —';
    this.r.sPkts.textContent = '↑ 0 · ↓ 0';
    this.r.sJitter.textContent = 'jitter —';
    this.r.sLoss.textContent = 'loss 0';
    setIcon(this.r.muteBtn, 'mic');
    this.r.muteBtn.classList.remove('on');
    this.r.padBtn.classList.remove('on');
    this.r.dtmf.hidden = true;
  }

  setBars(container, level) {
    const lv = Math.max(0, Math.min(1, level));
    [...container.children].forEach((bar, i) => {
      const jitter = lv > 0.02 ? 0.75 + Math.random() * 0.5 : 1;
      bar.style.height = `${Math.max(10, Math.min(100, lv * BAR_PROFILE[i] * jitter * 100))}%`;
    });
  }

  async pollStats() {
    const pc = this.session && this.session.connection;
    if (!pc) return;
    let report;
    try { report = await pc.getStats(); } catch { return; }
    let inb, outb, src;
    const codecs = {};
    report.forEach((s) => {
      if (s.type === 'inbound-rtp' && s.kind === 'audio') inb = s;
      else if (s.type === 'outbound-rtp' && s.kind === 'audio') outb = s;
      else if (s.type === 'media-source' && s.kind === 'audio') src = s;
      else if (s.type === 'codec') codecs[s.id] = s;
    });
    const codec = (inb && codecs[inb.codecId]) || (outb && codecs[outb.codecId]);
    if (codec) this.r.sCodec.textContent = `${codec.mimeType.replace('audio/', '').toUpperCase()} ${codec.clockRate / 1000}k`;
    const sent = outb ? outb.packetsSent : 0;
    const recv = inb ? inb.packetsReceived : 0;
    this.r.sPkts.textContent = `↑ ${sent} · ↓ ${recv}`;
    if (inb) {
      this.r.sJitter.textContent = `jitter ${Math.round((inb.jitter || 0) * 1000)} ms`;
      this.r.sLoss.textContent = `loss ${inb.packetsLost || 0}`;
    }
    const flowing = sent > 0 && recv > 0;
    this.r.sFlow.hidden = !flowing;
    if (flowing && !this.flowLogged) { this.flowLogged = true; this.log('Audio flowing both ways', 'ok'); }

    const muted = this.session && this.session.isMuted().audio;
    this.setBars(this.r.barsOut, muted ? 0 : Math.sqrt((src && src.audioLevel) || 0) * 1.6);
    this.setBars(this.r.barsIn, Math.sqrt((inb && inb.audioLevel) || 0) * 1.6);
  }
}

function setActive(line) {
  if (activeLine === line) return;
  activeLine = line;
  lines.forEach((l) => l.el.classList.toggle('active', l === line));
}

/* ---------- keyboard shortcuts ---------- */
document.addEventListener('keydown', (e) => {
  if (e.target.closest('input, textarea, dialog') || e.ctrlKey || e.metaKey || e.altKey) return;
  const line = activeLine || lines.find((l) => l.state !== 'offline') || lines[0];
  if (!line) return;
  if (/^[0-9*#]$/.test(e.key)) { e.preventDefault(); line.keyboard(e.key); }
  else if (e.key === 'Backspace' && line.state === 'idle') { e.preventDefault(); line.r.back.click(); }
  else if (e.key === 'Enter') {
    if (line.state === 'incoming') line.answer();
    else if (line.state === 'idle') line.call(line.r.number.value);
  } else if (e.key === 'Escape') {
    if ($('drawer').classList.contains('open')) closeDrawer();
    else if (line.session) line.hangup();
  }
});

/* ---------- boot ---------- */
lines.push(new Line('A', '1001'), new Line('B', '1002'));
lines.forEach((l) => l.render());
setActive(lines[0]);
window.addEventListener('beforeunload', () => lines.forEach((l) => l.stopUA()));
log('UI', 'Console ready. Sign in on a line to start.');
