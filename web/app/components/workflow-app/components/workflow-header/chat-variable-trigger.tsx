import { useAtomValue } from 'jotai'
import { memo } from 'react'
import { isChatflowAtom } from '@/app/components/workflow/editor-resource/state'
import ChatVariableButton from '@/app/components/workflow/header/chat-variable-button'
import { useNodesReadOnly } from '@/app/components/workflow/hooks/use-workflow'

const ChatVariableTrigger = () => {
  const { nodesReadOnly } = useNodesReadOnly()
  const isChatflow = useAtomValue(isChatflowAtom)

  if (!isChatflow) return null

  return <ChatVariableButton disabled={nodesReadOnly} />
}
export default memo(ChatVariableTrigger)
