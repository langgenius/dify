'use client'

import { cn } from '@langgenius/dify-ui/cn'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@langgenius/dify-ui/dropdown-menu'
import { Tooltip, TooltipContent, TooltipTrigger } from '@langgenius/dify-ui/tooltip'
import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { BUILT_IN_ENVIRONMENT_ID } from './state'

const DEFAULT_TABS_WIDTH = 320
const ENVIRONMENT_TAB_MAX_WIDTH = 88
const ENVIRONMENT_TAB_HORIZONTAL_PADDING = 16
const ENVIRONMENT_TAB_LABEL_MAX_WIDTH =
  ENVIRONMENT_TAB_MAX_WIDTH - ENVIRONMENT_TAB_HORIZONTAL_PADDING
const SELECTED_OVERFLOW_LABEL_MAX_WIDTH = ENVIRONMENT_TAB_LABEL_MAX_WIDTH - 16
const TAB_GAP = 4

export type PublisherEnvironment = {
  id: string
  name: string
}

type EnvironmentTabMeasurements = {
  availableWidth: number
  builtInWidth: number
  environmentTextWidths: Record<string, number>
  moreEnvironmentsWidth: number
  moreWidth: number
}

type EnvironmentTabLayout = {
  overflowEnvironmentIds: string[]
  showMore: boolean
  visibleEnvironmentIds: string[]
}

type GetEnvironmentTabLayoutParams = {
  availableWidth: number
  builtInWidth: number
  environmentTabWidths: Record<string, number>
  hasUndeployedEnvironments: boolean
  joinedEnvironmentIds: readonly string[]
  moreEnvironmentsWidth: number
  moreWidth: number
}

type PublisherEnvironmentTabsProps = {
  environments: readonly PublisherEnvironment[]
  joinedEnvironmentIds: readonly string[]
  selectedEnvironmentId: string
  onAddEnvironment: (environmentId: string) => void
  onSelectEnvironment: (environmentId: string) => void
}

function estimateTextWidth(value: string) {
  return Array.from(value).reduce((width, character) => {
    const codePoint = character.codePointAt(0) ?? 0
    if (codePoint > 0x2e7f) return width + 13
    if (character === ' ') return width + 4
    return width + 6.5
  }, 0)
}

function estimateTabWidth(value: string) {
  return Math.min(
    ENVIRONMENT_TAB_MAX_WIDTH,
    estimateTextWidth(value) + ENVIRONMENT_TAB_HORIZONTAL_PADDING,
  )
}

function rowWidth(widths: readonly number[]) {
  if (widths.length === 0) return 0
  return widths.reduce((total, width) => total + width, 0) + (widths.length - 1) * TAB_GAP
}

function getEnvironmentTabLayout({
  availableWidth,
  builtInWidth,
  environmentTabWidths,
  hasUndeployedEnvironments,
  joinedEnvironmentIds,
  moreEnvironmentsWidth,
  moreWidth,
}: GetEnvironmentTabLayoutParams): EnvironmentTabLayout {
  const joinedWidths = joinedEnvironmentIds.map(
    (environmentId) => environmentTabWidths[environmentId] ?? ENVIRONMENT_TAB_MAX_WIDTH,
  )
  const allTabsFit =
    !hasUndeployedEnvironments && rowWidth([builtInWidth, ...joinedWidths]) <= availableWidth

  if (allTabsFit) {
    return {
      overflowEnvironmentIds: [],
      showMore: false,
      visibleEnvironmentIds: [...joinedEnvironmentIds],
    }
  }

  const showMore = hasUndeployedEnvironments || joinedEnvironmentIds.length > 0
  if (!showMore) {
    return {
      overflowEnvironmentIds: [],
      showMore: false,
      visibleEnvironmentIds: [],
    }
  }

  const triggerWidth =
    joinedEnvironmentIds.length === 0
      ? moreEnvironmentsWidth
      : Math.max(moreWidth, ENVIRONMENT_TAB_MAX_WIDTH)
  const visibleEnvironmentIds: string[] = []
  let visibleTabsWidth = builtInWidth

  for (const environmentId of joinedEnvironmentIds) {
    const environmentWidth = environmentTabWidths[environmentId] ?? ENVIRONMENT_TAB_MAX_WIDTH
    const nextVisibleTabsWidth = visibleTabsWidth + TAB_GAP + environmentWidth
    const widthWithTrigger = nextVisibleTabsWidth + TAB_GAP + triggerWidth

    if (widthWithTrigger > availableWidth) break

    visibleEnvironmentIds.push(environmentId)
    visibleTabsWidth = nextVisibleTabsWidth
  }

  return {
    overflowEnvironmentIds: joinedEnvironmentIds.slice(visibleEnvironmentIds.length),
    showMore: true,
    visibleEnvironmentIds,
  }
}

