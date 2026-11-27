'use client'

import type { SkillReferenceResponse } from '@dify/contracts/api/console/workspaces/types.gen'
import { Button } from '@langgenius/dify-ui/button'
import { cn } from '@langgenius/dify-ui/cn'
import { useQuery } from '@tanstack/react-query'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import AppIcon from '@/app/components/base/app-icon'
import { SkeletonRectangle } from '@/app/components/base/skeleton'
import Link from '@/next/link'
import { consoleQuery } from '@/service/console'
import { useOwnedQueryError } from '@/service/use-owned-query-error'
import { useRequestErrorMessage } from '@/service/use-request-error-message'

/** A one-line failed-load message with a retry, shown where the data would be. */
export function SkillLoadError({
  className,
  error,
  fallback,
  onRetry,
  retrying,
}: {
  className?: string
  error: unknown
  fallback: string
  onRetry: () => void
  retrying?: boolean
}) {
  const { t } = useTranslation(['common'])
  const message = useRequestErrorMessage(error, fallback) ?? fallback
  return (
    <div role="alert" className={cn('flex min-w-0 items-center gap-2 py-2', className)}>
      <p className="min-w-0 flex-1 system-xs-regular text-text-destructive">{message}</p>
      <Button size="small" variant="secondary" loading={retrying} onClick={onRetry}>
        {t(($) => $['operation.retry'], { ns: 'common' })}
      </Button>
    </div>
  )
}

export function SkillReferencesPanel({
  compact = false,
  embedded = false,
  enabled = true,
  maxHeight,
  skillId,
  testId,
  visibleLimit,
}: {
  compact?: boolean
  embedded?: boolean
  enabled?: boolean
  maxHeight?: string
  skillId: string
  testId?: string
  visibleLimit?: number
}) {
  const { t } = useTranslation(['skill'])
  const referencesQuery = useQuery({
    ...consoleQuery.workspaces.current.skills.bySkillId.references.get.queryOptions({
      input: {
        params: {
          skill_id: skillId,
        },
      },
      enabled,
    }),
    refetchOnMount: 'always',
  })
  const references = referencesQuery.data?.data ?? []
  const referencesLoad = useOwnedQueryError(referencesQuery)

  if (referencesQuery.isPending) {
    return <SkillReferencesListSkeleton compact={compact} embedded={embedded} />
  }

  if (referencesLoad) {
    return (
      <SkillLoadError
        className={embedded ? 'w-full px-1' : 'w-max max-w-120'}
        error={referencesLoad.error}
        fallback={t(($) => $['skillManagement.detail.referencesLoadFailed'])}
        onRetry={referencesLoad.retry}
        retrying={referencesLoad.retrying}
      />
    )
  }

  if (references.length === 0) {
    return (
      <div
        className={cn(
          'py-2 system-xs-regular text-text-quaternary',
          embedded ? 'w-full px-1' : 'w-max',
        )}
      >
        {t(($) => $['skillManagement.detail.referencedBy'], { count: 0 })}
      </div>
    )
  }

  return (
    <SkillReferencesList
      compact={compact}
      embedded={embedded}
      maxHeight={maxHeight}
      references={references}
      testId={testId}
      visibleLimit={visibleLimit}
    />
  )
}

export function SkillReferencesListSkeleton({
  compact = false,
  embedded = false,
}: {
  compact?: boolean
  embedded?: boolean
}) {
  return (
    <div
      className={cn(
        compact
          ? cn('space-y-px', !embedded && 'rounded-xl border border-divider-subtle p-1')
          : 'w-52 space-y-1 py-1',
      )}
    >
      <SkeletonRectangle className={cn(compact ? 'h-7 rounded-md' : 'h-8 rounded-lg')} />
      <SkeletonRectangle className={cn(compact ? 'h-7 rounded-md' : 'h-8 rounded-lg')} />
      {compact && <SkeletonRectangle className="h-7 rounded-md" />}
    </div>
  )
}

