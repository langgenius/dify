'use client'
import type { FC } from 'react'
import type { Node, NodeOutPutVar } from '@/app/components/workflow/types'
import { cn } from '@langgenius/dify-ui/cn'
import { Tooltip, TooltipContent, TooltipTrigger } from '@langgenius/dify-ui/tooltip'
import { useBoolean } from 'ahooks'
import { noop } from 'es-toolkit/function'
import * as React from 'react'
import { useCallback, useEffect } from 'react'
import { useTranslation } from 'react-i18next'
import { Variable02 } from '@/app/components/base/icons/src/vender/solid/development'
import PromptEditor from '@/app/components/base/prompt-editor'
import { useStore } from '@/app/components/workflow/store'
import { BlockEnum } from '@/app/components/workflow/types'

type Props = Readonly<{
  instanceId?: string
  className?: string
  placeholder?: string
  placeholderClassName?: string
  promptMinHeightClassName?: string
  value: string
  onChange: (value: string) => void
  onFocusChange?: (value: boolean) => void
  readOnly?: boolean
  justVar?: boolean
  singleLine?: boolean
  onCommit?: () => void
  nodesOutputVars?: NodeOutPutVar[]
  availableNodes?: Node[]
  insertVarTipToLeft?: boolean
}>

const Editor: FC<Props> = ({
  instanceId,
  className,
  placeholder,
  placeholderClassName,
  promptMinHeightClassName = 'min-h-[20px]',
  value,
  onChange,
  onFocusChange,
  readOnly,
  nodesOutputVars,
  availableNodes = [],
  insertVarTipToLeft,
  singleLine = false,
  onCommit,
}) => {
  const { t } = useTranslation()

  const [isFocus, { setTrue: setFocus, setFalse: setBlur }] = useBoolean(false)

  useEffect(() => {
    onFocusChange?.(isFocus)
  }, [isFocus])

  const pipelineId = useStore((s) => s.pipelineId)
  const setShowInputFieldPanel = useStore((s) => s.setShowInputFieldPanel)

  const handleKeyDownCapture = useCallback(
    (e: React.KeyboardEvent<HTMLDivElement>) => {
      if (!singleLine || e.key !== 'Enter') return
      // When the variable-insert menu is open, Enter must select the highlighted
      // variable — let the editor handle it. The menu exposes its open state as
      // a data attribute (set from isPositioned) instead of relying on the
      // inline visibility style, so the check survives styling changes.
      const menuOpen = document.querySelector(
        '[data-prompt-editor-typeahead-menu] > div[data-visible="true"]',
      )
      if (menuOpen) return
      // Capture phase is required here: Lexical registers a native keydown
      // listener directly on the contentEditable, which runs before React's
      // delegated (bubble-phase) synthetic handlers on Chromium and inserts the
      // paragraph synchronously — too late for a bubble-phase preventDefault.
      // Intercepting in the capture phase stops the event before it ever
      // reaches Lexical, so no newline is inserted. WebKit happened to order
      // the handlers differently, which is why this only misbehaved on Chromium.
      e.preventDefault()
      e.stopPropagation()
      onCommit?.()
    },
    [singleLine, onCommit],
  )

  return (
    <div
      className={cn(className, 'relative min-h-8')}
      role="presentation"
      onKeyDownCapture={handleKeyDownCapture}
    >
      <>
        <PromptEditor
          instanceId={instanceId}
          className={cn(promptMinHeightClassName, 'leading-4.5')}
          placeholder={placeholder}
          placeholderClassName={placeholderClassName}
          value={value}
          contextBlock={{
            show: false,
            selectable: false,
            datasets: [],
            onAddContext: noop,
          }}
          historyBlock={{
            show: false,
            selectable: false,
            history: {
              user: 'Human',
              assistant: 'Assistant',
            },
            onEditRole: noop,
          }}
          queryBlock={{
            show: false,
            selectable: false,
          }}
          workflowVariableBlock={{
            show: true,
            variables: nodesOutputVars || [],
            workflowNodesMap: availableNodes.reduce((acc, node) => {
              acc[node.id] = {
                title: node.data.title,
                type: node.data.type,
                width: node.width,
                height: node.height,
                position: node.position,
              }
              if (node.data.type === BlockEnum.Start) {
                acc.sys = {
                  title: t(($) => $['blocks.start'], { ns: 'workflow' }),
                  type: BlockEnum.Start,
                }
              }
              return acc
            }, {} as any),
            showManageInputField: !!pipelineId,
            onManageInputField: () => setShowInputFieldPanel?.(true),
          }}
          onChange={onChange}
          editable={!readOnly}
          onBlur={setBlur}
          onFocus={setFocus}
        />
        {/* to patch Editor not support dynamic change editable status */}
        {readOnly && <div className="absolute inset-0 z-10"></div>}
        {isFocus && (
          <div
            className={cn(
              'absolute z-10',
              insertVarTipToLeft ? 'top-1.5 -left-3' : '-top-2.25 right-1',
            )}
          >
            <Tooltip>
              <TooltipTrigger
                render={
                  <div className="cursor-pointer rounded-[5px] border-[0.5px] border-divider-regular bg-components-badge-white-to-dark p-0.5 shadow-lg">
                    <Variable02 className="size-3.5 text-components-button-secondary-accent-text" />
                  </div>
                }
              />
              <TooltipContent>
                {`${t(($) => $['common.insertVarTip'], { ns: 'workflow' })}`}
              </TooltipContent>
            </Tooltip>
          </div>
        )}
      </>
    </div>
  )
}
export default React.memo(Editor)
