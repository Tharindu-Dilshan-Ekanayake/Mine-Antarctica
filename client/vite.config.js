import path from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'

import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'
import tailwindcss from '@tailwindcss/vite'

const here = path.dirname(fileURLToPath(import.meta.url))

/**
 * Boxity's local environment (a whole Boxity stack running on this machine), told to the
 * page by the dev server - only with BLOXITY_LOCAL=1, and never in a build: Boxity tells
 * the pages it serves where they are, and a page told nothing uses production.
 */
const BOXITY_LOCAL = {
  env: 'local',
  apiUrl: 'http://localhost:4000',
  playUrl: 'http://localhost:2567',
  portalUrl: 'http://localhost:3000',
  staticUrl: 'https://static.bloxity.io',
}
const boxityLocalEnv = {
  name: 'boxity-local-env',
  apply: 'serve',
  transformIndexHtml: () =>
    process.env.BLOXITY_LOCAL ? [{ tag: 'script', children: `window.BLOXITY_ENV = ${JSON.stringify(BOXITY_LOCAL)}`, injectTo: 'head-prepend' }] : [],
}

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), tailwindcss(), boxityLocalEnv],
  resolve: {
    // Game data and terrain maths shared with the Colyseus server.
    alias: { '@shared': path.resolve(here, '../shared') },
  },
  server: {
    // ../shared lives outside the client root.
    fs: { allow: [path.resolve(here, '..')] },
  },
  build: {
    rollupOptions: {
      output: {
        // Keep the big, rarely-changing libraries in their own cacheable chunks.
        manualChunks(id) {
          if (id.includes('node_modules/three/')) return 'three'
          if (id.includes('node_modules/@react-three/') || id.includes('node_modules/three-stdlib')) return 'r3f'
          if (id.includes('node_modules/@colyseus/')) return 'colyseus'
          if (id.includes('node_modules/react') || id.includes('node_modules/scheduler')) return 'react'
          return undefined
        },
      },
    },
  },
})
