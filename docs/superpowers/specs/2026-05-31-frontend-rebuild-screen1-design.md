# Frontend Rebuild — Экран 1: Source Panel

**Дата:** 2026-05-31  
**Стек:** React + TypeScript + Vite (без изменений)  
**Референс:** `frontend/public/design-v3.html` — Слайд 1

---

## Цель

Удалить текущие React-компоненты и CSS, пересобрать экран 1 пиксель-в-пиксель по прототипу design-v3.html. Итеративный подход: сначала только экран 1.

## Что сохраняется

- `frontend/src/api.ts` — без изменений
- `frontend/src/types.ts` — без изменений
- `frontend/src/main.tsx` — без изменений
- Вся инфраструктура Vite (`package.json`, `vite.config.ts`, `tsconfig.json`)

## Что удаляется

- `frontend/src/App.tsx`
- `frontend/src/index.css`
- `frontend/src/components/` (все 5 файлов)

## Новая структура

```
frontend/src/
├── main.tsx                    # не трогаем
├── api.ts                      # не трогаем
├── types.ts                    # не трогаем
├── index.css                   # CSS из прототипа (полная копия, глобальный)
├── App.tsx                     # layout-root: Sidebar + Workspace
└── components/
    ├── Sidebar.tsx             # тёмный сайдбар
    ├── ModeButton.tsx          # кнопка режима + inline dropdown
    └── SourcePanel.tsx         # вся форма загрузки тест-кейса
```

## CSS

- Глобальный `index.css` — точная копия CSS из прототипа
- Те же CSS-переменные: `--sb-bg`, `--accent`, `--bg-panel`, `--border`, etc.
- Те же имена классов: `.sidebar`, `.sb-item`, `.source-panel`, `.tms-card`, etc.
- Шрифт: `Hanken Grotesk` через Google Fonts (в `index.html`)
- Lucide icons: npm-пакет `lucide-react` (уже установлен)

## Компоненты

### App.tsx

```
<div className="layout-root">
  <Sidebar collapsed={sidebarCollapsed} onToggle={...} />
  <main className="workspace">
    <div className="workspace-inner">
      <div className="workspace-col">
        <div className="page-header">
          <ModeButton ... />
        </div>
        <SourcePanel ... />
      </div>
    </div>
  </main>
</div>
```

**State в App:**
- `sidebarCollapsed: boolean`
- `selectedPreset: 'strict' | 'basic' | 'custom'`
- `enabledRules: string[]`
- `testItId: string`
- `fetchLoading: boolean`
- `fetchResult: FetchResult | null`
- `fetchError: string | null`

### Sidebar.tsx

Props: `collapsed: boolean`, `onToggle: () => void`

Структура: logo → nav (3 items: active + 2 soon) → divider → bottom (settings + collapse).  
При `collapsed=true` — ширина 54px, только иконки (следующая итерация).

### ModeButton.tsx

Props: `selectedPreset`, `enabledRules`, `onApply(preset, rules)`

- Кнопка показывает название пресета + количество правил
- Клик → inline dropdown (не модал)
- Dropdown: 3 пресета с радио-кнопками + список правил с чекбоксами + footer (Apply)
- Закрывается кликом вне

Пресеты:
- `strict` → "Строгое ревью", 8 правил
- `basic` → "Базовое ревью", 4 правила
- `custom` → "Своё", пользовательский набор

### SourcePanel.tsx

Props: `testItId`, `onTestItIdChange`, `fetchLoading`, `fetchResult`, `fetchError`, `onFetch`

Секции (сверху вниз):
1. **Hero** — иконка + заголовок + описание
2. **Tabs** — "Из TMS" (активная) | "Вручную" (disabled, badge "Скоро")
3. **TMS grid** — 4 карточки: TestIT (активная), TestRail / Allure TestOps / Zephyr (disabled)
4. **Input** — label + поле ID + кнопка "Загрузить из TestIT"
5. **Status bar** — 3 чипа: источник, режим, кол-во правил
6. **Info cards** — 3 карточки: "Как это работает", "Что будет загружено", "Режим ревью"
7. **Manual panel** — accordion (по клику раскрывается)

**Состояния кнопки Fetch:**
- Нет ID → disabled, серая
- Есть ID → active, фиолетовая
- Loading → spinner + "Загружаю..."
- После success → переход на workbench (следующий экран, пока заглушка)

## Итерация

Это **итерация 1**: только экран 1 (source panel).  
Workbench (экран 3) — отдельная итерация.  
Sidebar collapse animation — отдельная итерация.

## Проверка готовности

1. `npm run dev` — нет ошибок TS
2. Визуально совпадает с design-v3.html слайд 1
3. Dropdown открывается/закрывается
4. Fetch вызывает `api.fetchWorkItem()` — успех/ошибка отображаются
5. Manual accordion работает
