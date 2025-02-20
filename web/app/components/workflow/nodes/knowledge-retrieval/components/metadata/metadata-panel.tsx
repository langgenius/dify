import { RiCloseLine } from '@remixicon/react'
import AddCondition from './add-condition'
import ConditionList from './condition-list'
import type { MetadataShape } from '@/app/components/workflow/nodes/knowledge-retrieval/types'

type MetadataPanelProps = {
  onCancel: () => void
} & MetadataShape
const MetadataPanel = ({
  metadataFilteringConditions,
  onCancel,
  handleAddCondition,
  ...restProps
}: MetadataPanelProps) => {
  return (
    <div className='w-[420px] bg-components-panel-bg border-[0.5px] border-components-panel-border rounded-2xl shadow-2xl'>
      <div className='relative px-3 pt-3.5'>
        <div className='system-xl-semibold text-text-primary'>
          Metadata Filter Conditions
        </div>
        <div
          className='absolute right-2.5 bottom-0 flex items-center justify-center w-8 h-8 cursor-pointer'
          onClick={onCancel}
        >
          <RiCloseLine className='w-4 h-4 text-text-tertiary' />
        </div>
      </div>
      <div className='px-1 py-2'>
        <div className='px-3 py-1'>
          <ConditionList
            metadataFilteringConditions={metadataFilteringConditions}
            {...restProps}
          />
          <AddCondition handleAddCondition={handleAddCondition} />
        </div>
      </div>
    </div>
  )
}

export default MetadataPanel
