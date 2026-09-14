# 2026-09-14 — phase-2-catalog

Агент: `unnamed` · ветка: `feat/cat-1-collection-source` · начато: `00:06`

---

## 1. Задачи

**TASK-1 · <что просили одной строкой>**
Статус: сделано / частично / отменено / упёрлось.
<Что вышло. Если частично — что именно не сделано и почему.>

**TASK-9 · Сделать CLI обнаруживаемым для агента — braze commands --json, не дожидаясь каталога**
Статус: сделано. 159 тестов (было 152).

Слава: «we need to make it discoverable, add this and mb some more improvements that we can
quickly add to make it more usable for ai agent, don't overcomplicate, can improve later».
`NEED-14` и `NEED-15` отложены им же: «1, 2 later».

Это `CAT-7` наполовину, вынутый вперёд каталога. Ключевое решение:
**команда обходит живое дерево Commander, а не список, написанный руками**
(`packages/cli/src/commands/commands.ts`). Поэтому, когда каталог начнёт регистрировать
команды циклом (`CAT-6`), они появятся в выдаче сами, и второго списка, который надо держать
в согласии с первым, не заводится.

Что отдаёт `braze commands --json`: имя и версию CLI, глобальные флаги, дерево команд
(путь уже разбит на массив — `["runs","list"]`, — плюс usage, аргументы, опции, choices и
значения по умолчанию) и **таблицу кодов возврата**. Последнее — то, ради чего агенту вообще
нужен машинный формат: он ветвится по `$?`, а не разбирает текст.

Одна ловушка, которую пришлось обойти явно: у Commander `option.required` значит «если флаг
указан, у него должно быть значение», а `option.mandatory` — «флаг обязан быть указан».
Отдать наружу `required` как есть значило бы, что агент прочитает `--profile` как
обязательный и откажется работать без него. В выдаче поля называются `takesValue` и
`mandatory`, на это есть тест.

Для человека (`--output pretty`) печатается плоская таблица «команда — описание», а не всё
дерево: в терминале дерево нечитаемо, а агенту оно и так приходит в JSON.

Побочно: аргументам `runs show` и `runs path` дописаны описания — они были пустые и теперь
видны в выдаче. README поправлен: `braze commands --json` переехал из «приедет в Фазе 2» в
«работает сегодня», и добавлен раздел «For an agent», который честно говорит, что пути
эндпоинтов агенту всё ещё надо подсказывать руками.

**TASK-10 · Машинные ошибки в JSON-режиме и указатель на список эндпоинтов Braze**
Статус: сделано. 163 теста (было 159).

Слава ответил на `NEED-16`: «1 А» — ошибка уходит в **stderr** одним JSON-объектом. Записано
в `DECISIONS.md`. И спросил: «can we for now point to the docs in help etc?»

**Ошибки.** `run()` в `packages/cli/src/program.ts` теперь держит ссылку на program и в
catch резолвит формат вывода тем же `resolveOutputFormat`, что и команды, — не вторым
правилом, которое разошлось бы с первым. В машинном режиме печатается
`{"error":{code, message, ...details}}`, в pretty — прежняя строка `code: message`.

Важное, что даёт `BrazeErrorDetails` даром: `retryable`, `retryAfterMs`, `httpStatus`,
`attempts`, `requestId`, `runId`. Проверено на живом 404 от Braze — приходит
`{"code":"not_found","httpStatus":404,"retryable":false,"attempts":1,"requestId":"…"}`.
Агенту этого хватает, чтобы решить, повторять ли, и через сколько, — кода возврата не хватало.

**stdout при отказе пуст** — проверено на настоящем бинарнике (`wc -c` = 0), тест в
`tests/machine-output.test.ts` это держит.

**Указатель на документацию.** Заведён `packages/cli/src/documentation.ts` — один источник
ссылок, чтобы help и `braze commands` не разъехались. Ссылка ведёт на
https://www.braze.com/docs/api/home: проверено curl'ом, что это страница «Braze API Guide» и
в ней действительно перечислены пути (`/campaigns/list`, `/users/track`, `/canvas/list`).
Соседний `/docs/api/endpoints` отдаёт 974 байта заглушки — не туда.

Видно в двух местах: хвост `braze api --help` и блок `endpoints` в `braze commands --json`,
где прямо сказано `discoverable: false` и почему. Когда каталог приедет, этот блок — то, что
надо будет поменять на список.

**TASK-11 · Готовый промпт для агента — docs/agent-prompt.md**
Статус: сделано. Слава: «give me a brief prompt to give to my agent».

Промпт намеренно **не перечисляет команды**, а велит их спросить (`braze commands --json`).
Перечисляющий промпт устарел бы в день, когда каталог зарегистрирует типизированные команды;
этот останется верным.

Основная ценность — вторая половина, грабли. Каждая из них стоит агенту потерянного хода, а
две выглядят как баги, которые хочется обойти, если не знать, что они намеренные: боевой
профиль отказывает в записи (`NEED-6`) и `/users/export/ids` — чтение, которое отклоняется
как запись (`FIND-13`).

Отдельно сказано, чего НЕ делать после отказа: `outcome_unknown` — единственное состояние,
где повтор даёт двойную запись, и именно его агент повторить попытается.

Все утверждения промпта проверены на собранном бинарнике, не по памяти:
- вызов `node <repo>/packages/cli/dist/bin/braze.js commands --json` → код 0;
- `--dry-run` на профиле с `readOnly: true` работает и печатает результат → код 0;
- `--query id=a --query id=b` → `validation_error` с внятным текстом про `CAT-3`;
- `braze api POST /users/export/ids` → `permission_error`, то есть грабля на месте;
- `braze runs show <id>` на настоящем id из `runs list` → код 0.

**TASK-12 · braze как настоящая команда в PATH; pnpm 11 убрал link --global**
Статус: сделано. Слава: «I need braze installed as cli locally».

Два препятствия, оба замерены, а не предположены:

1. **`pnpm link --global` в pnpm 11 больше нет.** `pnpm link --help` (версия 11.20.0) говорит
   `Usage: pnpm link <dir>` и флага `--global` не содержит вовсе; попытка отдаёт
   `ERR_PNPM_LINK_BAD_PARAMS`. Теперь `pnpm link` линкует пакет ВНУТРЬ другого проекта, а не
   наружу в PATH. Это ровно та же ловушка, что `BUG-2`: рецепт из памяти устарел, а ошибка
   выглядит как опечатка в параметрах.

