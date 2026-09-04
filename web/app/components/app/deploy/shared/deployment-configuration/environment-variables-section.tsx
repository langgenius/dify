import type { EnvironmentVariableGroup } from '@dify/contracts/enterprise-app-deploy/types.gen'
import type { DeploymentConfigurationValuesController } from './use-deployment-configuration-values'
import { cn } from '@langgenius/dify-ui/cn'
import { memo } from 'react'
import { useTranslation } from 'react-i18next'
import { EnvironmentVariableField } from './environment-variable-field'
import { SectionHeading } from './section-heading'
import { SubworkflowSourceTitle, WorkflowReferenceIcon } from './workflow-source-popover'

function EnvironmentVariableGroupFields({
  group,
  getEnvironmentVariableSelection,
  setEnvironmentVariableSelection,
}: {
  group: EnvironmentVariableGroup
  getEnvironmentVariableSelection: DeploymentConfigurationValuesController['getEnvironmentVariableSelection']
  setEnvironmentVariableSelection: DeploymentConfigurationValuesController['setEnvironmentVariableSelection']
}) {
  const owner = group.from_app ?? group.from_workflow_as_tool?.workflow
  if (!owner) return null

  return (
    <fieldset aria-label={owner.name} className="min-w-0 pb-2">
      <div className="flex min-w-0 items-center gap-2 pt-1 pb-3">
        <WorkflowReferenceIcon reference={owner} />
        {group.from_workflow_as_tool ? (
          <SubworkflowSourceTitle source={group.from_workflow_as_tool} />
        ) : (
          <span className="min-w-0 flex-1 truncate system-sm-semibold text-text-primary">
            {owner.name}
          </span>
        )}
      </div>
      <div className="flex min-w-0 items-stretch gap-2">
        <span aria-hidden className="flex w-5 shrink-0 justify-center pt-1">
          <span className="h-full w-0.5 rounded-full bg-divider-subtle" />
        </span>
        <div className="flex min-w-0 flex-1 flex-col gap-4">
          {group.environment_variable_slots.map((slot) => (
            <EnvironmentVariableField
              key={`${owner.workflow_id}:${slot.key}:${slot.has_configured_value}:${slot.has_last_deployed_value}`}
              slot={slot}
              workflowId={owner.workflow_id}
              getInitialSelection={getEnvironmentVariableSelection}
              onChange={setEnvironmentVariableSelection}
            />
          ))}
        </div>
      </div>
    </fieldset>
  )
}

export const EnvironmentVariablesSection = memo(
  ({
    environmentVariableGroups,
    getEnvironmentVariableSelection,
    hasCredentialSlots,
    horizontalPaddingClassName,
    setEnvironmentVariableSelection,
  }: {
    environmentVariableGroups: EnvironmentVariableGroup[]
    getEnvironmentVariableSelection: DeploymentConfigurationValuesController['getEnvironmentVariableSelection']
    hasCredentialSlots: boolean
    horizontalPaddingClassName: string
    setEnvironmentVariableSelection: DeploymentConfigurationValuesController['setEnvironmentVariableSelection']
  }) => {
    const { t } = useTranslation('deployments')
    const visibleGroups = environmentVariableGroups.filter(
      (group) => group.environment_variable_slots.length > 0,
    )

    if (visibleGroups.length === 0) return null

    return (
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
        {visibleGroups.map((group) => {
          const owner = group.from_app ?? group.from_workflow_as_tool?.workflow
          if (!owner) return null

          return (
            <EnvironmentVariableGroupFields
              key={owner.workflow_id}
              group={group}
              getEnvironmentVariableSelection={getEnvironmentVariableSelection}
              setEnvironmentVariableSelection={setEnvironmentVariableSelection}
            />
          )
        })}
      </section>
    )
  },
)
