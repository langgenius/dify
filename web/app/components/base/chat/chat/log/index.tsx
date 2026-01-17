import type { FC } from 'react'
import type { IChatItem } from '@/app/components/base/chat/chat/type'
import { RiFileList3Line } from '@remixicon/react'
import { useStore as useAppStore } from '@/app/components/app/store'
import ActionButton from '@/app/components/base/action-button'

type LogProps = {
  logItem: IChatItem
}

const Log: FC<LogProps> = ({
  logItem,
}) => {
  const { workflow_run_id: runID, agent_thoughts } = logItem
  const isAgent = agent_thoughts && agent_thoughts.length > 0

  const handleClick = (e: React.MouseEvent<HTMLDivElement>) => {
    const { setCurrentLogItem, setShowPromptLogModal, setShowAgentLogModal, setShowMessageLogModal } = useAppStore.getState()
    e.stopPropagation()
    e.nativeEvent.stopImmediatePropagation()
    setCurrentLogItem(logItem)
    if (runID)
      setShowMessageLogModal(true)
    else if (isAgent)
      setShowAgentLogModal(true)
    else
      setShowPromptLogModal(true)
  }

  return (
    <div
      className="ml-1 flex items-center gap-0.5 rounded-[10px] border-[0.5px] border-components-actionbar-border bg-components-actionbar-bg p-0.5 shadow-md backdrop-blur-sm"
      onClick={handleClick}
    >
      <ActionButton>
        <RiFileList3Line className="h-4 w-4" />
      </ActionButton>
    </div>
  )
}

export default Log