2. **`tsc` не ставит бит исполнения.** `dist/bin/braze.js` выходил как `-rw-rw-r--`, хотя
   шебанг `#!/usr/bin/env node` в нём есть. По симлинку из PATH такой файл не запускается.

Сделано:
- в `packages/cli/package.json` шаг сборки дописан: после `tsc` — `chmodSync(..., 0o755)`
  через node, а не `chmod`, чтобы не сломать сборку на Windows. Важно, что это в сборке:
  иначе бит терялся бы при каждом `pnpm build`, и команда ломалась бы молча;
- симлинк `~/.local/share/pnpm/bin/braze` → `dist/bin/braze.js`. `$PNPM_HOME/bin` уже был в
  PATH, новый каталог не заводился.

Проверено из `/tmp`, то есть вне репозитория: `braze --version` → `0.0.0`,
`braze commands --json` → код 0, `braze api GET /campaigns/list --query page=0 --json` →
настоящие кампании из боевого Braze, `braze api GET /nope --json` → структурированная ошибка
с `requestId`. То есть `brazecli-core` через workspace-симлинки резолвится и по глобальной
ссылке тоже.

Записано в README разделом «Install it locally», промпт для агента переписан на голое `braze`.

**TASK-13 · CAT-2 — снимок коллекции в spec/ с провенансом и отказом писать не-коллекцию**
Статус: сделано. 176 тестов (было 164).

`pnpm spec:sync` → `scripts/sync-spec.mjs`. В репозитории теперь лежит
`spec/braze.postman.json` (99 запросов, 32 папки, 5413 строк) и `spec/provenance.json`.
`sourceSha256` в провенансе — `a55735628a08…` — совпал с тем, что был замерен при разведке
(`FIND-14`), то есть коллекция за сутки не менялась.

Три решения, которые стоит знать:

**Снимок переформатирован, а не сохранён как пришёл.** Braze отдаёт одну строку на 565 КБ;
диф из одной строки ревьюеру не говорит ничего, а ради читаемого дифа всё это и коммитится
(§7 требований). Отсюда два хеша: `sourceSha256` — от полученных байт, им ловится изменение
на стороне Braze; `sha256` — от записанного файла, чтобы артефакт проверялся сам по себе.

**Синк, которому нечего менять, не пишет НИЧЕГО**, включая `syncedAt`. Иначе каждый запуск
давал бы диф из одной строки с новой датой, и «в spec/ есть изменения» перестало бы что-либо
значить. Проверено тестом: второй прогон печатает `unchanged` и не трогает `syncedAt`.

**`--from <файл>`** проверяет ручной экспорт вместо загрузки. Это запасной путь из плана на
случай `RISK-2` — и одновременно шов, через который написаны тесты, поэтому **ни один тест не
ходит в сеть**.

Отказы (это главное, ради чего скрипт вообще имеет право перезаписывать закоммиченный файл):
разметка вместо JSON, битый JSON, тело без схемы Postman, пустая коллекция, папки без
запросов. Все пять отвергаются с кодом 1 и **ничего не пишут** — проверено и вручную, и
тестами. Записать в `spec/` HTML-страницу ошибки — единственный по-настоящему плохой исход.

`spec:check` НЕ повешен на PR намеренно: он ходит в сеть, и CI, зависящий от аптайма Postman,
покупает не безопасность, а мигание. Гейт на исчезнувшую операцию — это `catalog:check`
(`CAT-5`), и он работает по закоммиченному снимку.

Побочно: `tests/fixtures/spec` исключён из biome — фикстуры намеренно сломаны, линтовать их
бессмысленно, а `broken.json` линтер вообще не может разобрать.

**TASK-14 · CAT-3 — генератор каталога: 99 запросов Braze → 95 операций**
Статус: сделано. 190 тестов (было 176).

`pnpm catalog:generate` → `packages/core/src/operations/generated.ts`. Читать каталог надо
через `catalog` из `packages/core/src/operations/index.ts`, а не из сгенерированного файла:
именно в `index.ts` `CAT-4` будет накладывать оверрайды.

**Идентификатор: `путь.с.by-id.маркерами.глагол`** — `campaigns.list.get`,
`catalogs.by-id.items.by-id.get`. Выбран замером, не вкусом: четыре схемы прогнаны по
настоящим 99 запросам, и только эта дала **ноль** столкновений между РАЗНЫМИ эндпоинтами
(A: путь без параметров — 4 столкновения; B: A+метод — 6; C: маркеры без метода — 6; D — 0).

Красивая схема «самый короткий уникальный id» отвергнута сознательно. Она дала бы
`users.track` вместо `users.track.create`, но `Operation.id` обещан стабильным между
регенерациями, а «самый короткий уникальный» **переименует** `users.track` в тот день, когда
Braze добавит второй метод на этот путь. Стабильность дороже красоты.

**Имя команды — три уровня**: голый путь → путь+глагол → путь с маркерами+глагол, каждый
следующий только если предыдущий столкнулся. Третий уровень совпадает по форме с id, то есть
уникален по построению, и эскалация всегда завершается. 21 операция из 95 потребовала уровня
выше первого. На `command` обещания стабильности НЕТ — §10 требований прямо говорит, что имена
команд правятся оверрайдом.

**Единственное число не выводится.** В требованиях `braze campaign list` (§779), а в примере
оверрайда там же — `["users","track"]`; документ сам себе противоречит. А наивное срезание «s»
превращает `canvas` в `canva`. Поэтому пути идут как есть, а `campaign` вместо `campaigns` —
это оверрайд по одному, как и советует §6 хендоффа.

**Генератор — обычный JS, типизирован его ВЫВОД.** `tsc` проверяет `generated.ts` при сборке
core, поэтому ошибка генератора, выдавшая неверное поле, ломает сборку, а не остаётся до
теста, которого никто не написал. Форматирование вывода — через сам biome
(`biome format --stdin-file-path`), а не руками: единственное, что оставалось угадывать, — где
biome переносит длинное описание, и своя реализация разошлась бы с ним на первом же случае.
Форматирование ДО сравнения в `--check` — то, без чего `catalog:check` падал бы всегда.

**Ничего не теряется молча.** Четыре эндпоинта из `FIND-15` схлопываются в одну операцию
каждый и печатаются в отчёте прогона. Два РАЗНЫХ эндпоинта, дающих один id, роняют генератор
с печатью обоих путей — проверено фикстурой `colliding.json` (`/thing/{name}` и
`/thing/{number}`).

