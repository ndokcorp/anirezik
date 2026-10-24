export function initSurfaceControls(root: ParentNode = document) {
  root.querySelectorAll<HTMLElement>('.chronology-section').forEach((section) => {
    if (section.dataset.arrowsBound) return;
    const track = section.querySelector<HTMLElement>('.franchise-track');
    if (!track) return;
    section.dataset.arrowsBound = 'true';
    const viewport = document.createElement('div');
    viewport.className = 'chronology-viewport';
    track.before(viewport);
    viewport.append(track);
    const buttons = [-1, 1].map((direction) => {
      const button = document.createElement('button');
      button.className = `chronology-arrow ${direction < 0 ? 'previous' : 'next'}`;
      button.setAttribute('aria-label', direction < 0 ? 'Предыдущие тайтлы' : 'Следующие тайтлы');
      button.innerHTML = `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="${direction < 0 ? 'm15 5-7 7 7 7' : 'm9 5 7 7-7 7'}"/></svg>`;
      button.addEventListener('click', () =>
        track.scrollBy({
          left: direction * Math.max(160, track.clientWidth * 0.75),
          behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'instant' : 'smooth',
        }),
      );
      viewport.append(button);
      return button;
    });
    const update = () => {
      const overflow = track.scrollWidth > track.clientWidth + 2;
      buttons.forEach((button) => (button.hidden = !overflow));
      buttons[0].disabled = track.scrollLeft <= 2;
      buttons[1].disabled = track.scrollLeft + track.clientWidth >= track.scrollWidth - 2;
    };
    track.addEventListener('scroll', update, { passive: true });
    new ResizeObserver(update).observe(track);
    update();
  });
}
export function bindNews() {
  const dialog = document.querySelector<HTMLDialogElement>('#site-news');
  document.querySelector('[data-open-news]')?.addEventListener('click', () => dialog?.showModal());
  document.querySelector('[data-close-news]')?.addEventListener('click', () => dialog?.close());
  dialog?.addEventListener('click', (event) => {
    if (event.target === dialog) {
      const r = dialog.getBoundingClientRect();
      if (
        event.clientX < r.left ||
        event.clientX > r.right ||
        event.clientY < r.top ||
        event.clientY > r.bottom
      )
        dialog.close();
    }
  });
}
