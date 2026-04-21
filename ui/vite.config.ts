import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

// Read the host stirrup-ai version at build time and expose it as a
// compile-time constant in the UI bundle. DeployPanel uses it to pin
// the generated package.json so the deployed service installs the
// same stirrup-ai version the editor is running — prevents the
// "require is not defined" failure caused by installing a mismatched
// or non-existent package.
const pkg = JSON.parse(
  readFileSync(resolve(__dirname, '../package.json'), 'utf-8'),
) as { version: string }

export default defineConfig({
  plugins: [react()],
  define: {
    __APP_VERSION__: JSON.stringify(pkg.version),
  },
  build: {
    outDir: '../src/ui/dist',
    emptyOutDir: true,
  },
  server: {
    proxy: {
      '/api': 'http://localhost:3710',
    },
  },
})
