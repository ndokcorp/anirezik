import { loadImages, imageRetryAt, retryFailedImages } from './image-service';

async function revealImage(img: HTMLImageElement) {
  const id = Number(img.dataset.imageId);
  if (id > 0) {
    const images = await loadImages([id]);
    // Filters may have replaced this card while its package was in flight.
    if (!img.isConnected) return;
    const art = images[id];
    if (art) {
      img.dataset.imageSrc = art.poster;
      if (art.posterDetailUrl && art.posterDetailUrl !== art.poster)
        img.dataset.imageAlternative = art.posterDetailUrl;
      img.alt = `${art.imageLicenseStatus === 'original-ai' ? 'AI-иллюстрация, не официальный постер' : 'Постер'}: ${img.dataset.imageTitle || ''}`;
      if (art.imageAttribution && art.imageLicenseStatus === 'original-ai') {
        const label = document.createElement(
          img.dataset.imageCredit === 'inline' ? 'small' : 'span',
        );
        label.className = img.dataset.imageCredit === 'inline' ? 'related-credit' : 'art-label';
        label.textContent =
          art.imageLicenseStatus === 'original-ai'
            ? 'AI · НЕОФИЦИАЛЬНЫЙ АРТ'
            : art.imageAttribution;
        (img.dataset.imageCredit === 'inline'
          ? img.closest('.related-link')?.querySelector('.related-copy')
          : img.parentElement
        )?.append(label);
      }
    } else if (imageRetryAt(id) > Date.now()) {
      // Keep the ID on transient package failures instead of permanently losing its poster.
      if (!img.dataset.imageRetried) {
        img.dataset.imageRetried = 'true';
        setTimeout(
          () => {
            if (img.isConnected && img.dataset.imageId) {
              if (observer) observer.observe(img);
              else void revealImage(img);
            }
          },
          imageRetryAt(id) - Date.now() + 50,
        );
      }
      return;
    }
    delete img.dataset.imageId;
  }
  if (img.isConnected && img.dataset.imageSrc) {
    delete img.dataset.failed;
    delete img.dataset.alternativeTried;
    img.hidden = false;
    img.classList.remove('image-failed');
    img.src = img.dataset.imageSrc;
    delete img.dataset.imageSrc;
  }
}
const observer =
  typeof IntersectionObserver === 'function'
    ? new IntersectionObserver(
        (entries) => {
          for (const entry of entries)
            if (entry.isIntersecting) {
              const img = entry.target as HTMLImageElement;
              observer?.unobserve(img);
              void revealImage(img);
            }
        },
        { rootMargin: '160px' },
      )
    : null;
export function releaseImages(root: ParentNode) {
  root.querySelectorAll('img').forEach((img) => observer?.unobserve(img));
}
export function initImages(root: ParentNode = document) {
  root
    .querySelectorAll<HTMLImageElement>('img[data-image-fallback],img[data-banner-image]')
    .forEach((img) => {
      if (img.dataset.imageBound) return;
      img.dataset.imageBound = 'true';
      const fail = () => {
        if (img.dataset.imageAlternative && !img.dataset.alternativeTried) {
          img.dataset.alternativeTried = 'true';
          if ('bannerImage' in img.dataset) img.classList.add('poster-backdrop');
          img.src = img.dataset.imageAlternative;
          return;
        }
        if (img.dataset.failed) {
          img.hidden = true;
          return;
        }
        img.dataset.failed = 'true';
        if (img.dataset.imageFallback) {
          img.src = img.dataset.imageFallback;
          img.classList.add('image-failed');
        } else {
          img.hidden = true;
          img.closest('.detail-banner,.hero-slide')?.classList.add('neutral-banner');
        }
      };
      img.addEventListener('error', fail);
      if (img.dataset.imageSrc) {
        if (observer) observer.observe(img);
        else {
          void revealImage(img);
        }
      }
      if (img.complete && img.naturalWidth === 0) fail();
    });
}
window.addEventListener('online', () => {
  retryFailedImages();
  document
    .querySelectorAll<HTMLImageElement>('img[data-image-id][data-image-bound]')
    .forEach((img) => {
      if (observer) observer.observe(img);
      else void revealImage(img);
    });
});
