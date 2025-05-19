import type { FC } from 'react'
import { memo } from 'react'
import { useTranslation } from 'react-i18next'
import type { KnowledgeBaseNodeType } from './types'
import type { NodeProps } from '@/app/components/workflow/types'

const Node: FC<NodeProps<KnowledgeBaseNodeType>> = ({ data }) => {
  const { t } = useTranslation()
  return (
    <div className='mb-1 space-y-0.5 px-3 py-1'>
      <div className='flex h-6 items-center rounded-md bg-workflow-block-parma-bg px-1.5'>
        <div className='system-xs-medium-uppercase mr-2 shrink-0 text-text-tertiary'>{t('datasetCreation.stepTwo.indexMode')}</div>
        <div className='system-xs-medium grow truncate text-right text-text-secondary' title={data.indexing_technique}>{data.indexing_technique}</div>
      </div>
      <div className='flex h-6 items-center rounded-md bg-workflow-block-parma-bg px-1.5'>
        <div className='system-xs-medium-uppercase mr-2 shrink-0 text-text-tertiary'>{t('datasetSettings.form.retrievalSetting.title')}</div>
        <div className='system-xs-medium grow truncate text-right text-text-secondary' title={data.retrieval_model.search_method}>{data.retrieval_model.search_method}</div>
      </div>
    </div>
  )
}

export default memo(Node)
