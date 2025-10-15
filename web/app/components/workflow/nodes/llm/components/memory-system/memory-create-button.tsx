import { useCallback, useState } from 'react'
import { RiAddLine } from '@remixicon/react'
import VariableModal from '@/app/components/workflow/panel/chat-variable-panel/components/variable-modal'
import type { OffsetOptions, Placement } from '@floating-ui/react'
import {
  PortalToFollowElem,
  PortalToFollowElemContent,
  PortalToFollowElemTrigger,
} from '@/app/components/base/portal-to-follow-elem'
import ActionButton from '@/app/components/base/action-button'
import type { MemoryVariable } from '@/app/components/workflow/types'
import { useStore } from '@/app/components/workflow/store'
import { useNodesSyncDraft } from '@/app/components/workflow/hooks/use-nodes-sync-draft'
import useInspectVarsCrud from '@/app/components/workflow/hooks/use-inspect-vars-crud'
import { useEventEmitterContextContext } from '@/context/event-emitter'
import { MEMORY_VAR_CREATED_BY_MODAL_BY_EVENT_EMITTER, MEMORY_VAR_MODAL_SHOW_BY_EVENT_EMITTER } from '@/app/components/workflow/nodes/_base/components/prompt/type'

type Props = {
  placement?: Placement
  offset?: number | OffsetOptions
  hideTrigger?: boolean
  instanceId?: string
}

const MemoryCreateButton = ({
  placement,
  offset,
  hideTrigger,
  instanceId,
}: Props) => {
  const { eventEmitter } = useEventEmitterContextContext()
  const [open, setOpen] = useState(false)
  const varList = useStore(s => s.memoryVariables) as MemoryVariable[]
  const updateMemoryVarList = useStore(s => s.setMemoryVariables)
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

  const handleSave = useCallback((newMemoryVar: MemoryVariable) => {
    const newList = [newMemoryVar, ...varList]
    updateMemoryVarList(newList)
    handleVarChanged()
    setOpen(false)
    if (instanceId)
      eventEmitter?.emit({ type: MEMORY_VAR_CREATED_BY_MODAL_BY_EVENT_EMITTER, instanceId, variable: ['memory', newMemoryVar.name] } as any)
  }, [varList, updateMemoryVarList, handleVarChanged, setOpen, eventEmitter, instanceId])

  eventEmitter?.useSubscription((v: any) => {
    if (v.type === MEMORY_VAR_MODAL_SHOW_BY_EVENT_EMITTER && v.instanceId === instanceId)
      setOpen(true)
  })

  return (
    <>
      <PortalToFollowElem
        open={open}
        onOpenChange={setOpen}
        placement={placement || 'left'}
        offset={offset}
      >
        <PortalToFollowElemTrigger onClick={() => setOpen(v => !v)}>
          {hideTrigger && <div></div>}
          {!hideTrigger && (
            <ActionButton className='shrink-0'>
              <RiAddLine className='h-4 w-4' />
            </ActionButton>
          )}
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
