import i18n from 'i18next'
import { initReactI18next } from 'react-i18next'
import enCommon from './en/common.json'
import esCommon from './es/common.json'
import enFiles from './en/files.json'
import esFiles from './es/files.json'
import enDeployments from './en/deployments.json'
import esDeployments from './es/deployments.json'
import enCommits from './en/commits.json'
import esCommits from './es/commits.json'
import enSettings from './en/settings.json'
import esSettings from './es/settings.json'

i18n.use(initReactI18next).init({
  resources: {
    en: {
      common: enCommon,
      files: enFiles,
      deployments: enDeployments,
      commits: enCommits,
      settings: enSettings
    },
    es: {
      common: esCommon,
      files: esFiles,
      deployments: esDeployments,
      commits: esCommits,
      settings: esSettings
    }
  },
  defaultNS: 'common',
  lng: localStorage.getItem('language') || 'en',
  fallbackLng: 'en',
  interpolation: { escapeValue: false }
})

export default i18n
