'use client'

import type { MockVersion } from '../mock-data'
import type { DeploymentDialogRequest } from './types'
import { Button } from '@langgenius/dify-ui/button'
import { DialogCloseButton, DialogDescription, DialogTitle } from '@langgenius/dify-ui/dialog'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { MOCK_DEPLOYMENT_CREDENTIALS, MOCK_ENVIRONMENT_VARIABLES } from '../mock-data'
import { CredentialField } from './credential-field'
import { EnvironmentVariableField } from './environment-variable-field'

function SectionHeading({ title, description }: { title: string; description: string }) {
  return (
    <div className="flex min-w-0 flex-col">
      <h3 className="system-md-semibold text-text-primary">{title}</h3>
      <p className="system-xs-regular text-text-tertiary">{description}</p>
    </div>
  )
}

export function DeploymentConfiguration({
  request,
  version,
  onBack,
  onClose,
}: {
  request: DeploymentDialogRequest
  version: MockVersion
  onBack: () => void
  onClose: () => void
}) {
  const { t } = useTranslation('deployments')
  const { t: tCommon } = useTranslation('common')
  const [credentials, setCredentials] = useState<Record<string, string>>(() =>
    Object.fromEntries(
      MOCK_DEPLOYMENT_CREDENTIALS.map((credential) => [credential.id, credential.selectedValue]),
    ),
  )
  const [environmentVariables, setEnvironmentVariables] = useState(() =>
    Object.fromEntries(
      MOCK_ENVIRONMENT_VARIABLES.map((variable) => [
        variable.key,
        {
          customValue: variable.customValue,
          source: variable.source,
        },
      ]),
    ),
  )

  return (
    <form
      className="flex min-h-0 flex-1 flex-col"
      onSubmit={(event) => {
        event.preventDefault()
        onClose()
      }}
    >
      <DialogCloseButton
        type="button"
        aria-label={tCommon(($) => $['operation.close'])}
        className="top-5 right-5 size-8 rounded-lg"
      />
      <header className="shrink-0 px-5 pt-5 pr-14 pb-1">
        <Button
          type="button"
          size="small"
          variant="ghost-accent"
          className="-ml-1 h-6 gap-1 px-1 system-xs-semibold-uppercase"
          onClick={onBack}
        >
          <span aria-hidden className="i-ri-arrow-left-line size-4" />
          {tCommon(($) => $['operation.back'])}
        </Button>
        <DialogTitle className="mt-0.5 px-1 title-2xl-semi-bold text-text-primary">
          {t(($) => $['studio.deployConfiguration'])}
        </DialogTitle>
        <DialogDescription className="mt-1 px-1 system-xs-regular text-text-tertiary">
          {t(($) => $['studio.deployConfigurationDescription'])}
        </DialogDescription>
      </header>

      <div className="shrink-0 border-b border-divider-regular px-6 pt-2 pb-4">
        <div className="flex items-center justify-between gap-3 rounded-xl bg-background-section p-3">
          <div className="flex min-w-0 flex-1 items-center gap-2">
            <span aria-hidden className="i-ri-stack-line size-3.5 shrink-0 text-text-tertiary" />
            <span className="truncate system-sm-medium text-text-secondary">{version.name}</span>
          </div>
          <span
            aria-hidden
            className="i-ri-arrow-right-line size-3.5 shrink-0 text-text-tertiary"
          />
          <div className="flex min-w-0 flex-1 items-center justify-end gap-2">
            <span aria-hidden className="i-ri-instance-line size-3.5 shrink-0 text-text-tertiary" />
            <span className="truncate system-sm-medium text-text-secondary">
              {request.environment}
            </span>
          </div>
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto">
        <section className="flex flex-col gap-4 px-6 py-4">
          <SectionHeading
            title={t(($) => $['deployDrawer.runtimeCredentials'])}
            description={t(($) => $['deployDrawer.bindingSelectionHint'])}
          />
          {MOCK_DEPLOYMENT_CREDENTIALS.map((credential) => (
            <CredentialField
              key={credential.id}
              credential={credential}
              value={credentials[credential.id] ?? credential.selectedValue}
              onChange={(value) =>
                setCredentials((current) => ({
                  ...current,
                  [credential.id]: value,
                }))
              }
            />
          ))}
        </section>

        <section className="flex flex-col gap-4 border-t border-divider-regular px-6 py-4">
          <SectionHeading
            title={t(($) => $['deployDrawer.envVars'])}
            description={t(($) => $['studio.environmentVariablesDescription'])}
          />
          {MOCK_ENVIRONMENT_VARIABLES.map((variable) => {
            const selection = environmentVariables[variable.key] ?? {
              customValue: variable.customValue,
              source: variable.source,
            }

            return (
              <EnvironmentVariableField
                key={variable.key}
                variable={variable}
                source={selection.source}
                customValue={selection.customValue}
                onSourceChange={(source) =>
                  setEnvironmentVariables((current) => ({
                    ...current,
                    [variable.key]: {
                      ...selection,
                      source,
                    },
                  }))
                }
                onCustomValueChange={(customValue) =>
                  setEnvironmentVariables((current) => ({
                    ...current,
                    [variable.key]: {
                      ...selection,
                      customValue,
                    },
                  }))
                }
              />
            )
          })}
        </section>
      </div>

      <footer className="flex shrink-0 justify-end gap-2 px-6 pt-5 pb-6">
        <Button type="button" variant="secondary" onClick={onClose}>
          {tCommon(($) => $['operation.cancel'])}
        </Button>
        <Button type="submit" variant="primary">
          {tCommon(($) => $['appMenus.deploy'])}
        </Button>
      </footer>
    </form>
  )
}
