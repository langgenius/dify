'use client'

import type { AppEnvironment } from '@dify/contracts/enterprise-app-deploy/types.gen'
import { Button } from '@langgenius/dify-ui/button'
import { cn } from '@langgenius/dify-ui/cn'
import { useTranslation } from 'react-i18next'
import { EnvironmentDeployMenu } from './environment-deploy-menu'

type SkeletonRow = {
  accessPointCount: number
  activity: string
  actor: string
  environment: string
  environmentWidth?: number
  id: string
  status: string
  version?: string
  versionBadge?: string
}

const ACCESS_POINT_ICONS = [
  'i-ri-robot-2-line',
  'i-custom-vender-knowledge-api-aggregate',
  'i-custom-vender-integrations-mcp',
  'i-custom-vender-integrations-trigger',
]

const SKELETON_ROWS: SkeletonRow[] = [
  {
    accessPointCount: 3,
    activity: 'Deploy Sprint-42 succeeded',
    actor: 'by Evan · 3d ago',
    environment: 'Canary',
    id: 'canary-primary',
    status: 'Disabled',
    version: 'Sprint-42',
    versionBadge: 'LATEST',
  },
  {
    accessPointCount: 2,
    activity: 'Deploy #11 succeeded',
    actor: 'by Evan · 3d ago',
    environment: 'Pre-release',
    id: 'pre-release-primary',
    status: 'Disabled',
    version: 'Version-02',
    versionBadge: '1',
  },
  {
    accessPointCount: 2,
    activity: 'Deploy #11 succeeded',
    actor: 'by Rhonda · 3d ago',
    environment: 'Prod',
    id: 'prod',
    status: 'Disabled',
    version: 'v0.9-hotfix',
    versionBadge: '1',
  },
  {
    accessPointCount: 1,
    activity: 'Deploy #10 failed',
    actor: 'by Rhonda · 3d ago',
    environment: 'EU-Prod',
    id: 'eu-prod',
    status: 'Disabled',
    version: 'v0.6-beta',
    versionBadge: '2',
  },
  {
    accessPointCount: 3,
    activity: 'Deploy Sprint-42 succeeded',
    actor: 'by Evan · 3d ago',
    environment: 'Canary',
    id: 'canary-secondary',
    status: 'Disabled',
    version: 'Sprint-42',
    versionBadge: 'LATEST',
  },
  {
    accessPointCount: 1,
    activity: 'Deploy #11 succeeded',
    actor: 'by Rhonda · 3d ago',
    environment: 'QA',
    environmentWidth: 118,
    id: 'qa',
    status: 'Disabled',
    version: 'v0.3-beta',
    versionBadge: '1',
  },
  {
    accessPointCount: 1,
    activity: 'Deploy #11 succeeded',
    actor: 'by Rhonda · 3d ago',
    environment: 'Sandbox',
    id: 'sandbox',
    status: 'Disabled',
    version: 'v0.3-beta',
    versionBadge: '1',
  },
  {
    accessPointCount: 1,
    activity: 'Deploy #10 failed',
    actor: 'by Rhonda · 3d ago',
    environment: 'Preview',
    id: 'preview',
    status: 'Disabled',
  },
  {
    accessPointCount: 2,
    activity: 'Deploy #11 succeeded',
    actor: 'by Evan · 3d ago',
    environment: 'Pre-release',
    id: 'pre-release-secondary',
    status: 'Disabled',
    version: 'Version-02',
    versionBadge: '1',
  },
]

const SKELETON_CLASS_NAME = 'bg-text-quaternary opacity-20'
const SKELETON_HEADER_LABELS = [
  'Environment',
  'Live version',
  'Status',
  'Last activity',
  'Access points',
  'Actions',
]

function HiddenSkeletonText({ children, className }: { children: string; className: string }) {
  return (
    <span className={cn(SKELETON_CLASS_NAME, 'inline-flex text-transparent', className)}>
      {children}
    </span>
  )
}

