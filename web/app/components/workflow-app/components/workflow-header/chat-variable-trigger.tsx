import { memo } from 'react'
import ChatVariableButton from '@/app/components/workflow/header/chat-variable-button'
import { useNodesReadOnly } from '@/app/components/workflow/hooks/use-workflow'
import { useIsChatMode } from '../../hooks/use-is-chat-mode'

const ChatVariableTrigger = () => {
  const { nodesReadOnly } = useNodesReadOnly()
  const isChatMode = useIsChatMode()

  if (!isChatMode) return null

  return <ChatVariableButton disabled={nodesReadOnly} />
}
export default memo(ChatVariableTrigger)
