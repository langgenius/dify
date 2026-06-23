import type { DeclaredOutputConfig } from '@dify/contracts/api/console/apps/types.gen'
import type { EditableOutputConfig, EditingState, OutputDraft } from './utils'
import { Button } from '@langgenius/dify-ui/button'
import { CollapsiblePanel, CollapsibleRoot, CollapsibleTrigger } from '@langgenius/dify-ui/collapsible'
import { FieldControl, FieldError, FieldLabel, FieldRoot } from '@langgenius/dify-ui/field'
import { Form } from '@langgenius/dify-ui/form'
import { Kbd, KbdGroup } from '@langgenius/dify-ui/kbd'
import { Switch } from '@langgenius/dify-ui/switch'
import { Textarea } from '@langgenius/dify-ui/textarea'
import { formatForDisplay, useHotkey } from '@tanstack/react-hotkeys'
import { useId, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { OutputTypeSelect } from './type-select'
import {
  createOutputFromDraft,
  getDefaultValueErrorKey,
  OUTPUT_NAME_PATTERN,
  OUTPUT_NAME_PATTERN_SOURCE,
} from './utils'

const CONFIRM_HOTKEY = 'Mod+Enter'

function ConfirmHotkeyHint() {
  const displayKeys = formatForDisplay(CONFIRM_HOTKEY, { separatorToken: ' ' })
    .split(' ')
    .filter(Boolean)

  return (
    <KbdGroup aria-hidden="true">
      {displayKeys.map(key => (
        <Kbd key={key} color="white">
          {key}
        </Kbd>
      ))}
    </KbdGroup>
  )
}

export function OutputEditCard({
  existingOutputs,
  editingIndex,
  allowDefaultValue = true,
  state,
  onCancel,
  onConfirm,
}: {
  existingOutputs: EditableOutputConfig[]
  editingIndex?: number
  allowDefaultValue?: boolean
  state: EditingState
  onCancel: () => void
  onConfirm: (output: DeclaredOutputConfig, state: EditingState) => void
}) {
  const { t } = useTranslation()
  const nameErrorId = useId()
  const editorRef = useRef<HTMLDivElement>(null)
  const [draft, setDraft] = useState(state.draft)
  const trimmedName = draft.name.trim()
  const duplicateName = existingOutputs.some((output, index) => output.name === trimmedName && index !== editingIndex)
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
    onConfirm(createOutputFromDraft(draft, { includeDefaultValue: allowDefaultValue }), state)
  }
  useHotkey(CONFIRM_HOTKEY, handleConfirm, { target: editorRef, ignoreInputs: false })
  useHotkey('Escape', onCancel, { target: editorRef, ignoreInputs: false })
  return (
    <div ref={editorRef}>
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
        {allowDefaultValue && (
          <CollapsibleRoot>
            <CollapsibleTrigger className="h-8 min-h-8 justify-start gap-x-0.5 rounded-none border-y border-divider-subtle pr-2 pl-2.5 system-xs-regular text-text-tertiary hover:not-data-disabled:bg-state-base-hover hover:not-data-disabled:text-text-tertiary focus-visible:bg-state-base-hover focus-visible:ring-inset data-panel-open:text-text-tertiary">
              <span
                aria-hidden="true"
                className="i-ri-arrow-down-double-line size-3 transition-transform duration-100 ease-out group-data-panel-open:rotate-180 motion-reduce:transition-none"
              />
              {t('nodes.agent.outputVars.showAdvancedOptions', { ns: 'workflow' })}
            </CollapsibleTrigger>
            <CollapsiblePanel className="border-t border-divider-subtle">
              <div className="px-3 py-2">
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
            </CollapsiblePanel>
          </CollapsibleRoot>
        )}
        <div className="flex h-12 items-center justify-end gap-x-2 px-3">
          <Button type="button" size="small" variant="secondary" onClick={onCancel}>
            {t('operation.cancel', { ns: 'common' })}
          </Button>
          <Button
            type="submit"
            size="small"
            variant="primary"
            disabled={confirmDisabled}
            aria-label={t('nodes.agent.outputVars.confirm', { ns: 'workflow' })}
            className="gap-x-1"
          >
            {t('nodes.agent.outputVars.confirm', { ns: 'workflow' })}
            <ConfirmHotkeyHint />
          </Button>
        </div>
      </Form>
    </div>
  )
}
