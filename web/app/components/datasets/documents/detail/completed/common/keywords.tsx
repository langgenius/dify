import React, { type FC } from 'react'
import { useTranslation } from 'react-i18next'
import classNames from '@/utils/classnames'
import type { SegmentDetailModel } from '@/models/datasets'
import TagInput from '@/app/components/base/tag-input'

type IKeywordsProps = {
  segInfo?: Partial<SegmentDetailModel> & { id: string }
  className?: string
  keywords: string[]
  onKeywordsChange: (keywords: string[]) => void
  isEditMode?: boolean
  actionType?: 'edit' | 'add' | 'view'
}

const Keywords: FC<IKeywordsProps> = ({
  segInfo,
  className,
  keywords,
  onKeywordsChange,
  isEditMode,
  actionType = 'view',
}) => {
  const { t } = useTranslation()
  return (
    <div className={classNames('flex flex-col', className)}>
      <div className='text-text-tertiary system-xs-medium-uppercase'>{t('datasetDocuments.segment.keywords')}</div>
      <div className='text-text-tertiary flex max-h-[200px] w-full flex-wrap gap-1 overflow-auto'>
        {(!segInfo?.keywords?.length && actionType === 'view')
          ? '-'
          : (
            <TagInput
              items={keywords}
              onChange={newKeywords => onKeywordsChange(newKeywords)}
              disableAdd={!isEditMode}
              disableRemove={!isEditMode || (keywords.length === 1)}
            />
          )
        }
      </div>
    </div>
  )
}

Keywords.displayName = 'Keywords'

export default React.memo(Keywords)
