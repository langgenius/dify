'use client'

import type { FC } from 'react'
import type { ActionItem } from '../actions/types'
import { useTranslation } from 'react-i18next'

export type EmptyStateVariant = 'no-results' | 'error' | 'default' | 'loading'

export type EmptyStateProps = {
  variant: EmptyStateVariant
  searchMode?: string
  error?: Error | null
  Actions?: Record<string, ActionItem>
}

const EmptyState: FC<EmptyStateProps> = ({
  variant,
  searchMode = 'general',
  error,
  Actions = {},
}) => {
  const { t } = useTranslation()

  if (variant === 'loading') {
    return (
      <div className="flex items-center justify-center py-8 text-center text-text-tertiary">
        <div className="flex items-center gap-2">
          <div className="h-4 w-4 animate-spin rounded-full border-2 border-gray-300 border-t-gray-600"></div>
          <span className="text-sm">{t('gotoAnything.searching', { ns: 'app' })}</span>
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
              ? t('gotoAnything.searchFailed', { ns: 'app' })
              : t('gotoAnything.searchTemporarilyUnavailable', { ns: 'app' })}
          </div>
          <div className="mt-1 text-xs text-text-quaternary">
            {error?.message || t('gotoAnything.servicesUnavailableMessage', { ns: 'app' })}
          </div>
        </div>
      </div>
    )
  }

  if (variant === 'default') {
    return (
      <div className="flex items-center justify-center py-8 text-center text-text-tertiary">
        <div>
          <div className="text-sm font-medium">{t('gotoAnything.searchTitle', { ns: 'app' })}</div>
          <div className="mt-3 space-y-1 text-xs text-text-quaternary">
            <div>{t('gotoAnything.searchHint', { ns: 'app' })}</div>
            <div>{t('gotoAnything.commandHint', { ns: 'app' })}</div>
            <div>{t('gotoAnything.slashHint', { ns: 'app' })}</div>
          </div>
        </div>
      </div>
    )
  }

  // variant === 'no-results'
  const isCommandSearch = searchMode !== 'general'
  const commandType = isCommandSearch ? searchMode.replace('@', '') : ''

  const getNoResultsMessage = () => {
    if (!isCommandSearch) {
      return t('gotoAnything.noResults', { ns: 'app' })
    }

    const keyMap = {
      app: 'gotoAnything.emptyState.noAppsFound',
      plugin: 'gotoAnything.emptyState.noPluginsFound',
      knowledge: 'gotoAnything.emptyState.noKnowledgeBasesFound',
      node: 'gotoAnything.emptyState.noWorkflowNodesFound',
    } as const

    return t(keyMap[commandType as keyof typeof keyMap] || 'gotoAnything.noResults', { ns: 'app' })
  }

  const getHintMessage = () => {
    if (isCommandSearch) {
      return t('gotoAnything.emptyState.tryDifferentTerm', { ns: 'app' })
    }

    const shortcuts = Object.values(Actions).map(action => action.shortcut).join(', ')
    return t('gotoAnything.emptyState.trySpecificSearch', { ns: 'app', shortcuts })
  }

  return (
    <div className="flex items-center justify-center py-8 text-center text-text-tertiary">
      <div>
        <div className="text-sm font-medium">{getNoResultsMessage()}</div>
        <div className="mt-1 text-xs text-text-quaternary">{getHintMessage()}</div>
      </div>
    </div>
  )
}

export default EmptyState
