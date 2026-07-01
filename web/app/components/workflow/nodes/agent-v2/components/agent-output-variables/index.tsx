import type { DeclaredOutputConfig } from '@dify/contracts/api/console/apps/types.gen'
import type { ReactNode } from 'react'
import type { AgentOutputVariablesProps, DeclaredOutputChildConfig, EditableOutputConfig, EditingState } from './utils'
import { Button } from '@langgenius/dify-ui/button'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import Divider from '@/app/components/base/divider'
import OutputVars from '../../../_base/components/output-vars'
import { OutputEditCard } from './edit-card'
import {
  canOutputHaveChildren,
  createDraft,
  deleteOutputChildAtPath,
  getOutputChildren,
  getOutputChildrenAtPath,
  getOutputDescription,
  getOutputDisplayType,
  getOutputTypeOptionValue,
  insertOutputChildAtPath,
  isDefaultOutput,
  toDeclaredOutputChild,
  updateOutputChildAtPath,
} from './utils'

function OutputRow({
  output,
  editable,
  onAddChild,
  onDelete,
  onEdit,
}: {
  output: EditableOutputConfig
  editable: boolean
  onAddChild?: () => void
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
            {onAddChild && (
              <button
                type="button"
                aria-label={`${t('operation.add', { ns: 'common' })} ${output.name}`}
                className="flex size-6 items-center justify-center rounded-md text-text-tertiary hover:bg-state-base-hover-alt hover:text-text-secondary focus-visible:ring-2 focus-visible:ring-state-accent-solid focus-visible:outline-hidden"
                onClick={onAddChild}
              >
                <span aria-hidden="true" className="i-ri-add-circle-line size-4" />
              </button>
            )}
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

function ChildOutputFrame({ children, depth }: { children: ReactNode, depth: number }) {
  return (
    <div className="flex items-stretch">
      {Array.from({ length: depth }, (_, index) => (
        <div key={index} aria-hidden="true" className="flex w-5 shrink-0 justify-center">
          <div className="w-px bg-divider-subtle" />
        </div>
      ))}
      <div className="min-w-0 flex-1">
        {children}
      </div>
    </div>
  )
}

export function AgentOutputVariables({
  outputs,
  onChange,
}: AgentOutputVariablesProps) {
  const { t } = useTranslation()
  const [editingState, setEditingState] = useState<EditingState | null>(null)
  const [collapsed, setCollapsed] = useState(true)
  function handleNewOutput() {
    setEditingState({ draft: createDraft() })
  }
  function handleEditOutput(index: number) {
    setEditingState({ outputIndex: index, draft: createDraft(outputs[index]) })
  }
  function handleNewChild(outputIndex: number, parentPath: number[]) {
    setEditingState({ outputIndex, parentPath, draft: createDraft() })
  }
  function handleEditChild(outputIndex: number, childPath: number[], child: DeclaredOutputChildConfig) {
    setEditingState({ outputIndex, childPath, draft: createDraft(child) })
  }
  function handleDeleteOutput(index: number) {
    onChange(outputs.filter((_, outputIndex) => outputIndex !== index))
  }
  function handleDeleteChild(outputIndex: number, childPath: number[]) {
    const parent = outputs[outputIndex]
    if (!parent)
      return

    onChange(outputs.map((item, itemIndex) => (
      itemIndex === outputIndex ? deleteOutputChildAtPath(item, childPath) : item
    )))
  }
  function handleConfirm(output: DeclaredOutputConfig, state: EditingState) {
    if (typeof state.outputIndex === 'number' && state.parentPath) {
      const parent = outputs[state.outputIndex]
      if (!parent)
        return

      const childOutput = toDeclaredOutputChild(output)
      onChange(outputs.map((item, outputIndex) => (
        outputIndex === state.outputIndex ? insertOutputChildAtPath(item, state.parentPath!, childOutput) : item
      )))
    }
    else if (typeof state.outputIndex === 'number' && state.childPath) {
      const childOutput = toDeclaredOutputChild(output)
      onChange(outputs.map((item, outputIndex) => (
        outputIndex === state.outputIndex ? updateOutputChildAtPath(item, state.childPath!, childOutput) : item
      )))
    }
    else if (typeof state.outputIndex === 'number') {
      onChange(outputs.map((item, outputIndex) => outputIndex === state.outputIndex ? output : item))
    }
    else {
      onChange([...outputs, output])
    }
    setEditingState(null)
  }
  function renderChildren(output: DeclaredOutputConfig, outputIndex: number, depth: number, children: DeclaredOutputChildConfig[], editable: boolean, parentPath: number[] = []) {
    return (
      <>
        {children.map((child, childIndex) => {
          const childPath = [...parentPath, childIndex]
          const nestedChildren = getOutputChildren(child)
          const isEditingChild = editingState?.outputIndex === outputIndex && pathsEqual(editingState.childPath, childPath)
          return (
            <div key={`${childPath.join('.')}-${child.name}-${getOutputTypeOptionValue(child)}`} className="flex flex-col">
              {isEditingChild
                ? (
                    <ChildOutputFrame depth={depth}>
                      <OutputEditCard
                        allowDefaultValue={false}
                        editingIndex={childIndex}
                        existingOutputs={getOutputChildrenAtPath(output, parentPath)}
                        state={editingState}
                        onCancel={() => setEditingState(null)}
                        onConfirm={handleConfirm}
                      />
                    </ChildOutputFrame>
                  )
                : (
                    <ChildOutputFrame depth={depth}>
                      <OutputRow
                        output={child}
                        editable={editable}
                        onAddChild={editable && canOutputHaveChildren(child) ? () => handleNewChild(outputIndex, childPath) : undefined}
                        onDelete={() => handleDeleteChild(outputIndex, childPath)}
                        onEdit={() => handleEditChild(outputIndex, childPath, child)}
                      />
                    </ChildOutputFrame>
                  )}
              {renderChildren(output, outputIndex, depth + 1, nestedChildren, editable, childPath)}
              {editingState?.outputIndex === outputIndex && pathsEqual(editingState.parentPath, childPath) && (
                <ChildOutputFrame depth={depth + 1}>
                  <OutputEditCard
                    allowDefaultValue={false}
                    existingOutputs={nestedChildren}
                    state={editingState}
                    onCancel={() => setEditingState(null)}
                    onConfirm={handleConfirm}
                  />
                </ChildOutputFrame>
              )}
            </div>
          )
        })}
      </>
    )
  }
  return (
    <OutputVars collapsed={collapsed} onCollapse={setCollapsed}>
      <div className="pb-2">
        <div className="flex flex-col">
          {outputs.map((output, index) => {
            const editable = !isDefaultOutput(output)
            const children = getOutputChildren(output)
            const isEditingOutput = editingState?.outputIndex === index && !editingState.childPath && !editingState.parentPath
            return (
              <div key={`${output.name}-${getOutputTypeOptionValue(output)}`} className="flex flex-col">
                {isEditingOutput
                  ? (
                      <OutputEditCard
                        key={`${output.name}-editing`}
                        editingIndex={index}
                        existingOutputs={outputs}
                        state={editingState}
                        onCancel={() => setEditingState(null)}
                        onConfirm={handleConfirm}
                      />
                    )
                  : (
                      <OutputRow
                        output={output}
                        editable={editable}
                        onAddChild={editable && canOutputHaveChildren(output) ? () => handleNewChild(index, []) : undefined}
                        onDelete={() => handleDeleteOutput(index)}
                        onEdit={() => handleEditOutput(index)}
                      />
                    )}
                {renderChildren(output, index, 1, children, editable)}
                {editingState?.outputIndex === index && editingState.parentPath && !editingState.parentPath.length && (
                  <ChildOutputFrame depth={1}>
                    <OutputEditCard
                      allowDefaultValue={false}
                      existingOutputs={children}
                      state={editingState}
                      onCancel={() => setEditingState(null)}
                      onConfirm={handleConfirm}
                    />
                  </ChildOutputFrame>
                )}
              </div>
            )
          })}
          <div className="py-1">
            <Divider type="horizontal" className="h-px bg-divider-subtle" />
          </div>
          {editingState && editingState.outputIndex == null
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

function pathsEqual(left?: number[], right?: number[]) {
  if (!left || !right || left.length !== right.length)
    return false

  return left.every((item, index) => item === right[index])
}
