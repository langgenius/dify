import { useTranslation } from 'react-i18next'
import { WorkflowVersionFilterOptions } from '../../../types'

export const useFilterOptions = () => {
  const { t } = useTranslation()

  return [
    {
      key: WorkflowVersionFilterOptions.all,
      name: t('workflow.versionHistory.filter.all'),
    },
    {
      key: WorkflowVersionFilterOptions.onlyYours,
      name: t('workflow.versionHistory.filter.onlyYours'),
    },
  ]
}
