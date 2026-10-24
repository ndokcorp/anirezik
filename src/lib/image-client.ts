import { loadImages } from './image-service';

async function revealImage(img: HTMLImageElement) {
  const id = Number(img.dataset.imageId);
  if (id > 0) {
    const images = await loadImages([id]);
    // Filters may have replaced this card while its package was in flight.
    if (!img.isConnected) return;
    const art = images[id];
    if (art) {
      img.dataset.imageSrc = art.poster;
      img.alt = `${art.imageLicenseStatus === 'original-ai' ? 'AI-иллюстрация, не официальный постер' : 'Постер'}: ${img.dataset.imageTitle || ''}`;
      if (art.imageAttribution) {
        const label = document.createElement('span');
        label.className = 'art-label';
        label.textContent =
          art.imageLicenseStatus === 'original-ai'
            ? 'AI · НЕОФИЦИАЛЬНЫЙ АРТ'
            : art.imageAttribution;
        img.parentElement?.append(label);
      }
    }
    delete img.dataset.imageId;
  }
  if (img.isConnected && img.dataset.imageSrc) {
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
