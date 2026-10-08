// @ts-check
import { defineConfig } from 'astro/config';

// SITE_URL and BASE_PATH come from the deploy environment:
//   org site (current)  SITE_URL=https://bigym2.github.io         BASE_PATH unset
//   project page        SITE_URL=https://<org>.github.io         BASE_PATH=/<repo>
export default defineConfig({
  site: process.env.SITE_URL || undefined,
  base: process.env.BASE_PATH || '/',
  trailingSlash: 'ignore',
  server: { port: 4321 },
  build: { inlineStylesheets: 'auto' },
});
