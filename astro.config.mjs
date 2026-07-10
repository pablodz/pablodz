// @ts-check
import { defineConfig } from 'astro/config';
import mdx from '@astrojs/mdx';
import sitemap from '@astrojs/sitemap';

export default defineConfig({
  site: 'https://pablodz.com',
  integrations: [mdx(), sitemap()],
  redirects: {
    '/blog': '/',
  },
  markdown: {
    shikiConfig: {
      // Vesper: negro + naranja, encaja con la paleta NERV
      theme: 'vesper',
      wrap: true,
    },
  },
});
