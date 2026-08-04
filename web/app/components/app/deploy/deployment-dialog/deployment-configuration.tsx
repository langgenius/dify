'use client'

import type { PrecheckWorkflowDeploymentResponse } from '@dify/contracts/enterprise-app-deploy/types.gen'
import type { Dispatch, SetStateAction } from 'react'
import type { DeploymentVersion } from '../version'
import type { DeploymentDialogRequest } from './types'
import type { DeploymentConfigurationQueryState } from './use-deployment-configuration-queries'
import type { DeploymentConfigurationValues } from './use-deployment-configuration-values'
import { Button } from '@langgenius/dify-ui/button'
import { cn } from '@langgenius/dify-ui/cn'
import { DialogCloseButton, DialogDescription, DialogTitle } from '@langgenius/dify-ui/dialog'
import { useTranslation } from 'react-i18next'
import { useDeployWorkflow } from '../use-deploy-workflow'
import { CredentialField } from './credential-field'
import { EnvironmentVariableField } from './environment-variable-field'
import { useDeploymentConfigurationQueries } from './use-deployment-configuration-queries'
import { useDeploymentConfigurationValues } from './use-deployment-configuration-values'
import {
  credentialSlotKey,
  defaultCredentialId,
  defaultEnvironmentVariableSelection,
  workflowDeploymentInput,
} from './workflow-deployment-input'

function SectionHeading({ title, description }: { title: string; description: string }) {
  return (
    <div className="flex min-w-0 flex-col">
      <h3 className="system-md-semibold text-text-primary">{title}</h3>
      <p className="system-xs-regular text-text-tertiary">{description}</p>
    </div>
  )
}

function errorMessage(error: unknown, fallback: string) {
  if (
    typeof error === 'object' &&
    error !== null &&
    'message' in error &&
    typeof error.message === 'string' &&
    error.message.trim()
  ) {
    return error.message.trim()
  }

  return fallback
}

function precheckIssueMessages(precheck: PrecheckWorkflowDeploymentResponse) {
  return [
    ...precheck.unsupported_nodes.map((node) => `${node.type} · ${node.id}`),
    ...precheck.unsupported_tool_providers.map(
      (provider) => `${provider.provider_name} · ${provider.tool_name} (${provider.provider_type})`,
    ),
  ]
}

function ConfigurationError({ messages }: { messages: string[] }) {
  const { t } = useTranslation('common')

  return (
    <div role="alert" className="flex gap-2 text-text-destructive">
      <span aria-hidden className="mt-0.5 i-ri-error-warning-fill size-4 shrink-0" />
      <div className="min-w-0">
        <p className="system-sm-semibold">{t(($) => $.error)}</p>
        <ul className="mt-1 list-disc space-y-1 pl-4 system-xs-regular">
          {messages.map((message) => (
            <li key={message} className="wrap-break-word">
              {message}
            </li>
          ))}
        </ul>
      </div>
    </div>
  )
}

function ConfigurationLoading({ label }: { label: string }) {
  return (
    <div role="status" className="flex items-center justify-center gap-2 py-8 text-text-tertiary">
      <span
        aria-hidden
        className="i-ri-loader-2-line size-4 animate-spin motion-reduce:animate-none"
      />
      <span className="system-xs-regular">{label}</span>
    </div>
  )
}

