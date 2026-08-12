'use client'

import type { Dispatch, SetStateAction } from 'react'
import type { DeploymentVersion } from '../../version'
import type { DeploymentDialogRequest } from '../types'
import type { DeploymentConfigurationQueryState } from './use-deployment-configuration-queries'
import type { DeploymentConfigurationValues } from './use-deployment-configuration-values'
import { cn } from '@langgenius/dify-ui/cn'
import { useTranslation } from 'react-i18next'
import { CredentialField } from './credential-field'
import { DeploymentPrecheckAlert } from './deployment-precheck-alert'
import { EnvironmentVariableField } from './environment-variable-field'
import {
  credentialSlotKey,
  defaultCredentialId,
  defaultEnvironmentVariableSelection,
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
  onValuesChange,
  queryState,
  request,
  values,
  version,
}: {
  compact?: boolean
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
        {showPrecheckAlert && (
          <div
            className={cn('border-b border-divider-regular pt-2 pb-4', horizontalPaddingClassName)}
          >
            <DeploymentPrecheckAlert nodes={unsupportedNodes} />
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
                  const selection =
                    values.environmentVariables[slot.key] ??
                    defaultEnvironmentVariableSelection(slot)

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
            ) : null}
          </>
        )}
      </div>
    </>
  )
}
