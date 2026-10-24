export const ratingStarPath =
  'M12 2.5l2.94 5.96 6.58.96-4.76 4.64 1.12 6.55L12 17.52l-5.88 3.09 1.12-6.55L2.48 9.42l6.58-.96z';
export function ratingValue(score: number | null | undefined) {
  return typeof score === 'number' && Number.isFinite(score) && score > 0 && score <= 10
    ? score.toFixed(1)
    : null;
}
export const ratingLabel = (value: string) => `Оценка пользователей Shikimori: ${value} из 10`;
export function ratingBadge(score: number | null | undefined, small = false) {
  const value = ratingValue(score);
  if (!value) return null;
  const badge = document.createElement('span');
  badge.className = `card-badge${small ? ' rating-small' : ''}`;
  badge.title = ratingLabel(value);
  badge.setAttribute('aria-label', badge.title);
  const star = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  star.setAttribute('viewBox', '0 0 24 24');
  star.setAttribute('aria-hidden', 'true');
  const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
  path.setAttribute('d', ratingStarPath);
  star.append(path);
  const number = document.createElement('span');
  number.textContent = value;
  badge.append(star, number);
  return badge;
}
