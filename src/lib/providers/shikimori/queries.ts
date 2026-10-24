export const ANIME_FIELDS = `
 id name russian english japanese synonyms kind status rating score episodes episodesAired duration
 airedOn { year month day date } releasedOn { year month day date } nextEpisodeAt url
 genres { id name russian kind } studios { id name }
 poster { originalUrl mainUrl }
 related { relationKind relationText anime { id name russian url } }
`;
export const ANIMES_QUERY = `query AniRezikCatalog($page: PositiveInt, $limit: PositiveInt, $ids: String, $status: AnimeStatusString, $season: SeasonString, $search: String) {
 animes(page: $page, limit: $limit, ids: $ids, status: $status, season: $season, search: $search, order: ranked, censored: true) { ${ANIME_FIELDS} }
}`;
