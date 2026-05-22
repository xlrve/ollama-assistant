# Scorecard cleanup plan

Дата проверки: 2026-05-22

Источник: свежая публичная страница `https://community.obsidian.md/plugins/ollama-assistant#scorecard`.

Текущий статус:

- Score: 84%
- Health: Excellent
- Review: Caution
- Total automated scan issues: 452
- Release: 1.0.1

## Что сейчас горит

Passed:

- No obfuscated code detected.
- Build verified against source.
- `main.js` has verified GitHub artifact attestation.
- `styles.css` has verified GitHub artifact attestation.
- Vault Read disclosure is recognized.
- No vulnerable dependencies found.

Disclosures:

- Found 1 `fetch()` and 1 `XMLHttpRequest` call.
- Malware scan not available.
- Network requests scan not available.

Warnings:

- `Avoid !important`: 428
- `Unexpected property "all"`: 8
- `Avoid :has`: 4
- `Use the full 6-digit hex format`: 3
- `"builtin-modules" should be replaced with an alternative package`: 1
- Duplicate CSS selectors:
  - `.ollama-chat-container`
  - `.message-actions button.mod-cta`
  - `.context-tooltip`
  - `.buffer-tooltip`
  - `.ollama-install-tooltip`
  - `.add-context-menu`
  - `.model-selector-menu`

## Главный риск

Плагин уже давно написан, и часть поведения легко забыть. Поэтому задача не просто "убрать предупреждения", а не сломать:

- потоковый чат с Ollama;
- режимы Edit, Discuss, Web;
- добавление контекста из заметок;
- web search через DuckDuckGo;
- индикаторы статуса, скорости, буфера и ошибок;
- Lottie-анимации;
- настройки;
- внешний вид в разных темах Obsidian;
- работу в popout-окнах, если пользователь их использует.

## Что не трогаем без отдельного решения

Сложные или спорные предупреждения ведем в `SCORECARD_DEFERRED_RISKS.md`.

Правило: если предупреждение нельзя убрать без визуального или поведенческого регресса, не давить его любой ценой. Нужно занести его в deferred-файл с причиной, что ломалось, возможной безопасной заменой и ручным тестом.

### `fetch()`

Оставляем. Он нужен для streaming response от Ollama. `requestUrl` не заменяет этот сценарий без потери стриминга.

### `XMLHttpRequest`

Скорее всего приходит из `lottie-web`. В 1.0.1 это лучше оставить, потому что попытка заменить Lottie уже ломала анимации. Возвращаться к этому только отдельной задачей.

### Malware/network scan unavailable

Это не найденная проблема, а отсутствие результата от части сканера Obsidian. Исправлять в коде тут нечего, пока сканер не дает конкретный сигнал.

## План работ

### Этап 0. Зафиксировать точку возврата

Уже сделано:

- локальная backup-ветка: `backup/before-scorecard-cleanup-2026-05-22`
- коммит: `18885c6`

Перед каждой большой группой правок:

- создать отдельную рабочую ветку;
- не пушить релиз без ручного подтверждения;
- после сборки копировать плагин в тестовый vault и проверять вручную.

### Этап 1. Карта функционала и smoke-тесты

Перед чисткой scorecard составить короткую карту функций:

- какие команды/кнопки есть;
- какие режимы есть;
- какие настройки влияют на поведение;
- какие UI-элементы должны остаться видимыми;
- какие сетевые запросы являются нормальными.

Практический чеклист для ручной проверки хранится в `TESTING.md`.

Минимальный smoke-тест перед каждым релизом:

- плагин включается без ошибок;
- settings page открывается, Lottie-анимация видна;
- Ollama connection status обновляется;
- список моделей грузится;
- Edit mode принимает выделенный текст и возвращает результат;
- Discuss mode отвечает и сохраняет историю в пределах настройки;
- Web mode делает поиск через DuckDuckGo;
- streaming-ответ печатается постепенно, не целым куском;
- кнопки apply/copy/context/clear работают;
- error banner показывается при недоступном Ollama;
- стили не ломаются в светлой и темной теме.