Побочно: `Operation` расширен полями `pathParameters`, `queryParameters`, `sourceId`.
`pathParameters` — то единственное, по чему агент вообще может понять, что подставлять в путь.
`sourceId` (id запроса Postman) — для сопоставления операций между регенерациями, это его
роль из §9, а НЕ роль публичного `id`, который по документации в `operation.ts` читаемый и
точечный.

Бандл core вырос с 15 835 до 50 801 байта — это данные каталога. Переносимость не пострадала,
гейт и smoke под bun зелёные.

`/users/export/ids` по-прежнему генерируется как запись (`FIND-13`), и это закреплено тестом,
чтобы переворот в `CAT-4` был виден, а не случился молча.

**TASK-15 · CAT-4 — оверрайды и слияние; FIND-13 закрыт и проверен вживую**
Статус: сделано. 200 тестов (было 190).

`packages/core/src/operations/overrides.ts` — семь исправлений, каждое с полем `reason`,
которое объясняет, зачем оно существует. Слияние и проверки — `operations/index.ts`.

**Ключ — `Operation.id`, а не путь**, вопреки наброску §10 требований. Путь не уникален:
на `/catalogs` висят и GET, и POST, поэтому оверрайд по пути молча накрыл бы оба.

**Что оверрайду менять НЕЛЬЗЯ:** `id`, `method`, `path`. Это то, чем операция опознаётся;
оверрайд, умеющий их двигать, при следующей перетряске коллекции Braze незаметно станет
оверрайдом чего-то другого.

Три проверки, каждая с тестом:
- **оверрайд, не нашедший операции, роняет сборку.** Эндпоинт переименовали — и классификация
  безопасности вроде `FIND-13` тихо перестала бы применяться. Это то, что ловится;
- **запись с `retryPolicy: "read-safe"` отвергается.** Ровно та проверка, которую
  `operation.ts` просит по имени: два источника правды о «можно ли повторить» — это способ
  получить один неверный;
- **`retryPolicy` перевыводится**, если оверрайд меняет `access` и не называет политику.
  POST-образное чтение, оставленное на `never`, сохранило бы неверный ответ.

**`FIND-13` закрыт.** `braze api` теперь сперва смотрит в каталог и только потом падает на
`rawOperation` — именно это имел в виду комментарий в `api.ts` словами «исправляется
типизированной операцией каталога, а не догадкой здесь». Сам `rawOperation` не тронут, он
остаётся запасным выходом для путей, которых в каталоге нет.

Проверено вживую на боевом профиле с пометкой readOnly:
- `braze api POST /users/export/ids` → **201 от Braze**, `{"users":[],"invalid_user_ids":["nope"]}`.
  Раньше отказывался. Это экспорт, ничего не записано;
- `braze api POST /users/track --confirm` → по-прежнему `permission_error`, код 5;
- `braze api DELETE /catalogs/nope --confirm` → по-прежнему отказ.
То есть послабление получили ровно POST-образные чтения, а не запись вообще.

Совпадение пути — только точное. `/catalogs/my-catalog` к шаблону `/catalogs/{catalog_name}`
не приводится и уходит в `rawOperation`, где судит метод, — что для шаблонного пути и так
верно: ни одно из POST-образных чтений Braze не имеет параметра в пути.

Бандл core 50 801 → 60 586 байт.

**TASK-16 · CAT-5 — отчёт о покрытии и catalog:check как гейт CI**
Статус: сделано. 203 теста (было 200).

`docs/catalog-coverage.md` генерируется вместе с каталогом; `pnpm catalog:check` проверяет
ОБА файла и повешен на CI. Сети не трогает — читает закоммиченный снимок, — поэтому гейтит
каждый PR, не завися от аптайма Postman. Этим он отличается от `spec:check`, который в CI
сознательно не висит.

**Главная строка отчёта — `unclassified or ambiguous`, и она обязана быть нулём.** Считаются
операции, которые Braze сделал записью, но путь читается как запрос (`export`, `list`,
`details`, `data_series`, `data_summary`, `info`), и ни один оверрайд не высказался.
Это форма `FIND-13`.

Проверено, что гейт настоящий: если временно убрать оверрайд с `users.export.ids.create`,
генератор падает и называет ровно `POST /users/export/ids`. То есть `FIND-13` был бы пойман
автоматически.

**`status` из списка слов убрано намеренно, и это стоило трёх ложных срабатываний.** Первый
прогон обвинил `POST /email/status`, `POST /subscription/status/set` и его v2. Проверил по
описаниям в самой коллекции: «set the email subscription state», «batch update the
subscription state» — все три настоящие записи. Слово, дающее три ложных из трёх, научило бы
игнорировать гейт, а гейт, на котором не останавливаются, бесполезен (§12).

Побочная находка из тех же описаний: `/subscription/status/set` и его v2 ограничены
**50 пользователями за запрос** — это сказано прозой в коллекции и нигде не структурировано.
Добавлено оверрайдом как `batch: { subscription_groups: 50 }`. Всего оверрайдов теперь 9.

Отчёт также разбивает операции по ресурсам (у `catalogs` их 13, у `users` 11) и перечисляет
все исправленные вручную со ссылкой на файл с причинами.

**TASK-17 · CAT-6 — команды регистрируются циклом по каталогу; критерий готовности фазы выполнен**
Статус: сделано. 213 тестов (было 203).

**`braze campaigns list --json` работает и отдаёт байт в байт то же, что
`braze api GET /campaigns/list --json`.** Это и есть критерий «done» всей фазы. Команду
`campaigns` никто не писал руками.

Сначала **вынес исполнение в `packages/cli/src/execute.ts`** и перевёл на него `api.ts` — 203
теста остались зелёными, то есть поведение не поехало. Только после этого построил
генерируемые команды поверх того же пути. Две реализации «отказать записи на readOnly, завести
каталог прогона, закрыть его на ЛЮБОМ выходе» разошлись бы, и разошлись бы тихо.

**Параметр пути — именованная опция, а не позиционный аргумент.** `--catalog-name <value>`,
обязательная. Агент, строящий вызов из `braze commands --json`, не должен знать порядок, а
`--help` при этом называет каждый параметр.

**`--query` остался у каждой команды.** Примеры Postman — не схема (§11), поэтому вытащенные
из них ключи это удобство, а не полный список; без `--query` типизированная команда была бы
слабее `braze api`. Проверено: `--query undocumented=1` доходит.

Два дефекта, найденных прогоном, а не рассуждением:

