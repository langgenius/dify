import type { DeclaredOutputConfig } from '@dify/contracts/api/console/apps/types.gen'
import type { AgentOutputVariablesProps, EditingState } from './utils'
import { Button } from '@langgenius/dify-ui/button'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import Divider from '@/app/components/base/divider'
import OutputVars from '../../../_base/components/output-vars'
import { OutputEditCard } from './edit-card'
import {
  createDraft,
  getOutputDescription,
  getOutputDisplayType,
  getOutputTypeOptionValue,
  isDefaultOutput,
} from './utils'

function OutputRow({
  output,
  editable,
  onDelete,
  onEdit,
}: {
  output: DeclaredOutputConfig
  editable: boolean
  onDelete: () => void
  onEdit: () => void
}) {
  const { t } = useTranslation()
  const description = getOutputDescription(output, t)
  return (
    <div className="group flex min-h-12 flex-col rounded-lg py-0.5 focus-within:bg-state-base-hover hover:bg-state-base-hover">
      <div className="flex h-6 items-center gap-x-1 pr-0.5 pl-1">
        <div className="flex min-w-0 grow items-center gap-x-1">
          <span className="flex h-5 min-w-0 items-center px-1">
            <span className="truncate code-sm-semibold leading-4 text-text-primary">{output.name}</span>
          </span>
          <span className="flex h-5 shrink-0 items-center px-1 system-xs-medium text-text-tertiary">{getOutputDisplayType(output)}</span>
          {output.required && (
            <span className="flex h-3 shrink-0 items-center px-1 system-2xs-medium-uppercase text-text-warning">
              {t('nodes.agent.outputVars.requiredLabel', { ns: 'workflow' })}
            </span>
          )}
        </div>
        {editable && (
          <div className="pointer-events-none flex shrink-0 items-center gap-x-0.5 opacity-0 group-focus-within:pointer-events-auto group-focus-within:opacity-100 group-hover:pointer-events-auto group-hover:opacity-100">
            <button
              type="button"
              aria-label={t('nodes.agent.outputVars.edit', { ns: 'workflow', name: output.name })}
              className="flex size-6 items-center justify-center rounded-md text-text-tertiary hover:bg-state-base-hover-alt hover:text-text-secondary focus-visible:ring-2 focus-visible:ring-state-accent-solid focus-visible:outline-hidden"
              onClick={onEdit}
            >
              <span aria-hidden="true" className="i-ri-pencil-line size-4" />
            </button>
            <button
              type="button"
              aria-label={t('nodes.agent.outputVars.delete', { ns: 'workflow', name: output.name })}
              className="flex size-6 items-center justify-center rounded-md text-text-tertiary hover:bg-state-base-hover-alt hover:text-text-destructive focus-visible:ring-2 focus-visible:ring-state-accent-solid focus-visible:outline-hidden"
              onClick={onDelete}
            >
              <span aria-hidden="true" className="i-ri-delete-bin-line size-4" />
            </button>
          </div>
        )}
      </div>
      {description && (
        <div className="truncate px-2 pb-1 system-xs-regular text-text-tertiary">
          {description}
        </div>
      )}
    </div>
  )
}
export function AgentOutputVariables({
  outputs,
  onChange,
}: AgentOutputVariablesProps) {
  const { t } = useTranslation()
  const [editingState, setEditingState] = useState<EditingState | null>(null)
  function handleNewOutput() {
    setEditingState({ draft: createDraft() })
  }
  function handleEditOutput(index: number) {
    setEditingState({ index, draft: createDraft(outputs[index]) })
  }
  function handleDeleteOutput(index: number) {
    onChange(outputs.filter((_, outputIndex) => outputIndex !== index))
  }
  function handleConfirm(output: DeclaredOutputConfig, index?: number) {
    if (typeof index === 'number') {
      onChange(outputs.map((item, outputIndex) => outputIndex === index ? output : item))
    }
    else {
      onChange([...outputs, output])
    }
    setEditingState(null)
  }
  return (
    <OutputVars>
      <div className="pb-2">
        <div className="flex flex-col">
          {outputs.map((output, index) => (
            editingState?.index === index
              ? (
                  <OutputEditCard
                    key={`${output.name}-editing`}
                    existingOutputs={outputs}
                    state={editingState}
                    onCancel={() => setEditingState(null)}
                    onConfirm={handleConfirm}
                  />
                )
              : (
                  <OutputRow
                    key={`${output.name}-${getOutputTypeOptionValue(output)}`}
                    output={output}
                    editable={!isDefaultOutput(output)}
                    onDelete={() => handleDeleteOutput(index)}
                    onEdit={() => handleEditOutput(index)}
                  />
                )
          ))}
          <div className="py-1">
            <Divider type="horizontal" className="h-px bg-divider-subtle" />
          </div>
          {editingState && editingState.index == null
            ? (
                <OutputEditCard
                  existingOutputs={outputs}
                  state={editingState}
                  onCancel={() => setEditingState(null)}
                  onConfirm={handleConfirm}
                />
              )
            : (
                <div className="pt-1">
                  <Button
                    size="small"
                    variant="tertiary"
                    className="h-6 w-full gap-x-1 rounded-md bg-components-input-bg-normal text-text-secondary hover:bg-state-base-hover"
                    onClick={handleNewOutput}
                  >
                    <span aria-hidden="true" className="i-ri-add-line size-3.5" />
                    {t('nodes.agent.outputVars.newOutput', { ns: 'workflow' })}
                  </Button>
                </div>
              )}
        </div>
      </div>
    </OutputVars>
  )
}
