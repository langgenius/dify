import type { FC } from 'react'
import type { IChatItem } from '@/app/components/base/chat/chat/type'
import { IconButton } from '@langgenius/dify-ui/icon-button'
import { RiFileList3Line } from '@remixicon/react'
import { useTranslation } from 'react-i18next'
import { useStore as useAppStore } from '@/app/components/app/store'

type LogProps = {
  logItem: IChatItem
}
const Log: FC<LogProps> = ({ logItem }) => {
  const { t } = useTranslation()
  const setCurrentLogItem = useAppStore((s) => s.setCurrentLogItem)
  const setShowPromptLogModal = useAppStore((s) => s.setShowPromptLogModal)
  const setShowAgentLogModal = useAppStore((s) => s.setShowAgentLogModal)
  const setShowMessageLogModal = useAppStore((s) => s.setShowMessageLogModal)
  const { workflow_run_id: runID, agent_thoughts } = logItem
  const isAgent = agent_thoughts && agent_thoughts.length > 0

  return (
    <div
      className="ml-1 flex items-center gap-0.5 rounded-[10px] border-[0.5px] border-components-actionbar-border bg-components-actionbar-bg p-0.5 shadow-md backdrop-blur-xs"
      onClick={(e) => {
        e.stopPropagation()
        e.nativeEvent.stopImmediatePropagation()
        setCurrentLogItem(logItem)
        if (runID) setShowMessageLogModal(true)
        else if (isAgent) setShowAgentLogModal(true)
        else setShowPromptLogModal(true)
      }}
    >
      <IconButton aria-label={t(($) => $['operation.log'], { ns: 'common' })}>
        <RiFileList3Line aria-hidden="true" className="size-4" />
      </IconButton>
    </div>
  )
}

export default Log