**Имя команды не может быть одновременно группой.** `sms invalid-phone-numbers` (GET) и
`sms invalid-phone-numbers remove` (POST) — Commander отказывается регистрировать такое и
роняет ВЕСЬ процесс, то есть ломается не одна команда, а вся программа. Уникальности полных
имён, которую я проверял в `CAT-3`, недостаточно: нужно отсутствие отношения «префикс».
Исправлено в генераторе четвёртым проходом и закреплено утверждением там же и тестом.

**`braze catalogs by-id items by-id get` — негодная поверхность.** Маркер `by-id` нужен
идентификатору ради стабильности, но не команде. Добавлен третий уровень эскалации: то, что
отличает `/items` от `/items/{id}`, — это «много против одного», и CLI должен так и говорить:
`catalogs items list` и `catalogs items get`, `delete-many` и `delete`. Слово `by-id` исчезло
из команд полностью (было 11 штук).

Побочно: блок `endpoints` в `braze commands --json` переписан — он утверждал
`discoverable: false`, что после этой нитки неправда. Теперь `discoverable: true`,
`runnableCommands: 103` (95 из каталога плюс 8 рукописных листьев) и по-прежнему названный
запасной выход `braze api`. Всего в выдаче 154 команды с учётом групп.

Замечание, не исправлял: `braze catalogs get` возвращает СПИСОК каталогов — группа `/catalogs`
разрешилась на втором уровне и до «list» не дошла. Это то, что §10 требований и предлагает
править оверрайдом по одному.

**TASK-18 · Шаг 5 фазы 2 (CAT-9, CAT-7, CAT-11) — план написан, ждёт ревью**
Принял тред по хендоффу `docs/plans/2026-09-14-phase-2-handoff.md`. Холодный старт сошёлся:
дерево чистое на `25bf4aa`, 228 тестов зелёные, `catalog:check` — «up to date, 95 operations,
9 overridden».

**Новый файл плана не заводил.** Работу уже держит `docs/plans/2026-09-13-phase-2-catalog.md`
(§2, шаги 5 и 6), а второй файл на ту же работу — ровно то, что запрещает §7 `HANDOFF.md`.
План шага 5 дописан туда же, в §2.

Что сделано в этом заходе:
- §2 шаг 5 расписан целиком: порядок, решения, тест-план, открытые вопросы.
- Шапка плана поправлена: стояло «`CAT-1` и `CAT-2` сделаны, дальше `CAT-3`», при том что
  тела шагов 3 и 4 в том же файле уже помечены ✅.
- Порядок внутри шага развёрнут: `CAT-9` перед `CAT-7`, вопреки строчке «then `CAT-7`» в
  бэклоге. Причина записана в плане, не молча.
- Три находки: `FIND-17` (откуда берутся тела запросов), `FIND-18` (`CAT-10` означает две
  разные задачи), `FIND-19` (три страничных эндпоинта не помечены страничными).
- `FIND-18` исправлен по месту в трёх документах, с пометкой «поправка».

Кода не написано ни строки — план ждёт ревью владельца, как требует `CLAUDE.md`.

## 2. Вопросы Славы

**ASK-1 · «<его вопрос дословно>»**
<Ответ, который был дан. Если ответ оказался неверным — правка на месте с пометкой
«поправка», прошлый текст оставить видимым.>

## 3. Находки

**SEC-1 · <заголовок находки>**
<Что не так, где — `file:line`, и чем это грозит. Отдельно: что проверено своими глазами,
а что предположение.>
- **SEC-1.a** — <подпункт>

**FIND-16 · Репозиторий на GitHub был пустой — main туда никогда не уезжал; первый push сделал веткой по умолчанию мою feature-ветку**
Обнаружено 14.09 при попытке открыть PR: `gh pr create` отказал словами «No commits between
main and feat/cat-1-collection-source, Base ref must be a branch». Причина — на `origin`
не было **ни одной** ветки: `git ls-remote --heads origin` до моего push печатал пустоту.

То есть вся Фаза 1 (15 коммитов) жила только локально, хотя `NEED-0` ещё 13.09 зафиксировал,
что репозиторий создан и публичный, и что CI гоняется на каждом PR. CI не гонялся ни разу —
гонять было нечего.

Что из этого вышло и как исправлено:
- мой `git push -u origin feat/cat-1-collection-source` стал первым содержимым репозитория,
  и GitHub автоматически назначил **feature-ветку веткой по умолчанию**;
- исправлено сразу: `git push origin main:main`, затем
  `gh api -X PATCH repos/leemour/braze-cli -f default_branch=main`. Сейчас по умолчанию
  снова `main`, PR #1 открыт из ветки в `main`;
- новых данных публикация не раскрыла: ветка и так содержала всю историю `main`, а
  `gh api .../secret-scanning/alerts` вернул пустой список.

Чего это стоит на будущее: **все гейты CI, описанные в документации, до сегодня не
исполнялись ни разу.** Зелёные проверки, на которые ссылаются документы Фазы 1, — это
локальные прогоны. Первый настоящий прогон GitHub Actions — на PR #1, и его результат стоит
посмотреть, прежде чем полагаться на «CI гейтит каждый PR» как на факт.

**BUG-2 · CI падал на каждом прогоне: pnpm 11 переименовал onlyBuiltDependencies в allowBuilds, старое написание читается, но сборку не разрешает**
Первый в истории репозитория прогон GitHub Actions (см. FIND-16) упал в обоих джобах, и на
`main` тоже — то есть это не моя правка. Оба падения на шаге `pnpm install --frozen-lockfile`:

    [ERR_PNPM_IGNORED_BUILDS] Ignored build scripts: esbuild@0.28.2, lefthook@2.1.12

Воспроизведено локально с первого раза: чистый клон + `pnpm install --frozen-lockfile` даёт
ровно ту же ошибку. В рабочем каталоге её не видно, потому что там сборки уже одобрены и
записаны в `node_modules/.modules.yaml` — то есть **зелёные локальные прогоны ничего не
говорили о чистой машине**.

Причина — не догадка: pnpm сам дописал в `pnpm-workspace.yaml` клона блок

    allowBuilds:
      esbuild: set this to true or false
      lefthook: set this to true or false

Ключ переезжал дважды: `pnpm.onlyBuiltDependencies` в package.json (pnpm 10) → корневой
`onlyBuiltDependencies` в `pnpm-workspace.yaml` → `allowBuilds` с ЯВНЫМ булевым значением на
пакет (pnpm 11). `FIND-2` поймал первый переезд и записал вывод «настройка переехала в
pnpm-workspace.yaml» — это было верно тогда и устарело сейчас.

