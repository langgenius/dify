import { useTranslation } from 'react-i18next'
import { WorkflowVersionFilterOptions } from '../../../types'

export const useFilterOptions = () => {
  const { t } = useTranslation(['workflowHistory'])

  return [
    {
      key: WorkflowVersionFilterOptions.all,
      name: t(($) => $['versionHistory.filter.all'], { ns: 'workflowHistory' }),
    },
    {
      key: WorkflowVersionFilterOptions.onlyYours,
      name: t(($) => $['versionHistory.filter.onlyYours'], { ns: 'workflowHistory' }),
    },
  ]
}
