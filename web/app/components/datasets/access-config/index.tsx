'use client'

import { ScrollArea } from '@langgenius/dify-ui/scroll-area'
import { useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import AccessRulesEditor from '@/app/components/access-rules-editor'
import { useDatasetDetailContextWithSelector } from '@/context/dataset-detail'
import { useDatasetAccessRules } from '@/service/access-control/use-dataset-access-config'
import { getDatasetACLCapabilities } from '@/utils/permission'

type DatasetAccessConfigPageProps = {
  datasetId: string
}

const DatasetAccessConfigPage = ({ datasetId }: DatasetAccessConfigPageProps) => {
  const { t } = useTranslation()
  const { data: datasetAccessRulesResponse } = useDatasetAccessRules(datasetId)
  const datasetPermissionKeys = useDatasetDetailContextWithSelector(state => state.dataset?.permission_keys)
  const datasetACLCapabilities = useMemo(
    () => getDatasetACLCapabilities(datasetPermissionKeys),
    [datasetPermissionKeys],
  )

  const datasetAccessRules = datasetAccessRulesResponse?.items || []

  return (
    <ScrollArea
      className="h-full bg-components-panel-bg"
      slotClassNames={{ viewport: 'overscroll-contain' }}
    >
      <div className="px-12 py-8">
        <h1 className="title-2xl-semi-bold text-text-primary">{t('settings.accessConfig', { ns: 'common' })}</h1>
        <div className="mt-6">
          <AccessRulesEditor resourceId={datasetId} rules={datasetAccessRules} canManage={datasetACLCapabilities.canAccessConfig} />
        </div>
      </div>
    </ScrollArea>
  )
}

export default DatasetAccessConfigPage
