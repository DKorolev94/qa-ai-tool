import i18n from 'i18next'
import { initReactI18next } from 'react-i18next'
import en from './locales/en.json'
import ru from './locales/ru.json'

const STORAGE_KEY = 'qa-ai-tool:language'

function initialLanguage(): 'ru' | 'en' {
  const stored = localStorage.getItem(STORAGE_KEY)
  return stored === 'en' ? 'en' : 'ru'
}

i18n
  .use(initReactI18next)
  .init({
    resources: {
      en: { translation: en },
      ru: { translation: ru },
    },
    lng: initialLanguage(),
    fallbackLng: 'ru',
    interpolation: { escapeValue: false },
  })

export function setLanguage(lng: 'ru' | 'en'): void {
  i18n.changeLanguage(lng)
  localStorage.setItem(STORAGE_KEY, lng)
}

export default i18n
