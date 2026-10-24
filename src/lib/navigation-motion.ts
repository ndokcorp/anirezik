export function initNavigationMotion() {
  const nav = document.querySelector<HTMLElement>('.desktop-nav');
  const pill = nav?.querySelector<HTMLElement>('.nav-highlight');
  if (!nav || !pill) return;
  const active = nav.querySelector<HTMLElement>('a.active');
  const measure = (link: HTMLElement) => ({ x: link.offsetLeft, width: link.offsetWidth });
  const move = (link: HTMLElement) => {
    const rect = measure(link);
    pill.style.width = `${rect.width}px`;
    pill.style.transform = `translateX(${rect.x}px)`;
    pill.style.opacity = '1';
  };
  if (active) {
    move(active);
    try {
      const from = JSON.parse(sessionStorage.getItem('anirezik:nav-motion') || 'null');
      sessionStorage.removeItem('anirezik:nav-motion');
      if (
        from &&
        Number.isFinite(from.x) &&
        Number.isFinite(from.width) &&
        !matchMedia('(prefers-reduced-motion: reduce)').matches
      )
        pill.animate(
          [
            { transform: `translateX(${from.x}px)`, width: `${from.width}px` },
            { transform: pill.style.transform, width: pill.style.width },
          ],
          { duration: 360, easing: 'cubic-bezier(.22,1,.36,1)' },
        );
    } catch {
      /* Optional motion state only. */
    }
  }
  nav.querySelectorAll<HTMLAnchorElement>('a').forEach((link) => {
    link.addEventListener('click', () => {
      if (link.getAttribute('href')?.startsWith('#')) return;
      try {
        if (active) sessionStorage.setItem('anirezik:nav-motion', JSON.stringify(measure(active)));
      } catch {
        /* Private mode. */
      }
      move(link);
    });
  });
  new ResizeObserver(() => {
    if (active) move(active);
  }).observe(nav);
}
