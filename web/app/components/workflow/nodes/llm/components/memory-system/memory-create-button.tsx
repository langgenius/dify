import { useCallback, useState } from 'react'
import VariableModal from '@/app/components/workflow/panel/chat-variable-panel/components/variable-modal'
import type { OffsetOptions, Placement } from '@floating-ui/react'
import {
  PortalToFollowElem,
  PortalToFollowElemContent,
  PortalToFollowElemTrigger,
} from '@/app/components/base/portal-to-follow-elem'
import type { MemoryVariable } from '@/app/components/workflow/types'
import { useEventEmitterContextContext } from '@/context/event-emitter'
import { MEMORY_VAR_CREATED_BY_MODAL_BY_EVENT_EMITTER, MEMORY_VAR_MODAL_SHOW_BY_EVENT_EMITTER } from '@/app/components/workflow/nodes/_base/components/prompt/type'
import { useMemoryVariables } from './hooks/use-memory-variables'

type Props = {
  placement?: Placement
  offset?: number | OffsetOptions
  hideTrigger?: boolean
  instanceId?: string
  nodeId: string
  renderTrigger?: (open?: boolean) => React.ReactNode
}

const MemoryCreateButton = ({
  placement,
  offset,
  instanceId,
  nodeId,
  renderTrigger = () => <div></div>,
}: Props) => {
  const { eventEmitter } = useEventEmitterContextContext()
  const [open, setOpen] = useState(false)
  const { handleSave: handleSaveMemoryVariables } = useMemoryVariables(nodeId)

  const handleSave = useCallback((newMemoryVar: MemoryVariable) => {
    handleSaveMemoryVariables(newMemoryVar)
    if (instanceId)
      eventEmitter?.emit({ type: MEMORY_VAR_CREATED_BY_MODAL_BY_EVENT_EMITTER, instanceId, variable: ['memory', newMemoryVar.name] } as any)
  }, [handleSaveMemoryVariables, eventEmitter, instanceId])

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
          {renderTrigger?.(open)}
        </PortalToFollowElemTrigger>
        <PortalToFollowElemContent className='z-[11]'>
          <VariableModal
            onSave={handleSave}
            onClose={() => {
              setOpen(false)
            }}
            nodeScopeMemoryVariable={nodeId ? { nodeId } : undefined}
          />
        </PortalToFollowElemContent>
      </PortalToFollowElem>
    </>
  )
}

export default MemoryCreateButton
