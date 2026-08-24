'use client'

import type { PublisherEnvironmentTabsProps } from './types'
import { cn } from '@langgenius/dify-ui/cn'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@langgenius/dify-ui/dropdown-menu'
import { Tooltip, TooltipContent, TooltipTrigger } from '@langgenius/dify-ui/tooltip'
import { useTranslation } from 'react-i18next'
import { BUILT_IN_ENVIRONMENT_ID } from '../state'
import { EnvironmentButton } from './environment-button'
import { EnvironmentMenuItem } from './environment-menu-item'
import {
  ENVIRONMENT_TAB_HORIZONTAL_PADDING,
  ENVIRONMENT_TAB_MAX_WIDTH,
  estimateFallbackTextWidth,
  getEnvironmentTabLayout,
  SELECTED_OVERFLOW_LABEL_MAX_WIDTH,
} from './layout'
import { EnvironmentTabsMeasurementProbe } from './measurement-probe'
import { useEnvironmentTabMeasurements } from './use-measurements'

export function PublisherEnvironmentTabs({
  environments,
  joinedEnvironmentIds,
  selectedEnvironmentId,
  onAddEnvironment,
  onSelectEnvironment,
}: PublisherEnvironmentTabsProps) {
  const { t } = useTranslation()
  const builtInLabel = t(($) => $['nodes.common.memories.builtIn'], { ns: 'workflow' })
  const moreLabel = t(($) => $['operation.more'], { ns: 'common' })
  const moreEnvironmentsLabel = t(($) => $['studio.moreEnvironments'], {
    ns: 'deployments',
  })
  const { containerRef, measurementRef, measurements } = useEnvironmentTabMeasurements({
    builtInLabel,
    environments,
    moreEnvironmentsLabel,
    moreLabel,
  })

  const environmentById = new Map(environments.map((environment) => [environment.id, environment]))
  const joinedEnvironmentIdSet = new Set(joinedEnvironmentIds)
  const orderedJoinedEnvironmentIds = environments
    .filter((environment) => joinedEnvironmentIdSet.has(environment.id))
    .map((environment) => environment.id)
  const undeployedEnvironments = environments.filter(
    (environment) => !joinedEnvironmentIdSet.has(environment.id),
  )
  const environmentTabWidths = Object.fromEntries(
    environments.map((environment) => [
      environment.id,
      Math.min(
        ENVIRONMENT_TAB_MAX_WIDTH,
        (measurements.environmentTextWidths[environment.id] ??
          estimateFallbackTextWidth(environment.name)) + ENVIRONMENT_TAB_HORIZONTAL_PADDING,
      ),
    ]),
  )
  const layout = getEnvironmentTabLayout({
    availableWidth: measurements.availableWidth,
    builtInWidth: measurements.builtInWidth,
    environmentTabWidths,
    hasUndeployedEnvironments: undeployedEnvironments.length > 0,
    joinedEnvironmentIds: orderedJoinedEnvironmentIds,
    moreEnvironmentsWidth: measurements.moreEnvironmentsWidth,
    moreWidth: measurements.moreWidth,
  })
  const overflowEnvironmentIdSet = new Set(layout.overflowEnvironmentIds)
  const selectedOverflowEnvironment = overflowEnvironmentIdSet.has(selectedEnvironmentId)
    ? environmentById.get(selectedEnvironmentId)
    : undefined
  const overflowEnvironments = layout.overflowEnvironmentIds
    .filter((environmentId) => environmentId !== selectedEnvironmentId)
    .map((environmentId) => environmentById.get(environmentId))
    .filter((environment) => environment !== undefined)
  const triggerLabel =
    selectedOverflowEnvironment?.name ??
    (layout.visibleEnvironmentIds.length > 0 ? moreLabel : moreEnvironmentsLabel)
  const selectedOverflowTextWidth = selectedOverflowEnvironment
    ? (measurements.environmentTextWidths[selectedOverflowEnvironment.id] ??
      estimateFallbackTextWidth(selectedOverflowEnvironment.name))
    : 0
  const selectedOverflowNameTruncated =
    Boolean(selectedOverflowEnvironment) &&
    selectedOverflowTextWidth > SELECTED_OVERFLOW_LABEL_MAX_WIDTH
  const showMoreEnvironmentsLabel =
    !selectedOverflowEnvironment && layout.visibleEnvironmentIds.length === 0

  return (
    <div
      ref={containerRef}
      role="group"
      aria-label={t(($) => $['studio.environments'], { ns: 'deployments' })}
      className="relative flex w-full items-start gap-1 pb-1"
    >
      <div className="flex min-w-0 items-start gap-1">
        <EnvironmentButton
          active={selectedEnvironmentId === BUILT_IN_ENVIRONMENT_ID}
          name={builtInLabel}
          textWidth={estimateFallbackTextWidth(builtInLabel)}
          onClick={() => onSelectEnvironment(BUILT_IN_ENVIRONMENT_ID)}
        />
        {layout.visibleEnvironmentIds.map((environmentId) => {
          const environment = environmentById.get(environmentId)
          if (!environment) return null

          return (
            <EnvironmentButton
              key={environment.id}
              active={selectedEnvironmentId === environment.id}
              name={environment.name}
              textWidth={
                measurements.environmentTextWidths[environment.id] ??
                estimateFallbackTextWidth(environment.name)
              }
              onClick={() => onSelectEnvironment(environment.id)}
            />
          )
        })}
      </div>
      {layout.showMore && (
        <DropdownMenu modal={false}>
          <DropdownMenuTrigger
            render={
              <button
                type="button"
                aria-current={selectedOverflowEnvironment ? 'true' : undefined}
                className={cn(
                  'flex h-7 min-w-0 items-center justify-center gap-0.5 rounded-lg px-2 py-1.5 system-sm-medium text-text-tertiary outline-hidden',
                  'hover:bg-state-base-hover focus-visible:ring-2 focus-visible:ring-state-accent-solid',
                  !showMoreEnvironmentsLabel && 'max-w-22 shrink-0',
                  selectedOverflowEnvironment &&
                    'bg-state-base-active system-sm-semibold text-text-primary',
                )}
              >
                <Tooltip disabled={!selectedOverflowNameTruncated}>
                  <TooltipTrigger
                    render={<span className="min-w-0 truncate">{triggerLabel}</span>}
                  />
                  <TooltipContent role="tooltip">
                    {selectedOverflowEnvironment?.name}
                  </TooltipContent>
                </Tooltip>
                <span aria-hidden className="i-ri-arrow-down-s-line size-3.5 shrink-0" />
              </button>
            }
          />
          <DropdownMenuContent
            placement="bottom-end"
            sideOffset={4}
            className="w-42 rounded-xl p-0"
          >
            {overflowEnvironments.length > 0 && (
              <DropdownMenuGroup className="p-1">
                {overflowEnvironments.map((environment) => (
                  <EnvironmentMenuItem
                    key={environment.id}
                    environment={environment}
                    onClick={() => onSelectEnvironment(environment.id)}
                  />
                ))}
              </DropdownMenuGroup>
            )}
            {overflowEnvironments.length > 0 && undeployedEnvironments.length > 0 && (
              <DropdownMenuSeparator className="my-0 bg-divider-subtle" />
            )}
            {undeployedEnvironments.length > 0 && (
              <DropdownMenuGroup className="p-1">
                <DropdownMenuLabel className="px-2 py-1 system-xs-medium-uppercase text-text-tertiary">
                  {t(($) => $['card.notDeployed'], { ns: 'deployments' })}
                </DropdownMenuLabel>
                {undeployedEnvironments.map((environment) => (
                  <EnvironmentMenuItem
                    key={environment.id}
                    environment={environment}
                    onClick={() => onAddEnvironment(environment.id)}
                  />
                ))}
              </DropdownMenuGroup>
            )}
          </DropdownMenuContent>
        </DropdownMenu>
      )}

      <EnvironmentTabsMeasurementProbe
        builtInLabel={builtInLabel}
        environments={environments}
        measurementRef={measurementRef}
        moreEnvironmentsLabel={moreEnvironmentsLabel}
        moreLabel={moreLabel}
      />
    </div>
  )
}
