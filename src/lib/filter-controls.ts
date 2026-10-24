export function closeFilters(dialog: HTMLDialogElement) {
  if (dialog.dataset.closing) return;
  dialog.dataset.closing = 'true';
  const animation = dialog.animate(
    [
      { opacity: 1, transform: 'translateY(0)' },
      { opacity: 0, transform: 'translateY(12px)' },
    ],
    { duration: matchMedia('(prefers-reduced-motion: reduce)').matches ? 0 : 180 },
  );
  void animation.finished.then(() => {
    dialog.close();
    delete dialog.dataset.closing;
  });
}
export function initFilterControls(dialog: HTMLDialogElement) {
  dialog
    .querySelectorAll<HTMLSelectElement>('select:not([hidden]):not(:disabled)')
    .forEach((select) => {
      const wrapper = document.createElement('div');
      wrapper.className = 'custom-select';
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'select-trigger';
      button.setAttribute('aria-haspopup', 'listbox');
      button.setAttribute('aria-expanded', 'false');
      button.setAttribute(
        'aria-label',
        select.parentElement!.firstChild?.textContent?.trim() || 'Выбрать',
      );
      const list = document.createElement('div');
      list.className = 'select-options';
      list.setAttribute('role', 'listbox');
      list.hidden = true;
      list.id = `${select.id}-options`;
      button.setAttribute('aria-controls', list.id);
      const sync = () => {
        button.textContent = (select.selectedOptions[0]?.textContent || 'Выбрать') + ' ⌄';
        list
          .querySelectorAll<HTMLElement>('[role=option]')
          .forEach((item, i) =>
            item.setAttribute('aria-selected', String(i === select.selectedIndex)),
          );
      };
      const close = () => {
        list.hidden = true;
        button.setAttribute('aria-expanded', 'false');
      };
      Array.from(select.options).forEach((option) => {
        const item = document.createElement('button');
        item.type = 'button';
        item.setAttribute('role', 'option');
        item.textContent = option.textContent;
        item.addEventListener('click', () => {
          select.value = option.value;
          select.dispatchEvent(new Event('change', { bubbles: true }));
          close();
          button.focus();
        });
        list.append(item);
      });
      button.addEventListener('click', () => {
        const opening = list.hidden;
        dialog.querySelectorAll<HTMLElement>('.select-options').forEach((n) => (n.hidden = true));
        dialog
          .querySelectorAll('.select-trigger')
          .forEach((n) => n.setAttribute('aria-expanded', 'false'));
        list.hidden = !opening;
        button.setAttribute('aria-expanded', String(opening));
        if (opening) list.querySelector<HTMLButtonElement>('[aria-selected=true]')?.focus();
      });
      wrapper.addEventListener('keydown', (event) => {
        const options = Array.from(list.querySelectorAll<HTMLButtonElement>('button'));
        const i = options.indexOf(document.activeElement as HTMLButtonElement);
        if (event.key === 'Escape' && !list.hidden) {
          event.preventDefault();
          event.stopPropagation();
          close();
          button.focus();
        }
        if (['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) {
          event.preventDefault();
          list.hidden = false;
          button.setAttribute('aria-expanded', 'true');
          options[
            event.key === 'Home'
              ? 0
              : event.key === 'End'
                ? options.length - 1
                : Math.max(
                    0,
                    Math.min(options.length - 1, i + (event.key === 'ArrowDown' ? 1 : -1)),
                  )
          ]?.focus();
        }
      });
      document.addEventListener('click', (event) => {
        if (!wrapper.contains(event.target as Node)) close();
      });
      select.classList.add('select-native');
      select.tabIndex = -1;
      select.setAttribute('aria-hidden', 'true');
      select.after(wrapper);
      wrapper.append(button, list);
      select.addEventListener('change', sync);
      select.addEventListener('filter-reset', sync);
      sync();
    });
}
