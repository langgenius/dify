import type { StatusDotStatus } from '@langgenius/dify-ui/status-dot'
import { useTranslation } from 'react-i18next'

export const useIndexStatus = () => {
  const { t } = useTranslation()
  return {
    queuing: { status: 'warning', text: t($ => $['list.status.queuing'], { ns: 'datasetDocuments' }) },
    indexing: { status: 'normal', text: t($ => $['list.status.indexing'], { ns: 'datasetDocuments' }) },
    paused: { status: 'warning', text: t($ => $['list.status.paused'], { ns: 'datasetDocuments' }) },
    error: { status: 'error', text: t($ => $['list.status.error'], { ns: 'datasetDocuments' }) },
    available: { status: 'success', text: t($ => $['list.status.available'], { ns: 'datasetDocuments' }) },
    enabled: { status: 'success', text: t($ => $['list.status.enabled'], { ns: 'datasetDocuments' }) },
    disabled: { status: 'disabled', text: t($ => $['list.status.disabled'], { ns: 'datasetDocuments' }) },
    archived: { status: 'disabled', text: t($ => $['list.status.archived'], { ns: 'datasetDocuments' }) },
  } satisfies Record<string, { status: StatusDotStatus, text: string }>
}
