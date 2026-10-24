(() => {
'use strict';
const $ = id => document.getElementById(id);
const cv = $('game'), ctx = cv.getContext('2d', { alpha: false });

/* ================= Константи ================= */
const SL = 200, RW = 1080, CAMH = 900, PZ = 900, DRAW = 95, MAXS = 12000;
const MODES = [
  { laps: 2, ai: [0.80, 0.90] },
  { laps: 3, ai: [0.84, 0.95] },
  { laps: 5, ai: [0.88, 0.99] }
];
const COL = ['#2f6bff', '#e2252b', '#17c3b2', '#ececec', '#9aa3ad', '#ffd23a', '#7c4dff'];
const ACC = ['#0a1a47', '#101010', '#06352f', '#d62b2b', '#2b2f36', '#111111', '#1a1040'];

/* ================= Траса (повторюється колами) ================= */
const segs = [];
[[100,0],[60,2.5],[40,0],[70,-3],[50,0],[40,3.5],[40,-3.5],[80,0],[60,4],[30,0],
 [70,-2.5],[50,2],[100,0],[60,-4],[40,0],[50,3],[40,-2],[100,0]].forEach(([n, c]) => {
  n *= 2;
  for (let i = 0; i < n; i++) {
    const t = i / n, k = t < .25 ? t * 4 : t > .75 ? (1 - t) * 4 : 1;
    segs.push(c * 0.55 * k * k * (3 - 2 * k));
  }
});
const N = segs.length, LEN = N * SL;
const segAt = d => segs[Math.floor((((d % LEN) + LEN) % LEN) / SL)];
const wrap = v => { v %= LEN; if (v > LEN / 2) v -= LEN; else if (v < -LEN / 2) v += LEN; return v; };
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

/* ================= Стан ================= */
let W = 0, H = 0, DPR = 1, K = 1, HY = 0, skyG, sunG, fogG;
let state = 'menu', prevState = 'race', mode = 1, t = 0, last = 0;
const p = { d: 0, x: 0, speed: 0, steer: 0, brake: false };
let opps = [], cars = [p], parts = [];
const lines = Array.from({ length: 18 }, () => ({ a: Math.PI * (.08 + Math.random() * .84), r: Math.random() * 700 + 80 }));
let raceT = 0, lapT = 0, lapIdx = 0, bestLap = 0, cdT = 0, goT = 0, finT = 0;
let shake = 0, hitCool = 0, bgOff = 0, result = null, cdLast = '';
const items = [];

/* ================= Керування ================= */
const T = { id: null, sx: 0, cx: 0, t0: 0, swipe: false };
let keys = {}, brakeBtn = false;
function resetInput() { T.id = null; keys = {}; brakeBtn = false; p.brake = false; p.steer = 0; }
function readInput() {
  let v = (keys.ArrowRight || keys.KeyD ? 1 : 0) - (keys.ArrowLeft || keys.KeyA ? 1 : 0);
  if (v === 0 && T.id !== null) {
    if (T.swipe) v = clamp((T.cx - T.sx) / 55, -1, 1);
    else v = (T.sx < W / 2 ? -1 : 1) * Math.min(1, .5 + (performance.now() - T.t0) / 1000 * 1.6);
  }
  return v;
}
cv.addEventListener('pointerdown', e => {
  if (T.id !== null || (state !== 'race' && state !== 'count')) return;
  e.preventDefault();
  T.id = e.pointerId; T.sx = T.cx = e.clientX; T.t0 = performance.now(); T.swipe = false;
  try { cv.setPointerCapture(e.pointerId); } catch (_) {}
});
cv.addEventListener('pointermove', e => {
  if (e.pointerId !== T.id) return;
  T.cx = e.clientX; if (Math.abs(T.cx - T.sx) > 18) T.swipe = true;
});
const endP = e => { if (e.pointerId === T.id) T.id = null; };
['pointerup', 'pointercancel', 'lostpointercapture'].forEach(n => cv.addEventListener(n, endP));

const bb = $('btnBrake');
bb.addEventListener('pointerdown', e => { e.preventDefault(); brakeBtn = true; });
['pointerup', 'pointercancel', 'pointerleave'].forEach(n => bb.addEventListener(n, () => { brakeBtn = false; }));

window.addEventListener('keydown', e => {
  keys[e.code] = true;
  if (['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Space'].includes(e.code)) e.preventDefault();
  if ((e.code === 'KeyP' || e.code === 'Escape') && !e.repeat) togglePause();
});
window.addEventListener('keyup', e => { keys[e.code] = false; });
window.addEventListener('blur', () => { keys = {}; T.id = null; brakeBtn = false; if (state === 'race' || state === 'count') pauseGame(); });
document.addEventListener('visibilitychange', () => { if (document.hidden && (state === 'race' || state === 'count')) pauseGame(); });
// блокуємо прокрутку / зум / контекстне меню (iOS Safari)
document.addEventListener('touchmove', e => e.preventDefault(), { passive: false });
['gesturestart', 'gesturechange', 'gestureend', 'contextmenu', 'dblclick'].forEach(n => document.addEventListener(n, e => e.preventDefault()));

/* ================= Екрани / стани ================= */
function show(id) { document.querySelectorAll('.screen').forEach(s => s.classList.toggle('hidden', s.id !== id)); }
function hideScreens() { document.querySelectorAll('.screen').forEach(s => s.classList.add('hidden')); }
function hudOn(on) { $('hud').classList.toggle('hidden', !on); }
function hideCD() { $('countdown').classList.add('hidden'); cdLast = ''; }
function showCD(s) {
  if (s === cdLast) return; cdLast = s;
  const e = $('cdText'); e.textContent = s; $('countdown').classList.remove('hidden');
  e.classList.remove('pop'); void e.offsetWidth; e.classList.add('pop');
}
function resetRace() {
  const m = MODES[mode];
  p.d = 0; p.x = 0; p.speed = 0; p.steer = 0;
  opps = [];
  for (let i = 0; i < 7; i++) {
    const x = i % 2 ? .5 : -.5;
    opps.push({ d: 1800 + i * 1000, x, tx: x, speed: 0, cool: Math.random() * 3,
      max: MAXS * (m.ai[0] + Math.random() * (m.ai[1] - m.ai[0])), col: COL[i], acc: ACC[i] });
  }
  cars = [p].concat(opps);
  raceT = lapT = 0; lapIdx = 0; bestLap = 0; parts = []; shake = 0; hitCool = 0; result = null; finT = 0;
  resetInput();
}
function startRace(i) {
  mode = i; resetRace(); hideScreens(); hudOn(true);
  state = 'count'; cdT = 0; goT = 0; cdLast = ''; hideCD();
  $('hTot').textContent = '/' + cars.length;
  $('hLap').textContent = 'КОЛО 1/' + MODES[mode].laps;
  last = performance.now();
}
function goMenu() { state = 'menu'; opps = []; cars = [p]; hudOn(false); hideCD(); show('scr-start'); resetInput(); p.speed = 0; last = performance.now(); }
function pauseGame() {
  if (state !== 'race' && state !== 'count') return;
  prevState = state; state = 'pause'; resetInput(); show('scr-pause');
}
function resumeGame() { if (state !== 'pause') return; hideScreens(); state = prevState; resetInput(); last = performance.now(); }
function togglePause() { if (state === 'pause') resumeGame(); else pauseGame(); }

$('btnStart').onclick = () => { state = 'mode'; show('scr-mode'); };
$('btnBack').onclick = () => { state = 'menu'; show('scr-start'); };
document.querySelectorAll('.mode').forEach(b => b.onclick = () => startRace(+b.dataset.mode));
$('btnPause').onclick = pauseGame;
$('btnContinue').onclick = resumeGame;
$('btnRestartP').onclick = () => startRace(mode);
$('btnMenuP').onclick = goMenu;
$('btnAgain').onclick = () => startRace(mode);
$('btnModes').onclick = () => { state = 'mode'; hudOn(false); show('scr-mode'); };
$('btnMenuF').onclick = goMenu;

const fmt = s => { if (!isFinite(s) || s < 0) s = 0; const m = Math.floor(s / 60), r = s - m * 60; return m + ':' + (r < 10 ? '0' : '') + r.toFixed(2); };

function finishRace() {
  state = 'finish'; finT = 0; resetInput();
  let rank = 1; for (const o of opps) if (o.d > p.d) rank++;
  result = { rank, time: raceT, best: bestLap, rec: false, shown: false };
  try {
    const k = 'papayagp.best.' + mode, old = parseFloat(localStorage.getItem(k));
    if (!old || raceT < old) { result.rec = true; localStorage.setItem(k, String(raceT)); }
  } catch (_) {}
}
function showFinish() {
  const r = result;
  $('fTitle').textContent = r.rank === 1 ? 'ПЕРЕМОГА' : r.rank <= 3 ? 'ПОДІУМ' : 'ФІНІШ';
  $('fPos').textContent = 'P' + r.rank;
  $('fTime').textContent = fmt(r.time); $('fBest').textContent = fmt(r.best);
  $('fRec').textContent = r.rec ? 'НОВИЙ РЕКОРД ЧАСУ' : '';
  hudOn(false); show('scr-finish');
}

/* ================= Частинки ================= */
function spark(x, y, n, cols, spd, g) {
  for (let i = 0; i < n && parts.length < 120; i++)
    parts.push({ x, y, vx: (Math.random() - .5) * spd, vy: -Math.random() * spd * .8, g, l: .55, ml: .55,
      s: 2 + Math.random() * 3, c: cols[(Math.random() * cols.length) | 0] });
}

/* ================= Оновлення ================= */
function update(dt) {
  t += dt;
  const sp0 = p.speed / MAXS;
  bgOff += segAt(p.d) * sp0 * dt * 120;
  for (const l of lines) {
    l.r *= 1 + dt * (1 + 3 * sp0);
    if (l.r > H * 1.25) { l.r = H * (.12 + Math.random() * .1); l.a = Math.PI * (.08 + Math.random() * .84); }
  }
  for (let i = parts.length - 1; i >= 0; i--) {
    const q = parts[i]; q.l -= dt;
    if (q.l <= 0) { parts[i] = parts[parts.length - 1]; parts.pop(); continue; }
    q.x += q.vx * dt; q.y += q.vy * dt; q.vy += q.g * dt;
  }
  if (state === 'menu' || state === 'mode') {
    p.d += 4800 * dt; p.speed = 4800; p.x = Math.sin(t * .6) * .45; p.steer = Math.cos(t * .6) * .6; return;
  }

  if (state === 'count') {
    cdT += dt;
    if (cdT >= 2.55) { state = 'race'; goT = .9; showCD('GO!'); }
    else showCD(String(3 - Math.floor(cdT / .85)));
  }
  if (goT > 0) { goT -= dt; if (goT <= 0) hideCD(); }
  const racing = state === 'race', fin = state === 'finish';
  if (racing) { raceT += dt; lapT += dt; }
  p.brake = !!(keys.ArrowDown || keys.KeyS || keys.Space || brakeBtn);

  if (racing || fin) {
    const off = Math.abs(p.x) > 1.02;
    let a;
    if (fin) a = -MAXS / 4;
    else if (p.brake) a = -MAXS / 1.1;
    else a = MAXS / 3.3 * (1.12 - p.speed / MAXS);
    p.speed += a * dt;
    const cap = off ? MAXS * .38 : MAXS;
    if (p.speed > cap) p.speed = Math.max(cap, p.speed - MAXS * .8 * dt);
    p.speed = clamp(p.speed, 0, MAXS);
    const inp = fin ? 0 : readInput();
    p.steer += (inp - p.steer) * Math.min(1, dt * 7);
    const s2 = p.speed / MAXS;
    p.x += p.steer * dt * 2.6 * (.25 + .75 * s2) - dt * 2 * s2 * s2 * segAt(p.d) * .5;
    if (fin) p.x *= 1 - Math.min(1, dt * .8);
    p.x = clamp(p.x, -2.3, 2.3);
    p.d += p.speed * dt;
    if (off && p.speed > 1500) {
      shake = Math.max(shake, .22);
      spark(W / 2 + (Math.random() - .5) * 60, H * .9, 1, ['#8a7f6a', '#6d6656'], 120, -30);
    }

    // суперники
    const lapNow = Math.min(MODES[mode].laps, Math.floor(p.d / LEN) + 1);
    const dm = 1 + .012 * (lapNow - 1) + Math.min(.03, raceT / 900);
    for (const o of opps) {
      const rel = o.d - p.d;
      let tg = o.max * dm * (1 - Math.min(.1, Math.abs(segAt(o.d)) * .03));
      if (rel < -5000) tg *= 1.07; else if (rel > 9000) tg *= .92;
      let blk = null, bd = 1200;
      for (const c of cars) {
        if (c === o) continue;
        const dd = c.d - o.d;
        if (dd > 0 && dd < bd && Math.abs(c.x - o.x) < .42) { bd = dd; blk = c; }
        if (Math.abs(dd) < 430 && Math.abs(c.x - o.x) < .36) { o.x += (o.x >= c.x ? 1 : -1) * dt * 1.2; o.tx = o.x; }
      }
      o.cool -= dt;
      if (blk) {
        tg = Math.min(tg, blk.speed * (bd < 650 ? .9 : 1));
        if (o.cool <= 0) {
          let best = null, bs = -9;
          for (const L of [-.7, -.35, 0, .35, .7]) {
            let free = true;
            for (const c of cars) {
              if (c === o) continue;
              const dd = c.d - o.d;
              if (dd > -500 && dd < 1600 && Math.abs(c.x - L) < .42) { free = false; break; }
            }
            if (free && -Math.abs(L - o.x) > bs) { bs = -Math.abs(L - o.x); best = L; }
          }
          if (best !== null) { o.tx = best; o.cool = 1.2; } else o.cool = .4;
        }
      } else if (o.cool <= 0) {
        o.tx = clamp(o.tx + (Math.random() - .5) * .8, -.75, .75); o.cool = 2 + Math.random() * 3;
      }
      o.speed += clamp(tg - o.speed, -MAXS * .6 * dt, MAXS / 3.5 * dt);
      o.x += clamp(o.tx - o.x, -dt * .9, dt * .9);
      o.d += o.speed * dt;
      if (blk) {
        const dd2 = blk.d - o.d;
        if (dd2 < 430 && dd2 > -200 && Math.abs(blk.x - o.x) < .36) { o.d = blk.d - 430; o.speed = Math.min(o.speed, blk.speed); }
      }
    }

    // зіткнення гравця
    hitCool -= dt;
    for (const o of opps) {
      const r = wrap(o.d - p.d);
      if (Math.abs(r) < 430 && Math.abs(o.x - p.x) < .36) {
        const side = p.x >= o.x ? 1 : -1;
        p.x += side * .06; o.x -= side * .03;
        if (r >= 0) { p.d += r - 430; p.speed = Math.min(p.speed, o.speed * .85); }
        else { o.d += -430 - r; o.speed *= .92; }
        if (hitCool <= 0 && !fin) {
          const wP = RW / PZ * K;
          spark(W / 2 + side * wP * .2, H * .8, 22, ['#ff8000', '#ffd27a', '#ffffff'], 420, 700);
          shake = .55; hitCool = .35;
        }
      }
    }
    shake *= Math.max(0, 1 - dt * 5);

    if (racing) {
      const li = Math.floor(p.d / LEN);
      if (li > lapIdx) {
        if (!bestLap || lapT < bestLap) bestLap = lapT;
        lapIdx = li; lapT = 0;
        if (li >= MODES[mode].laps) finishRace();
      }
    }
  }
  if (state === 'finish') {
    finT += dt;
    if (finT > 1.6 && result && !result.shown) { result.shown = true; showFinish(); }
  }
  if (state !== 'menu') updateHud();
}

/* ================= HUD ================= */
const cache = {};
function setT(id, v) { if (cache[id] !== v) { cache[id] = v; $(id).textContent = v; } }
function updateHud() {
  let rank = 1; for (const o of opps) if (o.d > p.d) rank++;
  setT('hPos', 'P' + rank);
  setT('hLap', 'КОЛО ' + Math.min(MODES[mode].laps, Math.floor(p.d / LEN) + 1) + '/' + MODES[mode].laps);
  setT('hTime', fmt(lapT));
  setT('hBest', bestLap ? fmt(bestLap) : '--');
  setT('hSpd', String(Math.round(p.speed / MAXS * 340)));
  $('hBar').style.transform = 'scaleX(' + (p.speed / MAXS).toFixed(3) + ')';
}

/* ================= Рендер ================= */
function strip(s, yb, a, b, col) {
  ctx.fillStyle = col; ctx.beginPath();
  ctx.moveTo(s.X1 + s.w1 * a, yb); ctx.lineTo(s.X1 + s.w1 * b, yb);
  ctx.lineTo(s.X2 + s.w2 * b, s.y2); ctx.lineTo(s.X2 + s.w2 * a, s.y2);
  ctx.closePath(); ctx.fill();
}
function ridge(col, amp, base, freq, off, ph) {
  ctx.fillStyle = col; ctx.beginPath(); ctx.moveTo(-20, HY + 2);
  for (let x = -20; x <= W + 20; x += 14) {
    const v = x + off;
    ctx.lineTo(x, HY - base - amp * (.5 + .5 * Math.sin(v * freq + ph)) - amp * .4 * Math.sin(v * freq * 2.3 + ph * 2));
  }
  ctx.lineTo(W + 20, HY + 2); ctx.closePath(); ctx.fill();
}
function drawCar(cx, by, w, c, a, tilt, br) {
  ctx.save(); ctx.translate(cx, by); if (tilt) ctx.rotate(tilt * .05);
  const u = w, R = (x, y, ww, hh, col) => { ctx.fillStyle = col; ctx.fillRect(x * u, -(y + hh) * u, ww * u, hh * u); };
  ctx.fillStyle = 'rgba(0,0,0,.38)'; ctx.beginPath(); ctx.ellipse(0, 0, .58 * u, .09 * u, 0, 0, 6.3); ctx.fill();
  R(-.5, 0, .21, .32, '#0d0d0d'); R(.29, 0, .21, .32, '#0d0d0d');          // задні шини
  R(-.44, .05, .03, .22, '#333'); R(.41, .05, .03, .22, '#333');
  R(-.3, 0, .6, .07, '#080808');                                           // дифузор
  R(-.3, .08, .16, .2, c); R(.14, .08, .16, .2, c);                        // сайдподи
  R(-.3, .23, .16, .025, a); R(.14, .23, .16, .025, a);
  R(-.16, .07, .32, .31, c); R(-.025, .1, .05, .28, a);                    // корпус
  R(-.07, .36, .14, .12, '#0a0a0a');                                       // повітрозабірник
  R(-.03, .14, .06, .06, br ? '#ff2b2b' : '#7a0f0f');                      // стоп-сигнал
  if (br) { ctx.fillStyle = 'rgba(255,40,40,.35)'; ctx.fillRect(-.12 * u, -.24 * u, .24 * u, .14 * u); }
  ctx.fillStyle = '#f2f2f2'; ctx.beginPath(); ctx.arc(0, -.55 * u, .06 * u, 0, 6.3); ctx.fill(); // шолом
  ctx.strokeStyle = '#0a0a0a'; ctx.lineWidth = Math.max(1, .025 * u);
  ctx.beginPath(); ctx.arc(0, -.53 * u, .09 * u, Math.PI, 0); ctx.stroke();                     // halo
  R(-.42, .34, .84, .06, '#0b0b0b'); R(-.42, .4, .84, .05, c);              // заднє антикрило
  R(-.45, .3, .04, .22, '#0b0b0b'); R(.41, .3, .04, .22, '#0b0b0b');
  ctx.restore();
}

function render() {
  ctx.save();
  if (shake > .01) ctx.translate((Math.random() - .5) * shake * 14, (Math.random() - .5) * shake * 14);
  ctx.fillStyle = skyG; ctx.fillRect(-20, -20, W + 40, HY + 22);
  ctx.fillStyle = sunG; ctx.fillRect(-20, -20, W + 40, HY + 22);
  ridge('#1a1420', H * .05, H * .01, .008, bgOff * .3, 1);
  ridge('#0e0c12', H * .035, 0, .014, bgOff * .6, 4);
  ctx.fillStyle = '#10201a'; ctx.fillRect(-20, HY, W + 40, H - HY + 20);

  // проєкція сегментів
  const cam = ((p.d % LEN) + LEN) % LEN, i0 = Math.floor(cam / SL), off = cam - i0 * SL, hh = H / 2;
  let x = 0, dx = -segs[i0] * (off / SL);
  for (let n = 0; n < DRAW; n++) {
    const idx = (i0 + n) % N, z1 = n * SL - off, z2 = z1 + SL, s = items[n] || (items[n] = {});
    s.ok = false;
    if (z2 > 60) {
      const a = 1 / Math.max(z1, 60), b = 1 / z2;
      s.y1 = HY + a * CAMH * hh; s.y2 = HY + b * CAMH * hh;
      s.w1 = a * RW * K; s.w2 = b * RW * K;
      s.X1 = W / 2 + (x - p.x * RW) * a * K; s.X2 = W / 2 + (x + dx - p.x * RW) * b * K;
      s.idx = idx; s.ok = true;
    }
    x += dx; dx += segs[idx];
  }
  // суперники по сегментах
  const bucket = [];
  for (const o of opps) {
    const zc = wrap(o.d - p.d) + PZ; if (zc < 80) continue;
    const f = (zc + off) / SL, n = Math.floor(f);
    if (n < 0 || n >= DRAW) continue;
    (bucket[n] || (bucket[n] = [])).push({ o, pct: f - n });
  }
  // малюємо від далекого до ближнього
  for (let n = DRAW - 1; n >= 0; n--) {
    const s = items[n]; if (!s || !s.ok || s.y1 <= HY + 1) continue;
    const i = s.idx, yb = s.y1 + 1, rc = ((i / 3) | 0) % 2 ? '#f4f4f4' : '#ff8000';
    ctx.fillStyle = ((i / 6) | 0) % 2 ? '#12231a' : '#0f1d15'; ctx.fillRect(-20, s.y2, W + 40, yb - s.y2);
    strip(s, yb, -1.14, -1, rc); strip(s, yb, 1, 1.14, rc);
    strip(s, yb, -1, 1, ((i / 6) | 0) % 2 ? '#34343a' : '#303035');
    strip(s, yb, -.97, -.93, '#e8e8e8'); strip(s, yb, .93, .97, '#e8e8e8');
    if (i % 8 < 4) strip(s, yb, -.018, .018, '#d9d9d9');
    if (i < 4) strip(s, yb, -.93, .93, i % 2 ? '#f2f2f2' : '#151515');
    if (i % 14 === 0 && s.w1 > 6) {                       // рекламні щити
      const side = ((i / 14) | 0) % 2 ? 1 : -1, bx = s.X1 + side * s.w1 * 1.45, bw = s.w1 * .5, bh = s.w1 * .2, ph = s.w1 * .28;
      ctx.fillStyle = '#222'; ctx.fillRect(bx - bw * .03, s.y1 - ph, Math.max(1, bw * .06), ph);
      ctx.fillStyle = '#ff8000'; ctx.fillRect(bx - bw / 2, s.y1 - ph - bh, bw / 2, bh);
      ctx.fillStyle = '#111'; ctx.fillRect(bx, s.y1 - ph - bh, bw / 2, bh);
      ctx.fillStyle = '#fff'; ctx.fillRect(bx - bw / 2, s.y1 - ph - bh * .55, bw, bh * .1);
    }
    const bk = bucket[n];
    if (bk) for (const q of bk) {
      const o = q.o, Y = s.y1 + (s.y2 - s.y1) * q.pct, Wd = s.w1 + (s.w2 - s.w1) * q.pct;
      const X = s.X1 + (s.X2 - s.X1) * q.pct + o.x * Wd;
      drawCar(X, Y, Wd * .42, o.col, o.acc, (o.tx - o.x) * .8, false);
    }
  }
  ctx.fillStyle = fogG; ctx.fillRect(-20, HY, W + 40, H * .14);

  // лінії швидкості
  const sp = p.speed / MAXS;
  if (sp > .15) {
    ctx.strokeStyle = 'rgba(255,255,255,' + (.3 * sp * sp).toFixed(3) + ')'; ctx.lineWidth = 2; ctx.beginPath();
    for (const l of lines) {
      const c = Math.cos(l.a), s2 = Math.sin(l.a), r2 = l.r * (1 + .3 * sp);
      ctx.moveTo(W / 2 + c * l.r, HY + s2 * l.r); ctx.lineTo(W / 2 + c * r2, HY + s2 * r2);
    }
    ctx.stroke();
  }
  // болід гравця
  const wP = RW / PZ * K, pY = HY + CAMH / PZ * hh + (Math.random() - .5) * sp * 2;
  drawCar(W / 2, pY, wP * .42, '#ff8000', '#111111', p.steer, p.brake || state === 'finish');
  // частинки
  for (const q of parts) { ctx.globalAlpha = Math.max(0, q.l / q.ml); ctx.fillStyle = q.c; ctx.fillRect(q.x, q.y, q.s, q.s); }
  ctx.globalAlpha = 1;
  ctx.restore();
}

/* ================= Розмір екрана ================= */
function resize() {
  DPR = Math.min(window.devicePixelRatio || 1, 2);
  W = window.innerWidth; H = window.innerHeight;
  cv.width = Math.round(W * DPR); cv.height = Math.round(H * DPR);
  ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
  K = Math.min(W, H * .6) / 2; HY = H * .4;
  skyG = ctx.createLinearGradient(0, 0, 0, HY);
  skyG.addColorStop(0, '#07080c'); skyG.addColorStop(.6, '#1b1520'); skyG.addColorStop(1, '#ff8a1f');
  sunG = ctx.createRadialGradient(W / 2, HY, 0, W / 2, HY, Math.max(W, H) * .5);
  sunG.addColorStop(0, 'rgba(255,140,20,.5)'); sunG.addColorStop(1, 'rgba(255,140,20,0)');
  fogG = ctx.createLinearGradient(0, HY, 0, HY + H * .14);
  fogG.addColorStop(0, 'rgba(255,128,0,.35)'); fogG.addColorStop(1, 'rgba(255,128,0,0)');
  render();
}
window.addEventListener('resize', resize);
window.addEventListener('orientationchange', () => setTimeout(resize, 200));
if (window.visualViewport) window.visualViewport.addEventListener('resize', resize);

/* ================= Головний цикл ================= */
function loop(now) {
  requestAnimationFrame(loop);
  const dt = Math.min(.05, (now - last) / 1000 || 0); last = now;
  if (state === 'pause') return;
  update(dt); render();
}
resize();
show('scr-start');
requestAnimationFrame(now => { last = now; loop(now); });
})();