function EmptyTableHeader() {
  return (
    <thead>
      <tr className="h-7 bg-background-section-burn">
        {SKELETON_HEADER_LABELS.map((label, index) => (
          <th
            key={label}
            className={cn(
              'pr-2 pl-3 text-left',
              index === 0 && 'rounded-l-lg',
              index === SKELETON_HEADER_LABELS.length - 1 && 'rounded-r-lg',
            )}
          >
            <div className="flex h-7 items-center">
              <HiddenSkeletonText className="h-2 rounded-xs system-xs-medium-uppercase">
                {label}
              </HiddenSkeletonText>
            </div>
          </th>
        ))}
      </tr>
    </thead>
  )
}

function EnvironmentSkeleton({ name, width }: { name: string; width?: number }) {
  return (
    <div className="flex min-w-0 items-center gap-2.5">
      <span className="flex size-6 shrink-0 items-center justify-center rounded-md border-[0.5px] border-divider-regular text-text-quaternary">
        <span aria-hidden className="i-ri-instance-line size-3.5" />
      </span>
      {width ? (
        <span className={cn(SKELETON_CLASS_NAME, 'h-3 shrink-0 rounded-[5px]')} style={{ width }} />
      ) : (
        <HiddenSkeletonText className="h-3 rounded-[5px] system-md-medium">
          {name}
        </HiddenSkeletonText>
      )}
    </div>
  )
}

function VersionSkeleton({ badge, version }: { badge?: string; version?: string }) {
  if (!version) {
    return (
      <div className="flex items-center">
        <span className={cn(SKELETON_CLASS_NAME, 'h-3 w-3 rounded-[5px]')} />
      </div>
    )
  }

  return (
    <div className="flex min-w-0 items-center gap-1">
      <HiddenSkeletonText className="h-3 rounded-[5px] system-sm-regular">
        {version}
      </HiddenSkeletonText>
      {badge && (
        <HiddenSkeletonText className="min-w-4 rounded-[5px] px-1 py-0.5 system-2xs-medium-uppercase">
          {badge}
        </HiddenSkeletonText>
      )}
    </div>
  )
}

function StatusSkeleton({ label }: { label: string }) {
  return (
    <div className="flex items-center gap-1">
      <span className="flex size-3 items-center justify-center">
        <span className={cn(SKELETON_CLASS_NAME, 'size-2 rounded-[3px]')} />
      </span>
      <HiddenSkeletonText className="h-2 rounded-xs system-xs-semibold-uppercase">
        {label}
      </HiddenSkeletonText>
    </div>
  )
}

function ActivitySkeleton({ activity, actor }: { activity: string; actor: string }) {
  return (
    <div className="flex min-w-0 flex-col items-start gap-2">
      <HiddenSkeletonText className="h-3 rounded-[5px] system-xs-regular">
        {activity}
      </HiddenSkeletonText>
      <HiddenSkeletonText className="h-2 rounded-[5px] system-xs-regular">
        {actor}
      </HiddenSkeletonText>
    </div>
  )
}

function AccessPointSkeleton({ activeCount }: { activeCount: number }) {
  return (
    <div className="flex items-center gap-1">
      {ACCESS_POINT_ICONS.map((icon, index) => (
        <span
          key={icon}
          className={cn(
            'flex size-6 shrink-0 items-center justify-center rounded-md border border-divider-regular text-text-quaternary',
            index >= activeCount && 'opacity-30',
          )}
        >
          <span aria-hidden className={cn(icon, 'size-3.5')} />
        </span>
      ))}
    </div>
  )
}

function ActionsSkeleton() {
  return (
    <div className="flex items-center justify-end gap-1">
      <span className="flex h-6 items-center gap-px rounded-md border-[0.5px] border-components-button-secondary-border bg-components-button-secondary-bg px-1.5 shadow-xs backdrop-blur-[5px]">
        <span className="flex size-3.5 items-center justify-center">
          <span className={cn(SKELETON_CLASS_NAME, 'size-2.5 rounded-[3px]')} />
        </span>
        <span className="flex px-0.75">
          <span className={cn(SKELETON_CLASS_NAME, 'h-2 w-20 rounded-[5px]')} />
        </span>
      </span>
      <span className="flex size-6 items-center justify-center rounded-md border-[0.5px] border-components-button-secondary-border bg-components-button-secondary-bg shadow-xs backdrop-blur-[5px]">
        <span className="flex size-3.5 items-center justify-center">
          <span className={cn(SKELETON_CLASS_NAME, 'size-2.5 rounded-[3px]')} />
        </span>
      </span>
    </div>
  )
}

