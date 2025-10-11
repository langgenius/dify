import {
  useCallback,
  useState,
} from 'react'
import { useTranslation } from 'react-i18next'
import MetadataTrigger from '../metadata-trigger'
import MetadataFilterSelector from './metadata-filter-selector'
import Collapse from '@/app/components/workflow/nodes/_base/components/collapse'
import Tooltip from '@/app/components/base/tooltip'
import type { MetadataShape } from '@/app/components/workflow/nodes/knowledge-retrieval/types'
import { MetadataFilteringModeEnum } from '@/app/components/workflow/nodes/knowledge-retrieval/types'
import ModelParameterModal from '@/app/components/header/account-setting/model-provider-page/model-parameter-modal'
import { noop } from 'lodash-es'

type MetadataFilterProps = {
  metadataFilterMode?: MetadataFilteringModeEnum
  handleMetadataFilterModeChange: (mode: MetadataFilteringModeEnum) => void
} & MetadataShape
const MetadataFilter = ({
  metadataFilterMode = MetadataFilteringModeEnum.disabled,
  handleMetadataFilterModeChange,
  metadataModelConfig,
  handleMetadataModelChange,
  handleMetadataCompletionParamsChange,
  ...restProps
}: MetadataFilterProps) => {
  const { t } = useTranslation()
  const [collapsed, setCollapsed] = useState(true)

  const handleMetadataFilterModeChangeWrapped = useCallback((mode: MetadataFilteringModeEnum) => {
    if (mode === MetadataFilteringModeEnum.automatic)
      setCollapsed(false)

    handleMetadataFilterModeChange(mode)
  }, [handleMetadataFilterModeChange])

  return (
    <Collapse
      disabled={metadataFilterMode === MetadataFilteringModeEnum.disabled || metadataFilterMode === MetadataFilteringModeEnum.manual}
      collapsed={collapsed}
      onCollapse={setCollapsed}
      hideCollapseIcon
      trigger={collapseIcon => (
        <div className='flex grow items-center justify-between pr-4'>
          <div className='flex items-center'>
            <div className='system-sm-semibold-uppercase mr-0.5 text-text-secondary'>
              {t('workflow.nodes.knowledgeRetrieval.metadata.title')}
            </div>
            <Tooltip
              popupContent={(
                <div className='w-[200px]'>
                  {t('workflow.nodes.knowledgeRetrieval.metadata.tip')}
                </div>
              )}
            />
            {collapseIcon}
          </div>
          <div className='flex items-center'>
            <MetadataFilterSelector
              value={metadataFilterMode}
              onSelect={handleMetadataFilterModeChangeWrapped}
            />
            {
              metadataFilterMode === MetadataFilteringModeEnum.manual && (
                <div className='ml-1'>
                  <MetadataTrigger {...restProps} />
                </div>
              )
            }
          </div>
        </div>
      )}
    >
      <>
        {
          metadataFilterMode === MetadataFilteringModeEnum.automatic && (
            <>
              <div className='body-xs-regular px-4 text-text-tertiary'>
                {t('workflow.nodes.knowledgeRetrieval.metadata.options.automatic.desc')}
              </div>
              <div className='mt-1 px-4'>
                <ModelParameterModal
                  portalToFollowElemContentClassName='z-[50]'
                  popupClassName='!w-[387px]'
                  isInWorkflow
                  isAdvancedMode={true}
                  mode={metadataModelConfig?.mode || 'chat'}
                  provider={metadataModelConfig?.provider || ''}
                  completionParams={metadataModelConfig?.completion_params || { temperature: 0.7 }}
                  modelId={metadataModelConfig?.name || ''}
                  setModel={handleMetadataModelChange || noop}
                  onCompletionParamsChange={handleMetadataCompletionParamsChange || noop}
                  hideDebugWithMultipleModel
                  debugWithMultipleModel={false}
                />
              </div>
            </>
          )
        }
      </>
    </Collapse>
  )
}

export default MetadataFilter