export function DeploymentConfigurationContent({
  compact = false,
  deploymentError,
  onValuesChange,
  queryState,
  request,
  values,
  version,
}: {
  compact?: boolean
  deploymentError?: unknown
  onValuesChange: Dispatch<SetStateAction<DeploymentConfigurationValues>>
  queryState: DeploymentConfigurationQueryState
  request: DeploymentDialogRequest
  values: DeploymentConfigurationValues
  version: DeploymentVersion
}) {
  const { t } = useTranslation('deployments')
  const { t: tCommon } = useTranslation('common')
  const horizontalPaddingClassName = compact ? 'px-4' : 'px-6'
  const {
    deploymentOptions,
    deploymentOptionsError,
    isLoadingDeploymentOptions,
    isPrecheckBlocked,
    isPrechecking,
    precheck,
    precheckError,
  } = queryState
  const precheckMessages = precheck ? precheckIssueMessages(precheck) : []
  const showConfiguration = Boolean(deploymentOptions)

  return (
    <>
      <div
        className={cn(
          'shrink-0 border-b border-divider-regular pt-2 pb-4',
          horizontalPaddingClassName,
        )}
      >
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

      <div
        aria-busy={isPrechecking || isLoadingDeploymentOptions}
        className="min-h-0 flex-1 overflow-y-auto"
      >
        {isPrechecking && (
          <ConfigurationLoading label={t(($) => $['versions.checkingReleaseContent'])} />
        )}
        {!isPrechecking && precheckError && (
          <div className={cn('py-4', horizontalPaddingClassName)}>
            <ConfigurationError
              messages={[
                errorMessage(
                  precheckError,
                  tCommon(($) => $.error),
                ),
              ]}
            />
          </div>
        )}
        {!isPrechecking && !precheckError && isPrecheckBlocked && (
          <div className={cn('py-4', horizontalPaddingClassName)}>
            <ConfigurationError
              messages={
                precheckMessages.length > 0
                  ? precheckMessages
                  : [t(($) => $['unsupportedDslNodes.description'])]
              }
            />
          </div>
        )}
        {isLoadingDeploymentOptions && <ConfigurationLoading label={tCommon(($) => $.loading)} />}
        {!isLoadingDeploymentOptions && deploymentOptionsError && (
          <div className={cn('py-4', horizontalPaddingClassName)}>
            <ConfigurationError
              messages={[
                errorMessage(
                  deploymentOptionsError,
                  t(($) => $['deployDrawer.bindingOptionsFailed']),
                ),
              ]}
            />
          </div>
        )}
        {Boolean(deploymentError) && (
          <div className={cn('pt-4', horizontalPaddingClassName)}>
            <ConfigurationError
              messages={[
                errorMessage(
                  deploymentError,
                  t(($) => $['deployDrawer.deployFailed']),
                ),
              ]}
            />
          </div>
        )}
        {showConfiguration && (
          <>
            <section className={cn('flex flex-col gap-4 py-4', horizontalPaddingClassName)}>
              <SectionHeading
                title={t(($) => $['deployDrawer.runtimeCredentials'])}
                description={t(($) => $['deployDrawer.bindingSelectionHint'])}
              />
              {deploymentOptions?.credential_slots.map((slot) => {
                const slotKey = credentialSlotKey(slot)

                return (
                  <CredentialField
                    key={slotKey}
                    slot={slot}
                    value={values.credentials[slotKey] ?? defaultCredentialId(slot)}
                    onChange={(value) =>
                      onValuesChange((current) => ({
                        ...current,
                        credentials: {
                          ...current.credentials,
                          [slotKey]: value,
                        },
                      }))
                    }
                  />
                )
              })}
            </section>

            <section
              className={cn(
                'flex flex-col gap-4 border-t border-divider-regular py-4',
                horizontalPaddingClassName,
              )}
            >
              <SectionHeading
                title={t(($) => $['deployDrawer.envVars'])}
                description={t(($) => $['studio.environmentVariablesDescription'])}
              />
              {deploymentOptions?.environment_variable_slots.map((slot) => {
                const selection =
                  values.environmentVariables[slot.key] ?? defaultEnvironmentVariableSelection(slot)

                return (
                  <EnvironmentVariableField
                    key={slot.key}
                    slot={slot}
                    source={selection.source}
                    customValue={selection.customValue}
                    onSourceChange={(source) =>
                      onValuesChange((current) => ({
                        ...current,
                        environmentVariables: {
                          ...current.environmentVariables,
                          [slot.key]: {
                            ...selection,
                            source,
                          },
                        },
                      }))
                    }
                    onCustomValueChange={(customValue) =>
                      onValuesChange((current) => ({
                        ...current,
                        environmentVariables: {
                          ...current.environmentVariables,
                          [slot.key]: {
                            ...selection,
                            customValue,
                          },
                        },
                      }))
                    }
                  />
                )
              })}
            </section>
          </>
        )}
      </div>
    </>
  )
}

