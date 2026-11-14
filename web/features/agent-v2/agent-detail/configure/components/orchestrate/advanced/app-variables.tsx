'use client'

import type { AppVariable, AppVariableType } from '@/features/agent-v2/agent-composer/form-state'
import type { I18nKeysWithPrefix } from '@/types/i18n'
import { Checkbox } from '@langgenius/dify-ui/checkbox'
import { cn } from '@langgenius/dify-ui/cn'
import { IconButton } from '@langgenius/dify-ui/icon-button'
import { Input } from '@langgenius/dify-ui/input'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectItemIndicator,
  SelectItemText,
  SelectTrigger,
} from '@langgenius/dify-ui/select'
import { Tooltip, TooltipContent, TooltipTrigger } from '@langgenius/dify-ui/tooltip'
import { useAtomValue, useSetAtom } from 'jotai'
import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from '@/app/notifications'
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
  'checkbox',
]

const appVariableTypeLabelKeys = {
  'text-input': 'agentDetail.configure.advancedSettings.appVariablesEditor.typeTextInput',
  paragraph: 'agentDetail.configure.advancedSettings.appVariablesEditor.typeParagraph',
  select: 'agentDetail.configure.advancedSettings.appVariablesEditor.typeSelect',
  number: 'agentDetail.configure.advancedSettings.appVariablesEditor.typeNumber',
  checkbox: 'agentDetail.configure.advancedSettings.appVariablesEditor.typeCheckbox',
} as const satisfies Record<
  AppVariableType,
  I18nKeysWithPrefix<'agentV2', 'agentDetail.configure.advancedSettings.appVariablesEditor.'>
>

// Name, type, default, required, hidden, row action.
const appVariableColumnCount = 6