Коварство ровно то же, о чём предупреждал `FIND-2`, но с обратным знаком: `pnpm config get
onlyBuiltDependencies` по-прежнему печатает список, будто настройка работает. Читается — да,
разрешает сборку — нет.

Исправлено: `allowBuilds: {esbuild: true, lefthook: true}`. Проверено на чистом клоне —
установка проходит без ошибки, `node_modules/.bin/esbuild --version` отвечает `0.28.2`,
lefthook ставит хуки.

**BUG-3 · Исходники packages/cli/src/runs/ никогда не попадали в git — правило runs/ в .gitignore съело каталог с кодом**
Найдено 14.09 на втором прогоне CI (после BUG-2). Типизация упала:

    packages/cli/src/commands/api.ts(7,26): error TS2307:
      Cannot find module '../runs/run.js' or its corresponding type declarations.

Причина: строка 8 `.gitignore` — `runs/` без якоря. В git такой шаблон совпадает **на любой
глубине**, поэтому под него попал не только каталог артефактов прогона, ради которого правило
писалось, но и `packages/cli/src/runs/` — исходный код. `git check-ignore -v` называет правило
прямо: `.gitignore:8:runs/`.

Что реально отсутствовало в репозитории: `run.ts` (4278 байт) и `run.test.ts` (4351 байт) —
то есть весь слой артефактов прогона из Фазы 1, на который ссылаются `api.ts` и `runs.ts`.

Почему не замечали: локально файлы на диске есть, поэтому и сборка, и 152 теста зелёные.
Увидеть это можно было только на чистой машине, а CI до сегодня не запускался ни разу
(`FIND-16`). Два дефекта усилили друг друга: без BUG-2 установка не доходила до типизации,
а без первого прогона CI никто не смотрел.

Проверено, что это единственный такой случай: `git status --ignored --short -- packages/`
показывает из игнорируемого только `dist/`, `node_modules/` и `*.tsbuildinfo` — всё остальное
сборочный вывод.

Исправлено: правило заякорено в корень (`/runs/`), файлы добавлены в индекс. Секретов в них
нет; единственное совпадение на «secret» — `Bearer secret-key` в тесте, который как раз
проверяет, что ключ вырезается из журнала.

**Третье следствие, вылезло на коммите:** Biome по умолчанию уважает `.gitignore`, поэтому
эти два файла не проверялись и линтером тоже. Как только они стали отслеживаемыми,
pre-commit хук отказался их принимать — форматирование в `run.ts:102` не соответствовало
правилам. `pnpm lint` до этого печатал «Checked 57 files», теперь печатает 59.

Это стоит запомнить как общее правило: **в этом репозитории игнорирование в git означает
невидимость и для линтера.** Файл, случайно попавший под шаблон, выпадает разом из трёх
проверок — сборки на чистой машине, типизации и линта, — и ни одна из них об этом не
скажет, пока файл не вернут.

**UX-2 · Ссылка на документацию Braze была только в braze api --help, а не в корневом**
Слава: «I don't see a link to braze api docs when I do braze».

Проверено: `braze` без аргументов и `braze --help` печатали список команд и на этом
заканчивались. Ссылку я поставил только в хвост `braze api --help` (`TASK-10`) — то есть
в том месте, куда попадёт человек, который уже догадался, что нужна команда `api`. А
догадаться как раз и не из чего: типизированных команд нет, и из корневого help не видно,
что путь надо взять откуда-то ещё.

Исправлено: тот же блок в корневом help — обе ссылки (индекс эндпоинтов и раздел про
авторизацию с лимитами) плюс одна строка про `braze commands --json` для агента. Источник
ссылок один (`packages/cli/src/documentation.ts`), поэтому разъехаться они не могут.

Тест в `tests/machine-output.test.ts` проверяет наличие ссылки во ВСЕХ трёх местах сразу —
`braze`, `braze --help`, `braze api --help`, — потому что забыть одно из них уже получилось.

**BUG-4 · Генератор не извлёк НИ ОДНОГО query-параметра: коллекция кладёт их в строку URL, а не в структурный массив Postman**
Найдено сразу после `CAT-3`, при подготовке оверрайдов. Дефект в том, что я только что сдал.

Замер: `grep -c queryParameters packages/core/src/operations/generated.ts` → **0**. При этом
40 запросов из 99 имеют строку запроса в URL. Причина: `queryOf()` читал только структурный
`url.query` — задокументированную форму Postman, — а в этой коллекции **все 99 URL являются
простыми строками**, и `url.query` нет ни у одного запроса.

То есть §9 требований («извлечь query parameters») не выполнялось вообще, и агент, которому
`braze commands --json` обещает рассказать про операцию, не узнавал бы, что у
`/campaigns/list` есть `page`, `include_archived`, `sort_direction` и `last_edit.time[gt]`.

Почему не поймал тестом: фикстура `small.json`, которую я писал сам, использовала структурную
форму — ту, которую поддерживал код. Классическая ошибка: тест проверял мою реализацию, а не
настоящие данные. Тест на настоящем каталоге («у campaigns.list.get есть параметр page»)
поймал бы это сразу, и теперь он есть.

Исправлено: разбираются обе формы, структурная и строковая, с приоритетом структурной.
Примеры-значения вида `{{campaign_identifier}}` выбрасываются — это плейсхолдер самой
коллекции, а не значение, которое можно отправить. Теперь параметры есть у 38 операций.

**BUG-5 · Эндпоинт профиля сейчас rest.fra-01.braze.com — такого хоста нет, не работает вообще ничего**
Замечено 14.09 при вопросе Славы про снятие блокировки записи. `braze profile list --json`
печатает `https://rest.fra-01.braze.com`. Ещё несколько часов назад в этой же сессии там было
`https://rest.fra-01.braze.eu`.

Замер, а не догадка:
- `braze campaigns list --json` → `network_error`, «request failed before a response arrived»;
- `curl https://rest.fra-01.braze.eu/campaigns/list` → **401** (хост настоящий, просто без ключа);
- `curl https://rest.fra-01.braze.com/campaigns/list` → **Could not resolve host**.

То есть сломано не «частично», а полностью: ни чтения, ни записи. `NEED-5` зафиксировал
`.eu` замером, и это по-прежнему верно — европейские кластеры Braze живут на `braze.eu`,
на `braze.com` их нет.