export function SkillReferencesList({
  compact = false,
  embedded = false,
  maxHeight,
  references,
  testId,
  visibleLimit,
}: {
  compact?: boolean
  embedded?: boolean
  maxHeight?: string
  references: SkillReferenceResponse[]
  testId?: string
  visibleLimit?: number
}) {
  const { t } = useTranslation(['skill'])
  const [expanded, setExpanded] = useState(false)
  const hasMoreReferences = visibleLimit != null && references.length > visibleLimit
  const visibleReferences =
    hasMoreReferences && !expanded ? references.slice(0, visibleLimit) : references
  const isScrollable = Boolean(maxHeight && (expanded || visibleLimit == null))

  return (
    <div
      data-testid={testId}
      data-scrollable={isScrollable ? true : undefined}
      className={cn(
        compact
          ? cn(
              'flex flex-col gap-px',
              !embedded && 'rounded-xl border border-divider-subtle p-0.75',
            )
          : 'w-max max-w-120 space-y-0.5 py-1',
        isScrollable && `${maxHeight} overflow-y-auto`,
      )}
    >
      {visibleReferences.map((reference) => (
        <SkillReferenceItem
          key={`${reference.type}:${reference.agent_id}:${reference.workflow_id ?? ''}:${reference.node_id ?? ''}`}
          compact={compact}
          reference={reference}
        />
      ))}
      {hasMoreReferences && !expanded && (
        <button
          type="button"
          className={cn(
            'flex h-7 cursor-pointer items-center justify-center rounded-md px-2 system-xs-medium text-text-accent outline-hidden hover:bg-state-accent-hover focus-visible:ring-2 focus-visible:ring-state-accent-solid',
            !compact && 'w-full',
          )}
          onClick={() => setExpanded(true)}
        >
          {t(($) => $['skillManagement.detail.showMoreReferences'], {
            count: references.length - visibleReferences.length,
          })}
        </button>
      )}
    </div>
  )
}

function SkillReferenceItem({
  compact = false,
  reference,
}: {
  compact?: boolean
  reference: SkillReferenceResponse
}) {
  const isWorkflowAgent = reference.type === 'workflow_agent_node'

  if (!isWorkflowAgent) {
    const title = reference.display_name || reference.name
    return (
      <Link
        href={`/agents/${reference.agent_id}/configure`}
        target="_blank"
        rel="noreferrer"
        className={cn(
          'group/reference flex min-w-0 items-center gap-2 outline-hidden hover:bg-state-base-hover focus-visible:ring-2 focus-visible:ring-state-accent-solid',
          compact ? 'h-7 w-full rounded-md py-1 ps-1 pe-2' : 'h-8 w-fit max-w-120 rounded-lg px-2',
        )}
      >
        <span aria-hidden className="shrink-0">
          <AppIcon
            size="tiny"
            icon={{
              icon_type: reference.agent_icon_type,
              icon: reference.agent_icon,
              icon_url: reference.agent_icon,
              icon_background: reference.agent_icon_background,
            }}
            fallback={{
              content: <span className="i-ri-robot-2-line size-4 text-util-colors-blue-blue-600" />,
              background: reference.agent_icon_background,
            }}
          />
        </span>
        <span
          className={cn(
            'min-w-0 truncate system-sm-regular text-text-secondary',
            compact ? 'flex-1' : 'max-w-63',
          )}
        >
          {title}
        </span>
        <span
          aria-hidden
          className={cn(
            'i-ri-external-link-line shrink-0 text-text-quaternary group-hover/reference:text-text-secondary group-focus-visible/reference:text-text-secondary',
            compact ? 'size-3' : 'size-4',
          )}
        />
      </Link>
    )
  }

  const workflowName = reference.workflow_name || reference.display_name || reference.name

  const workflowContent = (
    <>
      <span aria-hidden className="shrink-0">
        <AppIcon
          size="tiny"
          icon={{
            icon_type: reference.workflow_icon_type,
            icon: reference.workflow_icon,
            icon_url: reference.workflow_icon,
            icon_background: reference.workflow_icon_background,
          }}
          fallback={{
            content: <span className="i-ri-flow-chart size-4 text-util-colors-blue-blue-600" />,
            background: reference.workflow_icon_background,
          }}
        />
      </span>
      <span
        className={cn(
          'min-w-0 flex-1 truncate system-sm-regular text-text-secondary',
          !compact && 'max-w-63',
        )}
      >
        {workflowName}
      </span>
      <span
        aria-hidden
        className={cn(
          'i-ri-external-link-line shrink-0 text-text-quaternary group-hover/reference:text-text-secondary group-focus-visible/reference:text-text-secondary',
          compact ? 'size-3' : 'size-4',
        )}
      />
    </>
  )

  if (reference.app_id) {
    return (
      <Link
        href={`/app/${reference.app_id}/workflow`}
        target="_blank"
        rel="noreferrer"
        className={cn(
          'group/reference flex min-w-0 items-center gap-2 outline-hidden hover:bg-state-base-hover focus-visible:ring-2 focus-visible:ring-state-accent-solid',
          compact ? 'h-7 w-full rounded-md py-1 ps-1 pe-2' : 'h-8 w-fit max-w-120 rounded-lg px-2',
        )}
      >
        {workflowContent}
      </Link>
    )
  }

  return (
    <div
      className={cn(
        'group/reference flex min-w-0 items-center gap-2 hover:bg-state-base-hover',
        compact ? 'h-7 w-full rounded-md py-1 ps-1 pe-2' : 'h-8 w-fit max-w-120 rounded-lg px-2',
      )}
    >
      {workflowContent}
    </div>
  )
}
