'use client'

import type { RangeSelection } from 'lexical'
import type { AriaAttributes } from 'react'
import type { Node, NodeOutPutVar, ValueSelector } from '@/app/components/workflow/types'
import { cn } from '@langgenius/dify-ui/cn'
import { Field } from '@langgenius/dify-ui/field'
import { IconButton } from '@langgenius/dify-ui/icon-button'
import { Popover, PopoverContent, PopoverTrigger } from '@langgenius/dify-ui/popover'
import { useLexicalComposerContext } from '@lexical/react/LexicalComposerContext'
import { mergeRegister } from '@lexical/utils'
import {
  $getNodeByKey,
  $getRoot,
  $getSelection,
  $isRangeSelection,
  $setSelection,
  COMMAND_PRIORITY_HIGH,
  HISTORY_PUSH_TAG,
  INSERT_LINE_BREAK_COMMAND,
  INSERT_PARAGRAPH_COMMAND,
  KEY_ENTER_COMMAND,
  PASTE_COMMAND,
} from 'lexical'
import { useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import PromptEditor from '@/app/components/base/prompt-editor'
import { INSERT_WORKFLOW_VARIABLE_BLOCK_COMMAND } from '@/app/components/base/prompt-editor/plugins/workflow-variable-block'
import { BlockEnum } from '@/app/components/workflow/types'
import VarReferenceVars from '../../_base/components/variable/var-reference-vars'

const normalizeSubject = (value: string) => value.replace(/[\r\n\u2028\u2029]+/g, ' ')

// Subject owns its single-line editing rules and the selection used by its toolbar picker.
const SubjectEditorControls = ({
  disabled,
  availableVars,
}: {
  disabled: boolean
  availableVars: NodeOutPutVar[]
}) => {
  const [editor] = useLexicalComposerContext()
  const { t } = useTranslation(['workflow'])
  const searchInputRef = useRef<HTMLInputElement>(null)
  const inputRef = useRef<HTMLElement | null>(null)
  const selectionRef = useRef<RangeSelection | null>(null)
  const [open, setOpen] = useState(false)
  const insertVariableLabel = t(($) => $['nodes.humanInputV2.template.insertVariable'], {
    ns: 'workflow',
  })

  useEffect(
    () =>
      mergeRegister(
        editor.registerRootListener((root) => {
          inputRef.current = root
        }),
        editor.registerUpdateListener(({ editorState }) => {
          editorState.read(() => {
            const selection = $getSelection()
            if ($isRangeSelection(selection)) selectionRef.current = selection.clone()
          })
        }),
        editor.registerCommand(
          KEY_ENTER_COMMAND,
          (event) => {
            if (event?.isComposing) return false
            event?.preventDefault()
            return true
          },
          COMMAND_PRIORITY_HIGH,
        ),
        editor.registerCommand(INSERT_PARAGRAPH_COMMAND, () => true, COMMAND_PRIORITY_HIGH),
        editor.registerCommand(INSERT_LINE_BREAK_COMMAND, () => true, COMMAND_PRIORITY_HIGH),
        editor.registerCommand(
          PASTE_COMMAND,
          (event) => {
            if (!editor.isEditable() || !event || !('clipboardData' in event)) return false
            const selection = $getSelection()
            if (!$isRangeSelection(selection) || !event.clipboardData) return false
            event.preventDefault()
            selection.insertText(normalizeSubject(event.clipboardData.getData('text/plain')))
            return true
          },
          COMMAND_PRIORITY_HIGH,
        ),
      ),
    [editor],
  )

  const insertVariable = (selector: ValueSelector) => {
    if (disabled || !editor.isEditable()) {
      setOpen(false)
      return
    }
    editor.update(
      () => {
        if (!editor.isEditable()) return
        const previous = selectionRef.current
        if (
          previous &&
          $getNodeByKey(previous.anchor.key)?.isAttached() &&
          $getNodeByKey(previous.focus.key)?.isAttached()
        )
          $setSelection(previous.clone())
        else $getRoot().selectEnd()
        editor.dispatchCommand(INSERT_WORKFLOW_VARIABLE_BLOCK_COMMAND, selector)
      },
      { tag: HISTORY_PUSH_TAG },
    )
    setOpen(false)
    editor.focus(undefined, { defaultSelection: 'rootEnd' })
  }

  return (
    <Popover
      open={open}
      onOpenChange={(nextOpen) => {
        if (nextOpen && disabled) return
        setOpen(nextOpen)
      }}
    >
      <PopoverTrigger
        render={
          <IconButton
            className="absolute end-1 top-1/2 -translate-y-1/2"
            type="button"
            size="xs"
            aria-label={insertVariableLabel}
            title={insertVariableLabel}
            disabled={disabled}
          >
            <span aria-hidden="true" className="i-custom-vender-workflow-variable-x size-4" />
          </IconButton>
        }
      />
      <PopoverContent
        aria-label={insertVariableLabel}
        align="end"
        className="w-75 p-1"
        initialFocus={searchInputRef}
        finalFocus={inputRef}
      >
        {/* The picker search must not inherit the Subject field's id, label, or validation. */}
        <Field className="contents">
          <VarReferenceVars
            vars={availableVars}
            searchInputRef={searchInputRef}
            maxHeightClass="max-h-64"
            onChange={insertVariable}
            onClose={() => setOpen(false)}
          />
        </Field>
      </PopoverContent>
    </Popover>
  )
}

type MessageTemplateSubjectProps = Pick<
  AriaAttributes,
  'aria-labelledby' | 'aria-describedby' | 'aria-invalid'
> & {
  id: string
  value: string
  onValueChange: (value: string) => void
  availableVars: NodeOutPutVar[]
  availableNodes: Node[]
  disabled?: boolean
  placeholder?: string
}

const MessageTemplateSubject = ({
  value,
  onValueChange,
  availableVars,
  availableNodes,
  disabled = false,
  placeholder,
  ...props
}: MessageTemplateSubjectProps) => {
  const { t } = useTranslation(['workflow'])
  const workflowNodesMap = useMemo(
    () =>
      availableNodes.reduce(
        (acc, node) => {
          acc[node.id] = { title: node.data.title, type: node.data.type }
          if (node.data.type === BlockEnum.Start)
            acc.sys = {
              title: t(($) => $['blocks.start'], { ns: 'workflow' }),
              type: BlockEnum.Start,
            }
          return acc
        },
        {} as Record<string, Pick<Node['data'], 'title' | 'type'>>,
      ),
    [availableNodes, t],
  )

  return (
    <PromptEditor
      {...props}
      wrapperClassName={cn(
        'min-h-8 w-full rounded-lg border border-transparent bg-components-input-bg-normal py-1 ps-2 pe-8',
        'hover:border-components-input-border-hover hover:bg-components-input-bg-hover',
        'focus-within:border-components-input-border-active focus-within:bg-components-input-bg-active focus-within:shadow-xs',
        disabled && 'cursor-not-allowed opacity-50',
      )}
      className="min-h-6 break-words [&_[data-lexical-decorator]]:h-lh [&_[data-lexical-decorator]]:align-top"
      placeholderClassName="px-2 py-1 pe-8"
      placeholder={placeholder}
      editable={!disabled}
      aria-disabled={disabled}
      aria-multiline={false}
      value={normalizeSubject(value)}
      onChange={(text) => {
        const nextValue = normalizeSubject(text)
        if (nextValue !== normalizeSubject(value)) onValueChange(nextValue)
      }}
      workflowVariableBlock={{ show: true, variables: availableVars, workflowNodesMap }}
      disableSlashPicker
      disableBracePicker
    >
      <SubjectEditorControls disabled={disabled} availableVars={availableVars} />
    </PromptEditor>
  )
}

export default MessageTemplateSubject
