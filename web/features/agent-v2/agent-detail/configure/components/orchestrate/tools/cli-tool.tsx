'use client'

import type { EnvScope, EnvVariable } from '../advanced/env'
import type { AgentCliTool } from './types'
import { Button } from '@langgenius/dify-ui/button'
import { Dialog, DialogCloseButton, DialogContent, DialogDescription, DialogTitle } from '@langgenius/dify-ui/dialog'
import { FieldControl, FieldDescription, FieldLabel, FieldRoot } from '@langgenius/dify-ui/field'
import { Form } from '@langgenius/dify-ui/form'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { EnvVariablesTable } from '../advanced/env'

type CliToolFormValues = {
  installCommand?: string
  name?: string
}

const createCliToolId = () => `cli-tool-${globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random()}`}`

const createCliEnvVariable = (): EnvVariable => ({
  id: globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random()}`,
  key: '',
  value: '',
  scope: 'plain',
})

function CliIcon() {
  return (
    <span className="flex size-5 shrink-0 items-center justify-center rounded-md border border-divider-regular bg-text-tertiary p-1 text-text-primary-on-surface">
      <span aria-hidden className="i-ri-terminal-box-line size-3.5" />
    </span>
  )
}

export function AgentCliToolItem({
  onDelete,
  onEdit,
  tool,
}: {
  onDelete: () => void
  onEdit: () => void
  tool: AgentCliTool
}) {
  const { t } = useTranslation('agentV2')

  return (
    <div className="group flex min-h-8 items-center gap-1 overflow-hidden rounded-lg border-[0.5px] border-components-panel-border-subtle bg-components-panel-on-panel-item-bg py-1.5 pr-1.5 pl-2 shadow-xs shadow-shadow-shadow-3 focus-within:border-components-panel-border focus-within:bg-components-panel-on-panel-item-bg-hover focus-within:shadow-sm hover:border-components-panel-border hover:bg-components-panel-on-panel-item-bg-hover hover:shadow-sm">
      <div className="flex min-w-0 flex-1 items-center gap-2 py-0.5 pr-1">
        <CliIcon />
        <span className="min-w-0 truncate system-sm-medium text-text-primary">
          {tool.name}
        </span>
      </div>
      <div className="hidden shrink-0 items-center gap-1 group-focus-within:flex group-hover:flex">
        <button
          type="button"
          aria-label={t('agentDetail.configure.tools.editAction', { name: tool.name })}
          onClick={onEdit}
          className="flex size-6 items-center justify-center rounded-md text-text-tertiary hover:bg-state-base-hover hover:text-text-secondary focus-visible:ring-2 focus-visible:ring-state-accent-solid focus-visible:outline-hidden"
        >
          <span aria-hidden className="i-ri-equalizer-2-line size-4" />
        </button>
        <button
          type="button"
          aria-label={t('agentDetail.configure.tools.removeAction', { name: tool.name })}
          onClick={onDelete}
          className="flex size-6 items-center justify-center rounded-md text-text-tertiary hover:bg-state-destructive-hover hover:text-text-destructive focus-visible:ring-2 focus-visible:ring-state-accent-solid focus-visible:outline-hidden"
        >
          <span aria-hidden className="i-ri-delete-bin-line size-4" />
        </button>
      </div>
      <span className="shrink-0 rounded-[5px] border border-divider-deep bg-components-badge-bg-dimm px-1 py-0.5 system-2xs-medium-uppercase text-text-tertiary group-focus-within:hidden group-hover:hidden">
        {t('agentDetail.configure.tools.cliTool')}
      </span>
    </div>
  )
}

