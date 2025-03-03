import type { FC } from 'react'
import { RiFileList3Line } from '@remixicon/react'
import type { IChatItem } from '@/app/components/base/chat/chat/type'
import { useStore as useAppStore } from '@/app/components/app/store'
import ActionButton from '@/app/components/base/action-button'

type LogProps = {
  logItem: IChatItem
}
const Log: FC<LogProps> = ({
  logItem,
}) => {
  const setCurrentLogItem = useAppStore(s => s.setCurrentLogItem)
  const setShowPromptLogModal = useAppStore(s => s.setShowPromptLogModal)
  const setShowAgentLogModal = useAppStore(s => s.setShowAgentLogModal)
  const setShowMessageLogModal = useAppStore(s => s.setShowMessageLogModal)
  const { workflow_run_id: runID, agent_thoughts } = logItem
  const isAgent = agent_thoughts && agent_thoughts.length > 0

  return (
    <div
      className='ml-1 flex items-center gap-0.5 p-0.5 rounded-[10px] border-[0.5px] border-components-actionbar-border bg-components-actionbar-bg shadow-md backdrop-blur-sm'
      onClick={(e) => {
        e.stopPropagation()
        e.nativeEvent.stopImmediatePropagation()
        setCurrentLogItem(logItem)
        if (runID)
          setShowMessageLogModal(true)
        else if (isAgent)
          setShowAgentLogModal(true)
        else
          setShowPromptLogModal(true)
      }}
    >
      <ActionButton>
        <RiFileList3Line className='w-4 h-4' />
      </ActionButton>
    </div>
  )
}

export default Log
