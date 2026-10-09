import { defineConfig } from 'vite';

// Relative base so the build works on GitHub Pages under any repo name.
export default defineConfig({
  base: './',
  build: {
    // three.js is lazy-loaded in its own chunk; it's expected to be large.
    chunkSizeWarningLimit: 800,
  },
});
