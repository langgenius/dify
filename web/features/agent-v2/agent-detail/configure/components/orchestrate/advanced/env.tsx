'use client'

import type { I18nKeysWithPrefix } from '@/types/i18n'
import { cn } from '@langgenius/dify-ui/cn'
import { Select, SelectContent, SelectItem, SelectItemIndicator, SelectItemText, SelectTrigger } from '@langgenius/dify-ui/select'
import { useTranslation } from 'react-i18next'
import { useAgentConfigureEnvVariables } from '../../../atoms'
import { ConfigureSectionAddButton } from '../add-button'
import { ConfigureSection } from '../section'

export type EnvScope = 'secret' | 'plain'

export type EnvVariable = {
  id: string
  key: string
  value: string
  scope: EnvScope
  masked?: boolean
}

const scopeLabelKeys: Record<EnvScope, I18nKeysWithPrefix<'agentV2', 'agentDetail.configure.advancedSettings.envEditor.'>> = {
  plain: 'agentDetail.configure.advancedSettings.envEditor.scopePlain',
  secret: 'agentDetail.configure.advancedSettings.envEditor.scopeSecret',
}

const envScopeOptions: EnvScope[] = ['secret', 'plain']

function EnvEditorScope({
  scope,
  onChange,
}: {
  scope: EnvScope
  onChange?: (scope: EnvScope) => void
}) {
  const { t } = useTranslation('agentV2')

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

function EnvEditorRow({
  variable,
  isHighlighted,
  onDelete,
  onScopeChange,
}: {
  variable: EnvVariable
  isHighlighted?: boolean
  onDelete: () => void
  onScopeChange: (scope: EnvScope) => void
}) {
  const { t } = useTranslation('agentV2')

  return (
    <div className={cn('grid min-h-7 grid-cols-[minmax(76px,1fr)_minmax(84px,1.25fr)_72px_28px] border-t border-divider-subtle', isHighlighted && 'bg-background-default-hover')}>
      <EnvEditorCell>
        <span className={cn('min-w-0 truncate px-3 system-xs-regular text-text-secondary', isHighlighted && 'text-text-primary')}>
          {variable.key}
        </span>
      </EnvEditorCell>
      <EnvEditorCell>
        <span className="min-w-0 truncate px-3 system-xs-regular text-text-secondary">
          {variable.value}
        </span>
        {variable.masked && (
          <button
            type="button"
            aria-label={t('agentDetail.configure.advancedSettings.envEditor.revealValue', { key: variable.key })}
            className="mr-2 ml-auto flex size-5 shrink-0 items-center justify-center rounded-md text-text-tertiary hover:bg-state-base-hover hover:text-text-secondary focus-visible:ring-2 focus-visible:ring-state-accent-solid focus-visible:outline-hidden"
          >
            <span aria-hidden className="i-ri-eye-line size-4" />
          </button>
        )}
      </EnvEditorCell>
      <EnvEditorCell>
        <EnvEditorScope scope={variable.scope} onChange={onScopeChange} />
      </EnvEditorCell>
      <EnvEditorCell className="justify-center">
        <button
          type="button"
          aria-label={t('agentDetail.configure.advancedSettings.envEditor.deleteVariable', { key: variable.key })}
          onClick={onDelete}
          className="flex size-6 items-center justify-center rounded-md text-text-tertiary hover:bg-state-destructive-hover hover:text-text-destructive focus-visible:ring-2 focus-visible:ring-state-accent-solid focus-visible:outline-hidden"
        >
          <span aria-hidden className="i-ri-delete-bin-line size-4" />
        </button>
      </EnvEditorCell>
    </div>
  )
}

function EnvEditorDraftRow() {
  const { t } = useTranslation('agentV2')

  return (
    <div className="grid min-h-7 grid-cols-[minmax(76px,1fr)_minmax(84px,1.25fr)_72px_28px] border-t border-divider-subtle">
      <EnvEditorCell>
        <span className="min-w-0 truncate px-3 system-xs-regular text-components-input-text-placeholder">
          {t('agentDetail.configure.advancedSettings.envEditor.keyPlaceholder')}
        </span>
      </EnvEditorCell>
      <EnvEditorCell>
        <span className="min-w-0 truncate px-3 system-xs-regular text-components-input-text-placeholder">
          {t('agentDetail.configure.advancedSettings.envEditor.valuePlaceholder')}
        </span>
      </EnvEditorCell>
      <EnvEditorCell>
        <EnvEditorScope scope="plain" />
      </EnvEditorCell>
      <EnvEditorCell />
    </div>
  )
}

export function AgentEnvEditor() {
  const { t } = useTranslation('agentV2')
  const [envVariables, setEnvVariables] = useAgentConfigureEnvVariables()
  const envEditorTip = t('agentDetail.configure.advancedSettings.envEditor.tip')
  const envEditorTableId = 'agent-configure-env-editor-table'
  const updateVariableScope = (id: string, scope: EnvScope) => {
    setEnvVariables(envVariables.map(variable => (
      variable.id === id ? { ...variable, scope } : variable
    )))
  }
  const deleteVariable = (id: string) => {
    setEnvVariables(envVariables.filter(variable => variable.id !== id))
  }

  return (
    <ConfigureSection
      label={t('agentDetail.configure.advancedSettings.envEditor.label')}
      labelId="agent-configure-env-editor-label"
      headingLevel="h4"
      panelId={envEditorTableId}
      tip={envEditorTip}
      tipAriaLabel={envEditorTip}
      rootClassName="gap-1 pt-3"
      headerClassName="mb-0 gap-1 px-3"
      panelContentClassName="px-3 pb-3"
      actions={(
        <>
          <button
            type="button"
            className="flex h-6 shrink-0 items-center gap-1 rounded-md px-1.5 py-1 text-text-tertiary hover:bg-state-base-hover hover:text-text-secondary focus-visible:ring-2 focus-visible:ring-state-accent-solid focus-visible:outline-hidden"
          >
            <span aria-hidden className="i-ri-file-upload-line size-3.5" />
            <span className="system-xs-medium">{t('agentDetail.configure.advancedSettings.envEditor.importEnv')}</span>
          </button>
          <div className="mx-1 h-3 w-px shrink-0 bg-divider-regular" />
          <ConfigureSectionAddButton ariaLabel={t('agentDetail.configure.advancedSettings.envEditor.add')} />
        </>
      )}
    >
      <div className="overflow-hidden rounded-lg border border-divider-regular bg-components-panel-on-panel-item-bg shadow-xs shadow-shadow-shadow-3">
        <div className="grid min-h-7 grid-cols-[minmax(76px,1fr)_minmax(84px,1.25fr)_72px_28px] text-text-tertiary">
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
          <EnvEditorCell>
            <span className="px-3 system-xs-medium-uppercase">
              {t('agentDetail.configure.advancedSettings.envEditor.scopeColumn')}
            </span>
          </EnvEditorCell>
          <EnvEditorCell />
        </div>
        {envVariables.map((variable, index) => (
          <EnvEditorRow
            key={variable.id}
            variable={variable}
            isHighlighted={index === 1}
            onDelete={() => deleteVariable(variable.id)}
            onScopeChange={scope => updateVariableScope(variable.id, scope)}
          />
        ))}
        <EnvEditorDraftRow />
      </div>
    </ConfigureSection>
  )
}
