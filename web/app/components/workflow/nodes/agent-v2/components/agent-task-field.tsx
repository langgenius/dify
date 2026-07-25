import type { DeclaredOutputConfig } from '@dify/contracts/api/console/apps/types.gen'
import type { AgentV2NodeType } from '../types'
import type { AgentOutputTypeOptionValue } from '@/app/components/base/prompt-editor/plugins/agent-output-block/utils'
import type { WorkflowNodesMap } from '@/app/components/base/prompt-editor/types'
import { cn } from '@langgenius/dify-ui/cn'
import { Field, FieldLabel } from '@langgenius/dify-ui/field'
import { useLexicalComposerContext } from '@lexical/react/LexicalComposerContext'
import { useBoolean } from 'ahooks'
import { $insertNodes } from 'lexical'
import { useCallback } from 'react'
import { useTranslation } from 'react-i18next'
import { Infotip } from '@/app/components/base/infotip'
import PromptEditor from '@/app/components/base/prompt-editor'
import { $createCustomTextNode } from '@/app/components/base/prompt-editor/plugins/custom-text/node'
import { useWorkflowVariableType } from '../../../hooks'
import { BlockEnum } from '../../../types'
import useAvailableVarList from '../../_base/hooks/use-available-var-list'

const i18nPrefix = 'nodes.agent'

function AgentTaskToolbar({ taskLength, onInsert }: { taskLength: number; onInsert: () => void }) {
  const { t } = useTranslation()
  const [editor] = useLexicalComposerContext()

  const handleInsert = useCallback(() => {
    onInsert()
    editor.focus()
    editor.update(() => {
      $insertNodes([$createCustomTextNode('/')])
    })
  }, [editor, onInsert])

  return (
    <div className="flex h-8 shrink-0 items-center justify-between px-3 text-text-tertiary">
      <div className="flex min-w-0 items-center gap-3">
        <button
          type="button"
          className="flex items-center gap-1 system-xs-medium hover:text-text-secondary focus-visible:ring-2 focus-visible:ring-state-accent-solid focus-visible:outline-hidden"
          onClick={handleInsert}
        >
          <span aria-hidden className="i-ri-slash-commands-2 size-3.5" />
          {t(($) => $[`${i18nPrefix}.task.insert`], { ns: 'workflow' })}
        </button>
      </div>
      <div className="rounded-sm border border-divider-regular bg-background-default px-1 system-2xs-regular text-text-tertiary">
        {taskLength}
      </div>
    </div>
  )
}

export function AgentTaskField({
  id,
  data,
  readOnly,
  onChange,
  outputs,
  onOutputsChange,
  onEditOutput,
}: {
  id: string
  data: AgentV2NodeType
  readOnly?: boolean
  onChange: (value: string) => void
  outputs: DeclaredOutputConfig[]
  onOutputsChange: (outputs: DeclaredOutputConfig[], prompt?: string) => void
  onEditOutput?: (name: string, outputType: AgentOutputTypeOptionValue) => void
}) {
  const { t } = useTranslation()
  const getVarType = useWorkflowVariableType()
  const { availableVars, availableNodesWithParent } = useAvailableVarList(id)
  const [isFocus, { setTrue: setFocus, setFalse: setBlur }] = useBoolean(false)

  const workflowNodesMap = availableNodesWithParent.reduce<WorkflowNodesMap>((acc, node) => {
    acc[node.id] = {
      title: node.data.title,
      type: node.data.type,
      width: node.width ?? undefined,
      height: node.height ?? undefined,
      position: node.position,
    }
    if (node.data.type === BlockEnum.Start) {
      acc.sys = {
        title: t(($) => $['blocks.start'], { ns: 'workflow' }),
        type: BlockEnum.Start,
      }
    }
    return acc
  }, {})

  return (
    <Field name="agent_task" className="gap-1 px-4 py-2">
      <div className="flex h-6 items-center gap-1">
        <FieldLabel className="min-w-0 py-1 system-sm-semibold-uppercase! text-text-secondary">
          {t(($) => $[`${i18nPrefix}.task.label`], { ns: 'workflow' })}
        </FieldLabel>
        <Infotip
          aria-label={t(($) => $[`${i18nPrefix}.task.tooltip`], { ns: 'workflow' })}
          popupClassName="whitespace-pre-line"
        >
          {t(($) => $[`${i18nPrefix}.task.tooltip`], { ns: 'workflow' })}
        </Infotip>
      </div>
      <div
        className={cn(
          'h-80 rounded-[9px]! p-0.5',
          isFocus
            ? 'bg-linear-to-r from-components-input-border-active-prompt-1 to-components-input-border-active-prompt-2'
            : 'bg-transparent',
          readOnly && 'pointer-events-none',
        )}
      >
        <div
          className={cn(
            'flex h-full flex-col rounded-lg',
            isFocus ? 'bg-background-default' : 'bg-components-input-bg-normal',
          )}
        >
          <PromptEditor
            aria-label={t(($) => $[`${i18nPrefix}.task.label`], { ns: 'workflow' })}
            wrapperClassName="flex h-full flex-col"
            value={data.agent_task || ''}
            onChange={onChange}
            editable={!readOnly}
            compact
            className="min-h-0 flex-1 overflow-y-auto px-3 py-2"
            placeholderClassName="px-3 py-2"
            placeholder={t(($) => $[`${i18nPrefix}.task.placeholder`], { ns: 'workflow' })}
            onFocus={setFocus}
            onBlur={setBlur}
            workflowVariableBlock={{
              show: true,
              variables: availableVars,
              getVarType,
              workflowNodesMap,
            }}
            isSupportFileVar
            agentOutputBlock={{
              show: true,
              outputs,
              onChange: onOutputsChange,
              onEdit: onEditOutput,
            }}
          >
            {isFocus && (
              <AgentTaskToolbar taskLength={(data.agent_task || '').length} onInsert={setFocus} />
            )}
          </PromptEditor>
        </div>
      </div>
    </Field>
  )
}
