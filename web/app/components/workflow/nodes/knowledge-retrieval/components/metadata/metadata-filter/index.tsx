import {
  useCallback,
  useState,
} from 'react'
import MetadataTrigger from '../metadata-trigger'
import MetadataFilterSelector from './metadata-filter-selector'
import Collapse from '@/app/components/workflow/nodes/_base/components/collapse'
import Tooltip from '@/app/components/base/tooltip'
import type { MetadataShape } from '@/app/components/workflow/nodes/knowledge-retrieval/types'
import { MetadataFilteringModeEnum } from '@/app/components/workflow/nodes/knowledge-retrieval/types'
import ModelParameterModal from '@/app/components/header/account-setting/model-provider-page/model-parameter-modal'

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
      trigger={
        <div className='grow flex items-center justify-between pr-4'>
          <div className='flex items-center'>
            <div className='mr-0.5 system-sm-semibold-uppercase text-text-secondary'>
              metadata filtering
            </div>
            <Tooltip
              popupContent={(
                <div className='w-[200px]'>
                  Metadata filtering is the process of using metadata attributes (such as tags, categories, or access permissions) to refine and control the retrieval of relevant information within a system.
                </div>
              )}
            />
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
      }
    >
      <>
        {
          metadataFilterMode === MetadataFilteringModeEnum.automatic && (
            <>
              <div className='px-4 body-xs-regular text-text-tertiary'>
                Automatically generate metadata filtering conditions based on Query Variable
              </div>
              <div className='mt-1 px-4'>
                <ModelParameterModal
                  popupClassName='!w-[387px]'
                  isInWorkflow
                  isAdvancedMode={true}
                  mode={metadataModelConfig?.mode || 'chat'}
                  provider={metadataModelConfig?.provider || ''}
                  completionParams={metadataModelConfig?.completion_params || { temperature: 0.7 }}
                  modelId={metadataModelConfig?.name || ''}
                  setModel={handleMetadataModelChange || (() => {})}
                  onCompletionParamsChange={handleMetadataCompletionParamsChange || (() => {})}
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
