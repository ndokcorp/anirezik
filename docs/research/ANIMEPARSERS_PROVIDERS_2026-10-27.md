# AnimeParsers × AniRezik — 27.10.2026

Изучены исходники commit **cac4c83e03e43f2829506ef202a1279a4e0b78bf**, а не только README. Готовые парсеры не устанавливались/не исполнялись; читались текст и AST. Каталог kdk_tokns, get_token, прокси, декодеры и извлечение защищённых потоков не использовались. [Выборка 32 ID](../diagnostics/ANIMEPARSERS_COHORT_2026-10-27.json), [результаты по каждому ID](../diagnostics/ANIMEPARSERS_AUDIT_2026-10-27.json). Это целевая выборка (30 прежних AnimeGO кандидатов + 54744 и 39535), не статистическая оценка всего каталога.

## Исходники и точное сопоставление

| Источник | Что действительно реализовано в исходниках | Идентификатор |
|---|---|---|
| Kodik | parser_kodik.py: base_search_by_id, get_embed_link, get_info_from_embed; api_kodik.py: shikimori_id, translation_id/type, season/episode, with_seasons/episodes и ограничения стран | Прямой Shikimori ID; provider release/translation ID сохраняются отдельно |
| AnimeGO | parser_animego.py и async: поиск по названию, меню provider/translation/embed, реальные episode ID | Внутренний AnimeGO ID; нужна сверка названия/алиасов/года/формата/сезона. Число в bridge URL не объявляется универсальным контрактом Shikimori |
| AniBoom | aniboom_get_stream разбирает data-parameters HTML и извлекает DASH/HLS | Полученный embed, не каталог с Shikimori lookup |
| CVH | cvh_get_playlist/get_stream_by_id используют конфигурацию publisher/aggregator стороннего сайта и возвращают HLS/DASH/MP4 | Внутренние CVH ID; стороннюю конфигурацию не копируем. Отдельный официальный Content API поддерживает mal_id, но прямой shikimori_id не найден; MAL не отождествляется с Shikimori |
| AniLiberty | api_aniliberty.py — wrapper публичного API, строковый поиск, запросы по release ID; metadata содержит shikimori.id | Наш индекс Shikimori → AniLiberty release ID, дополнительно проверяются имя/год/формат. Нельзя передавать Shikimori ID как release ID |
| Jut.su | parser_jutsu.py не имеет поиска; get_anime_info группирует ссылки сезонов/фильмов, get_mp4_link читает HTML source | URL страницы и ручная точная сверка; позиция сезона в массиве не является Shikimori ID |

У Kodik оба клиента библиотеки отправляют POST **form body**. В AniRezik было POST+query; исправлено на application/x-www-form-urlencoded body. Это исправление транспорта, а не исправление неверного ключа. get_link/get_m3u8_playlist_link с извлечением/преобразованием внутренних данных Kodik не перенесены. _match_cvh_studio в библиотеке допускает совпадение по подстроке; наш адаптер использует реальные namespaced translation IDs, а не подобный выбор студии.

