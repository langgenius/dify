import { useState } from 'react'
import MetadataTrigger from '../metadata-trigger'
import MetadataFilterSelector from './metadata-filter-selector'
import Collapse from '@/app/components/workflow/nodes/_base/components/collapse'
import Tooltip from '@/app/components/base/tooltip'
import type { MetadataShape } from '@/app/components/workflow/nodes/knowledge-retrieval/types'
import { MetadataFilteringModeEnum } from '@/app/components/workflow/nodes/knowledge-retrieval/types'
import ModelSelector from '@/app/components/header/account-setting/model-provider-page/model-selector'

type MetadataFilterProps = {
  metadataFilterMode?: MetadataFilteringModeEnum
  handleMetadataFilterModeChange: (mode: MetadataFilteringModeEnum) => void
} & MetadataShape
const MetadataFilter = ({
  metadataFilterMode,
  handleMetadataFilterModeChange,
  ...restProps
}: MetadataFilterProps) => {
  const [collapsed, setCollapsed] = useState(true)

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
              onSelect={handleMetadataFilterModeChange}
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
              <ModelSelector
                modelList={[]}
              />
            </>
          )
        }
      </>
    </Collapse>
  )
}

export default MetadataFilter
