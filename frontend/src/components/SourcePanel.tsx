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
