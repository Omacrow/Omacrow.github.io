// Windows 98 cursors, drawn from pixel maps and exposed as CSS variables
// (--cursor-arrow, --cursor-hand) that style.css applies.
// B = black outline, W = white fill, anything else = transparent.

const ARROW = [
  'B...........',
  'BB..........',
  'BWB.........',
  'BWWB........',
  'BWWWB.......',
  'BWWWWB......',
  'BWWWWWB.....',
  'BWWWWWWB....',
  'BWWWWWWWB...',
  'BWWWWWWWWB..',
  'BWWWWWBBBBB.',
  'BWWBWWB.....',
  'BWB.BWWB....',
  'BB..BWWB....',
  'B....BWWB...',
  '.....BWWB...',
  '......BWWB..',
  '......BWWB..',
  '.......BB...',
];

const HAND = [
  '.....BB.........',
  '....BWWB........',
  '....BWWB........',
  '....BWWB........',
  '....BWWB........',
  '....BWWBBB......',
  '....BWWBWWBBB...',
  '....BWWBWWBWWBB.',
  '.BB.BWWBWWBWWBWB',
  'BWWBBWWWWWWWWBWB',
  'BWWWBWWWWWWWWWWB',
  '.BWWBWWWWWWWWWWB',
  '..BWWWWWWWWWWWWB',
  '..BWWWWWWWWWWWB.',
  '...BWWWWWWWWWWB.',
  '...BWWWWWWWWWB..',
  '....BWWWWWWWWB..',
  '....BWWWWWWWWB..',
  '....BBBBBBBBBB..',
];

const SCALE = 2; // chunky, like a 98 cursor on a modern screen

function toCss(rows, hotX, hotY) {
  const w = rows[0].length;
  const h = rows.length;
  let rects = '';
  rows.forEach((row, y) => {
    [...row].forEach((px, x) => {
      const fill = px === 'B' ? '#000' : px === 'W' ? '#fff' : null;
      if (fill) rects += `<rect x="${x}" y="${y}" width="1" height="1" fill="${fill}"/>`;
    });
  });
  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" width="${w * SCALE}" height="${h * SCALE}" ` +
    `viewBox="0 0 ${w} ${h}" shape-rendering="crispEdges">${rects}</svg>`;
  return `url("data:image/svg+xml,${encodeURIComponent(svg)}") ${hotX * SCALE} ${hotY * SCALE}`;
}

export function installRetroCursor() {
  // Touch devices have no cursor to replace.
  if (!window.matchMedia('(hover: hover) and (pointer: fine)').matches) return;
  const root = document.documentElement.style;
  root.setProperty('--cursor-arrow', `${toCss(ARROW, 0, 0)}, auto`);
  root.setProperty('--cursor-hand', `${toCss(HAND, 5, 0)}, pointer`);
}
