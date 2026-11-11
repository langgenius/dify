import type { DeclaredOutputConfig } from '@dify/contracts/api/console/apps/types.gen'
import type { WorkflowNodesMap } from '@/app/components/base/prompt-editor/types'
import type { NodeOutPutVar } from '@/app/components/workflow/types'
import { cn } from '@langgenius/dify-ui/cn'
import { Field, FieldLabel } from '@langgenius/dify-ui/field'
import { Infotip, InfotipContent, InfotipTrigger } from '@langgenius/dify-ui/infotip'
import { useLexicalComposerContext } from '@lexical/react/LexicalComposerContext'
import { $insertNodes } from 'lexical'
import { useId, useState } from 'react'
import { useTranslation } from 'react-i18next'
import PromptEditor from '@/app/components/base/prompt-editor'
import { $createCustomTextNode } from '@/app/components/base/prompt-editor/plugins/custom-text/node'
import { useWorkflowVariableType } from '@/app/components/workflow/hooks/use-workflow-variables'
import useAvailableVarList from '@/app/components/workflow/nodes/_base/hooks/use-available-var-list'
import { Type } from '@/app/components/workflow/nodes/llm/types'
import { BlockEnum, VarType } from '@/app/components/workflow/types'

const exampleVariables: NodeOutPutVar[] = [
  {
    nodeId: 'policy',
    title: 'Knowledge Retrieval',
    vars: [{ variable: 'result', type: VarType.string }],
  },
  {
    nodeId: 'input',
    title: 'User Input',
    vars: [{ variable: 'contract_text', type: VarType.string }],
  },
]
const exampleNodes: WorkflowNodesMap = {
  policy: { title: 'Knowledge Retrieval', type: BlockEnum.KnowledgeRetrieval },
  input: { title: 'User Input', type: BlockEnum.Start },
}

function TaskToolbar({ value, focused }: { value: string; focused: boolean }) {
  const { t } = useTranslation(['workflowAgent', 'agentRoster'])
  const [editor] = useLexicalComposerContext()
  return (
    <div className="flex h-8 shrink-0 items-center justify-between px-3">
      {focused ? (
        <button
          type="button"
          className="flex items-center gap-1 rounded-sm system-xs-medium text-text-tertiary focus-visible:outline-2 focus-visible:outline-state-accent-solid"
          onMouseDown={(event) => event.preventDefault()}
          onClick={() => {
            editor.focus()
            editor.update(() => $insertNodes([$createCustomTextNode('/')]))
          }}
        >
          <span aria-hidden className="i-ri-slash-commands-2 size-3.5" />
          {t(($) => $['nodes.agent.task.insert'], { ns: 'workflowAgent' })}
        </button>
      ) : (
        <span />
      )}
      <span className="rounded-[5px] border border-divider-deep px-1 system-2xs-medium text-text-tertiary">
        {t(($) => $['external.workflow.task.characterCount'], {
          ns: 'agentRoster',
          count: value.length,
        })}
      </span>
    </div>
  )
}

export function ExternalAgentTaskField({
  id,
  value,
  outputs,
  onChange,
  onOutputsChange,
}: {
  id: string
  value: string
  outputs: DeclaredOutputConfig[]
  onChange: (value: string) => void
  onOutputsChange: (outputs: DeclaredOutputConfig[], task?: string) => void
}) {
  const { t } = useTranslation(['workflowAgent'])
  const labelId = useId()
  const [focused, setFocused] = useState(false)
  const { availableVars, availableNodesWithParent } = useAvailableVarList(id)
  const getWorkflowVarType = useWorkflowVariableType()
  const missingExamples = exampleVariables.filter(
    (example) => !availableVars.some((item) => item.nodeId === example.nodeId),
  )
  const variables = [...availableVars, ...missingExamples]
  const workflowNodesMap = { ...exampleNodes }
  for (const node of availableNodesWithParent)
    workflowNodesMap[node.id] = {
      title: node.data.title,
      type: node.data.type,
      width: node.width ?? undefined,
      height: node.height ?? undefined,
      position: node.position,
    }
  return (
    <Field name="agent_task" className="gap-1 px-4 py-2">
      <div className="flex h-6 items-center gap-1">
        <FieldLabel id={labelId} className="system-sm-semibold-uppercase! text-text-secondary">
          {t(($) => $['nodes.agent.task.label'])}
        </FieldLabel>
        <Infotip>
          <InfotipTrigger aria-labelledby={labelId} />
          <InfotipContent aria-labelledby={labelId}>
            {t(($) => $['nodes.agent.task.tooltip'])}
          </InfotipContent>
        </Infotip>
      </div>
      <div
        className={cn(
          'h-30 rounded-[10px] p-0.5',
          focused
            ? 'bg-linear-to-r from-components-input-border-active-prompt-1 to-components-input-border-active-prompt-2'
            : 'bg-transparent',
        )}
      >
        <div
          className={cn(
            'flex h-full flex-col rounded-lg',
            focused ? 'bg-background-default' : 'bg-components-input-bg-normal',
          )}
        >
          <PromptEditor
            aria-label={t(($) => $['nodes.agent.task.label'])}
            wrapperClassName="flex h-full flex-col"
            className="min-h-0 flex-1 overflow-y-auto px-3 py-2"
            placeholderClassName="px-3 py-2"
            placeholder={t(($) => $['nodes.agent.task.placeholder'])}
            value={value}
            onChange={onChange}
            compact
            editable
            onFocus={() => setFocused(true)}
            onBlur={() => setFocused(false)}
            workflowVariableBlock={{
              show: true,
              variables,
              workflowNodesMap,
              getVarType: (payload) =>
                missingExamples.some((example) => example.nodeId === payload.nodeId)
                  ? Type.string
                  : getWorkflowVarType(payload),
            }}
            isSupportFileVar
            agentOutputBlock={{ show: true, outputs, onChange: onOutputsChange }}
          >
            <TaskToolbar value={value} focused={focused} />
          </PromptEditor>
        </div>
      </div>
    </Field>
  )
}