export function CliToolDialog({
  mode = 'add',
  onSaveCliTool,
  open,
  onOpenChange,
  tool,
}: {
  mode?: 'add' | 'edit'
  onSaveCliTool: (tool: AgentCliTool) => void
  open: boolean
  onOpenChange: (open: boolean) => void
  tool?: AgentCliTool | null
}) {
  const { t } = useTranslation('agentV2')
  const { t: tCommon } = useTranslation('common')
  const [installCommand, setInstallCommand] = useState(tool?.installCommand ?? '')
  const [toolName, setToolName] = useState(tool?.name ?? '')
  const [envVariables, setEnvVariables] = useState<EnvVariable[]>(() => tool?.envVariables?.length ? tool.envVariables : [createCliEnvVariable()])

  const resetForm = () => {
    setInstallCommand(tool?.installCommand ?? '')
    setToolName(tool?.name ?? '')
    setEnvVariables(tool?.envVariables?.length ? tool.envVariables : [createCliEnvVariable()])
  }
  const handleOpenChange = (nextOpen: boolean) => {
    if (nextOpen)
      resetForm()

    onOpenChange(nextOpen)
  }
  const updateEnvVariable = (id: string, updater: (variable: EnvVariable) => EnvVariable) => {
    setEnvVariables(currentVariables => currentVariables.map(variable => (
      variable.id === id ? updater(variable) : variable
    )))
  }
  const addEnvVariable = () => {
    setEnvVariables(currentVariables => [...currentVariables, createCliEnvVariable()])
  }
  const deleteEnvVariable = (id: string) => {
    setEnvVariables(currentVariables => currentVariables.length > 1
      ? currentVariables.filter(variable => variable.id !== id)
      : [createCliEnvVariable()],
    )
  }
  const handleSubmit = (formValues: CliToolFormValues) => {
    const trimmedName = formValues.name?.trim() || toolName.trim()
    const trimmedInstallCommand = formValues.installCommand?.trim() || installCommand.trim()
    const name = trimmedName || trimmedInstallCommand || t('agentDetail.configure.tools.cliTool')

    onSaveCliTool({
      ...tool,
      id: tool?.id ?? createCliToolId(),
      kind: 'cli',
      name,
      installCommand: trimmedInstallCommand,
      envVariables,
    })
    setInstallCommand('')
    setToolName('')
    setEnvVariables([createCliEnvVariable()])
    onOpenChange(false)
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="flex max-h-[calc(100dvh-2rem)] w-[640px] flex-col overflow-hidden p-0">
        <div className="relative px-6 pt-6 pb-3">
          <DialogCloseButton className="top-5 right-5" />
          <DialogTitle className="title-2xl-semi-bold text-text-primary">
            {t(mode === 'edit' ? 'agentDetail.configure.tools.cliDialog.editTitle' : 'agentDetail.configure.tools.cliDialog.title')}
          </DialogTitle>
          <DialogDescription className="mt-1 system-xs-regular text-text-tertiary">
            {t('agentDetail.configure.tools.cliDialog.description')}
          </DialogDescription>
        </div>
        <Form<CliToolFormValues>
          className="min-h-0 flex-1 overflow-y-auto px-6 py-3"
          onFormSubmit={handleSubmit}
        >
          <div className="flex flex-col gap-4">
            <FieldRoot name="installCommand">
              <FieldLabel>
                {t('agentDetail.configure.tools.cliDialog.installCommand.label')}
              </FieldLabel>
              <FieldDescription>
                {t('agentDetail.configure.tools.cliDialog.installCommand.description')}
              </FieldDescription>
              <FieldControl
                autoComplete="off"
                onValueChange={setInstallCommand}
                placeholder={t('agentDetail.configure.tools.cliDialog.installCommand.placeholder')}
                value={installCommand}
              />
            </FieldRoot>
            <FieldRoot name="name">
              <FieldLabel>
                {t('agentDetail.configure.tools.cliDialog.name.label')}
              </FieldLabel>
              <FieldControl
                autoComplete="off"
                onValueChange={setToolName}
                placeholder={t('agentDetail.configure.tools.cliDialog.name.placeholder')}
                value={toolName}
              />
            </FieldRoot>
            <div className="pt-1">
              <div className="mb-3 h-px bg-divider-subtle" />
              <div className="mb-1 flex min-h-6 items-center gap-1">
                <span className="system-sm-medium text-text-secondary">
                  {t('agentDetail.configure.tools.cliDialog.env.label')}
                </span>
                <span className="system-xs-regular text-text-tertiary">
                  {t('agentDetail.configure.tools.cliDialog.env.optional')}
                </span>
              </div>
              <p className="mb-2 body-xs-regular text-text-tertiary">
                {t('agentDetail.configure.tools.cliDialog.env.description')}
              </p>
              <EnvVariablesTable
                editable
                envVariables={envVariables}
                onAdd={addEnvVariable}
                onDelete={deleteEnvVariable}
                onKeyChange={(id, key) => updateEnvVariable(id, variable => ({ ...variable, key }))}
                onScopeChange={(id, scope: EnvScope) => updateEnvVariable(id, variable => ({ ...variable, scope }))}
                onValueChange={(id, value) => updateEnvVariable(id, variable => ({ ...variable, value }))}
                showDraftRow={false}
                showScope={false}
              />
            </div>
          </div>
          <div className="flex items-center gap-3 py-8">
            <a
              href="https://docs.dify.ai/"
              target="_blank"
              rel="noreferrer"
              className="inline-flex min-w-0 flex-1 items-center gap-1 system-xs-regular text-text-accent hover:underline focus-visible:ring-2 focus-visible:ring-state-accent-solid focus-visible:outline-hidden"
            >
              <span>{t('agentDetail.configure.tools.cliDialog.learnMore')}</span>
              <span aria-hidden className="i-ri-external-link-line size-3" />
            </a>
            <div className="flex shrink-0 items-center gap-2">
              <Button type="button" onClick={() => onOpenChange(false)}>
                {tCommon('operation.cancel')}
              </Button>
              <Button type="submit" variant="primary">
                {tCommon('operation.add')}
              </Button>
            </div>
          </div>
        </Form>
        <div className="flex items-start justify-center gap-1 border-t-[0.5px] border-divider-subtle bg-background-soft px-2 py-3">
          <span aria-hidden className="mt-0.5 i-ri-lock-2-fill size-3 text-text-tertiary" />
          <p className="system-xs-regular text-text-tertiary">
            {t('agentDetail.configure.tools.cliDialog.securityTip')}
          </p>
        </div>
      </DialogContent>
    </Dialog>
  )
}
