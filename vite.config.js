import { defineConfig } from 'vite'
import { svelte } from '@sveltejs/vite-plugin-svelte'

const FORGE_API_BASE = '/forge/api/v1/repos/join/WelcomeToFedora'

function isAllowedForgePath(pathname) {
  return pathname === FORGE_API_BASE || pathname.startsWith(FORGE_API_BASE + '/')
}

const forgeProxyGuard = {
  name: 'forge-proxy-guard',
  configureServer(server) {
    server.middlewares.use((req, res, next) => {
      const pathname = new URL(req.url || '/', 'http://localhost').pathname
      if (pathname.startsWith('/forge') && (!isAllowedForgePath(pathname) || req.method !== 'GET')) {
        res.statusCode = 403
        res.setHeader('Content-Type', 'text/plain')
        res.end('Forbidden: dev proxy only forwards GET to /forge/api/v1/repos/join/WelcomeToFedora')
        return
      }
      next()
    })
  },
}

// https://vite.dev/config/
export default defineConfig({
  plugins: [svelte(), forgeProxyGuard],
  base: './',
  server: {
    proxy: {
      '/forge': {
        target: 'https://forge.fedoraproject.org',
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/forge/, ''),
        configure: (proxy) => {
          proxy.on('proxyReq', (proxyReq) => {
            proxyReq.setHeader('Accept', 'application/json');
            proxyReq.setHeader('User-Agent', 'welcome-ticket-watchers/1.0');
          });
        },
      },
    },
  },
})
