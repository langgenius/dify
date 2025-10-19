import type { Dispatch, SetStateAction } from 'react'
import React, { useCallback, useMemo } from 'react'
import { Trans, useTranslation } from 'react-i18next'
import type { OnSelectBlock } from '../types'
import Tools from './tools'
import { ToolTypeEnum } from './types'
import type { ViewType } from './view-type-select'
import { RiMoreLine } from '@remixicon/react'
import Loading from '@/app/components/base/loading'
import Link from 'next/link'
import { getMarketplaceUrl } from '@/utils/var'
import { useRAGRecommendedPlugins } from '@/service/use-tools'

type RAGToolSuggestionsProps = {
  viewType: ViewType
  onSelect: OnSelectBlock
  onTagsChange: Dispatch<SetStateAction<string[]>>
}

const RAGToolSuggestions: React.FC<RAGToolSuggestionsProps> = ({
  viewType,
  onSelect,
  onTagsChange,
}) => {
  const { t } = useTranslation()

  const {
    data: ragRecommendedPlugins,
    isFetching: isFetchingRAGRecommendedPlugins,
  } = useRAGRecommendedPlugins()

  const recommendedPlugins = useMemo(() => {
    if (ragRecommendedPlugins)
      return [...ragRecommendedPlugins.installed_recommended_plugins]
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
      <div className='system-xs-medium px-3 pb-0.5 pt-1 text-text-tertiary'>
        {t('pipeline.ragToolSuggestions.title')}
      </div>
      {isFetchingRAGRecommendedPlugins && (
        <div className='py-2'>
          <Loading type='app' />
        </div>
      )}
      {!isFetchingRAGRecommendedPlugins && recommendedPlugins.length === 0 && (
        <p className='system-xs-regular px-3 py-1 text-text-tertiary'>
          <Trans
            i18nKey='pipeline.ragToolSuggestions.noRecommendationPluginsInstalled'
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
      {!isFetchingRAGRecommendedPlugins && recommendedPlugins.length > 0 && (
        <>
          <Tools
            className='p-0'
            tools={recommendedPlugins}
            onSelect={onSelect}
            canNotSelectMultiple
            toolType={ToolTypeEnum.All}
            viewType={viewType}
            hasSearchText={false}
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
    </div>
  )
}

export default React.memo(RAGToolSuggestions)
