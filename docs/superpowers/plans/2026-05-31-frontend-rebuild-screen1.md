# Frontend Rebuild — Screen 1: Source Panel Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Delete current React components and CSS, rebuild screen 1 pixel-perfect from design-v3.html prototype using same React + TypeScript + Vite stack.

**Architecture:** Global CSS copied verbatim from prototype. Three focused components: `Sidebar`, `ModeButton` (with inline dropdown), `SourcePanel` (all form sections). App.tsx manages fetch state and wires components. `api.ts` and `types.ts` untouched.

**Tech Stack:** React 18, TypeScript 5, Vite 5, lucide-react, Hanken Grotesk (already in index.html)

---

## File Map

| Action | Path | Responsibility |
|--------|------|----------------|
| DELETE | `src/App.tsx` | replaced |
| DELETE | `src/index.css` | replaced |
| DELETE | `src/components/ProgressBar.tsx` | not needed screen 1 |
| DELETE | `src/components/ReviewSettingsModal.tsx` | not needed screen 1 |
| DELETE | `src/components/Sidebar.tsx` | replaced |
| DELETE | `src/components/SourcePanel.tsx` | replaced |
| DELETE | `src/components/TestCaseWorkbench.tsx` | next iteration |
| DELETE | `src/components/Toolbar.tsx` | not needed screen 1 |
| KEEP | `src/api.ts` | backend calls — no changes |
| KEEP | `src/types.ts` | TS types — no changes |
| KEEP | `src/main.tsx` | entry point — no changes |
| KEEP | `index.html` | already has Hanken Grotesk font |
| CREATE | `src/index.css` | prototype CSS + React adjustments |
| CREATE | `src/App.tsx` | layout root + fetch state |
| CREATE | `src/components/Sidebar.tsx` | dark sidebar 220px |
| CREATE | `src/components/ModeButton.tsx` | preset button + inline dropdown |
| CREATE | `src/components/SourcePanel.tsx` | hero + tabs + TMS grid + input + status + info + accordion |

---

## Task 1: Delete old files

**Files:**
- Delete: `src/App.tsx`, `src/index.css`, `src/components/ProgressBar.tsx`, `src/components/ReviewSettingsModal.tsx`, `src/components/Sidebar.tsx`, `src/components/SourcePanel.tsx`, `src/components/TestCaseWorkbench.tsx`, `src/components/Toolbar.tsx`

- [ ] **Step 1: Delete files**

```bash
cd frontend
rm src/App.tsx src/index.css
rm src/components/ProgressBar.tsx src/components/ReviewSettingsModal.tsx
rm src/components/Sidebar.tsx src/components/SourcePanel.tsx
rm src/components/TestCaseWorkbench.tsx src/components/Toolbar.tsx
```

- [ ] **Step 2: Verify only api.ts, types.ts, main.tsx remain in src/**

```bash
find src -name "*.tsx" -o -name "*.ts" | sort
```

Expected output:
```
src/api.ts
src/main.tsx
src/types.ts
```

- [ ] **Step 3: Commit**

```bash
git add -A
git commit -m "chore: delete old frontend components for rebuild"
```

---

## Task 2: Create index.css

**Files:**
- Create: `src/index.css`

CSS from prototype (`frontend/public/design-v3.html` lines 11–789) with three adjustments for React: no slide nav height offset in `.app`, `#root` fills viewport, `body` background from prototype.

- [ ] **Step 1: Create src/index.css**

Create `frontend/src/index.css` with this exact content:

```css
*, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }

:root {
  --sb-bg: #1E1B4B;
  --sb-active-bg: rgba(255,255,255,0.09);
  --sb-active-border: rgba(255,255,255,0.13);
  --sb-hover: rgba(255,255,255,0.05);
  --sb-divider: rgba(255,255,255,0.08);
  --sb-icon-bg: rgba(255,255,255,0.06);
  --sb-icon-border: rgba(255,255,255,0.09);
  --sb-text: rgba(255,255,255,0.44);
  --sb-text-active: rgba(255,255,255,0.92);
  --sb-section: rgba(255,255,255,0.26);

  --accent: #7C3AED;
  --accent-dim: rgba(124,58,237,0.08);
  --accent-border: rgba(124,58,237,0.22);

  --green: #16A34A;
  --green-bg: rgba(22,163,74,0.07);
  --green-border: rgba(22,163,74,0.22);

  --ok: #079455;
  --ok-bg: rgba(7,148,85,0.07);
  --ok-border: rgba(7,148,85,0.2);

  --bad: #D92D20;
  --bad-bg: rgba(217,45,32,0.07);
  --bad-border: rgba(217,45,32,0.2);

  --warn: #B45309;

  --bg-panel: #FFFFFF;
  --bg-surface: #F7F8FC;
  --bg-hover: #F1F3F8;

  --tx-primary: #0F1117;
  --tx-secondary: #3D4558;
  --tx-muted: #6B7280;
  --tx-dim: #A0ABC0;

  --border: rgba(220,224,238,0.9);
  --border-hover: rgba(196,202,222,0.95);

  --r-sm: 6px;
  --r-md: 10px;
  --r-lg: 14px;

  --font: 'Hanken Grotesk', -apple-system, system-ui, sans-serif;
}

html, body {
  height: 100%;
  font-family: var(--font);
  -webkit-font-smoothing: antialiased;
  background: #C8D6EC;
  min-height: 100vh;
}
body { padding: 20px; }

#root {
  height: calc(100vh - 40px);
  min-height: 560px;
}

/* ── App shell ─────────────────────────────────────────── */
.app {
  display: flex;
  height: 100%;
  border-radius: var(--r-lg);
  overflow: hidden;
  border: 1px solid rgba(180,192,218,0.6);
  box-shadow: 0 2px 24px rgba(30,27,75,0.10), 0 1px 4px rgba(30,27,75,0.06);
}

