# Ticket Watcher script
[![AI Slop Inside](https://sladge.net/badge.svg)](https://sladge.net)

This is made specifically for the [Fedora Join SIG](https://forge.fedoraproject.org/join) to keep track of stale tickets.
## Development

```bash
npm install
npm run dev
```

## Manual deploy

There is a manual GitHub Pages workflow at [`.github/workflows/deploy.yml`](.github/workflows/deploy.yml). Trigger it with `workflow_dispatch` to build and publish the site.

The deployed build is hard-coded to talk to `https://forge.fedoraproject.org`. Local development still uses the Vite proxy at `/forge`.
