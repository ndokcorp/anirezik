export const url = (path = '') =>
  `${import.meta.env.BASE_URL.replace(/\/$/, '')}/${path.replace(/^\//, '')}`;

export const animeRoute = (id: number) => {
  if (!Number.isSafeInteger(id) || id < 1) throw new Error('Invalid Shikimori ID');
  return `anime/${id}/`;
};
