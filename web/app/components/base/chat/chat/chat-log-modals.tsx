import type { FC } from 'react'
import type { IChatItem } from './type'
import AgentLogModal from '@/app/components/base/agent-log-modal'
import PromptLogModal from '@/app/components/base/prompt-log-modal'

type ChatLogModalsProps = {
  width: number
  currentLogItem?: IChatItem
  showPromptLogModal: boolean
  showAgentLogModal: boolean
  hideLogModal?: boolean
  setCurrentLogItem: (item?: IChatItem) => void
  setShowPromptLogModal: (showPromptLogModal: boolean) => void
  setShowAgentLogModal: (showAgentLogModal: boolean) => void
}

const ChatLogModals: FC<ChatLogModalsProps> = ({
  width,
  currentLogItem,
  showPromptLogModal,
  showAgentLogModal,
  hideLogModal,
  setCurrentLogItem,
  setShowPromptLogModal,
  setShowAgentLogModal,
}) => {
  if (hideLogModal)
    return null

  return (
    <>
      {showPromptLogModal && (
        <PromptLogModal
          width={width}
          currentLogItem={currentLogItem}
          onCancel={() => {
            setCurrentLogItem()
            setShowPromptLogModal(false)
          }}
        />
      )}
      {showAgentLogModal && (
        <AgentLogModal
          width={width}
          currentLogItem={currentLogItem}
          onCancel={() => {
            setCurrentLogItem()
            setShowAgentLogModal(false)
          }}
        />
      )}
    </>
  )
}

export default ChatLogModals
