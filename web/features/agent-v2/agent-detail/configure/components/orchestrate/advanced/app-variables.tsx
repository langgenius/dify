'use client'

import type { AppVariable, AppVariableType } from '@/features/agent-v2/agent-composer/form-state'
import type { I18nKeysWithPrefix } from '@/types/i18n'
import { Checkbox } from '@langgenius/dify-ui/checkbox'
import { cn } from '@langgenius/dify-ui/cn'
import { Input } from '@langgenius/dify-ui/input'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectItemIndicator,
  SelectItemText,
  SelectTrigger,
} from '@langgenius/dify-ui/select'
import { useAtomValue, useSetAtom } from 'jotai'
import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import {
  addAppVariableAtom,
  agentComposerAppVariablesAtom,
  removeAppVariableAtom,
  setAppVariableDefaultAtom,
  setAppVariableHideAtom,
  setAppVariableNameAtom,
  setAppVariableOptionsAtom,
  setAppVariableRequiredAtom,
  setAppVariableTypeAtom,
} from '@/features/agent-v2/agent-composer/store-modules/app-variables'
import { checkKeys } from '@/utils/var'
import { ConfigureSection } from '../common/section'
import { AgentConfigureTipContent } from '../common/tip-content'
import { useAgentOrchestrateReadOnly } from '../read-only-context'

const appVariableTypeOptions: AppVariableType[] = [
  'text-input',
  'paragraph',
  'select',
  'number',
  'json',
]

const appVariableTypeLabelKeys: Record<
  AppVariableType,
  I18nKeysWithPrefix<'agentV2', 'agentDetail.configure.advancedSettings.appVariablesEditor.'>
> = {
  'text-input': 'agentDetail.configure.advancedSettings.appVariablesEditor.typeTextInput',
  paragraph: 'agentDetail.configure.advancedSettings.appVariablesEditor.typeParagraph',
  select: 'agentDetail.configure.advancedSettings.appVariablesEditor.typeSelect',
  number: 'agentDetail.configure.advancedSettings.appVariablesEditor.typeNumber',
  json: 'agentDetail.configure.advancedSettings.appVariablesEditor.typeJson',
}

