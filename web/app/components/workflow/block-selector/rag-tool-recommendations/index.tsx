'use client'
import type { Dispatch, SetStateAction } from 'react'
import React, { useCallback, useEffect, useMemo, useState } from 'react'
import { Trans, useTranslation } from 'react-i18next'
import type { OnSelectBlock } from '@/app/components/workflow/types'
import type { ViewType } from '@/app/components/workflow/block-selector/view-type-select'
import { RiMoreLine } from '@remixicon/react'
import Loading from '@/app/components/base/loading'
import Link from 'next/link'
import { getMarketplaceUrl } from '@/utils/var'
import { useRAGRecommendedPlugins } from '@/service/use-tools'
import List from './list'
import { getFormattedPlugin } from '@/app/components/plugins/marketplace/utils'
import { ArrowDownRoundFill } from '@/app/components/base/icons/src/vender/solid/arrows'

type RAGToolRecommendationsProps = {
  viewType: ViewType
  onSelect: OnSelectBlock
  onTagsChange: Dispatch<SetStateAction<string[]>>
}

const STORAGE_KEY = 'workflow_rag_recommendations_collapsed'

const RAGToolRecommendations = ({
  viewType,
  onSelect,
  onTagsChange,
}: RAGToolRecommendationsProps) => {
  const { t } = useTranslation()
  const [isCollapsed, setIsCollapsed] = useState<boolean>(() => {
    if (typeof window === 'undefined')
      return false
    const stored = window.localStorage.getItem(STORAGE_KEY)
    return stored === 'true'
  })

  useEffect(() => {
    if (typeof window === 'undefined')
      return
    const stored = window.localStorage.getItem(STORAGE_KEY)
    if (stored !== null)
      setIsCollapsed(stored === 'true')
  }, [])

  useEffect(() => {
    if (typeof window === 'undefined')
      return
    window.localStorage.setItem(STORAGE_KEY, String(isCollapsed))
  }, [isCollapsed])

  const {
    data: ragRecommendedPlugins,
    isLoading: isLoadingRAGRecommendedPlugins,
    isFetching: isFetchingRAGRecommendedPlugins,
  } = useRAGRecommendedPlugins()

  const recommendedPlugins = useMemo(() => {
    if (ragRecommendedPlugins)
      return ragRecommendedPlugins.installed_recommended_plugins
    return []
  }, [ragRecommendedPlugins])

  const unInstalledPlugins = useMemo(() => {
    if (ragRecommendedPlugins)
      return (ragRecommendedPlugins.uninstalled_recommended_plugins).map(getFormattedPlugin)
    return []
  }, [ragRecommendedPlugins])

  const loadMore = useCallback(() => {
    onTagsChange((prev) => {
      if (prev.includes('rag'))
        return prev
      return [...prev, 'rag']
    })
  }, [onTagsChange])

  return (
    <div className='flex flex-col p-1'>
      <button
        type='button'
        className='flex w-full items-center rounded-md px-3 pb-0.5 pt-1 text-left text-text-tertiary'
        onClick={() => setIsCollapsed(prev => !prev)}
      >
        <span className='system-xs-medium text-text-tertiary'>{t('pipeline.ragToolSuggestions.title')}</span>
        <ArrowDownRoundFill className={`ml-1 h-4 w-4 text-text-tertiary transition-transform ${isCollapsed ? '-rotate-90' : 'rotate-0'}`} />
      </button>
      {!isCollapsed && (
        <>
          {/* For first time loading, show loading */}
          {isLoadingRAGRecommendedPlugins && (
            <div className='py-2'>
              <Loading type='app' />
            </div>
          )}
          {!isFetchingRAGRecommendedPlugins && recommendedPlugins.length === 0 && unInstalledPlugins.length === 0 && (
            <p className='system-xs-regular px-3 py-1 text-text-tertiary'>
              <Trans
                i18nKey='pipeline.ragToolSuggestions.noRecommendationPlugins'
                components={{
                  CustomLink: (
                    <Link
                      className='text-text-accent'
                      target='_blank'
                      rel='noopener noreferrer'
                      href={getMarketplaceUrl('', { tags: 'rag' })}
                    />
                  ),
                }}
              />
            </p>
          )}
          {(recommendedPlugins.length > 0 || unInstalledPlugins.length > 0) && (
            <>
              <List
                tools={recommendedPlugins}
                unInstalledPlugins={unInstalledPlugins}
                onSelect={onSelect}
                viewType={viewType}
              />
              <div
                className='flex cursor-pointer items-center gap-x-2 py-1 pl-3 pr-2'
                onClick={loadMore}
              >
                <div className='px-1'>
                  <RiMoreLine className='size-4 text-text-tertiary' />
                </div>
                <div className='system-xs-regular text-text-tertiary'>
                  {t('common.operation.more')}
                </div>
              </div>
            </>
          )}
        </>
      )}
    </div>
  )
}

export default React.memo(RAGToolRecommendations)
