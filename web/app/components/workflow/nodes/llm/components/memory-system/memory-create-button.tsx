import { useCallback, useState } from 'react'
import { RiAddLine } from '@remixicon/react'
import VariableModal from '@/app/components/workflow/panel/chat-variable-panel/components/variable-modal'
import {
  PortalToFollowElem,
  PortalToFollowElemContent,
  PortalToFollowElemTrigger,
} from '@/app/components/base/portal-to-follow-elem'
import ActionButton from '@/app/components/base/action-button'
import type { ConversationVariable } from '@/app/components/workflow/types'
import { useStore } from '@/app/components/workflow/store'
import { useNodesSyncDraft } from '@/app/components/workflow/hooks/use-nodes-sync-draft'
import useInspectVarsCrud from '@/app/components/workflow/hooks/use-inspect-vars-crud'

const MemoryCreateButton = () => {
  const [open, setOpen] = useState(false)
  const varList = useStore(s => s.conversationVariables) as ConversationVariable[]
  const updateChatVarList = useStore(s => s.setConversationVariables)
  const { doSyncWorkflowDraft } = useNodesSyncDraft()
  const {
    invalidateConversationVarValues,
  } = useInspectVarsCrud()

  const handleVarChanged = useCallback(() => {
    doSyncWorkflowDraft(false, {
      onSuccess() {
        invalidateConversationVarValues()
      },
    })
  }, [doSyncWorkflowDraft, invalidateConversationVarValues])

  const handleSave = useCallback(async (newChatVar: ConversationVariable) => {
    const newList = [newChatVar, ...varList]
    updateChatVarList(newList)
    handleVarChanged()
    setOpen(false)
  }, [varList, updateChatVarList, handleVarChanged, setOpen])

  return (
    <>
      <PortalToFollowElem
        open={open}
        onOpenChange={setOpen}
        placement='left'
      >
        <PortalToFollowElemTrigger onClick={() => setOpen(v => !v)}>
          <ActionButton className='shrink-0'>
            <RiAddLine className='h-4 w-4' />
          </ActionButton>
        </PortalToFollowElemTrigger>
        <PortalToFollowElemContent className='z-[11]'>
          <VariableModal
            onSave={handleSave}
            onClose={() => {
              setOpen(false)
            }}
          />
        </PortalToFollowElemContent>
      </PortalToFollowElem>
    </>
  )
}

export default MemoryCreateButton