const createAppVariable = (): AppVariable => ({
  id: globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random()}`,
  name: '',
  type: 'text-input',
  required: false,
  default: '',
  hide: false,
})

const parseAppVariableOptions = (text: string) =>
  text
    .split(',')
    .map((option) => option.trim())
    .filter(Boolean)

const formatAppVariableOptions = (options: readonly string[] = []) => options.join(', ')

const isSameOptions = (left: readonly string[], right: readonly string[] = []) =>
  left.length === right.length && left.every((option, index) => option === right[index])

function AppVariableEditorCell({
  children,
  className,
  colSpan,
  header = false,
}: {
  children?: React.ReactNode
  className?: string
  colSpan?: number
  header?: boolean
}) {
  const Cell = header ? 'th' : 'td'

  return (
    <Cell
      colSpan={colSpan}
      scope={header ? 'col' : undefined}
      className="h-7 min-w-0 border-e border-divider-subtle p-0 text-start align-middle font-normal last:border-e-0"
    >
      <div className={cn('flex h-full min-h-7 min-w-0 items-center', className)}>{children}</div>
    </Cell>
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
      className="h-full rounded-none bg-transparent px-3 py-0 system-xs-regular text-text-secondary shadow-none ring-inset hover:bg-state-base-hover focus-visible:bg-state-base-hover"
      placeholder={placeholder}
      value={value}
      onValueChange={onValueChange}
    />
  )
}

/**
 * Keeps the text the user is typing, separators included, and reports the parsed list upward.
 * When the stored options stop matching that text (for example a build draft was applied),
 * the stored options win.
 */
function AppVariableOptionsInput({
  'aria-label': ariaLabel,
  options,
  placeholder,
  onOptionsChange,
}: {
  'aria-label': string
  options?: readonly string[]
  placeholder: string
  onOptionsChange: (options: string[]) => void
}) {
  const [text, setText] = useState(() => formatAppVariableOptions(options))
  const displayedText = isSameOptions(parseAppVariableOptions(text), options)
    ? text
    : formatAppVariableOptions(options)

  return (
    <AppVariableEditorInput
      aria-label={ariaLabel}
      placeholder={placeholder}
      value={displayedText}
      onValueChange={(nextText) => {
        setText(nextText)
        onOptionsChange(parseAppVariableOptions(nextText))
      }}
    />
  )
}

function AppVariableTypeSelect({
  editable,
  type,
  onChange,
}: {
  editable?: boolean
  type: AppVariableType
  onChange: (type: AppVariableType) => void
}) {
  const { t } = useTranslation(['agentV2'])

  if (!editable) {
    return (
      <span className="min-w-0 truncate px-3 system-xs-regular text-text-secondary">
        {t(($) => $[appVariableTypeLabelKeys[type]])}
      </span>
    )
  }

  return (
    <Select<AppVariableType>
      value={type}
      onValueChange={(nextValue) => {
        if (!nextValue) return

        onChange(nextValue)
      }}
    >
      <SelectTrigger
        aria-label={t(
          ($) => $['agentDetail.configure.advancedSettings.appVariablesEditor.typeColumn'],
        )}
        className="h-full w-full max-w-none rounded-none bg-transparent px-3 py-0 system-xs-regular text-text-secondary hover:bg-state-base-hover focus-visible:bg-state-base-hover data-popup-open:bg-state-base-hover [&>*:last-child]:size-3.5"
      >
        {t(($) => $[appVariableTypeLabelKeys[type]])}
      </SelectTrigger>
      <SelectContent className="min-w-28">
        {appVariableTypeOptions.map((option) => (
          <SelectItem<AppVariableType>
            key={option}
            value={option}
            className="h-7 system-xs-regular"
          >
            <SelectItemText>{t(($) => $[appVariableTypeLabelKeys[option]])}</SelectItemText>
            <SelectItemIndicator />
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  )
}

function AppVariableDefaultCell({
  editable,
  variable,
  onDefaultChange,
}: {
  editable?: boolean
  variable: AppVariable
  onDefaultChange: (value: string) => void
}) {
  const { t } = useTranslation(['agentV2'])
  const defaultLabel = t(
    ($) => $['agentDetail.configure.advancedSettings.appVariablesEditor.defaultColumn'],
  )

  if (variable.type === 'checkbox') {
    return (
      <span className="flex px-3">
        <Checkbox
          aria-label={defaultLabel}
          checked={variable.default === 'true'}
          disabled={!editable}
          onCheckedChange={(checked) => onDefaultChange(checked ? 'true' : 'false')}
        />
      </span>
    )
  }

  if (!editable) {
    return (
      <span className="min-w-0 truncate px-3 system-xs-regular text-text-secondary">
        {variable.default}
      </span>
    )
  }

  return (
    <AppVariableEditorInput
      aria-label={defaultLabel}
      placeholder={t(
        ($) => $['agentDetail.configure.advancedSettings.appVariablesEditor.defaultPlaceholder'],
      )}
      value={variable.default}
      onValueChange={onDefaultChange}
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
  onOptionsChange: (options: string[]) => void
  onRequiredChange: (required: boolean) => void
  onTypeChange: (type: AppVariableType) => void
}) {
  const { t } = useTranslation(['agentV2'])
  const { t: tCommon } = useTranslation(['common'])
  const optionsLabel = t(
    ($) => $['agentDetail.configure.advancedSettings.appVariablesEditor.optionsColumn'],
  )

  return (
    <>
      <tr className="border-t border-divider-subtle">
        <AppVariableEditorCell>
          {editable ? (
            <AppVariableEditorInput
              aria-label={t(
                ($) => $['agentDetail.configure.advancedSettings.appVariablesEditor.nameColumn'],
              )}
              placeholder={t(
                ($) =>
                  $['agentDetail.configure.advancedSettings.appVariablesEditor.namePlaceholder'],
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
        <AppVariableEditorCell>
          <AppVariableTypeSelect editable={editable} type={variable.type} onChange={onTypeChange} />
        </AppVariableEditorCell>
        <AppVariableEditorCell>
          <AppVariableDefaultCell
            editable={editable}
            variable={variable}
            onDefaultChange={onDefaultChange}
          />
        </AppVariableEditorCell>
        <AppVariableEditorCell className="justify-center">
          <Checkbox
            aria-label={t(
              ($) => $['agentDetail.configure.advancedSettings.appVariablesEditor.requiredColumn'],
            )}
            checked={variable.required}
            disabled={!editable || variable.hide}
            onCheckedChange={(checked) => onRequiredChange(checked)}
          />
        </AppVariableEditorCell>
        <AppVariableEditorCell className="justify-center">
          <Checkbox
            aria-label={t(
              ($) => $['agentDetail.configure.advancedSettings.appVariablesEditor.hiddenColumn'],
            )}
            checked={variable.hide}
            disabled={!editable || variable.required}
            onCheckedChange={(checked) => onHideChange(checked)}
          />
        </AppVariableEditorCell>
        <AppVariableEditorCell className="justify-center">
          {editable && (
            <Tooltip>
              <TooltipTrigger
                render={
                  <IconButton
                    aria-label={t(
                      ($) =>
                        $[
                          'agentDetail.configure.advancedSettings.appVariablesEditor.deleteVariable'
                        ],
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
                    tone="destructive"
                    onClick={onDelete}
                  >
                    <span aria-hidden className="i-ri-delete-bin-line size-4" />
                  </IconButton>
                }
              />
              <TooltipContent>{tCommon(($) => $['operation.delete'])}</TooltipContent>
            </Tooltip>
          )}
        </AppVariableEditorCell>
      </tr>
      {variable.type === 'select' && (
        <tr>
          <AppVariableEditorCell colSpan={appVariableColumnCount}>
            <span className="shrink-0 ps-3 system-xs-regular text-text-tertiary">
              {optionsLabel}
            </span>
            {editable ? (
              <AppVariableOptionsInput
                aria-label={optionsLabel}
                placeholder={t(
                  ($) =>
                    $[
                      'agentDetail.configure.advancedSettings.appVariablesEditor.optionsPlaceholder'
                    ],
                )}
                options={variable.options}
                onOptionsChange={onOptionsChange}
              />
            ) : (
              <span className="min-w-0 truncate px-3 system-xs-regular text-text-secondary">
                {formatAppVariableOptions(variable.options)}
              </span>
            )}
          </AppVariableEditorCell>
        </tr>
      )}
    </>
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
  onOptionsChange: (id: string, options: string[]) => void
  onRequiredChange: (id: string, required: boolean) => void
  onTypeChange: (id: string, type: AppVariableType) => void
}) {
  const { t } = useTranslation(['agentV2', 'appDebug'])
  const tableLabel = t(($) => $['agentDetail.configure.advancedSettings.appVariablesEditor.label'])
  const nameColumnLabel = t(
    ($) => $['agentDetail.configure.advancedSettings.appVariablesEditor.nameColumn'],
  )
  const requiredColumnLabel = t(
    ($) => $['agentDetail.configure.advancedSettings.appVariablesEditor.requiredColumn'],
  )
  const hiddenColumnLabel = t(
    ($) => $['agentDetail.configure.advancedSettings.appVariablesEditor.hiddenColumn'],
  )
  const addLabel = t(($) => $['agentDetail.configure.advancedSettings.appVariablesEditor.add'])
  const handleNameChange = (id: string, name: string) => {
    const normalizedName = name.replaceAll(' ', '_')
    const { isValid, errorMessageKey } = checkKeys([normalizedName], true)
    if (!isValid) {
      toast.error(
        t(($) => $[`varKeyError.${errorMessageKey}`], {
          ns: 'appDebug',
          key: nameColumnLabel,
        }),
      )
      return
    }

    onNameChange(id, normalizedName)
  }

  return (
    <div className="@container overflow-hidden rounded-lg border border-divider-regular bg-components-panel-on-panel-item-bg shadow-xs shadow-shadow-shadow-3">
      <table className="w-full table-fixed border-collapse">
        <caption className="sr-only">{tableLabel}</caption>
        <colgroup>
          <col />
          <col className="w-24" />
          <col />
          <col className="w-9" />
          <col className="w-9" />
          <col className="w-7" />
        </colgroup>
        <thead>
          <tr className="text-text-tertiary">
            <AppVariableEditorCell header>
              <span className="min-w-0 truncate px-3 system-xs-medium-uppercase">
                {nameColumnLabel}
              </span>
            </AppVariableEditorCell>
            <AppVariableEditorCell header>
              <span className="min-w-0 truncate px-3 system-xs-medium-uppercase">
                {t(
                  ($) => $['agentDetail.configure.advancedSettings.appVariablesEditor.typeColumn'],
                )}
              </span>
            </AppVariableEditorCell>
            <AppVariableEditorCell header>
              <span className="min-w-0 truncate px-3 system-xs-medium-uppercase">
                {t(
                  ($) =>
                    $['agentDetail.configure.advancedSettings.appVariablesEditor.defaultColumn'],
                )}
              </span>
            </AppVariableEditorCell>
            <AppVariableEditorCell header className="justify-center">
              <Tooltip>
                <TooltipTrigger
                  render={
                    <span
                      role="img"
                      aria-label={requiredColumnLabel}
                      className="i-ri-asterisk size-3.5"
                    />
                  }
                />
                <TooltipContent>{requiredColumnLabel}</TooltipContent>
              </Tooltip>
            </AppVariableEditorCell>
            <AppVariableEditorCell header className="justify-center">
              <Tooltip>
                <TooltipTrigger
                  render={
                    <span
                      role="img"
                      aria-label={hiddenColumnLabel}
                      className="i-ri-eye-off-line size-3.5"
                    />
                  }
                />
                <TooltipContent>{hiddenColumnLabel}</TooltipContent>
              </Tooltip>
            </AppVariableEditorCell>
            <AppVariableEditorCell header className="justify-center">
              {onAdd && (
                <Tooltip>
                  <TooltipTrigger
                    render={
                      <IconButton aria-label={addLabel} onClick={() => onAdd()}>
                        <span aria-hidden className="i-ri-add-line size-4" />
                      </IconButton>
                    }
                  />
                  <TooltipContent>{addLabel}</TooltipContent>
                </Tooltip>
              )}
            </AppVariableEditorCell>
          </tr>
        </thead>
        <tbody>
          {appVariables.map((variable) => (
            <AppVariableEditorRow
              key={variable.id}
              autoFocusName={focusedVariableId === variable.id}
              editable={editable}
              variable={variable}
              onDelete={() => onDelete(variable.id)}
              onDefaultChange={(value) => onDefaultChange(variable.id, value)}
              onHideChange={(hide) => onHideChange(variable.id, hide)}
              onNameChange={(name) => handleNameChange(variable.id, name)}
              onOptionsChange={(options) => onOptionsChange(variable.id, options)}
              onRequiredChange={(required) => onRequiredChange(variable.id, required)}
              onTypeChange={(type) => onTypeChange(variable.id, type)}
            />
          ))}
        </tbody>
      </table>
    </div>
  )
}

export function AgentAppVariablesEditor() {
  const { t } = useTranslation(['agentV2'])
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
        onOptionsChange={(id, options) => setAppVariableOptions({ id, options, starterVariable })}
      />
    </ConfigureSection>
  )
}
