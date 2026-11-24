'use client'

import type { SkillResponse } from '@dify/contracts/api/console/workspaces/types.gen'
import type { SkillPlaceholderActions } from './empty-state'
import { Button } from '@langgenius/dify-ui/button'
import { cn } from '@langgenius/dify-ui/cn'
import { useTranslation } from 'react-i18next'
import { SkillCard } from './card'
import { SkillPlaceholderState } from './empty-state'
import { SKILL_GRID_CLASS_NAME } from './layout'
import { SkillCardSkeleton, SkillCardSkeletonCards } from './skeleton'

type SkillGridRetryState = { status: 'error'; isRetrying: boolean; onRetry: () => void }

export type SkillGridState =
  | { status: 'pending' }
  | SkillGridRetryState
  | {
      status: 'ready'
      content:
        | {
            kind: 'empty'
            emptyState: 'skills' | 'filtered'
            actions?: SkillPlaceholderActions
          }
        | {
            kind: 'list'
            skills: SkillResponse[]
            pagination: { status: 'none' } | { status: 'loading' } | SkillGridRetryState
            refresh: { status: 'none' } | SkillGridRetryState
            cardActions: {
              canDelete: boolean
              canEdit: boolean
              onOpenTagManagement: () => void
            }
          }
      isFetching: boolean
    }

type SkillGridProps = {
  state: SkillGridState
}

function SkillGridRetryStatus({ state }: { state: SkillGridRetryState }) {
  const { t } = useTranslation(['skill'])
  const { t: tCommon } = useTranslation(['common'])

  return (
    <div
      className="flex items-center justify-center gap-3 pt-1 system-xs-regular text-text-destructive"
      role="alert"
    >
      <span>{t(($) => $['skillManagement.loadingError'])}</span>
      <Button loading={state.isRetrying} size="small" variant="secondary" onClick={state.onRetry}>
        {tCommon(($) => $['operation.retry'])}
      </Button>
    </div>
  )
}

function SkillGridPagination({
  state,
}: {
  state: Extract<
    Extract<SkillGridState, { status: 'ready' }>['content'],
    { kind: 'list' }
  >['pagination']
}) {
  const { t } = useTranslation(['common'])

  if (state.status === 'none') return null
  if (state.status === 'error') return <SkillGridRetryStatus state={state} />

  return (
    <div role="status" className={cn('mt-2.5', SKILL_GRID_CLASS_NAME)}>
      <span className="sr-only col-span-full">{t(($) => $.loading)}</span>
      <div aria-hidden="true" className="contents">
        <SkillCardSkeletonCards />
      </div>
    </div>
  )
}

export function SkillGrid({ state }: SkillGridProps) {
  const { t } = useTranslation(['skill'])
  const isBusy =
    state.status === 'pending' ||
    (state.status === 'error' && state.isRetrying) ||
    (state.status === 'ready' && state.isFetching)
  const readyContent = state.status === 'ready' ? state.content : undefined

  return (
    <section aria-label={t(($) => $['skillManagement.listLabel'])} aria-busy={isBusy}>
      {state.status === 'pending' && (
        <div className={SKILL_GRID_CLASS_NAME}>
          <SkillCardSkeleton />
        </div>
      )}
      {state.status === 'error' && (
        <SkillPlaceholderState
          isRetrying={state.isRetrying}
          onRetry={state.onRetry}
          role="alert"
          title={t(($) => $['skillManagement.loadingError'])}
        />
      )}
      {readyContent?.kind === 'empty' && (
        <SkillPlaceholderState
          actions={readyContent.actions}
          role={readyContent.emptyState === 'filtered' ? 'status' : undefined}
          title={
            readyContent.emptyState === 'filtered'
              ? t(($) => $['skillManagement.emptySearch'])
              : t(($) => $['skillManagement.empty'])
          }
        />
      )}
      {readyContent?.kind === 'list' && (
        <>
          {readyContent.refresh.status === 'error' && (
            <SkillGridRetryStatus state={readyContent.refresh} />
          )}
          {/* Safari list semantics: https://developer.mozilla.org/en-US/docs/Web/CSS/Reference/Properties/list-style#accessibility */}
          {/* oxlint-disable-next-line jsx-a11y/no-redundant-roles -- Dify's preflight removes list markers. */}
          <ul role="list" className={SKILL_GRID_CLASS_NAME}>
            {readyContent.skills.map((skill) => (
              <SkillCard
                key={skill.id}
                canDelete={readyContent.cardActions.canDelete}
                canEdit={readyContent.cardActions.canEdit}
                skill={skill}
                onOpenTagManagement={readyContent.cardActions.onOpenTagManagement}
              />
            ))}
          </ul>
          <SkillGridPagination state={readyContent.pagination} />
        </>
      )}
    </section>
  )
}
