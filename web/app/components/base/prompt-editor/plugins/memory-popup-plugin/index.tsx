import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react'
import { createPortal } from 'react-dom'
import { useTranslation } from 'react-i18next'
import {
  autoUpdate,
  flip,
  offset,
  shift,
  size,
  useFloating,
} from '@floating-ui/react'
import {
  RiAddLine,
} from '@remixicon/react'
import { Memory } from '@/app/components/base/icons/src/vender/line/others'
import {
  $getSelection,
  $isRangeSelection,
} from 'lexical'
import { useLexicalComposerContext } from '@lexical/react/LexicalComposerContext'
import { useEventEmitterContextContext } from '@/context/event-emitter'
import { MEMORY_POPUP_SHOW_BY_EVENT_EMITTER, MEMORY_VAR_CREATED_BY_MODAL_BY_EVENT_EMITTER, MEMORY_VAR_MODAL_SHOW_BY_EVENT_EMITTER } from '@/app/components/workflow/nodes/_base/components/prompt/type'
import Divider from '@/app/components/base/divider'
import VariableIcon from '@/app/components/workflow/nodes/_base/components/variable/variable-label/base/variable-icon'
import type {
  MemoryVariable,
} from '@/app/components/workflow/types'
import { INSERT_WORKFLOW_VARIABLE_BLOCK_COMMAND } from '../workflow-variable-block'

import cn from '@/utils/classnames'

export type MemoryPopupProps = {
  className?: string
  container?: Element | null
  instanceId?: string
  memoryVarInNode: MemoryVariable[]
  memoryVarInApp: MemoryVariable[]
}

