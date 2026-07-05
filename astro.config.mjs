import { defineConfig } from 'astro/config';

export default defineConfig({
  output: 'static',
  outDir: './dist',
  build: {
    // Flat `page.html` files (matching this project's previous
    // hand-written layout) instead of `page/index.html` directories —
    // the latter makes the Cloudflare assets binding 307-redirect any
    // request for the bare directory path to its trailing-slash form.
    format: 'file',
  },
});
