import { memo } from 'react'
import ChatVariableButton from '@/app/components/workflow/header/chat-variable-button'
import {
  useNodesReadOnly,
} from '@/app/components/workflow/hooks'

const ChatVariableTrigger = () => {
  const { nodesReadOnly } = useNodesReadOnly()
  return <ChatVariableButton disabled={nodesReadOnly} />
}
export default memo(ChatVariableTrigger)
