export function enhanceDetailMeta(root: ParentNode = document) {
  root.querySelectorAll<HTMLElement>('.detail-tags').forEach((tags) => {
    if (tags.dataset.enhanced) return;
    tags.dataset.enhanced = 'true';
    const items = tags.querySelectorAll<HTMLElement>(':scope > span');
    items.forEach((item, index) => {
      if (index === 2) {
        const text = item.textContent?.trim();
        item.classList.add('detail-status');
        item.dataset.state =
          text === 'Завершён'
            ? 'released'
            : text === 'Выходит'
              ? 'ongoing'
              : text === 'Анонс'
                ? 'announced'
                : 'unknown';
      }
      const kind =
        index === 0
          ? 'calendar'
          : index === 1
            ? 'tv'
            : index === 2
              ? 'status'
              : /серий|Серии:|Полнометражный/.test(item.textContent || '')
                ? 'episodes'
                : null;
      if (!kind) return;
      const icon = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
      icon.setAttribute('viewBox', '0 0 24 24');
      icon.setAttribute('width', '17');
      icon.setAttribute('height', '17');
      icon.setAttribute('aria-hidden', 'true');
      icon.setAttribute('fill', kind === 'status' ? 'currentColor' : 'none');
      icon.setAttribute('stroke', 'currentColor');
      icon.setAttribute('stroke-width', '1.7');
      const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
      path.setAttribute(
        'd',
        kind === 'calendar'
          ? 'M4 5h16v16H4zM8 2v6M16 2v6M4 11h16'
          : kind === 'status'
            ? 'M17 12a5 5 0 1 1-10 0 5 5 0 0 1 10 0'
            : kind === 'tv'
              ? 'M3 6h18v15H3zM8 2l4 4 4-4'
              : 'M3 5h18M3 11h12M3 17h8m4-3 6 4-6 4z',
      );
      icon.append(path);
      item.prepend(icon);
    });
  });
}