Исходники: [Kodik](https://github.com/YaNesyTortiK/AnimeParsers/blob/cac4c83e03e43f2829506ef202a1279a4e0b78bf/src/anime_parsers_ru/parser_kodik.py), [Kodik API](https://github.com/YaNesyTortiK/AnimeParsers/blob/cac4c83e03e43f2829506ef202a1279a4e0b78bf/src/anime_parsers_ru/api_kodik.py), [AnimeGO/CVH/AniBoom](https://github.com/YaNesyTortiK/AnimeParsers/blob/cac4c83e03e43f2829506ef202a1279a4e0b78bf/src/anime_parsers_ru/parser_animego.py), [AniLiberty](https://github.com/YaNesyTortiK/AnimeParsers/blob/cac4c83e03e43f2829506ef202a1279a4e0b78bf/src/anime_parsers_ru/api_aniliberty.py), [Jut.su](https://github.com/YaNesyTortiK/AnimeParsers/blob/cac4c83e03e43f2829506ef202a1279a4e0b78bf/src/anime_parsers_ru/parser_jutsu.py).

[MIT-лицензия](https://github.com/YaNesyTortiK/AnimeParsers/blob/cac4c83e03e43f2829506ef202a1279a4e0b78bf/LICENSE) относится к коду, не к видео/доступу провайдеров. При существенном заимствовании надо сохранять notice/license; здесь библиотека не вендорилась.

## Результаты доступа и воспроизведения

| Источник | 54744, TV 2024 | Озвучки/серии в выборке | iframe на AniRezik | Поток в собственном Player | Реальный результат / причина |
|---|---|---|---|---|---|
| Kodik | API вернул401: наличие релиза неизвестно | Сохранённый 39535: 13 озвучек + 2 варианта субтитров, 11 серий | Да, сохранённый 39535 | Direct HLS/MP4 не подключены | Серия AnimeVost дошла до 00:14/23:47, 640×360, после рекламы. Новый API lookup остановлен |
| AnimeGO | В полном снимке 3075 метастраниц точное имя/алиас не найдено; вне sitemap отсутствие не утверждается | Опубликованный кеш: 23 аниме, 256 номеров эпизодов, 55 вариантов перевода по тайтлам, 15 сырых подписей | Только фактически выданный собственный /cdn-iframe bridge | Отдельный direct-media API не включён | Solo Leveling/Amber: основное player-media 4,90 с из 1422 с, 640×360 на Pages после рекламы |
| AniBoom | Точный embed не получен | В шести прежних пилотах заявлены 12 вариантов; это меню, не видеопроверка | Самостоятельный партнёрский embed/условия для нашего домена не получены | Библиотека извлекает DASH/HLS из HTML; этот путь не активирован | Root HTTP200/ACAO* не доказывают CORS потока, срок ссылок или разрешение |
| CVH | Свой Content API без Bearer отвечает401 | Через AnimeGO учтён строкой выше, повторно не суммируется | Работает именно AnimeGO/CVH bridge | Самостоятельный API HLS/DASH/MP4 не включён | Чужие publisher IDs/конфигурация plapi не используются |
| AniLiberty | Точный релиз не получен по трём запросам | Свежие метаданные 32 ID: у 28 пригодные HLS-эпизоды, 324 записи, собственная AniLibria | В текущей записи прав iframe не включён | Да, разрешённый HLS | «Твоё имя»: таймер продвинулся до 53,2 с, duration6395,69, 1280×720/readyState4. Ошибка до нажатия запуска не является доказанным постоянным отказом |
| Jut.su | Публичная страница есть, 12 ссылок серий; первая требует Jutsu+ | Названия студий/самостоятельные разрешённые треки не подтверждены | Страница серии присылает SAMEORIGIN; партнёрский embed не получен | MP4 не извлекался | Подписка/авторизация/ограничения не обходились |

[Серверная диагностика Kodik](https://github.com/ndokcorp/anirezik/actions/runs/40407372800): только собственный Actions Secret KODIK_API_TOKEN, правильный form body, один запрос 54744 → HTTP401 → остановка. Остальные 31 ID не выдаются за отрицательные результаты. Токен не находится в браузере, отчётах и URL. Для расширения нужен действующий ключ в существующем Secret; повторять отклонённую авторизацию не следует.

AniLiberty: один bulk-запрос по известным provider IDs и шесть поисков для четырёх ID вне индекса. Затем отдельно проверены отвергнутый результат поиска и три HLS manifest. По запросу «Али» вернулся другой Tokidoki: release8044, Shikimori38145, 2019, Doukyonin wa Hiza, Tokidoki, Atama no Ue — он отклонён. У 54744/39535/56838 точный релиз не установлен; 41468 имеет TV/ONA-конфликт и ноль доступных эпизодов у AniLiberty, поэтому не подменяет разрешённый CVH.

Jut.su: [страница аниме](https://jut.su/tokidoki-alya/), [первая серия с Jutsu+](https://jut.su/tokidoki-alya/episode-1.html). HTTP200 не означает открытый просмотр. Не использовались «старый плеер», подписка, зеркала, авторизация или извлечение MP4 для обхода этого требования.

## CORS, сроки, права

Три фактических видео в этом аудите: **32281/AniLiberty, 39535/Kodik, 52299/AnimeGO-CVH**, origin https://ndokcorp.github.io. Проверялись таймер/длительность основного видео/размеры; реклама не засчитывалась. Это не проверка каждой из 324/256 серий и всех озвучек. Скриншоты оставлены локально в `.cache/provider-review/*-proof.png`, не импортируются как активы сайта.

- Ифрейм сам по себе не требует CORS для отображения, но требует допустимых CSP/XFO/parent origin. Он не перекрашивается и не меняет рекламу/внутреннее управление. Same-origin policy не обходится. Действуют существующие VideoRights/exact origins и ограничения региона.
- AniLiberty HLS проверен реальным браузером на Pages, без подмены Origin/Referer. Три серверных manifest без Origin вернули200/#EXTM3U и не прислали ACAO; это само по себе не доказывает ни успех, ни отказ браузерного CORS. Успех для 32281 подтверждён самим браузером.
- max-age=3600 у manifest — TTL HTTP-кеша, не доказательство срока действия URL. cache_ttl=36000 в AnimeParsers — TTL кеша библиотеки, не гарантия 10 часов работы медиассылки. Permanent-link contract для извлекаемых Aniboom/CVH/Jutsu потоков не получен. AniLiberty получает свежие разрешённые данные при просмотре; новые прямые медиассылки в публичный кеш не записывались.
- HLS.js/HTML5 уже есть. MP4 технически может идти через native video при разрешённом источнике; DASH отдельно не реализован. Нет подтверждённого нового DASH/MP4, ради которого следовало менять Player.
- [Прямое партнёрство CVH](https://cdnvideohub.com/) описывает заявку/кабинет и условия площадки: 2000 посетителей/сутки, Метрика, первое место среди плееров. Это не автоматически полученный доступ через разрешённый AnimeGO bridge. На root AniBoom обнаружен только бизнес-контакт, без API/embed-контракта. Новые права не выводятся из технической доступности HTML или лицензии парсера.

## Минимальная архитектура

Сейчас отдельный Python backend не требуется: существующие Actions/статический кеш/публичный AniLiberty API достаточны. Если партнёр требует секрет и оперативную выдачу: один Python API, SQLite, один worker. GET /v1/sources/shikimori/54744 читает подтверждённое Shikimori → provider release ID → сезон/серии/translation IDs. Ключи — server env/secret store, никогда в JSON/URL браузера/логах. Возвращаются только согласованные embed или разрешённые playback URLs; TTL/negative cache/квоты берутся из договора. Retry/backoff ограничены, 401/403/429/challenge останавливают соответствующий источник. CORS собственного metadata API — зарегистрированный origin AniRezik. Это не универсальный video/CORS proxy для обхода медиасервера. Сохраняется интерфейс VideoProvider/VideoRights.

## Изменения и счётчики

Исправлен серверный Kodik POST form; два профильных offline-теста проверяют body/бюджет/очередность/запрет redirect и остановку на auth без раскрытия ключа. npm run check: 0 ошибок/предупреждений/hints. Production build /anirezik успешен, 30704 numeric URL сохранены. Большой повторный browser-suite не запускался. GUI, AniLiberty, Kodik39535, AnimeGO/CVH и хранилища не переписывались; пустые адаптеры не добавлялись.

- Сравнены **32 ID**; 28 пригодных свежих AniLiberty metadata-результатов. 23 CVH кеша — существующая конфигурация, не 23 новых видеотеста. У 30 из 32 уже был настроен хотя бы один источник.
- **Три** включённых адаптера: aniliberty, kodik, animego-cvh. AnimeGO/CVH — одна интеграция, не две. Реальное воспроизведение проверено на трёх разных аниме в этом аудите.
- **Новых включённых провайдеров: 0; новых подключённых аниме: 0; новых подключённых уникальных озвучек: 0.** Старые 55 CVH вариантов и 15 Kodik вариантов (два — субтитры) не выдаются за прирост. Подписи AniLiberty/AniLibria и generic multi-voice не объявляются независимыми студиями.
- Для 54744 найден кандидат Jut.su (12 серий), но он не подключён из-за доступа/условий встраивания. Это страница, не готовый источник AniRezik.
- Полная очередь 0.5.0 отдельно продолжает обход серий после всех 3075 метастраниц, без второго worker. Её промежуточные ready-кеши не объявляются опубликованными плеерами. Это исследование не является выпуском 0.5.0.
