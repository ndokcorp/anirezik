const observer =
  typeof IntersectionObserver === 'function'
    ? new IntersectionObserver(
        (entries) => {
          for (const entry of entries)
            if (entry.isIntersecting) {
              const img = entry.target as HTMLImageElement;
              if (img.dataset.imageSrc) {
                img.src = img.dataset.imageSrc;
                delete img.dataset.imageSrc;
              }
              observer?.unobserve(img);
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
          img.src = img.dataset.imageSrc;
          delete img.dataset.imageSrc;
        }
      }
      if (img.complete && img.naturalWidth === 0) fail();
    });
}
