import { defineMiddleware } from 'astro:middleware';
import { experimentalPosters } from './lib/image-mode';
export const onRequest = defineMiddleware((context, next) => {
  if (experimentalPosters && !['localhost', '127.0.0.1', '[::1]'].includes(context.url.hostname)) {
    return new Response('Experimental posters are available only on localhost.', { status: 403 });
  }
  return next();
});
