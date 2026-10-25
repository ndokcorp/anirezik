/** Shared local-list menus: cancellation-safe motion and keyboard/outside dismissal. */
export function libraryMenu(wrapper: HTMLElement, button: HTMLButtonElement, menu: HTMLElement) {
  let animation: Animation | undefined;
  let revision = 0;
  const duration = () => (matchMedia('(prefers-reduced-motion: reduce)').matches ? 0 : 160);
  function close(focus = false) {
    if (button.getAttribute('aria-expanded') !== 'true') return;
    const current = ++revision;
    animation?.cancel();
    menu.inert = true;
    button.setAttribute('aria-expanded', 'false');
    animation = menu.animate(
      [
        { opacity: 1, transform: 'translateY(0)' },
        { opacity: 0, transform: 'translateY(-6px)' },
      ],
      { duration: duration() },
    );
    void animation.finished
      .then(() => {
        if (current === revision) menu.hidden = true;
      })
      .catch(() => {});
    if (focus) button.focus({ preventScroll: true });
  }
  function open(focus = false) {
    revision++;
    animation?.cancel();
    menu.hidden = false;
    menu.inert = false;
    button.setAttribute('aria-expanded', 'true');
    const rect = button.getBoundingClientRect();
    menu.dataset.side =
      innerHeight - rect.bottom < menu.offsetHeight + 16 && rect.top > menu.offsetHeight + 16
        ? 'up'
        : 'down';
    animation = menu.animate(
      [
        { opacity: 0, transform: 'translateY(-6px)' },
        { opacity: 1, transform: 'translateY(0)' },
      ],
      { duration: duration() },
    );
    if (focus) menu.querySelector<HTMLButtonElement>('[aria-pressed=true],button')?.focus();
    else button.focus({ preventScroll: true }); // Safari pointer clicks need explicit focus for Escape.
  }
  button.addEventListener('click', () =>
    button.getAttribute('aria-expanded') === 'true' ? close() : open(),
  );
  wrapper.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') {
      event.preventDefault();
      close(true);
    }
    if (event.key === 'Tab') close();
    if (['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) {
      event.preventDefault();
      if (button.getAttribute('aria-expanded') !== 'true') {
        open(true);
        return;
      }
      const options = [...menu.querySelectorAll<HTMLButtonElement>('button')];
      const current = options.indexOf(document.activeElement as HTMLButtonElement);
      const next =
        event.key === 'Home'
          ? 0
          : event.key === 'End'
            ? options.length - 1
            : (current + (event.key === 'ArrowDown' ? 1 : -1) + options.length) % options.length;
      options[next]?.focus();
    }
  });
  document.addEventListener('click', (event) => {
    if (!wrapper.contains(event.target as Node)) close();
  });
  return { close };
}
