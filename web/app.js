/* VoxHarbor Console: two JsSIP softphones over WebSocket + live WebRTC stats. */
'use strict';

const QUICK_DIALS = [
  { num: '9196', label: 'Echo' },
  { num: '5000', label: 'IVR' },
  { num: '9999', label: 'Which node' },
];

/* ---------- small helpers ---------- */
const store = {
  get(k) { try { return JSON.parse(localStorage.getItem('vh:' + k)); } catch { return null; } },
  set(k, v) { try { localStorage.setItem('vh:' + k, JSON.stringify(v)); } catch { /* storage unavailable */ } },
};
const pad = (n) => String(n).padStart(2, '0');
const fmtDur = (ms) => { const s = Math.floor(ms / 1000); return `${pad(Math.floor(s / 60))}:${pad(s % 60)}`; };

const logEl = document.getElementById('log');
function log(tag, msg, kind = '') {
  const li = document.createElement('li');
  const t = new Date();
  li.innerHTML = `<time>${pad(t.getHours())}:${pad(t.getMinutes())}:${pad(t.getSeconds())}</time>` +
    `<span class="tag"></span><span class="msg ${kind}"></span>`;
  li.querySelector('.tag').textContent = tag;
  li.querySelector('.msg').textContent = msg;
  logEl.prepend(li);
  while (logEl.children.length > 200) logEl.lastChild.remove();
}
document.getElementById('clearLog').onclick = () => { logEl.innerHTML = ''; };

/* ---------- global settings ---------- */
const wsInput = document.getElementById('wsUrl');
const domainInput = document.getElementById('sipDomain');
// Default: same-origin /ws, proxied by nginx to Kamailio's WebSocket listener
wsInput.value = `${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/ws`;
const saved = store.get('settings2');
if (saved) { wsInput.value = saved.ws || wsInput.value; domainInput.value = saved.domain || domainInput.value; }
const settings = () => ({ ws: wsInput.value.trim(), domain: domainInput.value.trim() });
[wsInput, domainInput].forEach((el) => el.addEventListener('change', () => store.set('settings2', settings())));

/* ---------- ringtone (WebAudio, no asset needed) ---------- */
let audioCtx;
function ringer() {
  audioCtx = audioCtx || new (window.AudioContext || window.webkitAudioContext)();
  let stopped = false, timer;
  const burst = () => {
    if (stopped) return;
    const o = audioCtx.createOscillator(), g = audioCtx.createGain();
    o.frequency.value = 440; g.gain.value = 0.06;
    o.connect(g).connect(audioCtx.destination);
    o.start(); o.stop(audioCtx.currentTime + 0.8);
    timer = setTimeout(burst, 2500);
  };
  burst();
  return () => { stopped = true; clearTimeout(timer); };
}

/* ---------- softphone line ---------- */
const lines = [];

class Line {
  constructor(id, defaultUser) {
    this.id = id;
    const node = document.getElementById('lineTpl').content.firstElementChild.cloneNode(true);
    this.r = {};
    node.querySelectorAll('[data-ref]').forEach((el) => { this.r[el.dataset.ref] = el; });
    this.r.title.textContent = `Line ${id}`;
    const prefs = store.get('line' + id) || {};
    this.r.user.value = prefs.user || defaultUser;
    document.getElementById('lines').append(node);

    this.ua = null; this.session = null; this.statsTimer = null; this.clock = null; this.stopRing = null;
    this.buildDialer();

    this.r.creds.addEventListener('submit', (e) => { e.preventDefault(); this.ua ? this.unregister() : this.register(); });
    this.r.callBtn.onclick = () => this.call(this.r.target.value.trim());
    this.r.target.addEventListener('keydown', (e) => { if (e.key === 'Enter' && !this.r.callBtn.disabled) this.r.callBtn.click(); });
    this.r.hangBtn.onclick = () => this.session && this.session.terminate();
    this.r.answerBtn.onclick = () => this.answer();
    this.r.muteBtn.onclick = () => this.toggleMute();
  }

  log(msg, kind) { log(`L${this.id}`, msg, kind); }

  buildDialer() {
    const chips = [...QUICK_DIALS];
    chips.push({ num: () => lines.find((l) => l !== this)?.r.user.value, label: 'Other line' });
    chips.forEach((c) => {
      const b = document.createElement('button');
      b.type = 'button';
      const label = () => (typeof c.num === 'function' ? c.num() : c.num);
      b.innerHTML = `<b></b>${c.label}`;
      const refresh = () => { b.querySelector('b').textContent = label() || ''; };
      refresh();
      b.onclick = () => { refresh(); this.r.target.value = label(); if (!this.r.callBtn.disabled) this.call(label()); };
      b.addEventListener('mouseenter', refresh);
      this.r.chips.append(b);
    });
    '123456789*0#'.split('').forEach((k) => {
      const b = document.createElement('button');
      b.type = 'button'; b.textContent = k;
      b.onclick = () => {
        if (this.session && this.session.isEstablished()) { this.session.sendDTMF(k); this.log(`DTMF ${k}`); }
        else this.r.target.value += k;
      };
      this.r.keypad.append(b);
    });
  }

