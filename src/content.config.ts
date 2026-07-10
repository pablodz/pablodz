import { defineCollection, z } from 'astro:content';
import { glob } from 'astro/loaders';

const blog = defineCollection({
  loader: glob({ pattern: '**/*.{md,mdx}', base: './src/content/blog' }),
  schema: z.object({
    title: z.string(),
    description: z.string(),
    pubDate: z.coerce.date(),
    updatedDate: z.coerce.date().optional(),
    tags: z.array(z.string()).default([]),
    // Número de "episodio" mostrado en la title card. Si se omite,
    // se usa el orden cronológico.
    episode: z.number().optional(),
    draft: z.boolean().default(false),
  }),
});

export const collections = { blog };