function EmptyTableRow({ row }: { row: SkeletonRow }) {
  return (
    <tr className="h-14">
      <td className="border-b border-divider-subtle pr-2 pl-3">
        <EnvironmentSkeleton name={row.environment} width={row.environmentWidth} />
      </td>
      <td className="border-b border-divider-subtle pr-2 pl-3">
        <VersionSkeleton badge={row.versionBadge} version={row.version} />
      </td>
      <td className="border-b border-divider-subtle px-2">
        <StatusSkeleton label={row.status} />
      </td>
      <td className="border-b border-divider-subtle pr-2 pl-3">
        <ActivitySkeleton activity={row.activity} actor={row.actor} />
      </td>
      <td className="border-b border-divider-subtle pr-2 pl-3">
        <AccessPointSkeleton activeCount={row.accessPointCount} />
      </td>
      <td className="border-b border-divider-subtle pr-2 pl-3">
        <ActionsSkeleton />
      </td>
    </tr>
  )
}

function EmptyTableSkeleton() {
  return (
    <div aria-hidden className="pointer-events-none absolute inset-0 overflow-hidden">
      <table className="w-full min-w-260 table-fixed border-separate border-spacing-0 opacity-50">
        <colgroup>
          <col className="w-43" />
          <col className="w-46" />
          <col className="w-44" />
          <col />
          <col className="w-36" />
          <col className="w-44" />
        </colgroup>
        <EmptyTableHeader />
        <tbody>
          {SKELETON_ROWS.map((row) => (
            <EmptyTableRow key={row.id} row={row} />
          ))}
        </tbody>
      </table>
      <div className="pointer-events-none absolute inset-0 z-10 bg-linear-to-b from-components-panel-bg-transparent to-components-panel-bg" />
    </div>
  )
}

type EnvironmentTableEmptyProps =
  | {
      state: 'empty'
      onSelectEnvironment?: (environment: AppEnvironment) => void
    }
  | {
      state: 'error'
      isRetrying: boolean
      onRetry: () => void
    }

export function EnvironmentTableEmpty(props: EnvironmentTableEmptyProps) {
  const { t } = useTranslation('deployments')
  const { t: tCommon } = useTranslation('common')
  const isError = props.state === 'error'
  const title = isError ? tCommon(($) => $['errorBoundary.title']) : t(($) => $['list.emptyTitle'])
  const description = isError
    ? t(($) => $['common.loadFailed'])
    : t(($) => $['studio.emptyDescription'])

  return (
    <div className="relative h-full w-full min-w-0 overflow-hidden">
      <EmptyTableSkeleton />
      <div className="absolute inset-0 z-20 flex items-center justify-center p-2">
        <div className="flex w-full max-w-120 flex-col items-center justify-center gap-3 pt-6 pb-16">
          <div className="flex size-14 items-center justify-center rounded-[10px]">
            <div className="flex size-full items-center justify-center overflow-hidden rounded-xl border border-dashed border-divider-regular bg-components-card-bg p-1">
              <span aria-hidden className="i-ri-instance-line size-6 text-text-tertiary" />
            </div>
          </div>
          <div className="flex w-full flex-col items-center gap-2">
            <h3 className="system-md-medium text-text-secondary">{title}</h3>
            <p className="system-sm-regular text-text-tertiary">{description}</p>
          </div>
          {props.state === 'error' ? (
            <Button variant="secondary" loading={props.isRetrying} onClick={props.onRetry}>
              <span aria-hidden className="mr-1.5 i-ri-reset-left-line" />
              {tCommon(($) => $['operation.retry'])}
            </Button>
          ) : (
            <EnvironmentDeployMenu
              appearance="empty"
              onSelectEnvironment={props.onSelectEnvironment}
            />
          )}
        </div>
      </div>
    </div>
  )
}
