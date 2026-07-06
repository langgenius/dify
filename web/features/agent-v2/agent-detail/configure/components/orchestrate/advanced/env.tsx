'use client'

import type { EnvScope, EnvVariable } from '@/features/agent-v2/agent-composer/form-state'
import type { I18nKeysWithPrefix } from '@/types/i18n'
import { cn } from '@langgenius/dify-ui/cn'
import { Input } from '@langgenius/dify-ui/input'
import { Select, SelectContent, SelectItem, SelectItemIndicator, SelectItemText, SelectTrigger } from '@langgenius/dify-ui/select'
import { toast } from '@langgenius/dify-ui/toast'
import { Tooltip, TooltipContent, TooltipTrigger } from '@langgenius/dify-ui/tooltip'
import { useAtom } from 'jotai'
import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { agentComposerEnvVariablesAtom } from '@/features/agent-v2/agent-composer/store-modules/env'
import { checkKeys } from '@/utils/var'
import { ConfigureSection } from '../common/section'
import { AgentConfigureTipContent } from '../common/tip-content'
import { useAgentOrchestrateReadOnly } from '../read-only-context'
import { getEnvImportPlatform, parseEnvImport } from './env-utils'

const scopeLabelKeys: Record<EnvScope, I18nKeysWithPrefix<'agentV2', 'agentDetail.configure.advancedSettings.envEditor.'>> = {
  plain: 'agentDetail.configure.advancedSettings.envEditor.scopePlain',
  secret: 'agentDetail.configure.advancedSettings.envEditor.scopeSecret',
}

const envScopeOptions: EnvScope[] = ['secret', 'plain']

const envImportTipKeys = {
  mac: 'agentDetail.configure.advancedSettings.envEditor.importEnvTip.mac',
  windows: 'agentDetail.configure.advancedSettings.envEditor.importEnvTip.windows',
  other: 'agentDetail.configure.advancedSettings.envEditor.importEnvTip.other',
} as const

const maskedEnvValue = '••••••••••••'

const getCurrentEnvImportPlatform = () => {
  if (typeof navigator === 'undefined')
    return 'other'

  const userAgentData = (navigator as Navigator & { userAgentData?: { platform?: string } }).userAgentData

  return getEnvImportPlatform({
    platform: userAgentData?.platform ?? navigator.platform,
    userAgent: navigator.userAgent,
  })
}