### Этап 2. Самые безопасные scorecard-правки

Цель: уменьшить шум без изменения поведения.

Кандидаты:

- убрать зависимость `builtin-modules`, заменить на поддерживаемую альтернативу или простой локальный список external-модулей для esbuild;
- заменить короткие hex-цвета на 6-значные;
- упростить CSS shorthand, где Obsidian ругается на формат;
- объединить очевидные duplicate selectors, если правила действительно одинаковые или близкие.

Если простая правка ломает UI, вернуть поведение и перенести предупреждение в `SCORECARD_DEFERRED_RISKS.md`.

Проверка:

- `npm run build`;
- сравнить, что `main.js` не получил неожиданных сетевых доменов;
- ручной smoke-тест UI.

### Этап 3. Осторожная чистка CSS

Цель: снижать `!important` партиями, а не одним большим изменением.

Порядок:

1. Низкорисковые блоки: статичные тексты, отступы, неинтерактивные элементы.
2. Меню и тултипы.
3. Кнопки и input area.
4. Сообщения чата и markdown-rendered content.
5. Compact mode и responsive-части.

Правило:

- после каждой партии проверять внешний вид;
- если снятие `!important` меняет UI в темах Obsidian, вернуть именно это место;
- не гнаться за нулем любой ценой.

### Этап 4. Убрать `:has`

Scorecard ругается на 4 CSS-использования `:has`.

Безопасный путь:

- заменить CSS-зависимость от `:has` на классы состояния, которые выставляет TypeScript;
- например, контейнер режима получает класс активного режима, а CSS смотрит на этот класс.

Риск:

- можно сломать скругления/отступы в mode switcher.

Проверка:

- переключение Edit/Discuss/Web;
- compact mode;
- нижние радиусы контейнера сообщений.

### Этап 5. DOM API cleanup

Где безопасно:

- `createEl('div')` -> `createDiv()`
- `createEl('span')` -> `createSpan()`
- `document.createElement(...)` -> `activeDocument.createElement(...)` или Obsidian helper, если элемент сразу вставляется в Obsidian DOM.

Начинать с простых областей:

- settings UI;
- status bar;
- menus;
- static renderers.

Не начинать с:

- streaming renderers;
- reasoning blocks;
- turn renderer;
- error banner animation.

### Этап 6. Timer cleanup

Заменить оставшиеся голые `setTimeout` / `clearTimeout` в нашем коде на `activeWindow.setTimeout` / `activeWindow.clearTimeout`, где это возможно.

Не трогать таймеры внутри bundled `lottie-web`.

Проверка:

- streaming throttle;
- web search render throttle;
- typing animation in error banner;
- model menu / quick edits delayed close.

### Этап 7. Типизация `any`

Это отдельный большой этап, не для быстрого релиза.

Кандидаты:

- типы Ollama API responses;
- типы model info;
- типы событий;
- типы streaming chunks;
- типы tool calls.

Риск:

- можно случайно изменить runtime-поведение обработки ответов разных моделей.

## Предлагаемая версия 1.0.2

Для 1.0.2 взять только безопасный минимум:

- `builtin-modules`;
- hex/shorthand CSS;
- часть duplicate selectors;
- небольшая партия `!important`, где визуальный риск минимальный;
- функциональная карта и smoke-тест чеклист.

Не включать в 1.0.2:

- замену Lottie;
- замену `fetch`;
- массовую типизацию `any`;
- полную перепись CSS.
- удаление `all: unset` с точных corner-кнопок без полноценной ручной проверки.

## Definition of done для каждой итерации

- `npm run build` проходит.
- Плагин скопирован в test vault.
- Пройден smoke-тест.
- В релизных файлах нет `cdnjs` и `bing`.
- `fetch` остался только там, где нужен streaming.
- Не появился новый внешний домен без явного решения.
- Перед публикацией пользователь явно подтвердил релиз.
