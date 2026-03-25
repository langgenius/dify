import { useTranslation } from 'react-i18next'

export const useIndexStatus = () => {
  const { t } = useTranslation()
  return {
    queuing: { color: 'orange', text: t('list.status.queuing', { ns: 'datasetDocuments' }) }, // waiting
    indexing: { color: 'blue', text: t('list.status.indexing', { ns: 'datasetDocuments' }) }, // indexing splitting parsing cleaning
    paused: { color: 'orange', text: t('list.status.paused', { ns: 'datasetDocuments' }) }, // paused
    error: { color: 'red', text: t('list.status.error', { ns: 'datasetDocuments' }) }, // error
    available: { color: 'green', text: t('list.status.available', { ns: 'datasetDocuments' }) }, // completed，archived = false，enabled = true
    enabled: { color: 'green', text: t('list.status.enabled', { ns: 'datasetDocuments' }) }, // completed，archived = false，enabled = true
    disabled: { color: 'gray', text: t('list.status.disabled', { ns: 'datasetDocuments' }) }, // completed，archived = false，enabled = false
    archived: { color: 'gray', text: t('list.status.archived', { ns: 'datasetDocuments' }) }, // completed，archived = true
  }
}
