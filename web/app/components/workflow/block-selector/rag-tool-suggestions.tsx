import type { Dispatch, SetStateAction } from 'react'
import React, { useCallback } from 'react'
import { useTranslation } from 'react-i18next'
import type { OnSelectBlock, ToolWithProvider } from '../types'
// import Tools from './tools'
// import { ToolTypeEnum } from './types'
import type { ViewType } from './view-type-select'
import { RiMoreLine } from '@remixicon/react'

type RAGToolSuggestionsProps = {
  tools: ToolWithProvider[]
  viewType: ViewType
  onSelect: OnSelectBlock
  onTagsChange: Dispatch<SetStateAction<string[]>>
}

const RAGToolSuggestions: React.FC<RAGToolSuggestionsProps> = ({
  // tools,
  // viewType,
  // onSelect,
  onTagsChange,
}) => {
  const { t } = useTranslation()

  const loadMore = useCallback(() => {
    onTagsChange(prev => [...prev, 'rag'])
  }, [onTagsChange])

  return (
    <div className='flex flex-col p-1'>
      <div className='system-xs-medium px-3 pb-0.5 pt-1 text-text-tertiary'>
        {t('pipeline.ragToolSuggestions.title')}
      </div>
      {/* <Tools
        className='p-0'
        tools={tools}
        onSelect={onSelect}
        canNotSelectMultiple
        toolType={ToolTypeEnum.All}
        viewType={viewType}
        hasSearchText={false}
      /> */}
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
    </div>
  )
}

export default React.memo(RAGToolSuggestions)
