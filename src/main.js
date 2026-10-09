import './style.css';
import { gsap } from 'gsap';
import { ScrollTrigger } from 'gsap/ScrollTrigger';
import Lenis from 'lenis';
import { installRetroCursor } from './cursor.js';

gsap.registerPlugin(ScrollTrigger);
installRetroCursor();

const root = document.documentElement;
const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
let canvas = document.getElementById('world');
const track = document.querySelector('.track');
const panels = [...document.querySelectorAll('.panel')].filter((panel) => !panel.hidden);
const navLinks = [...document.querySelectorAll('.topbar nav a')];
const bar = document.querySelector('.progress span');
const counterNow = document.querySelector('.counter__now');

// ---------- marquees ----------

// A second, hidden copy of each track makes the CSS loop seamless.
document.querySelectorAll('.marquee').forEach((marquee) => {
  const copy = marquee.querySelector('.marquee__track').cloneNode(true);
  copy.setAttribute('aria-hidden', 'true');
  marquee.append(copy);
});

// ---------- inner scroll areas ----------

// Some areas scroll on their own (stores grid, demo viewer and results). While one can still move in
// the wheel's direction, keep the event from Lenis (which would move the page); at either end, let
// it through so the page continues.
document.querySelectorAll('.stores, [data-scroll-y]').forEach((area) =>
  area.addEventListener(
    'wheel',
    (e) => {
      if (!root.classList.contains('is-h')) return;
      const { scrollTop, scrollHeight, clientHeight } = area;
      const canScroll =
        (e.deltaY > 0 && scrollTop + clientHeight < scrollHeight - 1) || (e.deltaY < 0 && scrollTop > 0);
      if (canScroll) e.stopPropagation();
    },
    { passive: true },
  ),
);

// ---------- live demo ----------

const demoRoot = document.querySelector('[data-demo]');
if (demoRoot) {
  import('./demo/demo.js')
    .then(({ mountDemo }) => mountDemo(demoRoot, { onBusy: (busy) => world?.setPaused(busy) }))
    .catch((err) => console.warn('Demo failed to load.', err));
}

// ---------- card highlight ----------

document.querySelectorAll('.card').forEach((card) => {
  card.addEventListener('pointermove', (e) => {
    const r = card.getBoundingClientRect();
    card.style.setProperty('--mx', `${e.clientX - r.left}px`);
    card.style.setProperty('--my', `${e.clientY - r.top}px`);
  });
});

// ---------- stat count-up ----------

if (!reduced) {
  const counters = new IntersectionObserver(
    (entries) => {
      for (const { target, isIntersecting } of entries) {
        if (!isIntersecting) continue;
        counters.unobserve(target);
        const [, prefix, num, suffix] = target.textContent.match(/^(\D*)([\d.]+)(.*)$/) ?? [];
        if (!num) continue;
        const decimals = num.split('.')[1]?.length ?? 0;
        const value = { n: 0 };
        gsap.to(value, {
          n: parseFloat(num),
          duration: 1.6,
          ease: 'power3.out',
          onUpdate: () => (target.textContent = prefix + value.n.toFixed(decimals) + suffix),
        });
      }
    },
    { threshold: 0.6 },
  );
  document.querySelectorAll('.stat dd').forEach((dd) => counters.observe(dd));
}

// ---------- game ----------

const dashRoot = document.querySelector('[data-dash]');
if (dashRoot) {
  import('./game/dash.js')
    .then(({ mountDash }) => mountDash(dashRoot, { reducedMotion: reduced }))
    .catch((err) => console.warn('Game failed to load.', err));
}

// ---------- 3D world ----------

// Loaded lazily so the text is readable before Three.js arrives.
let world = null;
let createWorld = null;
let lastProgress = 0;
import('./world.js')
  .then((mod) => {
    createWorld = mod.createWorld;
    world = createWorld(canvas, { reducedMotion: reduced, theme: root.dataset.theme, progress: lastProgress });
    requestAnimationFrame(() => canvas.classList.add('is-ready'));
  })
  .catch((err) => {
    console.warn('WebGL unavailable, continuing without the 3D world.', err);
    root.classList.add('no-webgl');
  });

// ---------- theme switcher ----------

const themeButtons = [...document.querySelectorAll('[data-theme-pick]')];
const themeMeta = document.querySelector('meta[name="theme-color"]');

function applyTheme(name, { rebuild = true } = {}) {
  root.dataset.theme = name;
  themeButtons.forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.themePick === name)));
  themeMeta?.setAttribute('content', getComputedStyle(root).getPropertyValue('--bg').trim());
  if (rebuild && world && createWorld) {
    // The island is procedural, so rebuilding it in the new palette takes a few milliseconds.
    world.dispose();
    const fresh = canvas.cloneNode(); // a new canvas means a clean WebGL context
    canvas.replaceWith(fresh);
    canvas = fresh;
    world = createWorld(canvas, { reducedMotion: reduced, theme: name, progress: lastProgress, intro: false });
  }
}

themeButtons.forEach((button) =>
  button.addEventListener('click', () => {
    const name = button.dataset.themePick;
    if (name === root.dataset.theme) return;
    applyTheme(name);
    try {
      localStorage.setItem('theme', name);
    } catch {
      // storage blocked: the pick still applies for this visit
    }
    const url = new URL(location.href);
    if (url.searchParams.has('theme')) {
      url.searchParams.set('theme', name);
      history.replaceState(null, '', url);
    }
  }),
);
applyTheme(root.dataset.theme, { rebuild: false });