  setStatus(text, state) { this.r.status.textContent = text; this.r.status.dataset.state = state; }

  /* ----- registration ----- */
  register() {
    const { ws, domain } = settings();
    const user = this.r.user.value.trim(), pass = this.r.pass.value;
    if (!user || !pass) { this.log('Extension and password are required', 'err'); return; }
    if (!window.JsSIP) { this.log('JsSIP failed to load (no internet?)', 'err'); return; }
    store.set('line' + this.id, { user });

    let socket;
    try { socket = new JsSIP.WebSocketInterface(ws); }
    catch (e) { this.log(`Bad WebSocket URL: ${e.message}`, 'err'); return; }

    this.ua = new JsSIP.UA({
      sockets: [socket],
      uri: `sip:${user}@${domain}`,
      authorization_user: user,
      password: pass,
      display_name: `VoxHarbor ${user}`,
      user_agent: 'VoxHarbor-Web',
      session_timers: false,
      register_expires: 300,
    });
    const ua = this.ua;
    ua.on('connecting', () => this.setStatus('Connecting…', 'busy'));
    ua.on('connected', () => this.log(`WebSocket connected ${ws}`));
    ua.on('disconnected', () => { if (this.ua === ua) { this.setStatus('Disconnected', 'bad'); this.log('WebSocket disconnected', 'err'); } });
    ua.on('registered', () => { this.setStatus(`Registered ${user}`, 'ok'); this.log(`Registered as ${user}`, 'ok'); this.syncButtons(); });
    ua.on('unregistered', () => { if (this.ua === ua) { this.setStatus('Unregistered', 'off'); this.syncButtons(); } });
    ua.on('registrationFailed', (e) => {
      const code = e.response ? `${e.response.status_code} ${e.response.reason_phrase}` : e.cause;
      this.setStatus('Registration failed', 'bad'); this.log(`Registration failed: ${code}`, 'err'); this.syncButtons();
    });
    ua.on('newRTCSession', (e) => this.onSession(e.session, e.originator, e.request));
    this.r.regBtn.textContent = 'Unregister';
    this.r.user.disabled = this.r.pass.disabled = true;
    ua.start();
  }

  unregister() {
    if (this.session) this.session.terminate();
    const ua = this.ua; this.ua = null;
    ua.stop();
    this.setStatus('Offline', 'off');
    this.r.regBtn.textContent = 'Register';
    this.r.user.disabled = this.r.pass.disabled = false;
    this.syncButtons();
    this.log('Unregistered');
  }

  syncButtons() {
    this.r.callBtn.disabled = !(this.ua && this.ua.isRegistered()) || !!this.session;
  }

  /* ----- calls ----- */
  call(target) {
    if (!target) { this.log('Enter a number to dial', 'err'); return; }
    const { domain } = settings();
    this.log(`Calling ${target}…`);
    this.ua.call(`sip:${target}@${domain}`, {
      mediaConstraints: { audio: true, video: false },
      pcConfig: { iceServers: [] },
    });
  }

  answer() {
    if (!this.session) return;
    this.session.answer({ mediaConstraints: { audio: true, video: false }, pcConfig: { iceServers: [] } });
  }

  toggleMute() {
    if (!this.session) return;
    const muted = this.session.isMuted().audio;
    muted ? this.session.unmute({ audio: true }) : this.session.mute({ audio: true });
    this.r.muteBtn.textContent = muted ? 'Mute' : 'Unmute';
  }