export default function MemoryPopupPlugin({
  className,
  container,
  instanceId,
  memoryVarInNode,
  memoryVarInApp,
}: MemoryPopupProps) {
  const { t } = useTranslation()
  const [editor] = useLexicalComposerContext()
  const { eventEmitter } = useEventEmitterContextContext()

  const [open, setOpen] = useState(false)
  const portalRef = useRef<HTMLDivElement | null>(null)
  const lastSelectionRef = useRef<Range | null>(null)

  const containerEl = useMemo(() => container ?? (typeof document !== 'undefined' ? document.body : null), [container])

  const useContainer = !!containerEl && containerEl !== document.body

  const { refs, floatingStyles, isPositioned } = useFloating({
    placement: 'bottom-start',
    middleware: [
      offset(0), // fix hide cursor
      shift({
        padding: 8,
        altBoundary: true,
      }),
      flip(),
      size({
        apply({ availableWidth, availableHeight, elements }) {
          Object.assign(elements.floating.style, {
            maxWidth: `${Math.min(400, availableWidth)}px`,
            maxHeight: `${Math.min(300, availableHeight)}px`,
            overflow: 'auto',
          })
        },
        padding: 8,
      }),
    ],
    whileElementsMounted: autoUpdate,
  })

  const openPortal = useCallback(() => {
    const domSelection = window.getSelection()
    let range: Range | null = null
    if (domSelection && domSelection.rangeCount > 0)
      range = domSelection.getRangeAt(0).cloneRange()
    else
      range = lastSelectionRef.current

    if (range) {
      const rects = range.getClientRects()
      let rect: DOMRect | null = null

      if (rects && rects.length)
        rect = rects[rects.length - 1]

      else
        rect = range.getBoundingClientRect()

      if (rect.width === 0 && rect.height === 0) {
        const root = editor.getRootElement()
        if (root) {
          const sc = range.startContainer
          const node = sc.nodeType === Node.ELEMENT_NODE
            ? sc as Element
            : (sc.parentElement || root)

          rect = node.getBoundingClientRect()

          if (rect.width === 0 && rect.height === 0)
            rect = root.getBoundingClientRect()
        }
      }

      if (rect && !(rect.top === 0 && rect.left === 0 && rect.width === 0 && rect.height === 0)) {
        const virtualEl = {
          getBoundingClientRect() {
            return rect!
          },
        }
        refs.setReference(virtualEl as Element)
      }
    }

    setOpen(true)
  }, [setOpen])

  const closePortal = useCallback(() => {
    setOpen(false)
  }, [setOpen])

  const handleSelectVariable = useCallback((variable: string[]) => {
    editor.dispatchCommand(INSERT_WORKFLOW_VARIABLE_BLOCK_COMMAND, variable)
    closePortal()
  }, [editor, closePortal])

  const handleCreate = useCallback(() => {
    eventEmitter?.emit({ type: MEMORY_VAR_MODAL_SHOW_BY_EVENT_EMITTER, instanceId } as any)
    closePortal()
  }, [eventEmitter, instanceId, closePortal])

  eventEmitter?.useSubscription((v: any) => {
    if (v.type === MEMORY_POPUP_SHOW_BY_EVENT_EMITTER && v.instanceId === instanceId)
      openPortal()
  })

  eventEmitter?.useSubscription((v: any) => {
    if (v.type === MEMORY_VAR_CREATED_BY_MODAL_BY_EVENT_EMITTER && v.instanceId === instanceId)
      handleSelectVariable(v.variable)
  })

  useEffect(() => {
    return editor.registerUpdateListener(({ editorState }) => {
      editorState.read(() => {
        const selection = $getSelection()
        if ($isRangeSelection(selection)) {
          const domSelection = window.getSelection()
          if (domSelection && domSelection.rangeCount > 0)
            lastSelectionRef.current = domSelection.getRangeAt(0).cloneRange()
        }
      })
    })
  }, [editor])

  useEffect(() => {
    if (!open)
      return

    const onMouseDown = (e: MouseEvent) => {
      if (!portalRef.current)
        return
      if (!portalRef.current.contains(e.target as Node))
        closePortal()
    }
    document.addEventListener('mousedown', onMouseDown, false)
    return () => document.removeEventListener('mousedown', onMouseDown, false)
  }, [open, closePortal])

  if (!open || !containerEl)
    return null

  return createPortal(
    <div className='h-0 w-0'>
      <div
        ref={(node) => {
          portalRef.current = node
          refs.setFloating(node)
        }}
        className={cn(
          useContainer ? '' : 'z-[999999]',
          'absolute rounded-xl shadow-lg backdrop-blur-sm',
          className,
        )}
        style={{
          ...floatingStyles,
          visibility: isPositioned ? 'visible' : 'hidden',
        }}
      >
        <div className='w-[261px] rounded-xl border-[0.5px] border-components-panel-border bg-components-panel-bg-blur'>
          {memoryVarInNode.length > 0 && (
            <>
              <div className='flex items-center gap-1 pb-1 pt-2.5'>
                <Divider className='!h-px !w-3 bg-divider-subtle' />
                <div className='system-2xs-medium-uppercase shrink-0 text-text-tertiary'>{t('workflow.nodes.llm.memory.currentNodeLabel')}</div>
                <Divider className='!h-px grow bg-divider-subtle' />
              </div>
              <div className='p-1'>
                {memoryVarInNode.map(variable => (
                  <div
                    key={variable.id}
                    className='flex cursor-pointer items-center gap-1 rounded-md px-3 py-1 hover:bg-state-base-hover'
                    onClick={() => handleSelectVariable(['memory_block', variable.id])}
                  >
                    <VariableIcon
                      variables={['memory_block', variable.id]}
                      className='text-util-colors-teal-teal-700'
                    />
                    <div title={variable.name} className='system-sm-medium shrink-0 truncate text-text-secondary'>{variable.name}</div>
                  </div>
                ))}
              </div>
            </>
          )}
          {memoryVarInApp.length > 0 && (
            <>
              <div className='flex items-center gap-1 pb-1 pt-2.5'>
                <Divider className='!h-px !w-3 bg-divider-subtle' />
                <div className='system-2xs-medium-uppercase shrink-0 text-text-tertiary'>{t('workflow.nodes.llm.memory.conversationScopeLabel')}</div>
                <Divider className='!h-px grow bg-divider-subtle' />
              </div>
              <div className='p-1'>
                {memoryVarInApp.map(variable => (
                  <div
                    key={variable.id}
                    className='flex cursor-pointer items-center gap-1 rounded-md px-3 py-1 hover:bg-state-base-hover'
                    onClick={() => handleSelectVariable(['memory_block', variable.id])}
                  >
                    <VariableIcon
                      variables={['memory_block', variable.id]}
                      className='text-util-colors-teal-teal-700'
                    />
                    <div title={variable.name} className='system-sm-medium shrink-0 truncate text-text-secondary'>{variable.name}</div>
                  </div>
                ))}
              </div>
            </>
          )}
          {!memoryVarInNode.length && !memoryVarInApp.length && (
            <div className='p-2'>
              <div className='flex flex-col gap-2 rounded-[10px] bg-workflow-process-bg p-4'>
                <div className='flex h-10 w-10 items-center justify-center rounded-lg border-[0.5px] border-components-card-border bg-components-card-bg shadow-lg backdrop-blur-sm'>
                  <Memory className='h-5 w-5 text-util-colors-teal-teal-700' />
                </div>
                <div className='system-sm-medium text-text-secondary'>{t('workflow.nodes.llm.memory.emptyState')}</div>
              </div>
            </div>
          )}
          <div className='system-xs-medium flex cursor-pointer items-center gap-1 border-t border-divider-subtle px-4 py-2 text-text-accent-light-mode-only' onClick={handleCreate}>
            <RiAddLine className='h-4 w-4' />
            <div>{t('workflow.nodes.llm.memory.createButton')}</div>
          </div>
        </div>
      </div>
    </div>,
    containerEl,
  )
}
