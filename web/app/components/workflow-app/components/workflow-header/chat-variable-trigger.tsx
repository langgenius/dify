import { memo } from 'react'
import ChatVariableButton from '@/app/components/workflow/header/chat-variable-button'
import {
  useNodesReadOnly,
} from '@/app/components/workflow/hooks'
import { useIsChatMode } from '../../hooks'

const ChatVariableTrigger = () => {
  const { nodesReadOnly } = useNodesReadOnly()
  const isChatMode = useIsChatMode()

  if (!isChatMode)
    return null

  return <div className='rounded-lg bg-components-actionbar-bg'>
    <ChatVariableButton disabled={nodesReadOnly} />
  </div>
}
export default memo(ChatVariableTrigger)