window.addEventListener(
  'pointermove',
  (e) => world?.setPointer((e.clientX / window.innerWidth) * 2 - 1, (e.clientY / window.innerHeight) * 2 - 1),
  { passive: true },
);

// ---------- smooth scroll ----------

const lenis = reduced ? null : new Lenis({ lerp: 0.09 });
if (lenis) {
  lenis.on('scroll', ScrollTrigger.update);
  gsap.ticker.add((time) => lenis.raf(time * 1000));
  gsap.ticker.lagSmoothing(0);
}

// ---------- progress, active section ----------

let horizontal = null; // the track tween while in horizontal mode
const distance = () => Math.max(1, track.scrollWidth - window.innerWidth);
let currentIndex = 0;

function activePanelIndex(p) {
  let index = 0;
  if (horizontal) {
    const x = p * distance() + window.innerWidth * 0.5;
    panels.forEach((panel, i) => {
      if (panel.offsetLeft <= x) index = i;
    });
  } else {
    panels.forEach((panel, i) => {
      if (panel.getBoundingClientRect().top <= window.innerHeight * 0.5) index = i;
    });
  }
  return index;
}

function onProgress(p) {
  bar.style.transform = `scaleX(${p})`;
  lastProgress = p;
  world?.setProgress(p);

  // full brightness on the hero and contact panels, receding behind the reading-heavy middle
  const dim = gsap.utils.clamp(0, 1, Math.min(p / 0.12, (1 - p) / 0.1));
  const opacity = horizontal ? 1 - dim * 0.55 : 0.6 - dim * 0.3;
  canvas.style.setProperty('--world-opacity', opacity.toFixed(3));

  const index = activePanelIndex(p);
  if (index !== currentIndex) {
    currentIndex = index;
    counterNow.textContent = String(index + 1).padStart(2, '0');
    const id = panels[index].id;
    navLinks.forEach((a) => a.setAttribute('aria-current', String(a.hash === `#${id}`)));
  }
}

// ---------- navigation ----------

function scrollYFor(panel) {
  if (horizontal) {
    const st = horizontal.scrollTrigger;
    const x = Math.min(panel.offsetLeft, distance());
    return st.start + (x / distance()) * (st.end - st.start);
  }
  return panel.getBoundingClientRect().top + window.scrollY;
}

function goTo(panel) {
  const y = scrollYFor(panel);
  if (lenis) lenis.scrollTo(y, { duration: 1.6 });
  else window.scrollTo({ top: y, behavior: 'auto' });
  panel.focus({ preventScroll: true });
}

document.querySelectorAll('[data-nav]').forEach((link) => {
  link.addEventListener('click', (e) => {
    const panel = document.querySelector(link.hash);
    if (!panel) return;
    e.preventDefault();
    goTo(panel);
    history.replaceState(null, '', link.hash);
  });
});

window.addEventListener('keydown', (e) => {
  if (!horizontal || e.altKey || e.ctrlKey || e.metaKey) return;
  if (e.target.closest('input, textarea, select, [contenteditable]')) return;
  if (e.key === 'ArrowRight') {
    e.preventDefault();
    goTo(panels[Math.min(currentIndex + 1, panels.length - 1)]);
  } else if (e.key === 'ArrowLeft') {
    e.preventDefault();
    goTo(panels[Math.max(currentIndex - 1, 0)]);
  }
});

// ---------- layouts ----------

const mm = gsap.matchMedia();

mm.add('(min-width: 901px)', () => {
  root.classList.add('is-h');

  horizontal = gsap.to(track, {
    x: () => -distance(),
    ease: 'none',
    scrollTrigger: {
      trigger: '.horizontal',
      start: 'top top',
      end: () => `+=${distance()}`,
      pin: true,
      scrub: lenis ? true : 0.5,
      invalidateOnRefresh: true,
      onUpdate: (self) => onProgress(self.progress),
    },
  });

  if (!reduced) {
    gsap.utils.toArray('[data-reveal]').forEach((el) => {
      gsap.from(el, {
        autoAlpha: 0,
        y: 36,
        duration: 0.9,
        ease: 'power3.out',
        scrollTrigger: {
          trigger: el,
          containerAnimation: horizontal,
          start: 'left 92%',
          toggleActions: 'play none none reverse',
        },
      });
    });
  }

  return () => {
    horizontal = null;
    root.classList.remove('is-h');
  };
});

mm.add('(max-width: 900px)', () => {
  ScrollTrigger.create({
    trigger: track,
    start: 'top top',
    end: 'bottom bottom',
    onUpdate: (self) => onProgress(self.progress),
  });

  if (!reduced) {
    gsap.utils.toArray('[data-reveal]').forEach((el) => {
      gsap.from(el, {
        autoAlpha: 0,
        y: 28,
        duration: 0.8,
        ease: 'power3.out',
        scrollTrigger: { trigger: el, start: 'top 88%' },
      });
    });
  }
});

// ---------- intro ----------

if (!reduced) {
  gsap.from('[data-intro]', { autoAlpha: 0, y: 30, duration: 1.1, stagger: 0.12, ease: 'power3.out', delay: 0.25 });
}

onProgress(0);
navLinks.forEach((a) => a.setAttribute('aria-current', 'false'));

// Fonts change text metrics; re-measure once they land, then honour any #hash in the URL.
document.fonts.ready.then(() => {
  ScrollTrigger.refresh();
  const target = location.hash ? document.querySelector(location.hash) : null;
  if (target?.classList.contains('panel')) goTo(target);
});
