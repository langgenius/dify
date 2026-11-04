import type { SkeletonRow } from './data'
import { cn } from '@langgenius/dify-ui/cn'
import { ACCESS_POINT_ICONS, SKELETON_HEADER_LABELS, SKELETON_ROWS } from './data'

const SKELETON_CLASS_NAME = 'bg-text-quaternary opacity-20'

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

export function EmptyTableSkeleton() {
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
