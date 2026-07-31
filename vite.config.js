import { defineConfig } from 'vite'
import { svelte } from '@sveltejs/vite-plugin-svelte'

// https://vite.dev/config/
export default defineConfig({
  plugins: [svelte()],
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
