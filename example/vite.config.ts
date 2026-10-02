import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// No proxy needed: the README's Daytona flow reaches the sandbox dsh through
// an SSH tunnel on localhost:3080 (same as a local `docker run -p 3080:3080`),
// so DshChat talks to a plain http://localhost:3080 host.
export default defineConfig({
  plugins: [react()],
})
