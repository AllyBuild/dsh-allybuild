import { defineConfig, type ProxyOptions } from 'vite'
const url = process.env.SANDBOX_PREVIEW_URL!
const base = new URL(url)
const key = base.searchParams.get('DAYTONA_SANDBOX_AUTH_KEY')!
function p(): ProxyOptions {
  return {
    target: base.origin, changeOrigin: true, ws: true,
    configure(proxy) {
      proxy.on('proxyReq', (proxyReq) => {
        if (!proxyReq.path.includes('DAYTONA')) proxyReq.path += (proxyReq.path.includes('?') ? '&' : '?') + 'DAYTONA_SANDBOX_AUTH_KEY=' + key
        console.log('[proxyReq]', proxyReq.path.slice(0, 80))
        console.log('[headers]', JSON.stringify(proxyReq.getHeaders()))
      })
    },
  }
}
export default defineConfig({ server: { proxy: { '/plugins': p(), '/sandbox': p() } } })
