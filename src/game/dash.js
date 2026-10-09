// A small Geometry Dash–style runner on a 2D canvas.
// World units are blocks (the player is 1×1). x grows to the right, y grows up from the ground.
// Physics runs on a fixed timestep so it plays the same at 60 Hz and 144 Hz.

import { loadScores, recordRun, saveScores } from './scores.js';

const STEP = 1 / 240;
const GRAVITY = 100; // blocks/s²
const JUMP_VELOCITY = 21; // → ~2.2 blocks high, ~0.42 s airtime
const SPIN_RATE = Math.PI / 0.42; // half a turn per jump
const BLOCKS_TALL = 8; // visible height of the stage in blocks
const GROUND_ROWS = 1.6; // ground band height
const PLAYER_X = 3.2; // player's screen position, in blocks from the left
const BASE_SPEED = 8.6;
const MAX_SPEED_GAIN = 4.2;
const MARGIN = 0.08; // player hitbox inset (forgiving, like the real thing)

// Obstacle patterns: [type, x, y]. `min` is the difficulty (0–1) at which a pattern unlocks.
const PATTERNS = [
  { min: 0, width: 1, items: [['spike', 0, 0]] },
  { min: 0, width: 2, items: [['spike', 0, 0], ['spike', 1, 0]] },
  { min: 0.08, width: 1, items: [['block', 0, 0]] },
  { min: 0.12, width: 3, items: [['block', 0, 0], ['block', 1, 0], ['block', 2, 0]] },
  { min: 0.25, width: 3, items: [['spike', 0, 0], ['spike', 1, 0], ['spike', 2, 0]] },
  {
    min: 0.3,
    width: 5,
    items: [['block', 0, 0], ['block', 2, 0], ['block', 2, 1], ['block', 4, 0], ['block', 4, 1], ['block', 4, 2]],
  },
  {
    min: 0.38,
    width: 6,
    items: [['block', 0, 0], ['block', 1, 0], ['spike', 2, 0], ['spike', 3, 0], ['block', 4, 0], ['block', 5, 0]],
  },
  {
    min: 0.48,
    width: 5,
    items: [['block', 0, 0], ['block', 1, 0], ['block', 2, 0], ['block', 3, 0], ['block', 4, 0], ['spike', 2, 1]],
  },
  { min: 0.58, width: 4, items: [['spike', 0, 0], ['block', 2, 0], ['block', 3, 0], ['spike', 3, 1]] },
];

const rgba = (triplet, a) => `rgba(${triplet.trim().split(/\s+/).join(',')},${a})`;

function readColors() {
  const s = getComputedStyle(document.documentElement);
  const v = (name) => s.getPropertyValue(name).trim();
  return {
    bg: v('--bg'),
    ink: v('--ink'),
    inkRgb: v('--ink-rgb'),
    accent: v('--accent'),
    accent2: v('--accent-2'),
    accentRgb: v('--accent-rgb'),
    onAccent: v('--on-accent'),
    cardRgb: v('--card-rgb'),
  };
}