export function DeploymentConfiguration({
  appId,
  disabled = false,
  embedded = false,
  invalidateAppEnvironmentsOnSuccess = true,
  request,
  version,
  onBack,
  onClose,
  onDeploymentStarted,
}: {
  appId?: string
  disabled?: boolean
  embedded?: boolean
  invalidateAppEnvironmentsOnSuccess?: boolean
  request: DeploymentDialogRequest
  version: DeploymentVersion
  onBack?: () => void
  onClose: () => void
  onDeploymentStarted?: (operationId: string) => void
}) {
  const { t } = useTranslation('deployments')
  const { t: tCommon } = useTranslation('common')
  const [configurationValues, setConfigurationValues] = useDeploymentConfigurationValues()
  const queryState = useDeploymentConfigurationQueries({
    appId,
    environmentId: request.environmentId,
    workflowId: version.id,
  })
  const deploymentInput = queryState.deploymentOptions
    ? workflowDeploymentInput(queryState.deploymentOptions, configurationValues)
    : undefined
  const deployMutation = useDeployWorkflow({
    appId,
    environmentId: request.environmentId,
    invalidateAppEnvironmentsOnSuccess,
    onSuccess: (response) => {
      onDeploymentStarted?.(response.operation.id)
      onClose()
    },
  })
  const canDeploy =
    Boolean(appId) &&
    !disabled &&
    queryState.canDeploy &&
    Boolean(deploymentInput) &&
    !deployMutation.isPending

  return (
    <form
      className="flex min-h-0 flex-1 flex-col"
      onSubmit={(event) => {
        event.preventDefault()
        if (!appId || !canDeploy || !deploymentInput) return

        deployMutation.mutate({
          body: deploymentInput,
          params: {
            app_id: appId,
            environment_id: request.environmentId,
            workflow_id: version.id,
          },
        })
      }}
    >
      {!embedded && (
        <DialogCloseButton
          type="button"
          aria-label={tCommon(($) => $['operation.close'])}
          className="top-5 right-5 size-8 rounded-lg"
        />
      )}
      <header className={cn('shrink-0', embedded ? 'px-3 pt-3.5 pb-1' : 'px-5 pt-5 pr-14 pb-1')}>
        {onBack && (
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
        )}
        {embedded ? (
          <>
            <h2 className="mt-0.5 px-1 system-xl-semibold text-text-primary">
              {t(($) => $['studio.deployConfiguration'])}
            </h2>
            <p className="mt-0.5 px-1 system-xs-regular text-text-tertiary">
              {t(($) => $['studio.deployConfigurationDescription'])}
            </p>
          </>
        ) : (
          <>
            <DialogTitle className="mt-0.5 px-1 title-2xl-semi-bold text-text-primary">
              {t(($) => $['studio.deployConfiguration'])}
            </DialogTitle>
            <DialogDescription className="mt-1 px-1 system-xs-regular text-text-tertiary">
              {t(($) => $['studio.deployConfigurationDescription'])}
            </DialogDescription>
          </>
        )}
      </header>

      <DeploymentConfigurationContent
        compact={embedded}
        deploymentError={deployMutation.error}
        onValuesChange={setConfigurationValues}
        queryState={queryState}
        request={request}
        values={configurationValues}
        version={version}
      />

      <footer
        className={cn(
          'flex shrink-0 justify-end gap-2',
          embedded ? 'px-4 pt-2 pb-4' : 'px-6 pt-5 pb-6',
        )}
      >
        <Button type="button" variant="secondary" onClick={onClose}>
          {tCommon(($) => $['operation.cancel'])}
        </Button>
        <Button
          type="submit"
          variant="primary"
          disabled={!canDeploy}
          loading={deployMutation.isPending}
        >
          {tCommon(($) => $['appMenus.deploy'])}
        </Button>
      </footer>
    </form>
  )
}
