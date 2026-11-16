import { defineConfig } from 'vite'

export default defineConfig({
  base: './', // GitHub Pages serves under /idc/
  // dcm2niix resolves its WASM worker via import.meta.url, which prebundling breaks.
  optimizeDeps: { exclude: ['@niivue/dcm2niix'] },
  worker: { format: 'es' },
})
