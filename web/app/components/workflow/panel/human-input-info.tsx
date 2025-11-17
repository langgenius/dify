import { memo } from 'react'
// import { useStore } from '../store'
import BlockIcon from '@/app/components/workflow/block-icon'
import { BlockEnum } from '../types'

type props = {
  nodeID: string
  nodeTitle: string
  formData: any
}

const HumanInputInfo = ({ nodeTitle }: props) => {
  // const historyWorkflowData = useStore(s => s.historyWorkflowData)

  return (
    <div className='rounded-2xl border-[0.5px] border-components-panel-border bg-components-panel-bg p-2 shadow-xs'>
      <div className='p-2'>
        {/* node icon */}
        <BlockIcon
          type={BlockEnum.HumanInput}
          // toolIcon={triggerIcon}
        />
        {/* node name */}
        <div className='system-sm-semibold-uppercase text-text-primary'>{nodeTitle}</div>
      </div>
      <div>
        {/* human input form content */}
      </div>
    </div>
  )
}

export default memo(HumanInputInfo)