const createEnvVariable = (): EnvVariable => ({
  id: globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random()}`,
  key: '',
  value: '',
  scope: 'plain',
})

const createEnvVariableFromEntry = ({
  key,
  value,
}: {
  key: string
  value: string
}): EnvVariable => ({
  ...createEnvVariable(),
  key,
  value,
})

function EnvEditorScope({
  editable,
  scope,
  onChange,
}: {
  editable?: boolean
  scope: EnvScope
  onChange?: (scope: EnvScope) => void
}) {
  const { t } = useTranslation('agentV2')

  if (!editable) {
    return (
      <span className="min-w-0 truncate px-3 system-xs-regular text-text-secondary">
        {t(scopeLabelKeys[scope])}
      </span>
    )
  }

  return (
    <Select
      value={scope}
      onValueChange={(nextValue) => {
        if (!nextValue)
          return

        onChange?.(nextValue as EnvScope)
      }}
    >
      <SelectTrigger
        aria-label={t('agentDetail.configure.advancedSettings.envEditor.scopeSelector')}
        className="h-full w-full max-w-none rounded-none bg-transparent px-3 py-0 system-xs-regular text-text-secondary hover:bg-state-base-hover focus-visible:bg-state-base-hover data-popup-open:bg-state-base-hover [&>*:last-child]:size-3.5"
      >
        {t(scopeLabelKeys[scope])}
      </SelectTrigger>
      <SelectContent placement="bottom-start" popupClassName="min-w-24">
        {envScopeOptions.map(option => (
          <SelectItem key={option} value={option} className="h-7 system-xs-regular">
            <SelectItemText>{t(scopeLabelKeys[option])}</SelectItemText>
            <SelectItemIndicator />
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  )
}

function EnvEditorCell({
  children,
  className,
}: {
  children?: React.ReactNode
  className?: string
}) {
  return (
    <div className={cn('flex min-h-7 min-w-0 items-center border-r border-divider-subtle last:border-r-0', className)}>
      {children}
    </div>
  )
}

function EnvEditorInput({
  'aria-label': ariaLabel,
  placeholder,
  shouldFocus,
  value,
  onValueChange,
}: {
  'aria-label': string
  'placeholder': string
  'shouldFocus'?: boolean
  'value': string
  'onValueChange': (value: string) => void
}) {
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (shouldFocus)
      inputRef.current?.focus()
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

function EnvEditorRow({
  autoFocusField,
  variable,
  editable = false,
  isHighlighted,
  onDelete,
  onKeyChange,
  onScopeChange,
  onValueChange,
  showScope = true,
}: {
  autoFocusField?: 'key' | 'value'
  variable: EnvVariable
  editable?: boolean
  isHighlighted?: boolean
  onDelete: () => void
  onKeyChange?: (key: string) => void
  onScopeChange: (scope: EnvScope) => void
  onValueChange?: (value: string) => void
  showScope?: boolean
}) {
  const { t } = useTranslation('agentV2')
  const [isValueRevealed, setIsValueRevealed] = useState(false)
  const gridClassName = showScope
    ? 'grid-cols-[minmax(76px,1fr)_minmax(84px,1.25fr)_72px_28px]'
    : 'grid-cols-[minmax(120px,180px)_minmax(160px,1fr)_28px]'
  const shouldMaskValue = variable.masked && !isValueRevealed
  const displayedValue = shouldMaskValue ? maskedEnvValue : variable.value

  return (
    <div className={cn('grid min-h-7 border-t border-divider-subtle', gridClassName, isHighlighted && 'bg-background-default-hover')}>
      <EnvEditorCell>
        {editable
          ? (
              <EnvEditorInput
                aria-label={t('agentDetail.configure.advancedSettings.envEditor.keyColumn')}
                placeholder={t('agentDetail.configure.advancedSettings.envEditor.keyPlaceholder')}
                shouldFocus={autoFocusField === 'key'}
                value={variable.key}
                onValueChange={onKeyChange ?? (() => {})}
              />
            )
          : (
              <span className={cn('min-w-0 truncate px-3 system-xs-regular text-text-secondary', isHighlighted && 'text-text-primary')}>
                {variable.key}
              </span>
            )}
      </EnvEditorCell>
      <EnvEditorCell>
        {editable && !shouldMaskValue
          ? (
              <EnvEditorInput
                aria-label={t('agentDetail.configure.advancedSettings.envEditor.valueColumn')}
                placeholder={t('agentDetail.configure.advancedSettings.envEditor.valuePlaceholder')}
                shouldFocus={autoFocusField === 'value'}
                value={displayedValue}
                onValueChange={onValueChange ?? (() => {})}
              />
            )
          : (
              <span className="min-w-0 truncate px-3 system-xs-regular text-text-secondary">
                {displayedValue}
              </span>
            )}
        {variable.masked && (
          <button
            type="button"
            aria-label={t(isValueRevealed ? 'agentDetail.configure.advancedSettings.envEditor.hideValue' : 'agentDetail.configure.advancedSettings.envEditor.revealValue', { key: variable.key })}
            onClick={() => setIsValueRevealed(revealed => !revealed)}
            className="mr-2 ml-auto flex size-5 shrink-0 items-center justify-center rounded-md text-text-tertiary hover:bg-state-base-hover hover:text-text-secondary focus-visible:ring-2 focus-visible:ring-state-accent-solid focus-visible:outline-hidden"
          >
            <span aria-hidden className={cn(isValueRevealed ? 'i-ri-eye-off-line' : 'i-ri-eye-line', 'size-4')} />
          </button>
        )}
      </EnvEditorCell>
      {showScope && (
        <EnvEditorCell>
          <EnvEditorScope editable={editable} scope={variable.scope} onChange={onScopeChange} />
        </EnvEditorCell>
      )}
      <EnvEditorCell className="justify-center">
        {editable && (
          <button
            type="button"
            aria-label={t('agentDetail.configure.advancedSettings.envEditor.deleteVariable', { key: variable.key || t('agentDetail.configure.advancedSettings.envEditor.keyPlaceholder') })}
            onClick={onDelete}
            className="flex size-6 items-center justify-center rounded-md text-text-tertiary hover:bg-state-destructive-hover hover:text-text-destructive focus-visible:ring-2 focus-visible:ring-state-accent-solid focus-visible:outline-hidden"
          >
            <span aria-hidden className="i-ri-delete-bin-line size-4" />
          </button>
        )}
      </EnvEditorCell>
    </div>
  )
}

function EnvEditorDraftRow({
  onAdd,
  showScope = true,
}: {
  onAdd?: (options?: { focusField?: 'key' | 'value', scope?: EnvScope }) => void
  showScope?: boolean
}) {
  const { t } = useTranslation('agentV2')
  const gridClassName = showScope
    ? 'grid-cols-[minmax(76px,1fr)_minmax(84px,1.25fr)_72px_28px]'
    : 'grid-cols-[minmax(120px,180px)_minmax(160px,1fr)_28px]'
  const keyPlaceholder = t('agentDetail.configure.advancedSettings.envEditor.keyPlaceholder')
  const valuePlaceholder = t('agentDetail.configure.advancedSettings.envEditor.valuePlaceholder')

  const renderDraftPlaceholder = (label: string) => (
    <span className="min-w-0 truncate px-3 system-xs-regular text-components-input-text-placeholder">
      {label}
    </span>
  )

  const renderDraftValueCell = () => {
    if (!onAdd)
      return renderDraftPlaceholder(valuePlaceholder)

    return (
      <button
        type="button"
        aria-label={t('agentDetail.configure.advancedSettings.envEditor.add')}
        onClick={() => onAdd({ focusField: 'value' })}
        className="flex h-full w-full min-w-0 items-center px-3 text-left system-xs-regular text-components-input-text-placeholder hover:bg-state-base-hover focus-visible:bg-state-base-hover focus-visible:ring-2 focus-visible:ring-state-accent-solid focus-visible:outline-hidden"
      >
        {valuePlaceholder}
      </button>
    )
  }

  return (
    <div className={cn('grid min-h-7 border-t border-divider-subtle', gridClassName)}>
      <EnvEditorCell>
        {renderDraftPlaceholder(keyPlaceholder)}
      </EnvEditorCell>
      <EnvEditorCell>
        {renderDraftValueCell()}
      </EnvEditorCell>
      {showScope && (
        <EnvEditorCell>
          <EnvEditorScope scope="plain" />
        </EnvEditorCell>
      )}
      <EnvEditorCell />
    </div>
  )
}

export function EnvVariablesTable({
  editable = false,
  envVariables,
  focusedVariable,
  highlightedIndex,
  onAdd,
  onDelete,
  onKeyChange,
  onScopeChange,
  onValueChange,
  showDraftRow = true,
  showScope = true,
}: {
  editable?: boolean
  envVariables: EnvVariable[]
  focusedVariable?: { id: string, field: 'key' | 'value' }
  highlightedIndex?: number
  onAdd?: (options?: { focusField?: 'key' | 'value', scope?: EnvScope }) => void
  onDelete: (id: string) => void
  onKeyChange?: (id: string, key: string) => void
  onScopeChange: (id: string, scope: EnvScope) => void
  onValueChange?: (id: string, value: string) => void
  showDraftRow?: boolean
  showScope?: boolean
}) {
  const { t } = useTranslation('agentV2')
  const gridClassName = showScope
    ? 'grid-cols-[minmax(76px,1fr)_minmax(84px,1.25fr)_72px_28px]'
    : 'grid-cols-[minmax(120px,180px)_minmax(160px,1fr)_28px]'
  const checkEnvVariableKey = (key: string) => {
    const { isValid, errorMessageKey } = checkKeys([key], false)
    if (!isValid) {
      toast.error(t(`varKeyError.${errorMessageKey}`, {
        ns: 'appDebug',
        key: t('agentDetail.configure.advancedSettings.envEditor.keyColumn'),
      }))
      return false
    }

    return true
  }
  const handleKeyChange = (id: string, key: string) => {
    const normalizedKey = key.replaceAll(' ', '_')
    if (normalizedKey && !checkEnvVariableKey(normalizedKey))
      return

    onKeyChange?.(id, normalizedKey)
  }

  return (
    <div className="overflow-hidden rounded-lg border border-divider-regular bg-components-panel-on-panel-item-bg shadow-xs shadow-shadow-shadow-3">
      <div className={cn('grid min-h-7 text-text-tertiary', gridClassName)}>
        <EnvEditorCell>
          <span className="px-3 system-xs-medium-uppercase">
            {t('agentDetail.configure.advancedSettings.envEditor.keyColumn')}
          </span>
        </EnvEditorCell>
        <EnvEditorCell>
          <span className="px-3 system-xs-medium-uppercase">
            {t('agentDetail.configure.advancedSettings.envEditor.valueColumn')}
          </span>
        </EnvEditorCell>
        {showScope && (
          <EnvEditorCell>
            <span className="px-3 system-xs-medium-uppercase">
              {t('agentDetail.configure.advancedSettings.envEditor.scopeColumn')}
            </span>
          </EnvEditorCell>
        )}
        <EnvEditorCell className="justify-center">
          {onAdd && (
            <button
              type="button"
              aria-label={t('agentDetail.configure.advancedSettings.envEditor.add')}
              onClick={() => onAdd()}
              className="flex size-6 items-center justify-center rounded-md text-text-tertiary hover:bg-state-base-hover hover:text-text-secondary focus-visible:ring-2 focus-visible:ring-state-accent-solid focus-visible:outline-hidden"
            >
              <span aria-hidden className="i-ri-add-line size-4" />
            </button>
          )}
        </EnvEditorCell>
      </div>
      {envVariables.map((variable, index) => (
        <EnvEditorRow
          key={variable.id}
          autoFocusField={focusedVariable?.id === variable.id ? focusedVariable.field : undefined}
          variable={variable}
          editable={editable}
          isHighlighted={index === highlightedIndex}
          onDelete={() => onDelete(variable.id)}
          onKeyChange={key => handleKeyChange(variable.id, key)}
          onScopeChange={scope => onScopeChange(variable.id, scope)}
          onValueChange={value => onValueChange?.(variable.id, value)}
          showScope={showScope}
        />
      ))}
      {showDraftRow && <EnvEditorDraftRow onAdd={onAdd} showScope={showScope} />}
    </div>
  )
}

export function AgentEnvEditor() {
  const { t } = useTranslation('agentV2')
  const readOnly = useAgentOrchestrateReadOnly()
  const [envVariables, setEnvVariables] = useAtom(agentComposerEnvVariablesAtom)
  const starterVariableRef = useRef<EnvVariable | undefined>(undefined)
  if (!starterVariableRef.current)
    starterVariableRef.current = createEnvVariable()
  const starterVariable = starterVariableRef.current
  const [focusedVariable, setFocusedVariable] = useState<{ id: string, field: 'key' | 'value' }>()
  const envImportInputRef = useRef<HTMLInputElement>(null)
  const envEditorTip = t('agentDetail.configure.advancedSettings.envEditor.tip')
  const envImportTip = t(envImportTipKeys[getCurrentEnvImportPlatform()])
  const envEditorTableId = 'agent-configure-env-editor-table'
  const visibleEnvVariables = envVariables.length > 0 ? envVariables : [starterVariable]

  const updateVariable = (id: string, updater: (variable: EnvVariable) => EnvVariable) => {
    setEnvVariables((currentEnvVariables) => {
      const existingVariable = currentEnvVariables.find(variable => variable.id === id)

      if (existingVariable) {
        return currentEnvVariables.map(variable => (
          variable.id === id ? updater(variable) : variable
        ))
      }

      if (id === starterVariable.id)
        return [updater(starterVariable)]

      return currentEnvVariables
    })
  }

  const addVariable = ({
    focusField = 'key',
    scope,
  }: {
    focusField?: 'key' | 'value'
    scope?: EnvScope
  } = {}) => {
    const variable = {
      ...createEnvVariable(),
      ...(scope ? { scope } : {}),
    }

    setEnvVariables(currentEnvVariables => [
      ...(currentEnvVariables.length > 0 ? currentEnvVariables : [starterVariable]),
      variable,
    ])
    setFocusedVariable({ id: variable.id, field: focusField })
  }
  const importEnvVariables = async (file: File) => {
    const {
      invalidLineCount,
      variables,
    } = parseEnvImport(await file.text())
    const importedVariables = variables.map(createEnvVariableFromEntry)

    if (invalidLineCount > 0) {
      toast.error(t('agentDetail.configure.advancedSettings.envEditor.importSkippedInvalidLines', {
        count: invalidLineCount,
      }))
    }

    if (importedVariables.length === 0)
      return

    setEnvVariables(currentEnvVariables => [...currentEnvVariables, ...importedVariables])
  }
  const updateVariableKey = (id: string, key: string) => {
    updateVariable(id, variable => ({ ...variable, key }))
  }
  const updateVariableScope = (id: string, scope: EnvScope) => {
    updateVariable(id, variable => ({ ...variable, scope }))
  }
  const updateVariableValue = (id: string, value: string) => {
    updateVariable(id, variable => ({ ...variable, value }))
  }
  const deleteVariable = (id: string) => {
    setEnvVariables(currentEnvVariables => currentEnvVariables.filter(variable => variable.id !== id))
  }

  return (
    <ConfigureSection
      label={t('agentDetail.configure.advancedSettings.envEditor.label')}
      labelId="agent-configure-env-editor-label"
      headingLevel="h4"
      panelId={envEditorTableId}
      tip={<AgentConfigureTipContent type="env" />}
      tipAriaLabel={envEditorTip}
      rootClassName="gap-1 pt-3"
      headerClassName="mb-0 gap-1 px-3"
      panelContentClassName="px-3 pb-3"
      actions={!readOnly
        ? (
            <>
              <input
                ref={envImportInputRef}
                className="hidden"
                type="file"
                onChange={(event) => {
                  const file = event.target.files?.[0]
                  event.target.value = ''

                  if (file)
                    void importEnvVariables(file)
                }}
              />
              <Tooltip>
                <TooltipTrigger
                  render={(
                    <button
                      type="button"
                      aria-label={t('agentDetail.configure.advancedSettings.envEditor.importEnv')}
                      onClick={() => envImportInputRef.current?.click()}
                      className="flex h-6 shrink-0 items-center gap-1 rounded-md px-1.5 py-1 text-text-tertiary hover:bg-state-base-hover hover:text-text-secondary focus-visible:ring-2 focus-visible:ring-state-accent-solid focus-visible:outline-hidden"
                    >
                      <span aria-hidden className="i-ri-file-upload-line size-3.5" />
                      <span className="system-xs-medium">{t('agentDetail.configure.advancedSettings.envEditor.importEnv')}</span>
                    </button>
                  )}
                />
                <TooltipContent className="max-w-72">
                  {envImportTip}
                </TooltipContent>
              </Tooltip>
            </>
          )
        : undefined}
    >
      <EnvVariablesTable
        editable={!readOnly}
        envVariables={visibleEnvVariables}
        focusedVariable={focusedVariable}
        highlightedIndex={1}
        onAdd={readOnly ? undefined : addVariable}
        onDelete={deleteVariable}
        onKeyChange={updateVariableKey}
        onScopeChange={updateVariableScope}
        onValueChange={updateVariableValue}
        showDraftRow={false}
      />
    </ConfigureSection>
  )
}
