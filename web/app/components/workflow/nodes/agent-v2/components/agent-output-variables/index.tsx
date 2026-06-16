import type { DeclaredOutputConfig } from '@dify/contracts/api/console/apps/types.gen'
import type { AgentOutputVariablesProps, EditingState, OutputDraft } from './utils'
import { Button } from '@langgenius/dify-ui/button'
import { cn } from '@langgenius/dify-ui/cn'
import { FieldControl, FieldError, FieldLabel, FieldRoot } from '@langgenius/dify-ui/field'
import { Form } from '@langgenius/dify-ui/form'
import { Switch } from '@langgenius/dify-ui/switch'
import { Textarea } from '@langgenius/dify-ui/textarea'
import { useId, useState } from 'react'
import { useTranslation } from 'react-i18next'
import Divider from '@/app/components/base/divider'
import OutputVars from '../../../_base/components/output-vars'
import { OutputTypeSelect } from './type-select'
import {
  createDraft,
  createOutputFromDraft,
  getDefaultValueErrorKey,
  getOutputDescription,
  getOutputDisplayType,
  getOutputTypeOptionValue,
  isDefaultOutput,
  OUTPUT_NAME_PATTERN,
  OUTPUT_NAME_PATTERN_SOURCE,
} from './utils'

function OutputEditCard({
  existingOutputs,
  state,
  onCancel,
  onConfirm,
}: {
  existingOutputs: DeclaredOutputConfig[]
  state: EditingState
  onCancel: () => void
  onConfirm: (output: DeclaredOutputConfig, index?: number) => void
}) {
  const { t } = useTranslation()
  const nameErrorId = useId()
  const [draft, setDraft] = useState(state.draft)
  const [showAdvancedOptions, setShowAdvancedOptions] = useState(false)
  const trimmedName = draft.name.trim()
  const duplicateName = existingOutputs.some((output, index) => output.name === trimmedName && index !== state.index)
  const nameInvalid = !!trimmedName && !OUTPUT_NAME_PATTERN.test(trimmedName)
  const hasNameError = duplicateName || nameInvalid
  const defaultValueErrorKey = getDefaultValueErrorKey(draft)
  const confirmDisabled = !trimmedName || nameInvalid || duplicateName || !!defaultValueErrorKey
  function updateDraft(next: Partial<OutputDraft>) {
    setDraft(prev => ({ ...prev, ...next }))
  }
  function handleConfirm() {
    if (confirmDisabled)
      return
    onConfirm(createOutputFromDraft(draft), state.index)
  }
  return (
    <Form
      aria-label={t('nodes.agent.outputVars.editorLabel', { ns: 'workflow' })}
      className="flex flex-col overflow-hidden rounded-xl border border-components-panel-border bg-components-panel-bg shadow-md shadow-shadow-shadow-4"
      onSubmit={(event) => {
        event.preventDefault()
        handleConfirm()
      }}
    >
      <div className="px-2 pt-2">
        <div className="flex h-6 items-center gap-x-2">
          <FieldRoot name="name" invalid={hasNameError} className="contents">
            <FieldLabel className="sr-only">
              {t('nodes.agent.outputVars.nameLabel', { ns: 'workflow' })}
            </FieldLabel>
            <FieldControl
              aria-describedby={hasNameError ? nameErrorId : undefined}
              // eslint-disable-next-line jsx-a11y/no-autofocus -- Inline editor opens from an explicit user action and should focus the first editable field.
              autoFocus
              required
              pattern={OUTPUT_NAME_PATTERN_SOURCE}
              size="small"
              value={draft.name}
              placeholder={t('nodes.agent.outputVars.namePlaceholder', { ns: 'workflow' })}
              className="h-6 w-24 px-1.5 py-0 code-sm-semibold"
              onChange={event => updateDraft({ name: event.currentTarget.value })}
            />
          </FieldRoot>
          <OutputTypeSelect
            value={draft.type}
            onChange={value => updateDraft({ type: value })}
          />
          <FieldRoot name="required" className="contents">
            <FieldLabel className="flex h-6 items-center gap-x-1 system-xs-regular text-text-tertiary">
              <Switch
                aria-label={t('nodes.agent.outputVars.requiredLabel', { ns: 'workflow' })}
                size="xs"
                checked={draft.required}
                onCheckedChange={required => updateDraft({ required })}
              />
              {t('nodes.agent.outputVars.requiredLabel', { ns: 'workflow' })}
            </FieldLabel>
          </FieldRoot>
        </div>
        {hasNameError && (
          <FieldRoot name="nameError" invalid className="contents">
            <FieldError id={nameErrorId} match className="mt-1 px-1 py-0 system-xs-regular text-text-destructive">
              {duplicateName
                ? t('nodes.agent.outputVars.nameDuplicate', { ns: 'workflow' })
                : t('nodes.agent.outputVars.nameInvalid', { ns: 'workflow' })}
            </FieldError>
          </FieldRoot>
        )}
        <FieldRoot name="description" className="contents">
          <FieldLabel className="sr-only">
            {t('nodes.agent.outputVars.descriptionLabel', { ns: 'workflow' })}
          </FieldLabel>
          <FieldControl
            size="small"
            value={draft.description}
            placeholder={t('nodes.agent.outputVars.descriptionPlaceholder', { ns: 'workflow' })}
            className="mt-2 h-5 border-transparent bg-transparent px-1 py-0 system-xs-regular shadow-none hover:border-transparent hover:bg-transparent focus:bg-transparent"
            onChange={event => updateDraft({ description: event.currentTarget.value })}
          />
        </FieldRoot>
      </div>
      <button
        type="button"
        className="mt-2 flex h-8 items-center gap-x-1 border-t border-divider-subtle px-2 system-xs-regular text-text-tertiary hover:bg-state-base-hover focus-visible:bg-state-base-hover focus-visible:ring-2 focus-visible:ring-state-accent-solid focus-visible:outline-hidden"
        aria-expanded={showAdvancedOptions}
        onClick={() => setShowAdvancedOptions(value => !value)}
      >
        <span
          aria-hidden="true"
          className={cn('i-ri-arrow-down-double-line size-3', showAdvancedOptions && 'rotate-180')}
        />
        {t('nodes.agent.outputVars.showAdvancedOptions', { ns: 'workflow' })}
      </button>
      {showAdvancedOptions && (
        <div className="border-t border-divider-subtle px-3 py-2">
          <FieldRoot name="defaultValue" className="gap-1">
            <FieldLabel className="py-0 system-xs-medium text-text-secondary">
              {t('nodes.agent.outputVars.defaultValueLabel', { ns: 'workflow' })}
            </FieldLabel>
            <Textarea
              size="small"
              value={draft.defaultValue}
              placeholder={t('nodes.agent.outputVars.defaultValuePlaceholder', { ns: 'workflow' })}
              className="mt-1 min-h-6"
              onValueChange={defaultValue => updateDraft({ defaultValue })}
            />
            {defaultValueErrorKey && (
              <FieldError match className="py-0 system-xs-regular text-text-destructive">
                {t(defaultValueErrorKey, { ns: 'workflow' })}
              </FieldError>
            )}
          </FieldRoot>
        </div>
      )}
      <div className="flex h-12 items-center justify-end gap-x-2 px-3">
        <Button type="button" size="small" variant="secondary" onClick={onCancel}>
          {t('operation.cancel', { ns: 'common' })}
        </Button>
        <Button type="submit" size="small" variant="primary" disabled={confirmDisabled}>
          {t('nodes.agent.outputVars.confirm', { ns: 'workflow' })}
        </Button>
      </div>
    </Form>
  )
}
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
      <div className="flex h-6 items-center gap-x-1 pr-0.5 pl-2">
        <div className="flex min-w-0 grow items-center gap-x-3">
          <span className="truncate code-sm-semibold text-text-primary">{output.name}</span>
          <span className="shrink-0 system-xs-regular text-text-tertiary">{getOutputDisplayType(output)}</span>
          {output.required && (
            <span className="shrink-0 system-2xs-medium-uppercase text-text-warning">
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