Почти наверняка это `UX-1` во второй раз: чтобы поменять ОДНО поле профиля, надо заново
подать все, включая `--endpoint`, — и эндпоинт был перепечатан с ошибкой. См. следующую
запись.

**UX-3 · Чтобы снять readOnly, надо заново указать --endpoint — и именно на этом эндпоинт ломается**
`braze profile add` — единственный способ изменить профиль, и он перезаписывает объект
целиком: `config.profiles[name] = { restEndpoint: flags.endpoint, readOnly: ... }`
(`packages/cli/src/commands/profile.ts:61`). При этом `--endpoint` объявлен
`requiredOption`.

Следствие: чтобы поменять один флаг, надо заново набрать URL кластера по памяти. Ключ при
этом команда бережёт сознательно — в коде есть комментарий «Re-running add to correct an
endpoint must not demand the key again», — а вот эндпоинт такой защиты не получил, хотя
ошибиться в нём ровно так же легко и цена выше: не работает ничего.

Это уже случилось дважды: `UX-1` (вставленный дословно плейсхолдер) и `BUG-5` (сегодня,
`.com` вместо `.eu`).

Чинится дёшево: сделать `--endpoint` необязательным при обновлении существующего профиля и
сохранять прежний, как уже делается с ключом. Тогда снятие readOnly — это
`braze profile add production` без аргументов вовсе. Не делал: Слава не просил, и это
меняет поведение команды, которой он пользуется прямо сейчас.

**SEC-2 · BRAZE_CONFIG_DIR не изолирует брелок: мои ручные проверки записали fake-key в настоящий брелок Слава под именем staging**
Найдено 14.09, когда Слава сказал, что завёл профиль `staging`, а `braze profile list` его не
показал. В `config.json` профиля нет, **а ключ под именем `staging` в брелоке есть**.

Отпечаток сохранённого ключа — `cdefebd9a557`. Это ровно `sha256("fake-key")`, то есть моя
тестовая строка из проверок `profile add` часом раньше. Проверял я так:

    BRAZE_CONFIG_DIR="$tmp" BRAZE_API_KEY=fake-key braze profile add staging --endpoint ...

**`BRAZE_CONFIG_DIR` переносит только `config.json`.** Брелок один на машину, и
`credentials.write` при `credentialStorage: "auto"` пишет именно в него. Поэтому конфигурация
ушла во временный каталог и исчезла вместе с ним, а ключ остался в настоящем брелоке
пользователя — и остался бы там навсегда.

Чем это плохо на самом деле: не тем, что строка `fake-key` секретна, а тем, что запись
**молча притворяется настоящим профилем**. Если бы Слава завёл `staging` по-настоящему
позже, он бы получил либо чужой ключ, либо непонятный отказ авторизации, и искал бы причину
в Braze, а не в брелоке.

В коде защита от этого есть — `memoryKeyring()`, и в журнале за 13.09 прямо записано, что
«ни один тест не трогал настоящий брелок» сделано свойством кода. Но это про тесты внутри
процесса. **Ручная проверка собранного бинарника проходит мимо этой защиты целиком**, и
ничто о том не предупреждает.

Убрано: запись `brazecli:staging` удалена после сверки отпечатка (удалял только при точном
совпадении с `fake-key`, иначе бы не трогал).

Как проверять руками впредь — заводить временный конфиг с `"credentialStorage": "file"` ДО
первого `profile add`, тогда ключи лягут в `credentials.json` рядом с конфигом и уедут вместе
с каталогом. Либо не проверять `profile add` вручную вообще, раз на него есть тесты.

**SEC-3 · Я уничтожил оба боевых ключа Славы: BRAZE_CONFIG_DIR изолирует конфиг, но НЕ брелок**
**Случилось 14.09, виноват я.** Проверяя новую грамматику профилей, я гонял
`BRAZE_CONFIG_DIR=$(mktemp -d) BRAZE_API_KEY=k braze profile add staging …` и
`… profile add production …`, считая, что временный каталог конфигурации делает прогон
изолированным.

Он изолирует конфигурацию и не изолирует брелок. Запись в брелоке адресуется парой
(служба, профиль) — `new Entry("brazecli", "staging")` — и о каталоге конфигурации не знает
ничего. Поэтому обе команды перезаписали НАСТОЯЩИЕ ключи Славы строкой `k`.

Замер, подтверждающий: отпечатки обоих профилей стали `8254c329a928`, и
`sha256("k") = 8254c329a928`. До этого staging был `3c196f2189e3`, production —
`a4e3da366419`. Оба теперь отдают `401 Invalid API key`.

**Ключи не восстанавливаются**: брелок отдаёт значение, но старое затёрто, а Braze свои ключи
повторно не показывает. Слава заводит оба заново в дашборде.

Что чинит: `keyringService(configDir, env)` в `packages/cli/src/auth/credentials.ts` —
пока `BRAZE_CONFIG_DIR` не задан, служба называется `brazecli` как раньше; как только задан,
она становится `brazecli:<каталог>`. То есть временный каталог конфигурации теперь даёт и
временное пространство имён в брелоке — ровно ту изоляцию, которую все и так предполагают.

Проверено: тот же самый вызов с `BRAZE_API_KEY=zzz` больше не трогает `brazecli:staging`,
отпечаток настоящей записи не изменился.

Урок шире одного бага: **«я подменил переменную окружения, значит это песочница» — проверяемое
утверждение, а не данность.** Ровно та же ошибка по форме, что `BUG-4`: фикстура проверяла мою
реализацию, а не настоящие данные. Здесь временный каталог проверял мою модель изоляции, а не
настоящую.

**UX-4 · braze … | head печатает стек EPIPE вместо тихого выхода**
Замечено 14.09 при проверке блока холодного старта в хендоффе:
`braze commands --json | head -c 90` печатает данные, а затем стек
`Error: write EPIPE ... Node.js v24.19.0`.

Причина обычная для Node: `head` закрывает канал, следующая запись в stdout получает EPIPE,
необработанное событие `error` на сокете роняет процесс с трассировкой.

Почему это стоит починить, а не списать на шелл: `| head`, `| less`, `| jq .[0:5]` — то, как
человек и смотрит большую JSON-выдачу, а у нас она большая (154 команды). Плюс трассировка
идёт в stderr вместе с нашими же диагностиками, и агент, читающий stderr как JSON-ошибку,
получит мусор.