/* ── Sidebar ───────────────────────────────────────────── */
.sidebar {
  width: 220px; flex-shrink: 0;
  background: var(--sb-bg);
  display: flex; flex-direction: column;
  user-select: none;
}
.sb-logo {
  padding: 15px 14px; display: flex; align-items: center; gap: 10px;
  border-bottom: 1px solid var(--sb-divider); flex-shrink: 0;
}
.sb-mark {
  width: 30px; height: 30px; flex-shrink: 0; border-radius: var(--r-sm);
  background: var(--accent); display: flex; align-items: center; justify-content: center;
}
.sb-mark span { font-size: 10px; font-weight: 700; color: #fff; letter-spacing: -0.03em; }
.sb-brand { display: flex; flex-direction: column; gap: 2px; min-width: 0; }
.sb-brand-name { font-size: 13px; font-weight: 500; color: rgba(255,255,255,0.9); line-height: 17px; white-space: nowrap; }
.sb-brand-sub { font-size: 11px; font-weight: 400; color: var(--sb-section); text-transform: uppercase; letter-spacing: 0.06em; line-height: 14px; white-space: nowrap; }
.sb-section { padding: 14px 14px 5px; flex-shrink: 0; }
.sb-section-label { font-size: 11px; font-weight: 400; color: var(--sb-section); text-transform: uppercase; letter-spacing: 0.07em; }
.sb-nav { flex: 1; padding: 4px 8px; display: flex; flex-direction: column; gap: 2px; overflow-y: auto; }
.sb-item {
  display: flex; align-items: center; gap: 10px; padding: 5px 8px; min-height: 36px;
  border-radius: var(--r-sm); border: 1px solid transparent;
  color: var(--sb-text); cursor: pointer;
  transition: background .14s, color .14s, border-color .14s; position: relative;
  background: none; font-family: var(--font); text-align: left; width: 100%;
}
.sb-item:hover { background: var(--sb-hover); color: rgba(255,255,255,0.68); }
.sb-item-active { background: var(--sb-active-bg); border-color: var(--sb-active-border); color: var(--sb-text-active); cursor: default; }
.sb-item-active:hover { background: var(--sb-active-bg); color: var(--sb-text-active); }
.sb-item-active::before {
  content: ''; position: absolute; left: 0; top: 7px; bottom: 7px;
  width: 2px; border-radius: 2px; background: var(--accent); opacity: 0.9;
}
.sb-item-soon { cursor: default; color: rgba(255,255,255,0.24); }
.sb-item-soon:hover { background: transparent; color: rgba(255,255,255,0.24); }
.sb-icon {
  width: 26px; height: 26px; flex-shrink: 0; border-radius: var(--r-sm);
  background: var(--sb-icon-bg); border: 1px solid var(--sb-icon-border);
  display: flex; align-items: center; justify-content: center;
}
.sb-item-active .sb-icon { background: rgba(255,255,255,0.11); border-color: rgba(255,255,255,0.16); }
.sb-item-soon .sb-icon { background: rgba(255,255,255,0.03); border-color: rgba(255,255,255,0.055); }
.sb-copy { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 1px; }
.sb-title { font-size: 13px; font-weight: 400; line-height: 17px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; color: inherit; }
.sb-sub { font-size: 11px; font-weight: 400; line-height: 14px; color: rgba(255,255,255,0.3); white-space: nowrap; }
.sb-item-active .sb-sub { color: rgba(255,255,255,0.46); }
.sb-badge {
  flex-shrink: 0; font-size: 10px; font-weight: 400; color: rgba(255,255,255,0.28);
  background: rgba(255,255,255,0.05); border: 1px solid rgba(255,255,255,0.09);
  padding: 2px 6px; border-radius: var(--r-sm); text-transform: uppercase; letter-spacing: 0.03em;
  white-space: nowrap; line-height: 1.4;
}
.sb-divider { margin: 4px 12px; border-top: 1px solid var(--sb-divider); flex-shrink: 0; }
.sb-bottom { padding: 4px 8px 12px; flex-shrink: 0; display: flex; flex-direction: column; gap: 2px; }

/* ── Workspace ─────────────────────────────────────────── */
.workspace {
  flex: 1; overflow-y: auto; position: relative;
  background:
    radial-gradient(ellipse 70% 50% at 15% 0%, rgba(124,58,237,0.07) 0%, transparent 60%),
    radial-gradient(ellipse 55% 60% at 90% 100%, rgba(22,163,74,0.06) 0%, transparent 60%),
    radial-gradient(ellipse 60% 40% at 80% 10%, rgba(56,189,248,0.05) 0%, transparent 55%),
    linear-gradient(160deg, #E8F0FB 0%, #EEF2F8 35%, #EAF4F0 65%, #F2EDFA 100%);
}
.workspace-inner { padding: 28px 32px; display: flex; flex-direction: column; align-items: center; }
.workspace-col { width: 100%; max-width: 740px; display: flex; flex-direction: column; gap: 14px; }

/* ── Page header ───────────────────────────────────────── */
.page-header { display: flex; align-items: center; justify-content: flex-end; gap: 16px; }

/* ── Mode button ───────────────────────────────────────── */
.mode-btn-wrap { position: relative; flex-shrink: 0; }
.mode-btn {
  display: inline-flex; align-items: center; gap: 8px;
  height: 36px; padding: 0 12px; border-radius: var(--r-sm);
  background: var(--bg-panel);
  border: 1px solid var(--accent);
  box-shadow: 0 0 0 2px rgba(124,58,237,0.12);
  font-family: var(--font); font-size: 13px; font-weight: 500; color: var(--tx-secondary);
  cursor: pointer; white-space: nowrap;
  transition: border-color .14s, background .14s, box-shadow .14s;
}
.mode-btn:hover { background: var(--bg-surface); box-shadow: 0 0 0 3px rgba(124,58,237,0.16); }
.mode-btn.open { background: var(--bg-surface); box-shadow: 0 0 0 3px rgba(124,58,237,0.18); }
.mode-btn-star { color: #F59E0B; display: flex; flex-shrink: 0; }
.mode-btn-sep { width: 1px; height: 14px; background: var(--border); flex-shrink: 0; }
.mode-btn-pill {
  font-size: 11px; font-weight: 500;
  background: #EEEDFE; color: var(--accent);
  padding: 2px 7px; border-radius: var(--r-sm); white-space: nowrap;
}
.mode-btn-chevron { color: var(--tx-dim); display: flex; flex-shrink: 0; transition: transform .18s; }
.mode-btn-chevron.open { transform: rotate(180deg); }

/* ── Review dropdown ────────────────────────────────────── */
.review-dropdown {
  position: absolute; top: calc(100% + 6px); right: 0;
  width: 320px;
  background: var(--bg-panel); border-radius: var(--r-md);
  border: 1px solid var(--border);
  box-shadow: 0 8px 28px rgba(30,27,75,0.14), 0 2px 8px rgba(30,27,75,0.06);
  z-index: 100; overflow: hidden;
}
.rd-header { padding: 14px 16px 10px; font-size: 13px; font-weight: 500; color: var(--tx-primary); border-bottom: 1px solid var(--border); }
.rd-presets { display: flex; flex-direction: column; gap: 4px; padding: 10px 12px; }
.rd-preset {
  display: flex; align-items: center; gap: 10px;
  padding: 9px 10px; border-radius: var(--r-sm);
  cursor: pointer; border: 1px solid transparent;
  transition: background .12s, border-color .12s;
}
.rd-preset:hover { background: var(--bg-surface); }
.rd-preset.active { background: #EEEDFE; border-color: rgba(124,58,237,0.18); }
.rd-radio {
  width: 16px; height: 16px; flex-shrink: 0; border-radius: 50%;
  border: 1.5px solid var(--border);
  display: flex; align-items: center; justify-content: center;
  transition: border-color .12s;
}
.rd-preset.active .rd-radio { border-color: var(--accent); background: var(--accent); }
.rd-radio-dot { width: 6px; height: 6px; border-radius: 50%; background: #fff; display: none; }
.rd-preset.active .rd-radio-dot { display: block; }
.rd-preset-copy { flex: 1; min-width: 0; }
.rd-preset-name { font-size: 13px; font-weight: 500; color: var(--tx-primary); line-height: 17px; }
.rd-preset.active .rd-preset-name { color: var(--accent); }
.rd-preset-desc { font-size: 11px; color: var(--tx-muted); line-height: 15px; }
.rd-preset-count {
  font-size: 11px; font-weight: 500;
  background: rgba(124,58,237,0.08); color: var(--accent);
  padding: 2px 7px; border-radius: var(--r-sm);
  flex-shrink: 0; white-space: nowrap;
}
.rd-rules-section { padding: 4px 12px 10px; }
.rd-rules-label {
  font-size: 10px; font-weight: 500; color: var(--tx-dim);
  text-transform: uppercase; letter-spacing: 0.07em; padding: 6px 2px 6px;
}
.rd-rule {
  display: flex; align-items: center; gap: 10px;
  padding: 7px 2px; cursor: pointer;
  border-bottom: 1px solid rgba(220,224,238,0.5);
}
.rd-rule:last-child { border-bottom: none; }
.rd-cb {
  width: 16px; height: 16px; flex-shrink: 0; border-radius: 4px;
  border: 1.5px solid var(--border);
  display: flex; align-items: center; justify-content: center;
  transition: background .12s, border-color .12s;
}
.rd-cb.checked { background: var(--accent); border-color: var(--accent); }
.rd-cb-mark { display: none; color: #fff; }
.rd-cb.checked .rd-cb-mark { display: flex; }
.rd-rule-text { font-size: 12px; color: var(--tx-secondary); line-height: 16px; }
.rd-rule.disabled .rd-rule-text { color: var(--tx-dim); }
.rd-footer {
  display: flex; align-items: center; justify-content: space-between;
  padding: 10px 16px 12px; border-top: 1px solid var(--border);
}
.rd-link {
  font-size: 12px; font-weight: 500; color: var(--accent);
  background: none; border: none; cursor: pointer;
  font-family: var(--font); padding: 0;
  transition: opacity .14s;
}
.rd-link:hover { opacity: 0.75; }
.rd-apply {
  height: 32px; padding: 0 14px; border-radius: var(--r-sm);
  background: var(--accent); color: #fff;
  font-family: var(--font); font-size: 12px; font-weight: 500;
  border: none; cursor: pointer;
  transition: background .14s;
}
.rd-apply:hover { background: #6D28D9; }

/* ── Source panel ──────────────────────────────────────── */
.source-panel { background: var(--bg-panel); border-radius: var(--r-lg); border: 1px solid var(--border); width: 100%; overflow: hidden; }
.source-hero { display: flex; align-items: flex-start; gap: 14px; padding: 18px 18px 16px; border-bottom: 1px solid var(--border); }
.source-hero-icon {
  width: 38px; height: 38px; flex-shrink: 0; border-radius: var(--r-md);
  background: var(--accent-dim); border: 1px solid var(--accent-border);
  display: flex; align-items: center; justify-content: center; color: var(--accent);
}
.source-hero-copy { flex: 1; min-width: 0; }
.source-hero-title { font-size: 15px; font-weight: 500; color: var(--tx-primary); line-height: 20px; margin-bottom: 4px; }
.source-hero-desc { font-size: 12px; font-weight: 400; color: var(--tx-muted); line-height: 17px; }
.source-tabs { display: flex; padding: 0 18px; border-bottom: 1px solid var(--border); }
.source-tab {
  display: flex; align-items: center; gap: 7px; padding: 10px 2px; margin-right: 18px;
  font-size: 13px; font-weight: 400; color: var(--tx-muted); cursor: pointer;
  border: none; background: none; border-bottom: 2px solid transparent; margin-bottom: -1px;
  transition: color .14s, border-color .14s; font-family: var(--font);
}
.source-tab-active { color: var(--accent); border-bottom-color: var(--accent); font-weight: 500; cursor: default; }
.source-tab-disabled { cursor: default; color: var(--tx-dim); opacity: 0.7; }
.tab-badge {
  font-size: 10px; font-weight: 400; background: var(--bg-surface);
  border: 1px solid var(--border); color: var(--tx-dim);
  padding: 1px 5px; border-radius: var(--r-sm); line-height: 1.4;
}
.source-body { padding: 16px 18px 18px; display: flex; flex-direction: column; gap: 14px; }

/* TMS grid */
.tms-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; }
.tms-card {
  border: 1px solid var(--border); border-radius: var(--r-md);
  padding: 11px 12px; display: flex; align-items: center; gap: 10px;
  background: var(--bg-surface); cursor: default;
}
.tms-card-active { border: 1.5px solid var(--accent-border); background: var(--bg-panel); cursor: pointer; }
.tms-card-disabled { opacity: 0.45; cursor: not-allowed; }
.tms-icon {
  width: 34px; height: 34px; flex-shrink: 0; border-radius: var(--r-sm);
  border: 1px solid var(--border); background: var(--bg-panel);
  display: flex; align-items: center; justify-content: center; color: var(--tx-muted);
}
.tms-card-active .tms-icon { background: var(--accent-dim); border-color: var(--accent-border); color: var(--accent); }
.tms-copy { flex: 1; min-width: 0; }
.tms-name { font-size: 13px; font-weight: 500; color: var(--tx-primary); line-height: 17px; }
.tms-sub { font-size: 11px; font-weight: 400; color: var(--tx-dim); line-height: 15px; }
.tms-state {
  font-size: 11px; font-weight: 400; padding: 2px 7px; border-radius: var(--r-sm);
  border: 1px solid; white-space: nowrap; flex-shrink: 0; line-height: 1.5;
}
.tms-state-ok { color: var(--green); background: var(--green-bg); border-color: var(--green-border); }
.tms-state-soon { color: var(--tx-dim); background: transparent; border-color: var(--border); }

/* Input */
.source-label { display: block; font-size: 12px; font-weight: 500; color: var(--tx-secondary); margin-bottom: 7px; line-height: 16px; }
.source-input-row { display: flex; gap: 8px; align-items: center; }
.source-id-input {
  flex: 1; height: 40px; border: 1px solid var(--border); border-radius: var(--r-sm);
  background: var(--bg-panel); padding: 0 12px;
  font-family: var(--font); font-size: 13px; font-weight: 400; color: var(--tx-primary);
  outline: none; transition: border-color .14s, box-shadow .14s;
}
.source-id-input::placeholder { color: var(--tx-dim); }
.source-id-input:hover { border-color: var(--border-hover); }
.source-id-input:focus { border-color: var(--accent); box-shadow: 0 0 0 3px rgba(124,58,237,0.11); }
.source-id-input:disabled { opacity: 0.6; cursor: not-allowed; }
.source-fetch-btn {
  height: 40px; padding: 0 16px; border-radius: var(--r-sm);
  background: var(--accent); color: #fff; font-family: var(--font);
  font-size: 13px; font-weight: 500; border: none; cursor: pointer;
  display: flex; align-items: center; gap: 7px; white-space: nowrap; flex-shrink: 0;
  transition: background .14s;
}
.source-fetch-btn:hover { background: #6D28D9; }
.source-fetch-btn-muted {
  background: var(--bg-surface); color: var(--tx-dim);
  border: 1px solid var(--border); cursor: not-allowed;
}
.source-fetch-btn-muted:hover { background: var(--bg-surface); }

/* Status bar */
.status-bar {
  display: flex; align-items: stretch;
  border-radius: var(--r-sm); border: 1px solid var(--border);
  background: var(--bg-surface); overflow: hidden;
}
.status-chip { display: flex; align-items: center; gap: 6px; padding: 9px 12px; font-size: 12px; color: var(--tx-muted); flex: 1; }
.status-chip + .status-chip { border-left: 1px solid var(--border); }
.status-chip-icon { color: var(--tx-dim); display: flex; flex-shrink: 0; }
.status-chip-label { font-size: 11px; color: var(--tx-dim); }
.status-chip-value { font-weight: 500; color: var(--tx-secondary); }

/* Info cards */
.info-grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 8px; }
.info-card { border: 1px solid var(--border); border-radius: var(--r-md); background: var(--bg-surface); padding: 12px; display: flex; flex-direction: column; gap: 8px; }
.info-card-title { display: flex; align-items: center; gap: 7px; font-size: 12px; font-weight: 500; color: var(--tx-secondary); line-height: 16px; }
.info-card-title-icon { color: var(--tx-muted); display: flex; flex-shrink: 0; }
.info-card-body { font-size: 12px; color: var(--tx-muted); line-height: 17px; }
.info-steps { display: flex; flex-direction: column; gap: 5px; }
.info-step { display: flex; align-items: flex-start; gap: 7px; font-size: 12px; color: var(--tx-muted); line-height: 17px; }
.info-step-num {
  width: 17px; height: 17px; flex-shrink: 0; border-radius: 50%;
  background: var(--accent-dim); border: 1px solid var(--accent-border);
  color: var(--accent); font-size: 10px; font-weight: 500;
  display: flex; align-items: center; justify-content: center; line-height: 1;
}
.info-tag {
  display: inline-flex; align-items: center; gap: 5px; font-size: 11px; color: var(--tx-muted);
  background: var(--bg-panel); border: 1px solid var(--border);
  padding: 2px 8px; border-radius: var(--r-sm); width: fit-content; margin-top: 4px;
}

/* Manual panel */
.manual-panel { border: 1px solid var(--border); border-radius: var(--r-sm); background: var(--bg-surface); overflow: hidden; }
.manual-panel-btn {
  display: flex; align-items: center; gap: 10px; padding: 10px 14px;
  width: 100%; background: none; border: none; cursor: pointer;
  font-family: var(--font); text-align: left; transition: background .14s;
}
.manual-panel-btn:hover { background: var(--bg-hover); }
.manual-panel-icon { color: var(--tx-dim); display: flex; flex-shrink: 0; }
.manual-panel-copy { flex: 1; min-width: 0; display: flex; align-items: baseline; gap: 8px; }
.manual-panel-title { font-size: 12px; font-weight: 500; color: var(--tx-secondary); flex-shrink: 0; }
.manual-panel-desc { font-size: 12px; color: var(--tx-dim); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.manual-panel-chevron { color: var(--tx-dim); display: flex; flex-shrink: 0; transition: transform .18s; }
.manual-panel-chevron.open { transform: rotate(180deg); }
.manual-panel-content { border-top: 1px solid var(--border); padding: 10px 14px; font-size: 12px; color: var(--tx-muted); line-height: 18px; }
.manual-panel-content b { font-weight: 500; color: var(--tx-secondary); }

/* Alerts */
.alert { display: flex; align-items: flex-start; gap: 10px; padding: 11px 13px; border-radius: var(--r-sm); border: 1px solid; }
.alert-error { background: var(--bad-bg); border-color: var(--bad-border); }
.alert-success { background: var(--ok-bg); border-color: var(--ok-border); }
.alert-icon-err { color: var(--bad); display: flex; flex-shrink: 0; margin-top: 1px; }
.alert-icon-ok { color: var(--ok); display: flex; flex-shrink: 0; margin-top: 1px; }
.alert-text { font-size: 12px; color: var(--tx-secondary); line-height: 17px; flex: 1; }
.alert-text strong { font-weight: 500; }
.alert-id {
  margin-left: auto; flex-shrink: 0; font-size: 11px; font-family: monospace;
  color: var(--tx-muted); background: var(--bg-surface);
  border: 1px solid var(--border); padding: 2px 7px; border-radius: var(--r-sm); align-self: center;
}

/* Spinner */
@keyframes spin { to { transform: rotate(360deg); } }
.spinner { animation: spin .8s linear infinite; display: flex; }
```

- [ ] **Step 2: Verify Vite picks up the new CSS (no build errors)**

```bash
cd frontend && npx tsc --noEmit 2>&1 | head -20
```

Expected: только ошибки про отсутствующий `App` (мы его ещё не создали) — это нормально.

- [ ] **Step 3: Commit**

```bash
git add src/index.css
git commit -m "feat: add prototype CSS to index.css"
```

---

## Task 3: Create Sidebar.tsx

**Files:**
- Create: `src/components/Sidebar.tsx`

- [ ] **Step 1: Create src/components/Sidebar.tsx**

```tsx
import { FileCheck2, Sparkles, Zap, Settings, PanelLeftClose } from 'lucide-react'

interface SidebarProps {
  onToggle: () => void
}

export function Sidebar({ onToggle }: SidebarProps) {
  return (
    <aside className="sidebar">
      <div className="sb-logo">
        <div className="sb-mark"><span>QA</span></div>
        <div className="sb-brand">
          <span className="sb-brand-name">QA AI Tools</span>
          <span className="sb-brand-sub">AI Review Workspace</span>
        </div>
      </div>
      <div className="sb-section">
        <span className="sb-section-label">Инструменты</span>
      </div>
      <nav className="sb-nav">
        <div className="sb-item sb-item-active">
          <div className="sb-icon"><FileCheck2 size={16} strokeWidth={1.75} /></div>
          <div className="sb-copy">
            <span className="sb-title">Ревью и улучшение</span>
            <span className="sb-sub">тест-кейсов</span>
          </div>
        </div>
        <div className="sb-item sb-item-soon">
          <div className="sb-icon"><Sparkles size={16} strokeWidth={1.75} /></div>
          <div className="sb-copy">
            <span className="sb-title">Генерация</span>
            <span className="sb-sub">тест-кейсов</span>
          </div>
          <span className="sb-badge">Скоро</span>
        </div>
        <div className="sb-item sb-item-soon">
          <div className="sb-icon"><Zap size={16} strokeWidth={1.75} /></div>
          <div className="sb-copy">
            <span className="sb-title">Генерация</span>
            <span className="sb-sub">api-тестов</span>
          </div>
          <span className="sb-badge">Скоро</span>
        </div>
      </nav>
      <div className="sb-divider" />
      <div className="sb-bottom">
        <div className="sb-item">
          <div className="sb-icon"><Settings size={16} strokeWidth={1.75} /></div>
          <div className="sb-copy"><span className="sb-title">Настройки</span></div>
        </div>
        <button type="button" className="sb-item" onClick={onToggle}>
          <div className="sb-icon"><PanelLeftClose size={16} strokeWidth={1.75} /></div>
          <div className="sb-copy"><span className="sb-title">Свернуть</span></div>
        </button>
      </div>
    </aside>
  )
}
```

- [ ] **Step 2: Commit**

```bash
git add src/components/Sidebar.tsx
git commit -m "feat: add Sidebar component"
```

---

## Task 4: Create ModeButton.tsx

**Files:**
- Create: `src/components/ModeButton.tsx`

Dropdown с 3 пресетами (радио) + список правил (чекбоксы) + footer. Закрывается кликом вне. При выборе пресета — правила меняются автоматически. Применяется кнопкой «Применить».

- [ ] **Step 1: Create src/components/ModeButton.tsx**

```tsx
import { useEffect, useRef, useState } from 'react'
import { Check, ChevronDown, Star } from 'lucide-react'
import type { ReviewConfig, ReviewRuleId } from '../types'

interface ModeButtonProps {
  reviewConfig: ReviewConfig
  selectedPreset: string
  enabledRules: ReviewRuleId[]
  onApply: (presetId: string, rules: ReviewRuleId[]) => void
}

export function ModeButton({ reviewConfig, selectedPreset, enabledRules, onApply }: ModeButtonProps) {
  const [open, setOpen] = useState(false)
  const [localPreset, setLocalPreset] = useState(selectedPreset)
  const [localRules, setLocalRules] = useState<ReviewRuleId[]>(enabledRules)
  const wrapRef = useRef<HTMLDivElement>(null)

  useEffect(() => { setLocalPreset(selectedPreset) }, [selectedPreset])
  useEffect(() => { setLocalRules(enabledRules) }, [enabledRules])

  useEffect(() => {
    if (!open) return
    function onMouseDown(e: MouseEvent) {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) {
        setOpen(false)
      }
    }
    document.addEventListener('mousedown', onMouseDown)
    return () => document.removeEventListener('mousedown', onMouseDown)
  }, [open])

  function selectPreset(profileId: string) {
    setLocalPreset(profileId)
    const profile = reviewConfig.profiles.find(p => p.id === profileId)
    if (profile && profile.rules.length > 0) setLocalRules(profile.rules)
  }

  function toggleRule(ruleId: ReviewRuleId) {
    setLocalPreset('custom')
    setLocalRules(prev =>
      prev.includes(ruleId) ? prev.filter(r => r !== ruleId) : [...prev, ruleId]
    )
  }

  function handleApply() {
    onApply(localPreset, localRules)
    setOpen(false)
  }

  const currentLabel = reviewConfig.profiles.find(p => p.id === selectedPreset)?.label ?? 'Строгое ревью'

  return (
    <div className="mode-btn-wrap" ref={wrapRef}>
      <button
        type="button"
        className={`mode-btn${open ? ' open' : ''}`}
        onClick={() => setOpen(v => !v)}
      >
        <span className="mode-btn-star">
          <Star size={16} strokeWidth={1.5} style={{ fill: '#F59E0B', stroke: '#F59E0B' }} />
        </span>
        <span>{currentLabel}</span>
        <span className="mode-btn-sep" />
        <span className="mode-btn-pill">{enabledRules.length} правил</span>
        <span className={`mode-btn-chevron${open ? ' open' : ''}`}>
          <ChevronDown size={16} strokeWidth={1.75} />
        </span>
      </button>

      {open && (
        <div className="review-dropdown">
          <div className="rd-header">Режим ревью</div>

          <div className="rd-presets">
            {reviewConfig.profiles.map(profile => (
              <div
                key={profile.id}
                className={`rd-preset${localPreset === profile.id ? ' active' : ''}`}
                onClick={() => selectPreset(profile.id)}
              >
                <div className="rd-radio"><div className="rd-radio-dot" /></div>
                <div className="rd-preset-copy">
                  <div className="rd-preset-name">{profile.label}</div>
                  {profile.description && (
                    <div className="rd-preset-desc">{profile.description}</div>
                  )}
                </div>
                {profile.rules.length > 0 && (
                  <span className="rd-preset-count">{profile.rules.length} правил</span>
                )}
              </div>
            ))}
          </div>

          <div className="rd-rules-section">
            <div className="rd-rules-label">Активные правила</div>
            {reviewConfig.rules.map(rule => (
              <div
                key={rule.id}
                className={`rd-rule${!localRules.includes(rule.id) ? ' disabled' : ''}`}
                onClick={() => toggleRule(rule.id)}
              >
                <div className={`rd-cb${localRules.includes(rule.id) ? ' checked' : ''}`}>
                  <span className="rd-cb-mark">
                    <Check size={10} strokeWidth={2.5} />
                  </span>
                </div>
                <span className="rd-rule-text">{rule.label}</span>
              </div>
            ))}
          </div>

          <div className="rd-footer">
            <button type="button" className="rd-link">Все правила →</button>
            <button type="button" className="rd-apply" onClick={handleApply}>Применить</button>
          </div>
        </div>
      )}
    </div>
  )
}
```

- [ ] **Step 2: Commit**

```bash
git add src/components/ModeButton.tsx
git commit -m "feat: add ModeButton component with preset dropdown"
```

---

## Task 5: Create SourcePanel.tsx

**Files:**
- Create: `src/components/SourcePanel.tsx`

Hero → Tabs → TMS grid → Input → Alerts (error/success) → Status bar → Info cards → Manual accordion.

- [ ] **Step 1: Create src/components/SourcePanel.tsx**

```tsx
import { useState } from 'react'
import {
  AlignLeft, CheckCircle2, ChevronDown, Clock3, FileInput,
  FileText, HardDrive, List, Loader2, Lock, Shield, ShieldCheck,
  Upload, XCircle,
} from 'lucide-react'
import type { FetchResult } from '../types'

interface SourcePanelProps {
  testItId: string
  onTestItIdChange: (v: string) => void
  fetchLoading: boolean
  fetchResult: FetchResult | null
  fetchError: string | null
  onFetch: () => void
  presetLabel: string
  enabledRulesCount: number
}

export function SourcePanel({
  testItId, onTestItIdChange, fetchLoading, fetchResult, fetchError,
  onFetch, presetLabel, enabledRulesCount,
}: SourcePanelProps) {
  const [manualOpen, setManualOpen] = useState(false)
  const canFetch = testItId.trim().length > 0 && !fetchLoading

  return (
    <div className="source-panel">
      {/* Hero */}
      <div className="source-hero">
        <div className="source-hero-icon">
          <FileInput size={20} strokeWidth={1.75} />
        </div>
        <div className="source-hero-copy">
          <h2 className="source-hero-title">Загрузите тест-кейс для ревью</h2>
          <p className="source-hero-desc">Импортируйте тест-кейс из TestIT по ID — остальные TMS будут доступны позже.</p>
        </div>
      </div>

      {/* Tabs */}
      <div className="source-tabs">
        <button type="button" className="source-tab source-tab-active">Из TMS</button>
        <button type="button" className="source-tab source-tab-disabled" disabled>
          Вручную <span className="tab-badge">Скоро</span>
        </button>
      </div>

      <div className="source-body">
        {/* TMS grid */}
        <div className="tms-grid">
          <div className="tms-card tms-card-active">
            <div className="tms-icon">
              <img
                src="https://docs.testit.software/images/testit_logo_icon_blue.png"
                width={20} height={20} alt="TestIT"
                style={{ objectFit: 'contain' }}
              />
            </div>
            <div className="tms-copy"><div className="tms-name">TestIT</div></div>
            <span className="tms-state tms-state-ok">Доступно</span>
          </div>
          {([
            { name: 'TestRail', src: 'https://codaio.imgix.net/packs/21236/unversioned/assets/LOGO/ba1091c59bab89cd2fd0f289622731fe16113d7b00905abe64759c313a4b73b76c1b0426076ed76cb74752234c734131df46992d5b8b48fc13e264240e4f7119f736cfeb64df36ded54b5cbf6198b9cadedf18dd0cac5c7dbcd16e6336c29363cd1292ba' },
            { name: 'Allure TestOps', src: 'https://img.stackshare.io/service/40438/default_a9d9f8f8546d65b5f12a32106e6d03e6921e11fa.png' },
            { name: 'Zephyr', src: 'https://www.testingtoolsguide.net/wp-content/uploads/2016/11/zephyr.jpg' },
          ] as const).map(tms => (
            <div key={tms.name} className="tms-card tms-card-disabled">
              <div className="tms-icon">
                <img src={tms.src} width={20} height={20} alt={tms.name} style={{ objectFit: 'contain', borderRadius: 4 }} />
              </div>
              <div className="tms-copy"><div className="tms-name">{tms.name}</div></div>
              <span className="tms-state tms-state-soon">Скоро</span>
            </div>
          ))}
        </div>

        {/* Input */}
        <div>
          <label className="source-label" htmlFor="testit-id">ID тест-кейса в TestIT</label>
          <div className="source-input-row">
            <input
              id="testit-id"
              className="source-id-input"
              type="text"
              placeholder="Например: 6110"
              value={testItId}
              onChange={e => onTestItIdChange(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && canFetch && onFetch()}
              spellCheck={false}
              disabled={fetchLoading}
            />
            <button
              type="button"
              className={`source-fetch-btn${!canFetch ? ' source-fetch-btn-muted' : ''}`}
              onClick={onFetch}
              disabled={!canFetch}
            >
              {fetchLoading
                ? <><Loader2 size={15} className="spinner" />Загружаю...</>
                : <><Upload size={15} />Загрузить из TestIT</>
              }
            </button>
          </div>
        </div>

        {/* Error alert */}
        {fetchError && (
          <div className="alert alert-error">
            <span className="alert-icon-err"><XCircle size={16} strokeWidth={1.75} /></span>
            <span className="alert-text"><strong>Ошибка: </strong>{fetchError}</span>
          </div>
        )}

        {/* Success alert */}
        {fetchResult && (
          <div className="alert alert-success">
            <span className="alert-icon-ok"><CheckCircle2 size={16} strokeWidth={1.75} /></span>
            <span className="alert-text"><strong>Загружено: </strong>{fetchResult.normalized_testcase.title}</span>
            <span className="alert-id">{fetchResult.work_item_id}</span>
          </div>
        )}

        {/* Status bar */}
        <div className="status-bar">
          <div className="status-chip">
            <span className="status-chip-icon"><HardDrive size={14} strokeWidth={1.75} /></span>
            <span className="status-chip-label">Источник</span>
            <span className="status-chip-value">TestIT</span>
          </div>
          <div className="status-chip">
            <span className="status-chip-icon"><Clock3 size={14} strokeWidth={1.75} /></span>
            <span className="status-chip-label">Режим</span>
            <span className="status-chip-value">{presetLabel}</span>
          </div>
          <div className="status-chip">
            <span className="status-chip-icon"><ShieldCheck size={14} strokeWidth={1.75} /></span>
            <span className="status-chip-value">{enabledRulesCount} правил</span>
          </div>
        </div>

        {/* Info cards */}
        <div className="info-grid">
          <div className="info-card">
            <div className="info-card-title">
              <span className="info-card-title-icon"><List size={14} strokeWidth={1.75} /></span>
              Как это работает
            </div>
            <div className="info-steps">
              <div className="info-step"><span className="info-step-num">1</span>Выберите источник</div>
              <div className="info-step"><span className="info-step-num">2</span>Загрузите тест-кейс</div>
              <div className="info-step"><span className="info-step-num">3</span>Получите ревью и улучшения</div>
            </div>
          </div>
          <div className="info-card">
            <div className="info-card-title">
              <span className="info-card-title-icon"><FileText size={14} strokeWidth={1.75} /></span>
              Что будет загружено
            </div>
            <div className="info-card-body">
              Название, описание, предусловия, шаги, постусловия и метаданные TestIT.
            </div>
            <div className="info-tag">
              <Lock size={10} strokeWidth={2} />
              Только для чтения
            </div>
          </div>
          <div className="info-card">
            <div className="info-card-title">
              <span className="info-card-title-icon"><Shield size={14} strokeWidth={1.75} /></span>
              Режим ревью
            </div>
            <div className="info-card-body">
              Проверки настраиваются через режим ревью и кастомные правила.
            </div>
          </div>
        </div>

        {/* Manual accordion */}
        <div className="manual-panel">
          <button type="button" className="manual-panel-btn" onClick={() => setManualOpen(v => !v)}>
            <span className="manual-panel-icon"><AlignLeft size={16} strokeWidth={1.75} /></span>
            <span className="manual-panel-copy">
              <span className="manual-panel-title">Ручной ввод</span>
              <span className="manual-panel-desc">При выборе «Вручную» будет доступно поле ввода тест-кейса.</span>
            </span>
            <span className={`manual-panel-chevron${manualOpen ? ' open' : ''}`}>
              <ChevronDown size={16} strokeWidth={1.75} />
            </span>
          </button>
          {manualOpen && (
            <div className="manual-panel-content">
              Нажмите <b>«Вручную»</b> в переключателе выше, чтобы вставить тест-кейс в формате JSON или plain text.
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
```

- [ ] **Step 2: Commit**

```bash
git add src/components/SourcePanel.tsx
git commit -m "feat: add SourcePanel component"
```

---

## Task 6: Create App.tsx and wire everything

**Files:**
- Create: `src/App.tsx`

Fetch state, reviewConfig loading, renders Sidebar + ModeButton + SourcePanel. After successful fetch shows a placeholder (workbench will be added next iteration).

- [ ] **Step 1: Create src/App.tsx**

```tsx
import { useEffect, useState } from 'react'
import { api, humanizeFetchError } from './api'
import { Sidebar } from './components/Sidebar'
import { ModeButton } from './components/ModeButton'
import { SourcePanel } from './components/SourcePanel'
import type { FetchResult, ReviewConfig, ReviewRuleId } from './types'

const DEFAULT_RULES: ReviewRuleId[] = [
  'structure', 'expected_results', 'test_data', 'tags',
  'duration', 'atomicity', 'independence', 'requirement_traceability',
]

const FALLBACK_CONFIG: ReviewConfig = {
  sources: [{ id: 'testit', label: 'TestIT', enabled: true }],
  profiles: [
    { id: 'standard', label: 'Базовое ревью', description: 'Только критичные проверки', rules: ['structure', 'expected_results', 'test_data', 'tags'] },
    { id: 'strict', label: 'Строгое ревью', description: 'Все проверки включены', rules: DEFAULT_RULES },
    { id: 'custom', label: 'Своё', description: 'Выберите правила вручную', rules: [] },
  ],
  rules: [
    { id: 'structure', label: 'Структура', group: 'Качество', enabled: true, order: 10 },
    { id: 'expected_results', label: 'Ожидаемые результаты', group: 'Качество', enabled: true, order: 20 },
    { id: 'test_data', label: 'Тестовые данные', group: 'Качество', enabled: true, order: 30 },
    { id: 'tags', label: 'Теги', group: 'Метаданные', enabled: true, order: 40 },
    { id: 'duration', label: 'Длительность', group: 'Метаданные', enabled: true, order: 50 },
    { id: 'atomicity', label: 'Атомарность', group: 'Качество', enabled: true, order: 60 },
    { id: 'independence', label: 'Независимость', group: 'Качество', enabled: true, order: 70 },
    { id: 'requirement_traceability', label: 'Связь с требованиями', group: 'Traceability', enabled: true, order: 80 },
  ],
  defaults: { testit: DEFAULT_RULES },
}

export default function App() {
  const [reviewConfig, setReviewConfig] = useState<ReviewConfig>(FALLBACK_CONFIG)
  const [selectedPreset, setSelectedPreset] = useState('strict')
  const [enabledRules, setEnabledRules] = useState<ReviewRuleId[]>(DEFAULT_RULES)

  const [testItId, setTestItId] = useState('')
  const [fetchLoading, setFetchLoading] = useState(false)
  const [fetchResult, setFetchResult] = useState<FetchResult | null>(null)
  const [fetchError, setFetchError] = useState<string | null>(null)

  useEffect(() => {
    api.getReviewConfig()
      .then(config => {
        setReviewConfig(config)
        setEnabledRules(config.defaults['testit'] ?? DEFAULT_RULES)
      })
      .catch(() => {})
  }, [])

  async function handleFetch() {
    const id = testItId.trim()
    if (!id) return
    setFetchLoading(true)
    setFetchError(null)
    setFetchResult(null)
    try {
      const data = await api.fetchWorkItem(id)
      setFetchResult(data)
    } catch (err) {
      setFetchError(humanizeFetchError((err as Error).message))
    } finally {
      setFetchLoading(false)
    }
  }

  function handleTestItIdChange(v: string) {
    setTestItId(v)
    if (fetchResult || fetchError) {
      setFetchResult(null)
      setFetchError(null)
    }
  }

  const presetLabel = reviewConfig.profiles.find(p => p.id === selectedPreset)?.label ?? 'Строгое ревью'

  if (fetchResult) {
    return (
      <div className="app">
        <Sidebar onToggle={() => {}} />
        <main className="workspace">
          <div className="workspace-inner" style={{ justifyContent: 'center', alignItems: 'center', height: '100%' }}>
            <div style={{ textAlign: 'center', color: 'var(--tx-muted)', fontSize: 14 }}>
              <div style={{ fontWeight: 500, color: 'var(--tx-primary)', marginBottom: 6 }}>
                {fetchResult.normalized_testcase.title}
              </div>
              <div>Воркбенч будет добавлен в следующей итерации</div>
              <button
                type="button"
                style={{ marginTop: 16, padding: '8px 16px', borderRadius: 'var(--r-sm)', border: '1px solid var(--border)', background: 'var(--bg-panel)', cursor: 'pointer', fontFamily: 'var(--font)', fontSize: 13, color: 'var(--tx-secondary)' }}
                onClick={() => { setFetchResult(null); setFetchError(null) }}
              >
                ← Назад
              </button>
            </div>
          </div>
        </main>
      </div>
    )
  }

  return (
    <div className="app">
      <Sidebar onToggle={() => {}} />
      <main className="workspace">
        <div className="workspace-inner">
          <div className="workspace-col">
            <div className="page-header">
              <ModeButton
                reviewConfig={reviewConfig}
                selectedPreset={selectedPreset}
                enabledRules={enabledRules}
                onApply={(preset, rules) => { setSelectedPreset(preset); setEnabledRules(rules) }}
              />
            </div>
            <SourcePanel
              testItId={testItId}
              onTestItIdChange={handleTestItIdChange}
              fetchLoading={fetchLoading}
              fetchResult={fetchResult}
              fetchError={fetchError}
              onFetch={handleFetch}
              presetLabel={presetLabel}
              enabledRulesCount={enabledRules.length}
            />
          </div>
        </div>
      </main>
    </div>
  )
}
```

- [ ] **Step 2: Verify TypeScript compiles**

```bash
cd frontend && npx tsc --noEmit
```

Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add src/App.tsx
git commit -m "feat: wire up App with screen 1 state"
```

---

## Task 7: Run and verify visually

- [ ] **Step 1: Start dev server**

```bash
cd frontend && npm run dev
```

Open `http://localhost:5173` in browser.

- [ ] **Step 2: Compare against prototype**

Open `frontend/public/design-v3.html` in browser.

Check side-by-side:
- [ ] Dark sidebar 220px — logo, 3 nav items (1 active, 2 со «Скоро»), bottom items
- [ ] Gradient workspace background (purple/green/blue тонкие)
- [ ] Mode button right-aligned, фиолетовая рамка, star icon, pill с кол-вом правил
- [ ] Dropdown открывается по клику, 3 пресета + чекбоксы правил, кнопка «Применить»
- [ ] Dropdown закрывается кликом вне
- [ ] Source panel: hero секция с иконкой
- [ ] Tabs: «Из TMS» active, «Вручную» disabled
- [ ] TMS grid: TestIT активный (accent border), остальные disabled (opacity)
- [ ] Input: placeholder, фокус-стейт (фиолетовая рамка)
- [ ] Fetch кнопка: серая без ID, фиолетовая с ID, спиннер при загрузке
- [ ] Status bar: 3 чипа
- [ ] Info cards: 3 карточки в ряд
- [ ] Manual accordion: закрыт по умолчанию, открывается по клику

- [ ] **Step 3: Fix any visual discrepancies, then final commit**

```bash
git add -A
git commit -m "feat: complete screen 1 rebuild — source panel pixel-perfect"
```
