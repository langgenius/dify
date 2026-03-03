import type { FC } from 'react'
import type { KnowledgeBaseNodeType } from './types'
import type { NodeProps } from '@/app/components/workflow/types'
import { memo } from 'react'
import { useTranslation } from 'react-i18next'
import { useSettingsDisplay } from './hooks/use-settings-display'

const Node: FC<NodeProps<KnowledgeBaseNodeType>> = ({ data }) => {
  const { t } = useTranslation()
  const settingsDisplay = useSettingsDisplay()

  return (
    <div className="mb-1 space-y-0.5 px-3 py-1">
      <div className="flex h-6 items-center rounded-md bg-workflow-block-parma-bg px-1.5">
        <div className="mr-2 shrink-0 text-text-tertiary system-xs-medium-uppercase">
          {t('stepTwo.indexMode', { ns: 'datasetCreation' })}
        </div>
        <div
          className="grow truncate text-right text-text-secondary system-xs-medium"
          title={data.indexing_technique}
        >
          {settingsDisplay[data.indexing_technique as keyof typeof settingsDisplay]}
        </div>
      </div>
      <div className="flex h-6 items-center rounded-md bg-workflow-block-parma-bg px-1.5">
        <div className="mr-2 shrink-0 text-text-tertiary system-xs-medium-uppercase">
          {t('form.retrievalSetting.title', { ns: 'datasetSettings' })}
        </div>
        <div
          className="grow truncate text-right text-text-secondary system-xs-medium"
          title={data.retrieval_model?.search_method}
        >
          {settingsDisplay[data.retrieval_model?.search_method as keyof typeof settingsDisplay]}
        </div>
      </div>
    </div>
  )
}

export default memo(Node)
