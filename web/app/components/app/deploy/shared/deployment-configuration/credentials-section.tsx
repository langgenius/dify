import type { CredentialSlot } from '@dify/contracts/enterprise-app-deploy/types.gen'
import type { DeploymentConfigurationValuesController } from './use-deployment-configuration-values'
import { cn } from '@langgenius/dify-ui/cn'
import { memo } from 'react'
import { useTranslation } from 'react-i18next'
import { CredentialField } from './credential-field'
import { SectionHeading } from './section-heading'
import { credentialSlotKey, defaultCredentialId } from './utils/workflow-deployment-input'

const CredentialConfigurationField = memo(
  ({
    onChange,
    paths,
    slot,
    slotKey,
    value,
  }: {
    onChange: DeploymentConfigurationValuesController['setCredential']
    paths?: NonNullable<CredentialSlot['workflow_as_tool_dependency']>['paths']
    slot: CredentialSlot
    slotKey: string
    value?: string
  }) => {
    return (
      <CredentialField
        paths={paths}
        slot={slot}
        value={value}
        onChange={(value) => onChange(slotKey, value)}
      />
    )
  },
)
CredentialConfigurationField.displayName = 'CredentialConfigurationField'

export const CredentialsSection = memo(
  ({
    credentialSlots,
    credentials,
    horizontalPaddingClassName,
    onChange,
  }: {
    credentialSlots: CredentialSlot[]
    credentials: DeploymentConfigurationValuesController['credentials']
    horizontalPaddingClassName: string
    onChange: DeploymentConfigurationValuesController['setCredential']
  }) => {
    const { t } = useTranslation('deployments')
    const { t: tWorkflow } = useTranslation('workflow')
    const appCredentialSlots = credentialSlots.filter((slot) => !slot.workflow_as_tool_dependency)
    const subworkflowCredentialSlots = credentialSlots.filter(
      (slot) => slot.workflow_as_tool_dependency,
    )

    if (credentialSlots.length === 0) return null

    return (
      <section className={cn('flex flex-col gap-4 py-4', horizontalPaddingClassName)}>
        <SectionHeading
          title={t(($) => $['deployDrawer.runtimeCredentials'])}
          description={t(($) => $['deployDrawer.bindingSelectionHint'])}
        />
        {appCredentialSlots.map((slot) => {
          const slotKey = credentialSlotKey(slot)

          return (
            <CredentialConfigurationField
              key={slotKey}
              slot={slot}
              slotKey={slotKey}
              value={credentials[slotKey] ?? defaultCredentialId(slot)}
              onChange={onChange}
            />
          )
        })}
        {subworkflowCredentialSlots.length > 0 && (
          <>
            <div className="flex min-w-0 items-center gap-2 pt-2">
              <span className="shrink-0 system-xs-medium-uppercase text-text-tertiary">
                {t(($) => $['studio.precheck.from'])} {tWorkflow(($) => $['common.workflowAsTool'])}
              </span>
              <span
                aria-hidden
                className="h-px min-w-0 flex-1 bg-linear-to-r from-divider-regular to-background-gradient-mask-transparent"
              />
            </div>
            {subworkflowCredentialSlots.map((slot) => {
              const slotKey = credentialSlotKey(slot)

              return (
                <CredentialConfigurationField
                  key={slotKey}
                  paths={slot.workflow_as_tool_dependency?.paths}
                  slot={slot}
                  slotKey={slotKey}
                  value={credentials[slotKey] ?? defaultCredentialId(slot)}
                  onChange={onChange}
                />
              )
            })}
          </>
        )}
      </section>
    )
  },
)