Чинится обработчиком `EPIPE` на `process.stdout` в `packages/cli/src/bin/braze.ts`: тихий
выход с кодом 0, потому что данные-то отданы, их просто перестали читать.

Не делал: нашёл в момент написания хендоффа, правка в точке входа заслуживает отдельного
теста и своего PR, а не довеска к сдаче.

**FIND-17 · Braze's example bodies are prose in JSON clothing — 32 of 48 are real JSON, 16 are annotated text**
Measured against the committed snapshot (`spec/braze.postman.json`), not inferred:

- 99 requests, **48 carry a non-empty raw body** — 43 POST, 4 PUT, 1 PATCH. No GET or DELETE
  has one, so a body is a write-side fact only.
- **32 of the 48 parse as strict JSON**, and **none of those 32 contains a `{{…}}` Postman
  placeholder**. They are real, usable example payloads. Compact, all 32 together are 9 652
  bytes — the cost of embedding them in `generated.ts` (1 104 lines today).
- **The other 16 are not JSON at all.** Braze writes documentation into the value position:
  `"name": (required, string) Must be less than 100 characters,` and
  `"state": (optional) Choose \`active\` or \`draft\`,` plus `//` comments.
- **A tolerant parser for that dialect would be a BUG-4 repeat.** The regular shape
  `"key": (required|optional[, type]) description` matches only **55 of the 145** quoted-key
  lines in those 16 bodies — 38%. The rest are nested objects and plain `"string"` values. A
  parser that handles 38% and silently mishandles the remainder is exactly the failure §3 of
  the phase plan names.

**What this settles.** The handoff's §6 recommendation — "the body schema lives next to the
override, because Postman does not give it" — rests on a premise that is false for two thirds
of the cases. Postman *does* give 32 of them. So: derive `bodyExample` for the 32, carry the
16 as opaque text labelled with where it came from, and leave handwritten schemas to `CORE-10`
where the validation-level decision already lives.

**FIND-18 · CAT-10 names two different tasks; the Valibot reading is the wrong one and has spread to three documents**
`CAT-10` is cited with two incompatible meanings, which means one of them is quietly
unowned work.

Settled with `git log -S`, not by reading a second document:

- The scaffold commit `c322326` created **both** rows, distinctly:
  `CAT-10` = "Smoke tests generated from the collection's own examples" (P3), and
  `CORE-10` = "Valibot validation with the three levels" (P2).
- The `CAT-4` commit `e7b3a5a` then wrote "Valibot schemas and PII fields still to come with
  `CAT-10`" into `BACKLOG.md:112`. That is the error — it meant `CORE-10`.