  onSession(session, originator, request) {
    if (this.session) {
      if (originator === 'remote') session.terminate({ status_code: 486, reason_phrase: 'Busy Here' });
      return;
    }
    this.session = session;
    const peer = originator === 'remote'
      ? (request.from.display_name || request.from.uri.user)
      : session.remote_identity.uri.user;
    this.r.peer.textContent = peer;
    this.r.callbox.hidden = false;
    this.r.answerBtn.hidden = originator !== 'remote';
    this.r.muteBtn.textContent = 'Mute';
    this.resetStats();
    this.syncButtons();

    if (originator === 'remote') {
      this.r.callState.textContent = 'Incoming call';
      this.setStatus('Ringing', 'busy');
      this.log(`Incoming call from ${peer}`);
      this.stopRing = ringer();
    } else {
      this.r.callState.textContent = 'Dialing';
    }

    const attach = () => this.attachRemote();
    session.on('peerconnection', (e) => e.peerconnection.addEventListener('track', attach));
    if (session.connection) session.connection.addEventListener('track', attach);

    session.on('progress', () => { this.r.callState.textContent = originator === 'remote' ? 'Incoming call' : 'Ringing'; attach(); });
    session.on('accepted', () => { this.stopRinging(); attach(); });
    session.on('confirmed', () => {
      this.r.answerBtn.hidden = true;
      this.r.callState.textContent = 'Connected';
      this.setStatus('In call', 'ok');
      this.log(`Connected with ${peer}`, 'ok');
      attach();
      const start = Date.now();
      this.clock = setInterval(() => { this.r.timer.textContent = fmtDur(Date.now() - start); }, 500);
      this.statsTimer = setInterval(() => this.pollStats(), 1000);
    });
    session.on('ended', (e) => this.endCall(`Call ended (${e.cause})`));
    session.on('failed', (e) => {
      const code = e.message && e.message.status_code ? ` ${e.message.status_code} ${e.message.reason_phrase}` : '';
      this.endCall(`Call failed: ${e.cause}${code}`, 'err');
    });
  }

  stopRinging() { if (this.stopRing) { this.stopRing(); this.stopRing = null; } }

  attachRemote() {
    const pc = this.session && this.session.connection;
    if (!pc) return;
    const tracks = pc.getReceivers().map((r) => r.track).filter((t) => t && t.kind === 'audio');
    if (!tracks.length) return;
    const cur = this.r.audio.srcObject;
    if (cur && cur.getAudioTracks()[0] === tracks[0]) return;
    this.r.audio.srcObject = new MediaStream(tracks);
    this.r.audio.play().catch(() => this.log('Autoplay blocked; click anywhere on the page', 'err'));
  }

  endCall(msg, kind) {
    this.stopRinging();
    clearInterval(this.clock); clearInterval(this.statsTimer);
    this.log(msg, kind);
    this.r.callState.textContent = msg;
    this.r.answerBtn.hidden = true;
    this.session = null;
    this.r.audio.srcObject = null;
    this.r.mIn.style.width = this.r.mOut.style.width = '0';
    if (this.ua && this.ua.isRegistered()) this.setStatus(`Registered ${this.r.user.value}`, 'ok');
    this.syncButtons();
  }

  resetStats() {
    this.r.timer.textContent = '00:00';
    ['sCodec', 'sJitter', 'sRemote'].forEach((k) => { this.r[k].textContent = '—'; });
    ['sSent', 'sRecv', 'sLost'].forEach((k) => { this.r[k].textContent = '0'; });
  }

  async pollStats() {
    const pc = this.session && this.session.connection;
    if (!pc) return;
    const report = await pc.getStats();
    let inb, outb, pair, codecs = {}, remoteCands = {}, media = {};
    report.forEach((s) => {
      if (s.type === 'inbound-rtp' && s.kind === 'audio') inb = s;
      else if (s.type === 'outbound-rtp' && s.kind === 'audio') outb = s;
      else if (s.type === 'codec') codecs[s.id] = s;
      else if (s.type === 'candidate-pair' && s.nominated && s.state === 'succeeded') pair = s;
      else if (s.type === 'remote-candidate') remoteCands[s.id] = s;
      else if (s.type === 'media-source' && s.kind === 'audio') media = s;
    });
    const codec = inb && codecs[inb.codecId] || outb && codecs[outb.codecId];
    if (codec) this.r.sCodec.textContent = `${codec.mimeType.replace('audio/', '')}/${codec.clockRate}`;
    if (outb) this.r.sSent.textContent = outb.packetsSent;
    if (inb) {
      this.r.sRecv.textContent = inb.packetsReceived;
      this.r.sLost.textContent = inb.packetsLost;
      this.r.sJitter.textContent = `${Math.round((inb.jitter || 0) * 1000)} ms`;
      this.r.mIn.style.width = `${Math.min(100, Math.round(Math.sqrt(inb.audioLevel || 0) * 140))}%`;
    }
    if (media.audioLevel !== undefined) {
      this.r.mOut.style.width = `${Math.min(100, Math.round(Math.sqrt(media.audioLevel) * 140))}%`;
    }
    const rc = pair && remoteCands[pair.remoteCandidateId];
    if (rc) this.r.sRemote.textContent = `${rc.address || rc.ip}:${rc.port}`;
  }
}

lines.push(new Line('A', '1001'), new Line('B', '1002'));
lines.forEach((l) => l.r.chips.querySelectorAll('button').forEach((b) => b.dispatchEvent(new Event('mouseenter'))));
window.addEventListener('beforeunload', () => lines.forEach((l) => l.ua && l.ua.stop()));
log('UI', 'Ready. Enter the password on each line and click Register.');
