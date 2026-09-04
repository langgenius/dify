import type {
  ExecutionActivity,
  ExecutionProgress as ExecutionProgressData,
} from '@dify/contracts/api/console/dify-builder/types.gen'
import { cn } from '@langgenius/dify-ui/cn'
import { useState } from 'react'

const ActivityIcon = ({ state }: { state: ExecutionActivity['state'] }) => (
  <span
    aria-hidden
    className={cn(
      'size-3.5 shrink-0 text-text-quaternary',
      state === 'active' &&
        'i-ri-loader-4-line animate-spin text-text-accent motion-reduce:animate-none',
      state === 'done' && 'i-ri-check-line text-text-success',
      state === 'failed' && 'i-ri-close-line text-text-destructive',
      state === 'stopped' && 'i-ri-subtract-line',
    )}
  />
)

const ActivityRow = ({ activity }: { activity: ExecutionActivity }) => (
  <div
    className={cn(
      'flex min-h-5 items-center gap-1.5 text-xs text-text-tertiary',
      activity.state === 'active' && 'text-text-secondary',
      activity.state === 'failed' && 'text-text-destructive',
    )}
  >
    <ActivityIcon state={activity.state} />
    <span>{activity.label}</span>
  </div>
)

export const ExecutionProgress = ({ execution }: { execution?: ExecutionProgressData | null }) => {
  const [open, setOpen] = useState(execution?.status === 'running' || execution?.status === 'error')
  const activities = execution?.activities ?? []
  if (!execution || activities.length === 0) return null

  const activityIds = new Set(activities.map((activity) => activity.id))
  const childrenByParent = new Map<string, ExecutionActivity[]>()
  for (const activity of activities) {
    if (!activity.parent_id || !activityIds.has(activity.parent_id)) continue
    const siblings = childrenByParent.get(activity.parent_id) ?? []
    siblings.push(activity)
    childrenByParent.set(activity.parent_id, siblings)
  }
  const roots = activities.filter(
    (activity) => !activity.parent_id || !activityIds.has(activity.parent_id),
  )

  let summaryActivity = activities.at(-1)
  for (const activity of activities) {
    if (activity.state === 'active') summaryActivity = activity
  }
  if (!activities.some((activity) => activity.state === 'active')) {
    summaryActivity = activities.find((activity) => activity.state === 'failed') ?? summaryActivity
  }

  return (
    <details
      aria-label={summaryActivity?.label}
      className="group min-h-8"
      open={open}
      onToggle={(event) => setOpen(event.currentTarget.open)}
    >
      <summary className="flex h-8 cursor-pointer list-none items-center gap-2 text-[13px] leading-4 font-medium text-text-tertiary outline-hidden focus-visible:ring-1 focus-visible:ring-state-accent-solid">
        <ActivityIcon state={summaryActivity?.state ?? 'stopped'} />
        <span
          role={execution.status === 'running' ? 'status' : undefined}
          aria-live={execution.status === 'running' ? 'polite' : undefined}
          aria-atomic={execution.status === 'running' ? 'true' : undefined}
        >
          {summaryActivity?.label}
        </span>
        <span className="grow" />
        <span
          aria-hidden
          className="i-ri-arrow-right-s-line size-4 text-text-tertiary transition-transform group-open:rotate-90"
        />
      </summary>
      <ol className="ml-[7px] space-y-1 border-l border-divider-subtle py-1 pl-[19px]">
        {roots.map((activity) => {
          const children = childrenByParent.get(activity.id) ?? []
          return (
            <li key={activity.id}>
              <ActivityRow activity={activity} />
              {children.length > 0 && (
                <ol className="mt-1 ml-[7px] space-y-1 border-l border-divider-subtle pl-[19px]">
                  {children.map((child) => (
                    <li key={child.id}>
                      <ActivityRow activity={child} />
                    </li>
                  ))}
                </ol>
              )}
            </li>
          )
        })}
      </ol>
    </details>
  )
}
