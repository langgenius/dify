'use client'

import type { Environment } from '@dify/contracts/enterprise/types.gen'
import { cn } from '@langgenius/dify-ui/cn'
import { RadioControl, RadioRoot } from '@langgenius/dify-ui/radio'
import { RadioGroup } from '@langgenius/dify-ui/radio-group'
import { useAtomValue, useSetAtom } from 'jotai'
import { useTranslation } from 'react-i18next'
import { TitleTooltip } from '@/features/deployments/components/title-tooltip'
import { deployableEnvironmentsQueryAtom } from '../../../state/query-atoms'
import {
  selectedEnvironmentIdAtom,
} from '../../../state/target-atoms'
import {
  deployableEnvironmentsAtom,
  effectiveSelectedEnvironmentIdAtom,
} from '../../../state/target-derived-atoms'
import { TargetEnvironmentSkeleton } from '../skeletons'

function EnvironmentOptionRow({ environment }: {
  environment: Environment
}) {
  const { t } = useTranslation('deployments')
  const summary = environment.description.trim() || `${t(`mode.${environment.mode}`)} · ${t(`backend.${environment.backend}`)}`

  return (
    <RadioRoot<string>
      value={environment.id}
      variant="unstyled"
      className={cn(
        'group flex cursor-pointer items-center gap-3 rounded-xl border p-3 outline-hidden',
        'border-components-option-card-option-border bg-components-option-card-option-bg hover:border-components-option-card-option-border-hover hover:bg-components-option-card-option-bg-hover hover:shadow-xs',
        'focus-visible:ring-2 focus-visible:ring-state-accent-solid',
        'data-checked:border-state-accent-solid data-checked:bg-state-accent-hover data-checked:shadow-xs',
      )}
    >
      <RadioControl />
      <span className="flex min-w-0 grow flex-col gap-1">
        <span className="truncate system-sm-semibold text-text-primary group-data-checked:text-text-accent">{environment.name}</span>
        <TitleTooltip content={summary}>
          <span className="line-clamp-1 system-xs-regular text-text-tertiary group-data-checked:text-text-secondary">
            {summary}
          </span>
        </TitleTooltip>
      </span>
    </RadioRoot>
  )
}

export function TargetEnvironmentSection() {
  const { t } = useTranslation('deployments')
  const environmentsQuery = useAtomValue(deployableEnvironmentsQueryAtom)
  const environments = useAtomValue(deployableEnvironmentsAtom)
  const effectiveSelectedEnvironmentId = useAtomValue(effectiveSelectedEnvironmentIdAtom)
  const isEnvironmentError = environmentsQuery.isError
  const isEnvironmentLoading = environmentsQuery.isLoading || (environmentsQuery.isFetching && !environmentsQuery.data)
  const onSelectEnvironment = useSetAtom(selectedEnvironmentIdAtom)
  const hasEnvironmentOptions = environments.length > 0

  return (
    <div className="flex flex-col gap-3">
      <div className="system-xs-medium-uppercase text-text-tertiary">{t('createGuide.target.environment')}</div>
      {hasEnvironmentOptions
        ? (
            <RadioGroup<string>
              value={effectiveSelectedEnvironmentId}
              onValueChange={onSelectEnvironment}
              className="grid grid-cols-1 items-stretch gap-3 lg:grid-cols-2"
            >
              {environments.map(environment => (
                <EnvironmentOptionRow
                  key={environment.id}
                  environment={environment}
                />
              ))}
            </RadioGroup>
          )
        : isEnvironmentLoading
          ? <TargetEnvironmentSkeleton />
          : (
              <div className="rounded-lg border border-divider-subtle bg-background-default-subtle px-3 py-3 system-sm-regular text-text-quaternary">
                {isEnvironmentError
                  ? t('createGuide.target.loadEnvironmentsFailed')
                  : t('createGuide.target.noEnvironmentOptions')}
              </div>
            )}
    </div>
  )
}
