import { RiArrowRightLine } from '@remixicon/react'
import type {
  AgentLogItemWithChildren,
  NodeTracing,
} from '@/types/workflow'

type AgentLogTriggerProps = {
  nodeInfo: NodeTracing
  onShowAgentResultList: (agentLogs: AgentLogItemWithChildren[]) => void
}
const AgentLogTrigger = ({
  nodeInfo,
  onShowAgentResultList,
}: AgentLogTriggerProps) => {
  const { agentLog } = nodeInfo

  return (
    <div className='bg-components-button-tertiary-bg rounded-[10px]'>
      <div className='flex items-center px-3 pt-2 system-2xs-medium-uppercase text-text-tertiary'>
        Agent strategy
      </div>
      <div className='flex items-center pl-3 pt-1 pr-2 pb-1.5'>
        <div className='shrink-0 w-5 h-5'></div>
        <div className='grow mx-0.5 px-1 system-xs-medium text-text-secondary'></div>
        <div
          className='shrink-0 flex items-center px-[1px] system-xs-regular-uppercase text-text-tertiary cursor-pointer'
          onClick={() => onShowAgentResultList(agentLog || [])}
        >
          Detail
          <RiArrowRightLine className='ml-0.5 w-3.5 h-3.5' />
        </div>
      </div>
    </div>
  )
}

export default AgentLogTrigger