- It spread from there: `docs/plans/2026-09-13-phase-2-catalog.md:143` ("Valibot schemas and
  validation levels (`CORE-10`, `CAT-10`)") and
  `docs/plans/2026-09-14-phase-2-handoff.md:49` ("`CAT-10` / `CORE-10` схемы Valibot").

**Cost if left.** Someone closes `CORE-10`, sees `CAT-10` also described as Valibot, marks it
done too — and the smoke tests generated from the collection's own examples leave the backlog
without ever having been built.

Corrected in place in all three documents, marked as corrections.

**Smaller, same class:** `CORE-10` stands as two separate rows in `BACKLOG.md` — line 87 under
"Core — the portable client" and line 101 under "Left over from Phase 1". The second carries
the fuller text. Two rows is two answers to "is it done".

**FIND-19 · Three paged endpoints are not classified as paged, and no gate notices**
Six operations in the catalog carry a `page` query parameter. **Only three declare
`pagination: "page"`** — the three that happen to have a handwritten override.

Verified by running the built catalog (`packages/core/dist/index.js`), not read off a document:

| operation | `page` parameter | `pagination` declared |
|---|---|---|
| `campaigns.list.get` | yes | `page` |
| `canvas.list.get` | yes | `page` |
| `segments.list.get` | yes | `page` |
| `events.list.get` | yes | **none** |
| `feed.list.get` | yes | **none** |
| `purchases.product-list.get` | yes | **none** |

The three without it are `/events/list`, `/feed/list` and `/purchases/product_list` — Braze's
own example URLs for them are `?page=3`, `?page=1` and `?page=1`.

**What it costs today.** `paginationNote` in `packages/cli/src/execute.ts:96` returns early
unless `pagination === "page"`, so those three print no "you are on page N of at most M"
line — the exact ambiguity that note exists to remove. A caller cannot tell a full page from
the last one.

**What it will cost at `CAT-11`.** `--paginate` keys off the same field, so it would silently
do nothing on three of the six paged endpoints. Silently, because nothing checks this: the
`catalog:check` gate covers unclassified **access** (`CAT-5`), and has no equivalent for
pagination.

**Inferred, not verified:** that all three are paged the same 0-or-1-indexed way as the other
three, and that their page size is also 100. Braze's example URLs show `page=` but the page
size is prose in their docs, which is why the existing three needed an override at all. Do not
copy `pageSize: 100` across without checking each.

The fix is two lines of work and one gate, and it belongs with `CAT-11`.

**UX-5 · Каждый флаг запроса в help описан словами «query parameter» — 134 из 134, и уйти за настоящим ответом некуда**
Слава заметил на `braze campaigns list --help`. Флаг `--page` там **есть**; бесполезно то, что
про него написано.

```
--page <value>               query parameter (e.g. 0)
--include-archived <value>   query parameter (e.g. false)
--sort-direction <value>     query parameter (e.g. desc)
```

Измерено по собранному каталогу:

- **134 query-параметра, описание есть у 0.** Все до одного печатаются как «query parameter».
- У 91 есть пример значения, у **43 нет и его** — эти выглядят просто «query parameter».
- **У всех 95 операций `documentationUrl` пуст.** То есть из help нельзя уйти на страницу Braze,
  где ответ на самом деле написан.

**Это не баг генератора.** В коллекции **ноль** структурных записей `url.query` — Braze кладёт
параметры в сырую строку URL (это и был `BUG-4`), а описаний к ним не даёт нигде. Взять их
оттуда физически неоткуда; `catalog.ts:60` честно подставляет заглушку.

**Дёшево чинится, и без раздувания.** 134 слота — это всего **43 разных имени**, и 33 из них
встречаются больше чем в одной команде, покрывая 124 слота из 134:

```
14 x length    14 x ending_at   8 x app_id    6 x limit
 6 x offset     6 x page        5 x sort_direction  5 x unit …
```

То есть **один общий словарик на 43 строки описывает каждый флаг в каждой из 95 команд**.
Не 134 оверрайда по операциям, а одна таблица по имени параметра — по имени, потому что `page`
означает одно и то же в `campaigns list` и в `segments list`.

Отдельный маленький вопрос того же свойства: у `length` и `ending_at` (самые частые, 14 команд
каждый) смысл зависит от эндпоинта, так что для них словарика по имени может не хватить и
понадобится точечное уточнение. Проверить на паре команд, прежде чем обещать.

**BUG-6 · В help команды «изменить товары каталога» написано, что она их удаляет — ошибка самого Braze, приехавшая к нам дословно**
```
$ braze catalogs items --help
  update-many [options]   Use this endpoint to delete multiple items in your catalog.
```

Команда `catalogs items update-many` — это `PATCH /catalogs/{catalog_name}/items`, правка
товаров. В help написано «delete».

**Источник — сама коллекция Braze, не наш генератор.** В снимке
`spec/braze.postman.json` у запроса `Edit multiple catalog items` описание начинается словами
`Use this endpoint to delete multiple items in your catalog.` Это опечатка Braze: соседний
`Delete multiple catalog items` описан теми же словами, из него и скопировали.

**Чем опасно.** Описание попадает в `braze catalogs items --help`, в `braze commands --json`
и дальше в `docs/commands.md` (`CAT-8`). Агент, выбирающий команду по описанию, прочитает
«delete» и либо не вызовет правку, либо вызовет её, думая, что удаляет. Неверное описание
опаснее отсутствующего.

**Чинится оверрайдом с `reason`** — ровно тот случай, для которого `overrides.ts` и заведён:
факт о Braze, которого коллекция не даёт правильно. Плюс к `CAT-9` проверка, которую стоит
добавить: описание операции, слово в слово совпадающее с описанием **другой** операции,
у которой другой метод, — это почти всегда копипаста на стороне Braze. Так найдутся остальные,
если они есть.

Не проверял, сколько ещё таких пар в коллекции. Это одна строка на `git grep` по снимку и
входит в `CAT-9`.

**FIND-20 · В коллекции НОЛЬ примеров ответов — это ломает и правило слияния страниц, и входные данные для CAT-10**
Проверял, можно ли по снимку узнать форму ответа страничных эндпоинтов. Ответ: нельзя.

```
requests: 99;  carrying any response example: 0;  total examples: 0
```

**Ноль из 99.** Ни у одного запроса в `spec/braze.postman.json` нет ни одного примера ответа —
в том числе ни у одного из шести страничных (`FIND-19`).

**Поправка к плану.** В §2 шага 5 я написал, что при слиянии страниц надо отказываться, если
массивов на верхнем уровне больше одного, «потому что сегодня ни одна операция в коллекции так
не отвечает». **Это была догадка, а не измерение** — проверить это по снимку не по чему.
Известна ровно одна форма: `/campaigns/list` отвечает `{"campaigns":[…],"message":"success"}`,
и это видели живьём в фазе 1. Про остальные пять неизвестно ничего. Формулировка в плане
исправлена по месту.

Следствие для `CAT-11`: ключ массива нельзя выбирать эвристикой «единственный массив» и на этом
успокоиться. Нужен `itemsKey` в операции, по умолчанию — эвристика, с отказом в рантайме при
неоднозначности. Форму каждого из шести придётся снять живьём: это шесть GET-запросов, правило
13 их не запрещает, но лучше по песочнице.

**Следствие для `CAT-10`, и оно серьёзнее.** Бэклог формулирует `CAT-10` как «смоук-тесты,
сгенерированные из примеров самой коллекции». **Примеров ответов в коллекции нет — генерировать
не из чего.** Примеры *тел запросов* есть, 48 штук (`FIND-17`), так что задача не пустая, но
она не та, что записана: из неё получаются тесты «запрос собирается», а не «ответ разбирается».

Ирония: `FIND-18` только что спас `CAT-10` от путаницы с `CORE-10`, и сразу выяснилось, что
`CAT-10` в нынешней формулировке невыполним. Строку надо переписать или закрыть — это вопрос
к владельцу, не моё решение, поэтому в бэклоге строка помечена 🚩, а не исправлена.

## 4. Вопросы к Славе

**NEED-1 · <вопрос с объектом внутри, а не тема>**
- Сейчас: <что есть прямо сейчас / что заблокировано>
- Варианты: **A** <…> · **B** <…>
- Я бы: **A** — <почему>
- Если не ответить: <что уедет не так или встанет>
- **Ответ Славы (YYYY-MM-DD):** <когда придёт>


**NEED-14 · Вливать ли PR #1 в main сейчас, или сначала посмотришь сам?**
- Сейчас: PR #1 открыт, CI зелёный впервые в истории репозитория. В нём три вещи: решение
  по источнику каталога (`NEED-13`, только документы) и два исправления, без которых CI не
  проходил вообще (`BUG-2` — установка, `BUG-3` — исходники Фазы 1 не были в git).
- Варианты: **A** влить сейчас, чтобы `main` наконец стал собираемым на чистой машине ·
  **B** сначала прочитать диф, влить потом.
- Я бы: **A**. Пока не влито, `main` не собирается нигде, кроме твоей машины, и любая
  следующая ветка стартует с той же поломки. Диф на 99% документы плюс два файла, которые
  ты уже писал сам.
- Если не ответишь: PR висит, `CAT-2` начинать не с чего — снимок коллекции ляжет в ветку
  поверх сломанного `main`.


**NEED-15 · Идти дальше в CAT-2 в этой же сессии, или остановиться на разведке?**
- Сейчас: `CAT-1` закрыт, источник известен и проверен. `CAT-2` — это `pnpm spec:sync`,
  который кладёт `spec/braze.postman.json` с источником, датой, id коллекции и sha256, плюс
  проверка «это вообще коллекция» перед перезаписью (`RISK-2`).
- Варианты: **A** сделать `CAT-2` сейчас, отдельной веткой от `main` после влития PR #1 ·
  **B** остановиться, ты смотришь `CAT-1` и решаешь.
- Я бы: **B**. Задание на эту сессию было названо разведкой, и разведка дала ответ. `CAT-2`
  пишет файл на 565 КБ в репозиторий и первым же коммитом фиксирует форму провенанса —
  это стоит начинать с чистого `main`, а не поверх непроверенного PR.
- Если не ответишь: ничего не ломается, нитка просто стоит на месте с закрытым `CAT-1`.

