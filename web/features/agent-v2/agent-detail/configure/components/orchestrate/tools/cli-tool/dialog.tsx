'use client'

import type { AgentCliTool, EnvScope, EnvVariable } from '@/features/agent-v2/agent-composer/form-state'
import { Button } from '@langgenius/dify-ui/button'
import { Dialog, DialogCloseButton, DialogContent, DialogDescription, DialogTitle } from '@langgenius/dify-ui/dialog'
import { FieldControl, FieldDescription, FieldLabel, FieldRoot } from '@langgenius/dify-ui/field'
import { Form } from '@langgenius/dify-ui/form'
import { toast } from '@langgenius/dify-ui/toast'
import { useCallback, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { EnvVariablesTable } from '../../advanced/env'

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

export function CliToolDialog({
  mode = 'add',
  onDeleteCliTool,
  onSaveCliTool,
  open,
  onOpenChange,
  tool,
}: {
  mode?: 'add' | 'edit'
  onDeleteCliTool?: (toolId: string) => void
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

  const resetForm = useCallback(() => {
    setInstallCommand(tool?.installCommand ?? '')
    setToolName(tool?.name ?? '')
    setEnvVariables(tool?.envVariables?.length ? tool.envVariables : [createCliEnvVariable()])
  }, [tool])

  const handleOpenChange = useCallback((nextOpen: boolean) => {
    if (nextOpen)
      resetForm()

    onOpenChange(nextOpen)
  }, [onOpenChange, resetForm])

  const updateEnvVariable = useCallback((id: string, updater: (variable: EnvVariable) => EnvVariable) => {
    setEnvVariables(currentVariables => currentVariables.map(variable => (
      variable.id === id ? updater(variable) : variable
    )))
  }, [])

  const addEnvVariable = useCallback(() => {
    setEnvVariables(currentVariables => [...currentVariables, createCliEnvVariable()])
  }, [])

  const deleteEnvVariable = useCallback((id: string) => {
    setEnvVariables(currentVariables => currentVariables.length > 1
      ? currentVariables.filter(variable => variable.id !== id)
      : [createCliEnvVariable()],
    )
  }, [])

  const handleKeyChange = useCallback((id: string, key: string) => {
    updateEnvVariable(id, variable => ({ ...variable, key }))
  }, [updateEnvVariable])

  const handleScopeChange = useCallback((id: string, scope: EnvScope) => {
    updateEnvVariable(id, variable => ({ ...variable, scope }))
  }, [updateEnvVariable])

  const handleValueChange = useCallback((id: string, value: string) => {
    updateEnvVariable(id, variable => ({ ...variable, value }))
  }, [updateEnvVariable])

  const handleSubmit = useCallback((formValues: CliToolFormValues) => {
    const trimmedName = formValues.name?.trim() || toolName.trim()
    const trimmedInstallCommand = formValues.installCommand?.trim() || installCommand.trim()

    if (!trimmedInstallCommand) {
      toast.error(t('agentDetail.configure.tools.cliDialog.installCommand.required'))
      return
    }
    if (!trimmedName) {
      toast.error(t('agentDetail.configure.tools.cliDialog.name.required'))
      return
    }

    onSaveCliTool({
      ...tool,
      id: tool?.id ?? createCliToolId(),
      kind: 'cli',
      name: trimmedName,
      installCommand: trimmedInstallCommand,
      envVariables,
    })
    setInstallCommand('')
    setToolName('')
    setEnvVariables([createCliEnvVariable()])
    onOpenChange(false)
  }, [envVariables, installCommand, onOpenChange, onSaveCliTool, t, tool, toolName])

  const handleCancel = useCallback(() => {
    onOpenChange(false)
  }, [onOpenChange])

  const handleDelete = useCallback(() => {
    if (!tool)
      return

    onDeleteCliTool?.(tool.id)
    onOpenChange(false)
  }, [onDeleteCliTool, onOpenChange, tool])

  return (
    <Dialog open={open} onOpenChange={handleOpenChange} disablePointerDismissal>
      <DialogContent className="flex max-h-[calc(100dvh-2rem)] w-[640px] flex-col overflow-hidden p-0">
        <div className="relative px-6 pt-6 pb-3">
          <DialogCloseButton />
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
                onKeyChange={handleKeyChange}
                onScopeChange={handleScopeChange}
                onValueChange={handleValueChange}
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
            <div className="flex shrink-0 items-center gap-3">
              {mode === 'edit' && tool && onDeleteCliTool && (
                <div className="flex items-center gap-3">
                  <Button type="button" tone="destructive" onClick={handleDelete}>
                    {tCommon('operation.remove')}
                  </Button>
                  <div className="h-4 w-px bg-divider-regular" aria-hidden />
                </div>
              )}
              <div className="flex items-center gap-2">
                <Button type="button" onClick={handleCancel}>
                  {tCommon('operation.cancel')}
                </Button>
                <Button type="submit" variant="primary">
                  {tCommon(mode === 'edit' ? 'operation.save' : 'operation.add')}
                </Button>
              </div>
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
