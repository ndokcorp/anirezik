import { localPosterExperiment } from './image-policy';
export const experimentalPosters = localPosterExperiment(
  !!import.meta.env?.DEV,
  import.meta.env?.ANIREZIK_EXPERIMENTAL_SHIKIMORI_POSTERS,
  !!process.env.CI,
);