export async function mountDash(root, { reducedMotion = false } = {}) {
  const canvas = root.querySelector('canvas');
  const ctx = canvas.getContext('2d');
  const ui = {
    score: root.querySelector('[data-score]'),
    best: root.querySelector('[data-best]'),
    overlay: root.querySelector('[data-overlay]'),
    title: root.querySelector('[data-title]'),
    sub: root.querySelector('[data-sub]'),
    actions: root.querySelector('[data-actions]'),
    save: root.querySelector('[data-save]'),
    retry: root.querySelector('[data-retry]'),
    runs: document.querySelector('[data-runs]'),
    attempts: document.querySelector('[data-attempts]'),
  };

  let scores = await loadScores();
  let colors = readColors();
  new MutationObserver(() => (colors = readColors())).observe(document.documentElement, {
    attributes: true,
    attributeFilter: ['data-theme'],
  });

  // ---------- state ----------

  const view = { w: 0, h: 0, dpr: 1, B: 1, groundY: 0 };
  let state = 'ready'; // ready | playing | paused | dead
  let distance = 0;
  let speed = BASE_SPEED;
  let obstacles = [];
  let nextSpawn = 0;
  let particles = [];
  let shake = 0;
  let held = false;
  let deadAt = 0;
  let lastScore = 0;
  let sessionAttempt = 0; // this visit only; never stored
  const player = { y: 0, vy: 0, rot: 0, onGround: true };

  const difficulty = () => Math.min(1, distance / 650);
  const score = () => Math.floor(distance);

  function reset() {
    distance = 0;
    speed = BASE_SPEED;
    obstacles = [];
    nextSpawn = 14;
    particles = [];
    shake = 0;
    Object.assign(player, { y: 0, vy: 0, rot: 0, onGround: true });
  }

  function spawn() {
    const viewBlocks = view.w / view.B;
    while (nextSpawn < distance + viewBlocks + 4) {
      const d = difficulty();
      const pool = PATTERNS.filter((p) => p.min <= d);
      const pattern = pool[Math.floor(Math.random() * pool.length)];
      for (const [type, x, y] of pattern.items) obstacles.push({ type, x: nextSpawn + x, y });
      const hasBlocks = pattern.items.some(([t]) => t === 'block');
      const gap = Math.max(hasBlocks ? 4 : 3.4, 4.5 + Math.random() * 3.5 - d * 1.6);
      nextSpawn += pattern.width + gap;
    }
    obstacles = obstacles.filter((o) => o.x > distance - PLAYER_X - 2);
  }

  // ---------- simulation ----------

  function jump() {
    if (!player.onGround) return;
    player.vy = JUMP_VELOCITY;
    player.onGround = false;
  }

  function step(dt) {
    const prevY = player.y;
    speed = BASE_SPEED + MAX_SPEED_GAIN * difficulty();
    distance += speed * dt;
    player.vy -= GRAVITY * dt;
    player.y += player.vy * dt;

    let landed = false;
    if (player.y <= 0) {
      player.y = 0;
      player.vy = 0;
      landed = true;
    }

    const left = distance + MARGIN;
    const right = distance + 1 - MARGIN;
    for (const o of obstacles) {
      if (o.x > right + 1 || o.x + 1 < left - 1) continue;
      if (o.type === 'block') {
        const top = o.y + 1;
        const overlaps = right > o.x && left < o.x + 1 && player.y < top && player.y + 1 > o.y;
        if (!overlaps) continue;
        if (prevY >= top - 0.25 && player.vy <= 0) {
          player.y = top;
          player.vy = 0;
          landed = true;
        } else {
          return die();
        }
      } else {
        // spikes kill on a narrow inner box, which feels fair
        const hit =
          right > o.x + 0.38 && left < o.x + 0.62 && player.y + MARGIN < o.y + 0.55 && player.y + 1 - MARGIN > o.y;
        if (hit) return die();
      }
    }

    player.onGround = landed;
    if (landed) {
      player.rot += (Math.round(player.rot / (Math.PI / 2)) * (Math.PI / 2) - player.rot) * 0.35;
      if (held) jump();
    } else {
      player.rot += SPIN_RATE * dt;
    }
    spawn();
  }

  function burst(count) {
    for (let i = 0; i < count; i++) {
      const a = Math.random() * Math.PI * 2;
      const v = 4 + Math.random() * 9;
      particles.push({
        x: distance + 0.5,
        y: player.y + 0.5,
        vx: Math.cos(a) * v,
        vy: Math.sin(a) * v,
        life: 0.6 + Math.random() * 0.5,
        size: 0.12 + Math.random() * 0.18,
      });
    }
  }

  function die() {
    state = 'dead';
    deadAt = performance.now();
    held = false;
    burst(reducedMotion ? 10 : 26);
    shake = reducedMotion ? 0 : 0.4;
    lastScore = score();
    const isBest = lastScore > scores.best;
    setTimeout(() => {
      if (state !== 'dead') return;
      showOverlay(isBest ? `New best: ${lastScore}` : `Score: ${lastScore}`, 'Save this run, or go again?');
      ui.save.disabled = lastScore === 0;
      ui.save.textContent = 'Save score';
      ui.actions.hidden = false;
    }, 450);
  }

  // Runs are only stored when the player asks for it.
  async function saveLastRun() {
    if (state !== 'dead' || ui.save.disabled) return;
    ui.save.disabled = true;
    scores = recordRun(scores, lastScore);
    await saveScores(scores);
    renderScores();
    ui.save.textContent = 'Saved';
  }

  // ---------- input ----------

  function press() {
    held = true;
    if (state === 'playing') return jump();
    if (state === 'dead' && performance.now() - deadAt < 450) return; // don't skip the crash by accident
    if (state === 'paused') {
      state = 'playing';
      hideOverlay();
      return;
    }
    reset();
    sessionAttempt += 1;
    if (ui.attempts) ui.attempts.textContent = sessionAttempt;
    state = 'playing';
    hideOverlay();
    jump();
  }

  const release = () => (held = false);

  canvas.addEventListener('pointerdown', (e) => {
    e.preventDefault();
    canvas.focus({ preventScroll: true });
    canvas.setPointerCapture?.(e.pointerId);
    press();
  });
  ui.save.addEventListener('click', saveLastRun);
  ui.retry.addEventListener('click', () => {
    press();
    release();
  });
  canvas.addEventListener('pointerup', release);
  canvas.addEventListener('pointercancel', release);
  canvas.addEventListener('lostpointercapture', release);

  const isJumpKey = (e) => e.code === 'Space' || e.code === 'ArrowUp' || e.code === 'KeyW';
  window.addEventListener('keydown', (e) => {
    if (!isJumpKey(e) || !visible || e.target.closest?.('input, textarea, select, button, [contenteditable]')) return;
    e.preventDefault();
    if (!e.repeat) press();
  });
  window.addEventListener('keydown', (e) => {
    if (e.code === 'KeyS' && visible && state === 'dead' && !e.target.closest?.('input, textarea, select, [contenteditable]')) saveLastRun();
  });
  window.addEventListener('keyup', (e) => {
    if (isJumpKey(e)) release();
  });

  // ---------- visibility & sizing ----------

  let visible = false;
  new IntersectionObserver(
    ([entry]) => {
      visible = entry.isIntersecting;
      if (!visible && state === 'playing') pause();
    },
    { threshold: 0.5 },
  ).observe(canvas);

  document.addEventListener('visibilitychange', () => {
    if (document.hidden && state === 'playing') pause();
  });

  function pause() {
    state = 'paused';
    held = false;
    showOverlay('Paused', 'Tap or press Space to resume');
  }

  function resize() {
    const rect = canvas.getBoundingClientRect();
    view.dpr = Math.min(window.devicePixelRatio || 1, 2);
    view.w = rect.width;
    view.h = rect.height;
    view.B = view.h / BLOCKS_TALL;
    view.groundY = view.h - GROUND_ROWS * view.B;
    canvas.width = Math.round(view.w * view.dpr);
    canvas.height = Math.round(view.h * view.dpr);
  }
  new ResizeObserver(resize).observe(canvas);
  resize();

  // ---------- UI ----------

  function showOverlay(title, sub) {
    ui.title.textContent = title;
    ui.sub.textContent = sub;
    ui.overlay.classList.remove('is-hidden');
  }

  function hideOverlay() {
    ui.overlay.classList.add('is-hidden');
    ui.actions.hidden = true;
  }

  const dateFmt = new Intl.DateTimeFormat(undefined, { day: 'numeric', month: 'short' });
  function renderScores() {
    ui.best.textContent = scores.best;
    if (!ui.runs) return;
    ui.runs.replaceChildren(
      ...(scores.runs.length
        ? scores.runs.map((run) => {
            const li = document.createElement('li');
            const s = document.createElement('span');
            const d = document.createElement('span');
            s.textContent = run.score;
            d.textContent = run.at ? dateFmt.format(new Date(run.at)) : '';
            li.append(s, d);
            return li;
          })
        : [Object.assign(document.createElement('li'), { className: 'runs__empty', textContent: 'No runs yet' })]),
    );
  }

  // ---------- rendering ----------

  const sx = (x) => (x - distance + PLAYER_X) * view.B;
  const sy = (y) => view.groundY - y * view.B;

  function drawBackground() {
    const { w, h, B, groundY } = view;
    const sky = ctx.createLinearGradient(0, 0, 0, groundY);
    sky.addColorStop(0, rgba(colors.accentRgb, 0.16));
    sky.addColorStop(1, rgba(colors.cardRgb, 0.9));
    ctx.fillStyle = colors.bg;
    ctx.fillRect(0, 0, w, h);
    ctx.fillStyle = sky;
    ctx.fillRect(0, 0, w, groundY);

    // parallax grid
    const cell = B * 2;
    const off = -((distance * B * 0.3) % cell);
    ctx.strokeStyle = rgba(colors.inkRgb, 0.05);
    ctx.lineWidth = 1;
    ctx.beginPath();
    for (let x = off; x < w; x += cell) {
      ctx.moveTo(x + 0.5, 0);
      ctx.lineTo(x + 0.5, groundY);
    }
    for (let y = groundY - cell; y > 0; y -= cell) {
      ctx.moveTo(0, y + 0.5);
      ctx.lineTo(w, y + 0.5);
    }
    ctx.stroke();

    // ground
    ctx.fillStyle = rgba(colors.cardRgb, 1);
    ctx.fillRect(0, groundY, w, h - groundY);
    const tile = B * 2;
    const goff = -((distance * B) % tile);
    ctx.strokeStyle = rgba(colors.inkRgb, 0.06);
    ctx.beginPath();
    for (let x = goff; x < w; x += tile) {
      ctx.moveTo(x + 0.5, groundY);
      ctx.lineTo(x + 0.5, h);
    }
    ctx.stroke();
    ctx.fillStyle = colors.accent;
    ctx.fillRect(0, groundY - 1, w, 2);
  }

  function drawAttemptLabel() {
    if (sessionAttempt === 0) return;
    const x = sx(7);
    if (x < -view.w) return;
    ctx.fillStyle = rgba(colors.inkRgb, 0.85);
    ctx.font = `600 ${Math.round(view.B * 0.8)}px 'PP Mori', system-ui, sans-serif`;
    ctx.textBaseline = 'alphabetic';
    ctx.fillText(`Attempt ${sessionAttempt}`, x, sy(4));
  }

  function drawObstacles() {
    const { B } = view;
    for (const o of obstacles) {
      const x = sx(o.x);
      if (x > view.w + B || x < -B) continue;
      const y = sy(o.y + 1);
      if (o.type === 'block') {
        ctx.fillStyle = rgba(colors.cardRgb, 1);
        ctx.fillRect(x, y, B, B);
        ctx.strokeStyle = colors.accent;
        ctx.lineWidth = 2;
        ctx.strokeRect(x + 1, y + 1, B - 2, B - 2);
        ctx.strokeStyle = rgba(colors.accentRgb, 0.35);
        ctx.lineWidth = 1;
        ctx.strokeRect(x + B * 0.28, y + B * 0.28, B * 0.44, B * 0.44);
      } else {
        const base = sy(o.y);
        ctx.beginPath();
        ctx.moveTo(x + B * 0.06, base);
        ctx.lineTo(x + B * 0.5, base - B * 0.9);
        ctx.lineTo(x + B * 0.94, base);
        ctx.closePath();
        ctx.fillStyle = colors.bg;
        ctx.fill();
        ctx.strokeStyle = colors.ink;
        ctx.lineWidth = 2;
        ctx.stroke();
      }
    }
  }

  function drawPlayer() {
    if (state === 'dead') return;
    const { B } = view;
    const s = B * 0.92;
    ctx.save();
    ctx.translate(sx(distance) + B / 2, sy(player.y) - B / 2);
    ctx.rotate(player.rot);
    ctx.shadowColor = colors.accent;
    ctx.shadowBlur = B * 0.5;
    ctx.fillStyle = colors.accent;
    ctx.fillRect(-s / 2, -s / 2, s, s);
    ctx.shadowBlur = 0;
    ctx.strokeStyle = colors.onAccent;
    ctx.lineWidth = Math.max(2, B * 0.07);
    ctx.strokeRect(-s * 0.3, -s * 0.3, s * 0.6, s * 0.6);
    ctx.fillStyle = colors.accent2;
    ctx.fillRect(-s * 0.12, -s * 0.12, s * 0.24, s * 0.24);
    ctx.restore();
  }

  function drawParticles(dt) {
    const { B } = view;
    for (const p of particles) {
      p.life -= dt;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.vy -= GRAVITY * 0.35 * dt;
    }
    particles = particles.filter((p) => p.life > 0);
    for (const p of particles) {
      ctx.globalAlpha = Math.min(1, p.life * 1.6);
      ctx.fillStyle = colors.accent2;
      const size = p.size * B;
      ctx.fillRect(sx(p.x) - size / 2, sy(p.y) - size / 2, size, size);
    }
    ctx.globalAlpha = 1;

    // a little trail while running on the ground
    if (state === 'playing' && player.onGround && !reducedMotion && Math.random() < 0.6) {
      particles.push({
        x: distance + 0.1,
        y: player.y + 0.08,
        vx: -speed * 0.25 - Math.random() * 2,
        vy: Math.random() * 2.5,
        life: 0.35,
        size: 0.08 + Math.random() * 0.08,
      });
    }
  }

  function render(dt) {
    ctx.setTransform(view.dpr, 0, 0, view.dpr, 0, 0);
    if (shake > 0) {
      const m = shake * view.B * 0.35;
      ctx.translate((Math.random() - 0.5) * m, (Math.random() - 0.5) * m);
      shake = Math.max(0, shake - dt);
    }
    drawBackground();
    drawAttemptLabel();
    drawObstacles();
    drawPlayer();
    drawParticles(dt);
    ui.score.textContent = score();
  }

  // ---------- loop ----------

  let last = performance.now();
  let acc = 0;
  function frame(now) {
    requestAnimationFrame(frame);
    const dt = Math.min((now - last) / 1000, 0.1);
    last = now;
    if (!visible || document.hidden) return;
    if (state === 'playing') {
      acc += dt;
      while (acc >= STEP && state === 'playing') {
        step(STEP);
        acc -= STEP;
      }
    } else {
      acc = 0;
    }
    render(dt);
  }

  reset();
  spawn();
  renderScores();
  showOverlay('Tap to play', 'Space, ↑ or tap to jump. Hold to keep jumping.');
  requestAnimationFrame(frame);
}
