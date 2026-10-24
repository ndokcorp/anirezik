import type { APIRoute } from 'astro';
import { anime, staticPageIds } from '../data/anime';
import { packIndex } from '../lib/catalog-index';
export const GET: APIRoute = () => Response.json(packIndex(anime, staticPageIds));
