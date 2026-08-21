'use client'

import type { CredentialSlot } from '@dify/contracts/enterprise-app-deploy/types.gen'
import type { DeploymentVersion } from '../../version'
import type { DeploymentDialogRequest } from '../types'
import type { DeploymentConfigurationQueryState } from './use-deployment-configuration-queries'
import type { DeploymentConfigurationValuesController } from './use-deployment-configuration-values'
import { cn } from '@langgenius/dify-ui/cn'
import { memo } from 'react'
import { useTranslation } from 'react-i18next'
import Loading from '@/app/components/base/loading'
import { CredentialField } from './credential-field'
import { DeploymentPrecheckAlert } from './deployment-precheck-alert'
import { EnvironmentVariableField } from './environment-variable-field'
import { credentialSlotKey, defaultCredentialId } from './workflow-deployment-input'

const CredentialConfigurationField = memo(
  ({
    onChange,
    slot,
    slotKey,
    value,
  }: {
    onChange: (key: string, value: string) => void
    slot: CredentialSlot
    slotKey: string
    value?: string
  }) => {
    return (
      <CredentialField slot={slot} value={value} onChange={(value) => onChange(slotKey, value)} />
    )
  },
)
CredentialConfigurationField.displayName = 'CredentialConfigurationField'

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

export function DeploymentConfigurationContent({
  compact = false,
  configurationValues,
  queryState,
  request,
  version,
}: {
  compact?: boolean
  configurationValues: DeploymentConfigurationValuesController
  queryState: DeploymentConfigurationQueryState
  request: DeploymentDialogRequest
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
  const {
    credentials,
    getEnvironmentVariableSelection,
    setCredential,
    setEnvironmentVariableSelection,
  } = configurationValues
  const unsupportedNodes = precheck?.unsupported_nodes ?? []
  const showPrecheckAlert = !isPrechecking && !precheckError && isPrecheckBlocked
  const showConfiguration = Boolean(deploymentOptions)
  const credentialSlots = deploymentOptions?.credential_slots ?? []
  const hasCredentialSlots = credentialSlots.length > 0
  const environmentVariableSlots = deploymentOptions?.environment_variable_slots ?? []

  return (
    <>
      <div
        className={cn(
          'shrink-0 pt-2',
          showPrecheckAlert ? 'pb-0' : 'border-b border-divider-regular pb-4',
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
        {isPrechecking && <Loading className="py-8" />}
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
        {showPrecheckAlert && (
          <div
            className={cn('border-b border-divider-regular pt-2 pb-4', horizontalPaddingClassName)}
          >
            <DeploymentPrecheckAlert nodes={unsupportedNodes} />
          </div>
        )}
        {isLoadingDeploymentOptions && <Loading className="py-8" />}
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
        {showConfiguration && (
          <>
            {hasCredentialSlots && (
              <section className={cn('flex flex-col gap-4 py-4', horizontalPaddingClassName)}>
                <SectionHeading
                  title={t(($) => $['deployDrawer.runtimeCredentials'])}
                  description={t(($) => $['deployDrawer.bindingSelectionHint'])}
                />
                {credentialSlots.map((slot) => {
                  const slotKey = credentialSlotKey(slot)

                  return (
                    <CredentialConfigurationField
                      key={slotKey}
                      slot={slot}
                      slotKey={slotKey}
                      value={credentials[slotKey] ?? defaultCredentialId(slot)}
                      onChange={setCredential}
                    />
                  )
                })}
              </section>
            )}

            {environmentVariableSlots.length > 0 ? (
              <section
                className={cn(
                  'flex flex-col gap-4 py-4',
                  hasCredentialSlots && 'border-t border-divider-regular',
                  horizontalPaddingClassName,
                )}
              >
                <SectionHeading
                  title={t(($) => $['deployDrawer.envVars'])}
                  description={t(($) => $['studio.environmentVariablesDescription'])}
                />
                {environmentVariableSlots.map((slot) => {
                  return (
                    <EnvironmentVariableField
                      key={`${slot.key}:${slot.has_configured_value}:${slot.has_last_deployed_value}`}
                      slot={slot}
                      getInitialSelection={getEnvironmentVariableSelection}
                      onChange={setEnvironmentVariableSelection}
                    />
                  )
                })}
              </section>
            ) : null}
          </>
        )}
      </div>
    </>
  )
}