const createAppVariable = (): AppVariable => ({
  id: globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random()}`,
  name: '',
  type: 'text-input',
  required: false,
  default: '',
  hide: false,
})

function AppVariableEditorCell({
  children,
  className,
  role,
}: {
  children?: React.ReactNode
  className?: string
  role?: React.AriaRole
}) {
  return (
    <div
      role={role}
      className={cn(
        'flex min-h-7 min-w-0 items-center border-r border-divider-subtle last:border-r-0',
        className,
      )}
    >
      {children}
    </div>
  )
}

function AppVariableEditorInput({
  'aria-label': ariaLabel,
  placeholder,
  shouldFocus,
  value,
  onValueChange,
}: {
  'aria-label': string
  placeholder: string
  shouldFocus?: boolean
  value: string
  onValueChange: (value: string) => void
}) {
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (shouldFocus) inputRef.current?.focus()
  }, [shouldFocus])

  return (
    <Input
      ref={inputRef}
      aria-label={ariaLabel}
      className="h-full rounded-none bg-transparent px-3 py-0 system-xs-regular text-text-secondary shadow-none hover:bg-state-base-hover focus-visible:bg-state-base-hover"
      placeholder={placeholder}
      value={value}
      onValueChange={onValueChange}
    />
  )
}

function AppVariableEditorRow({
  autoFocusName,
  editable = false,
  variable,
  onDelete,
  onDefaultChange,
  onHideChange,
  onNameChange,
  onOptionsChange,
  onRequiredChange,
  onTypeChange,
}: {
  autoFocusName?: boolean
  editable?: boolean
  variable: AppVariable
  onDelete: () => void
  onDefaultChange: (value: string) => void
  onHideChange: (hide: boolean) => void
  onNameChange: (name: string) => void
  onOptionsChange: (options: string) => void
  onRequiredChange: (required: boolean) => void
  onTypeChange: (type: AppVariableType) => void
}) {
  const { t } = useTranslation('agentV2')

  return (
    <div
      role="row"
      className="grid min-h-7 grid-cols-[minmax(96px,1.2fr)_minmax(88px,0.9fr)_minmax(96px,1.2fr)_minmax(96px,1.2fr)_36px_36px_28px] border-t border-divider-subtle"
    >
      <AppVariableEditorCell role="cell">
        {editable ? (
          <AppVariableEditorInput
            aria-label={t(
              ($) => $['agentDetail.configure.advancedSettings.appVariablesEditor.nameColumn'],
            )}
            placeholder={t(
              ($) => $['agentDetail.configure.advancedSettings.appVariablesEditor.namePlaceholder'],
            )}
            shouldFocus={autoFocusName}
            value={variable.name}
            onValueChange={onNameChange}
          />
        ) : (
          <span className="min-w-0 truncate px-3 system-xs-regular text-text-secondary">
            {variable.name}
          </span>
        )}
      </AppVariableEditorCell>
      <AppVariableEditorCell role="cell">
        {editable ? (
          <Select<AppVariableType>
            value={variable.type}
            onValueChange={(nextValue) => {
              if (!nextValue) return

              onTypeChange(nextValue)
            }}
          >
            <SelectTrigger
              aria-label={t(
                ($) => $['agentDetail.configure.advancedSettings.appVariablesEditor.typeColumn'],
              )}
              className="h-full w-full max-w-none rounded-none bg-transparent px-3 py-0 system-xs-regular text-text-secondary hover:bg-state-base-hover focus-visible:bg-state-base-hover data-popup-open:bg-state-base-hover [&>*:last-child]:size-3.5"
            >
              {t(($) => $[appVariableTypeLabelKeys[variable.type]])}
            </SelectTrigger>
            <SelectContent placement="bottom-start" className="min-w-28">
              {appVariableTypeOptions.map((option) => (
                <SelectItem key={option} value={option}>
                  <SelectItemText>{t(($) => $[appVariableTypeLabelKeys[option]])}</SelectItemText>
                  <SelectItemIndicator />
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        ) : (
          <span className="min-w-0 truncate px-3 system-xs-regular text-text-secondary">
            {t(($) => $[appVariableTypeLabelKeys[variable.type]])}
          </span>
        )}
      </AppVariableEditorCell>
      <AppVariableEditorCell role="cell">
        {editable ? (
          <AppVariableEditorInput
            aria-label={t(
              ($) => $['agentDetail.configure.advancedSettings.appVariablesEditor.defaultColumn'],
            )}
            placeholder={t(
              ($) =>
                $['agentDetail.configure.advancedSettings.appVariablesEditor.defaultPlaceholder'],
            )}
            value={variable.default}
            onValueChange={onDefaultChange}
          />
        ) : (
          <span className="min-w-0 truncate px-3 system-xs-regular text-text-secondary">
            {variable.default}
          </span>
        )}
      </AppVariableEditorCell>
      <AppVariableEditorCell role="cell">
        {variable.type === 'select' && editable ? (
          <AppVariableEditorInput
            aria-label={t(
              ($) => $['agentDetail.configure.advancedSettings.appVariablesEditor.optionsColumn'],
            )}
            placeholder={t(
              ($) =>
                $['agentDetail.configure.advancedSettings.appVariablesEditor.optionsPlaceholder'],
            )}
            value={(variable.options ?? []).join(', ')}
            onValueChange={onOptionsChange}
          />
        ) : (
          <span className="min-w-0 truncate px-3 system-xs-regular text-text-tertiary">
            {variable.type === 'select' ? (variable.options ?? []).join(', ') : '—'}
          </span>
        )}
      </AppVariableEditorCell>
      <AppVariableEditorCell role="cell" className="justify-center">
        <Checkbox
          aria-label={t(
            ($) => $['agentDetail.configure.advancedSettings.appVariablesEditor.requiredColumn'],
          )}
          checked={variable.required}
          disabled={!editable || variable.hide}
          onCheckedChange={(checked) => onRequiredChange(checked === true)}
        />
      </AppVariableEditorCell>
      <AppVariableEditorCell role="cell" className="justify-center">
        <Checkbox
          aria-label={t(
            ($) => $['agentDetail.configure.advancedSettings.appVariablesEditor.hiddenColumn'],
          )}
          checked={variable.hide}
          disabled={!editable || variable.required}
          onCheckedChange={(checked) => onHideChange(checked === true)}
        />
      </AppVariableEditorCell>
      <AppVariableEditorCell role="cell" className="justify-center">
        {editable && (
          <button
            type="button"
            aria-label={t(
              ($) => $['agentDetail.configure.advancedSettings.appVariablesEditor.deleteVariable'],
              {
                name:
                  variable.name ||
                  t(
                    ($) =>
                      $[
                        'agentDetail.configure.advancedSettings.appVariablesEditor.unnamedVariable'
                      ],
                  ),
              },
            )}
            onClick={onDelete}
            className="flex size-6 items-center justify-center rounded-md text-text-tertiary hover:bg-state-base-hover hover:text-text-secondary focus-visible:ring-2 focus-visible:ring-state-accent-solid focus-visible:outline-hidden"
          >
            <span aria-hidden className="i-ri-delete-bin-line size-4" />
          </button>
        )}
      </AppVariableEditorCell>
    </div>
  )
}

function AppVariablesTable({
  appVariables,
  editable,
  focusedVariableId,
  onAdd,
  onDelete,
  onDefaultChange,
  onHideChange,
  onNameChange,
  onOptionsChange,
  onRequiredChange,
  onTypeChange,
}: {
  appVariables: AppVariable[]
  editable?: boolean
  focusedVariableId?: string
  onAdd?: () => void
  onDelete: (id: string) => void
  onDefaultChange: (id: string, value: string) => void
  onHideChange: (id: string, hide: boolean) => void
  onNameChange: (id: string, name: string) => void
  onOptionsChange: (id: string, options: string) => void
  onRequiredChange: (id: string, required: boolean) => void
  onTypeChange: (id: string, type: AppVariableType) => void
}) {
  const { t } = useTranslation('agentV2')

  return (
    <div role="table" className="overflow-hidden rounded-lg border border-divider-subtle">
      <div
        role="row"
        className="grid min-h-7 grid-cols-[minmax(96px,1.2fr)_minmax(88px,0.9fr)_minmax(96px,1.2fr)_minmax(96px,1.2fr)_36px_36px_28px] bg-background-default-hover"
      >
        <AppVariableEditorCell role="columnheader">
          <span className="px-3 system-xs-medium-uppercase">
            {t(($) => $['agentDetail.configure.advancedSettings.appVariablesEditor.nameColumn'])}
          </span>
        </AppVariableEditorCell>
        <AppVariableEditorCell role="columnheader">
          <span className="px-3 system-xs-medium-uppercase">
            {t(($) => $['agentDetail.configure.advancedSettings.appVariablesEditor.typeColumn'])}
          </span>
        </AppVariableEditorCell>
        <AppVariableEditorCell role="columnheader">
          <span className="px-3 system-xs-medium-uppercase">
            {t(($) => $['agentDetail.configure.advancedSettings.appVariablesEditor.defaultColumn'])}
          </span>
        </AppVariableEditorCell>
        <AppVariableEditorCell role="columnheader">
          <span className="px-3 system-xs-medium-uppercase">
            {t(($) => $['agentDetail.configure.advancedSettings.appVariablesEditor.optionsColumn'])}
          </span>
        </AppVariableEditorCell>
        <AppVariableEditorCell role="columnheader" className="justify-center">
          <span className="px-1 system-xs-medium-uppercase">
            {t(
              ($) => $['agentDetail.configure.advancedSettings.appVariablesEditor.requiredColumn'],
            )}
          </span>
        </AppVariableEditorCell>
        <AppVariableEditorCell role="columnheader" className="justify-center">
          <span className="px-1 system-xs-medium-uppercase">
            {t(($) => $['agentDetail.configure.advancedSettings.appVariablesEditor.hiddenColumn'])}
          </span>
        </AppVariableEditorCell>
        <AppVariableEditorCell role="columnheader" className="justify-center">
          {onAdd && (
            <button
              type="button"
              aria-label={t(
                ($) => $['agentDetail.configure.advancedSettings.appVariablesEditor.add'],
              )}
              onClick={() => onAdd()}
              className="flex size-6 items-center justify-center rounded-md text-text-tertiary hover:bg-state-base-hover hover:text-text-secondary focus-visible:ring-2 focus-visible:ring-state-accent-solid focus-visible:outline-hidden"
            >
              <span aria-hidden className="i-ri-add-line size-4" />
            </button>
          )}
        </AppVariableEditorCell>
      </div>
      {appVariables.map((variable) => (
        <AppVariableEditorRow
          key={variable.id}
          autoFocusName={focusedVariableId === variable.id}
          editable={editable}
          variable={variable}
          onDelete={() => onDelete(variable.id)}
          onDefaultChange={(value) => onDefaultChange(variable.id, value)}
          onHideChange={(hide) => onHideChange(variable.id, hide)}
          onNameChange={(name) => {
            const { isValid } = checkKeys([name], true)
            if (!isValid && name.trim()) return

            onNameChange(variable.id, name)
          }}
          onOptionsChange={(options) => onOptionsChange(variable.id, options)}
          onRequiredChange={(required) => onRequiredChange(variable.id, required)}
          onTypeChange={(type) => onTypeChange(variable.id, type)}
        />
      ))}
    </div>
  )
}

export function AgentAppVariablesEditor() {
  const { t } = useTranslation('agentV2')
  const readOnly = useAgentOrchestrateReadOnly()
  const appVariables = useAtomValue(agentComposerAppVariablesAtom)
  const addAppVariable = useSetAtom(addAppVariableAtom)
  const removeAppVariable = useSetAtom(removeAppVariableAtom)
  const setAppVariableName = useSetAtom(setAppVariableNameAtom)
  const setAppVariableType = useSetAtom(setAppVariableTypeAtom)
  const setAppVariableRequired = useSetAtom(setAppVariableRequiredAtom)
  const setAppVariableHide = useSetAtom(setAppVariableHideAtom)
  const setAppVariableDefault = useSetAtom(setAppVariableDefaultAtom)
  const setAppVariableOptions = useSetAtom(setAppVariableOptionsAtom)
  const starterVariableRef = useRef<AppVariable | undefined>(undefined)
  if (!starterVariableRef.current) starterVariableRef.current = createAppVariable()
  const starterVariable = starterVariableRef.current
  const [focusedVariableId, setFocusedVariableId] = useState<string>()
  const appVariablesTableId = 'agent-configure-app-variables-table'
  const visibleAppVariables = appVariables.length > 0 ? appVariables : [starterVariable]
  const appVariablesTip = t(
    ($) => $['agentDetail.configure.advancedSettings.appVariablesEditor.tip'],
  )

  const addVariable = () => {
    const variable = createAppVariable()

    addAppVariable({
      starterVariable,
      variable,
    })
    setFocusedVariableId(variable.id)
  }

  return (
    <ConfigureSection
      label={t(($) => $['agentDetail.configure.advancedSettings.appVariablesEditor.label'])}
      labelId="agent-configure-app-variables-editor-label"
      headingLevel="h4"
      panelId={appVariablesTableId}
      tip={<AgentConfigureTipContent type="appVariables" />}
      tipAriaLabel={appVariablesTip}
      rootClassName="gap-1 py-3"
      headerClassName="mb-0 gap-1 px-3"
      panelContentClassName="px-3"
    >
      <AppVariablesTable
        editable={!readOnly}
        appVariables={visibleAppVariables}
        focusedVariableId={focusedVariableId}
        onAdd={readOnly ? undefined : addVariable}
        onDelete={removeAppVariable}
        onNameChange={(id, name) => setAppVariableName({ id, name, starterVariable })}
        onTypeChange={(id, type) => setAppVariableType({ id, type, starterVariable })}
        onRequiredChange={(id, required) =>
          setAppVariableRequired({ id, required, starterVariable })
        }
        onHideChange={(id, hide) => setAppVariableHide({ id, hide, starterVariable })}
        onDefaultChange={(id, defaultValue) =>
          setAppVariableDefault({ id, defaultValue, starterVariable })
        }
        onOptionsChange={(id, options) =>
          setAppVariableOptions({
            id,
            options: options
              .split(',')
              .map((option) => option.trim())
              .filter(Boolean),
            starterVariable,
          })
        }
      />
    </ConfigureSection>
  )
}
