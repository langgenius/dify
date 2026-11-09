'use client'

import type { ResultListProps } from '../results'
import type { EmptyStateProps } from './empty-state'
import { useTranslation } from 'react-i18next'
import { ResultList } from '../results'
import { EmptyState } from './empty-state'

type SearchResultsProps = ResultListProps &
  Pick<EmptyStateProps, 'scope' | 'error'> & {
    emptyState: EmptyStateProps['variant'] | null
    hasPartialFailure: boolean
  }

export function SearchResults({
  emptyState,
  scope,
  error,
  hasPartialFailure,
  ...listProps
}: SearchResultsProps) {
  const { t } = useTranslation(['app'])

  return (
    <>
      {hasPartialFailure && (
        <p className="flex items-center gap-1.5 px-4 pt-3 text-xs text-text-tertiary">
          <span
            aria-hidden
            className="i-ri-error-warning-line size-3.5 shrink-0 text-text-warning"
          />
          {t(($) => $['gotoAnything.someServicesUnavailable'], { ns: 'app' })}
        </p>
      )}
      {emptyState && <EmptyState variant={emptyState} scope={scope} error={error} />}
      <ResultList {...listProps} />
    </>
  )
}
