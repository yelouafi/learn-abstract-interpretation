import { defineConfig } from 'astro/config';
import mdx from '@astrojs/mdx';
import { unified } from '@astrojs/markdown-remark';
import remarkMath from 'remark-math';
import rehypeKatex from 'rehype-katex';

// Deployed to GitHub Pages as a project site. In CI, BASE_PATH comes from
// actions/configure-pages, so renaming the repository does not break the site.
const base = process.env.BASE_PATH || '/learn-abstract-interpretation';

export default defineConfig({
  site: 'https://yelouafi.github.io',
  base,
  trailingSlash: 'ignore',
  integrations: [mdx()],
  markdown: {
    shikiConfig: { themes: { light: 'github-light', dark: 'github-dark' } },
    processor: unified({
      remarkPlugins: [remarkMath],
      rehypePlugins: [rehypeKatex],
    }),
  },
});