function EnvironmentTab({
  active,
  name,
  textWidth,
  onClick,
}: {
  active: boolean
  name: string
  textWidth: number
  onClick: () => void
}) {
  const truncated = textWidth > ENVIRONMENT_TAB_LABEL_MAX_WIDTH

  return (
    <Tooltip disabled={!truncated}>
      <TooltipTrigger
        render={
          <button
            type="button"
            role="tab"
            aria-selected={active}
            className={cn(
              'flex h-7 max-w-22 shrink-0 items-center justify-center rounded-lg px-2 py-1.5 text-center system-sm-medium text-text-tertiary outline-hidden',
              'hover:bg-state-base-hover focus-visible:ring-2 focus-visible:ring-state-accent-solid',
              active && 'bg-state-base-active system-sm-semibold text-text-primary',
            )}
            onClick={onClick}
          >
            <span className="min-w-0 truncate">{name}</span>
          </button>
        }
      />
      <TooltipContent role="tooltip">{name}</TooltipContent>
    </Tooltip>
  )
}

function EnvironmentMenuItem({
  environment,
  onClick,
}: {
  environment: PublisherEnvironment
  onClick: () => void
}) {
  return (
    <DropdownMenuItem className="mx-0 flex gap-2 px-2 py-1.5" onClick={onClick}>
      <span aria-hidden className="i-ri-instance-line size-4 shrink-0 text-text-tertiary" />
      <span className="grow truncate system-md-regular text-text-secondary">
        {environment.name}
      </span>
    </DropdownMenuItem>
  )
}

