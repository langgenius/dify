'use client'

import type { ScopeSelection } from '../command-options'
import { useTranslation } from 'react-i18next'

const noResultsKeys: Partial<
  Record<
    ScopeSelection,
    | 'gotoAnything.emptyState.noAppsFound'
    | 'gotoAnything.emptyState.noPluginsFound'
    | 'gotoAnything.emptyState.noKnowledgeBasesFound'
    | 'gotoAnything.emptyState.noWorkflowNodesFound'
  >
> = {
  '@app': 'gotoAnything.emptyState.noAppsFound',
  '@plugin': 'gotoAnything.emptyState.noPluginsFound',
  '@knowledge': 'gotoAnything.emptyState.noKnowledgeBasesFound',
  '@node': 'gotoAnything.emptyState.noWorkflowNodesFound',
}

export type EmptyStateProps = {
  variant: 'loading' | 'error' | 'no-commands' | 'no-results'
  scope: ScopeSelection
  error: Error | null
}

export function EmptyState({ variant, scope, error }: EmptyStateProps) {
  const { t } = useTranslation(['app'])

  if (variant === 'loading') {
    return (
      <div className="flex items-center justify-center py-8 text-center text-text-tertiary">
        <div className="flex items-center gap-2">
          <div className="size-4 animate-spin rounded-full border-2 border-gray-300 border-t-gray-600"></div>
          <span className="text-sm">{t(($) => $['gotoAnything.searching'], { ns: 'app' })}</span>
        </div>
      </div>
    )
  }

  if (variant === 'error') {
    return (
      <div className="flex items-center justify-center py-8 text-center text-text-tertiary">
        <div>
          <div className="text-sm font-medium text-red-500">
            {error?.message
              ? t(($) => $['gotoAnything.searchFailed'], { ns: 'app' })
              : t(($) => $['gotoAnything.searchTemporarilyUnavailable'], { ns: 'app' })}
          </div>
          <div className="mt-1 text-xs text-text-quaternary">
            {error?.message ||
              t(($) => $['gotoAnything.servicesUnavailableMessage'], { ns: 'app' })}
          </div>
        </div>
      </div>
    )
  }

  const noResultsKey =
    variant === 'no-commands'
      ? 'gotoAnything.noMatchingCommands'
      : (noResultsKeys[scope] ?? 'gotoAnything.noResults')

  return (
    <div className="flex items-center justify-center py-8 text-center text-text-tertiary">
      <div>
        <div className="text-sm font-medium">{t(($) => $[noResultsKey], { ns: 'app' })}</div>
        <div className="mt-1 text-xs text-text-quaternary">
          {t(($) => $['gotoAnything.emptyState.tryDifferentTerm'], { ns: 'app' })}
        </div>
      </div>
    </div>
  )
}