export function PublisherEnvironmentTabs({
  environments,
  joinedEnvironmentIds,
  selectedEnvironmentId,
  onAddEnvironment,
  onSelectEnvironment,
}: PublisherEnvironmentTabsProps) {
  const { t } = useTranslation()
  const containerRef = useRef<HTMLDivElement>(null)
  const measurementRef = useRef<HTMLDivElement>(null)
  const builtInLabel = t(($) => $['nodes.common.memories.builtIn'], { ns: 'workflow' })
  const moreLabel = t(($) => $['operation.more'], { ns: 'common' })
  const moreEnvironmentsLabel = t(($) => $['studio.moreEnvironments'], {
    ns: 'deployments',
  })
  const [measurements, setMeasurements] = useState<EnvironmentTabMeasurements>(() => ({
    availableWidth: DEFAULT_TABS_WIDTH,
    builtInWidth: estimateTabWidth(builtInLabel),
    environmentTextWidths: Object.fromEntries(
      environments.map((environment) => [environment.id, estimateTextWidth(environment.name)]),
    ),
    moreEnvironmentsWidth:
      estimateTextWidth(moreEnvironmentsLabel) + ENVIRONMENT_TAB_HORIZONTAL_PADDING + 16,
    moreWidth: estimateTextWidth(moreLabel) + ENVIRONMENT_TAB_HORIZONTAL_PADDING + 16,
  }))

  useEffect(() => {
    const container = containerRef.current
    const measurementRoot = measurementRef.current
    if (!container || !measurementRoot) return

    const readElementWidth = (element: HTMLElement | null, fallback: number) => {
      return element?.getBoundingClientRect().width || element?.scrollWidth || fallback
    }
    const readWidth = (selector: string, fallback: number) =>
      readElementWidth(measurementRoot.querySelector<HTMLElement>(selector), fallback)
    const updateMeasurements = () => {
      const environmentMeasureElements = new Map(
        Array.from(measurementRoot.querySelectorAll<HTMLElement>('[data-environment-measure]')).map(
          (element) => [element.dataset.environmentMeasure, element],
        ),
      )
      const environmentTextWidths = Object.fromEntries(
        environments.map((environment) => [
          environment.id,
          readElementWidth(
            environmentMeasureElements.get(environment.id) ?? null,
            estimateTextWidth(environment.name),
          ),
        ]),
      )
      const nextMeasurements = {
        availableWidth:
          container.getBoundingClientRect().width || container.clientWidth || DEFAULT_TABS_WIDTH,
        builtInWidth: Math.min(
          ENVIRONMENT_TAB_MAX_WIDTH,
          readWidth(
            '[data-built-in-measure]',
            estimateTextWidth(builtInLabel) + ENVIRONMENT_TAB_HORIZONTAL_PADDING,
          ),
        ),
        environmentTextWidths,
        moreEnvironmentsWidth: readWidth(
          '[data-more-environments-measure]',
          estimateTextWidth(moreEnvironmentsLabel) + ENVIRONMENT_TAB_HORIZONTAL_PADDING + 16,
        ),
        moreWidth: readWidth(
          '[data-more-measure]',
          estimateTextWidth(moreLabel) + ENVIRONMENT_TAB_HORIZONTAL_PADDING + 16,
        ),
      }

      setMeasurements((current) => {
        const environmentWidthsUnchanged = environments.every(
          (environment) =>
            current.environmentTextWidths[environment.id] ===
            nextMeasurements.environmentTextWidths[environment.id],
        )
        if (
          current.availableWidth === nextMeasurements.availableWidth &&
          current.builtInWidth === nextMeasurements.builtInWidth &&
          current.moreEnvironmentsWidth === nextMeasurements.moreEnvironmentsWidth &&
          current.moreWidth === nextMeasurements.moreWidth &&
          environmentWidthsUnchanged
        ) {
          return current
        }
        return nextMeasurements
      })
    }

    const animationFrame = requestAnimationFrame(updateMeasurements)
    if (typeof ResizeObserver === 'undefined') return () => cancelAnimationFrame(animationFrame)

    const observer = new ResizeObserver(updateMeasurements)
    observer.observe(container)
    observer.observe(measurementRoot)
    return () => {
      cancelAnimationFrame(animationFrame)
      observer.disconnect()
    }
  }, [builtInLabel, environments, moreEnvironmentsLabel, moreLabel])

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
          estimateTextWidth(environment.name)) + ENVIRONMENT_TAB_HORIZONTAL_PADDING,
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
    .filter((environment): environment is PublisherEnvironment => Boolean(environment))
  const triggerLabel =
    selectedOverflowEnvironment?.name ??
    (layout.visibleEnvironmentIds.length > 0 ? moreLabel : moreEnvironmentsLabel)
  const selectedOverflowTextWidth = selectedOverflowEnvironment
    ? (measurements.environmentTextWidths[selectedOverflowEnvironment.id] ??
      estimateTextWidth(selectedOverflowEnvironment.name))
    : 0
  const selectedOverflowNameTruncated =
    Boolean(selectedOverflowEnvironment) &&
    selectedOverflowTextWidth > SELECTED_OVERFLOW_LABEL_MAX_WIDTH
  const showMoreEnvironmentsLabel =
    !selectedOverflowEnvironment && layout.visibleEnvironmentIds.length === 0

  return (
    <div ref={containerRef} className="relative flex w-full items-start gap-1 pb-1">
      <div
        role="tablist"
        aria-label={t(($) => $['studio.environments'], { ns: 'deployments' })}
        className="flex min-w-0 items-start gap-1"
      >
        <EnvironmentTab
          active={selectedEnvironmentId === BUILT_IN_ENVIRONMENT_ID}
          name={builtInLabel}
          textWidth={estimateTextWidth(builtInLabel)}
          onClick={() => onSelectEnvironment(BUILT_IN_ENVIRONMENT_ID)}
        />
        {layout.visibleEnvironmentIds.map((environmentId) => {
          const environment = environmentById.get(environmentId)
          if (!environment) return null

          return (
            <EnvironmentTab
              key={environment.id}
              active={selectedEnvironmentId === environment.id}
              name={environment.name}
              textWidth={
                measurements.environmentTextWidths[environment.id] ??
                estimateTextWidth(environment.name)
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
            popupClassName="w-42 rounded-xl p-0"
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

      <div
        ref={measurementRef}
        aria-hidden
        className="pointer-events-none invisible absolute top-0 left-0 flex items-center gap-1 whitespace-nowrap"
      >
        <span data-built-in-measure className="inline-flex px-2 py-1.5 system-sm-medium">
          {builtInLabel}
        </span>
        <span
          data-more-measure
          className="inline-flex items-center gap-0.5 px-2 py-1.5 system-sm-medium"
        >
          {moreLabel}
          <span className="size-3.5" />
        </span>
        <span
          data-more-environments-measure
          className="inline-flex items-center gap-0.5 px-2 py-1.5 system-sm-medium"
        >
          {moreEnvironmentsLabel}
          <span className="size-3.5" />
        </span>
        {environments.map((environment) => (
          <span
            key={environment.id}
            data-environment-measure={environment.id}
            className="system-sm-medium"
          >
            {environment.name}
          </span>
        ))}
      </div>
    </div>
  )
}
