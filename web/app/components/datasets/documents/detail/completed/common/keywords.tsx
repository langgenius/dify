import type { FC } from 'react'
import type { SegmentDetailModel } from '@/models/datasets'
import * as React from 'react'
import { useTranslation } from 'react-i18next'
import TagInput from '@/app/components/base/tag-input'
import { cn } from '@/utils/classnames'

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
    <div className={cn('flex flex-col', className)}>
      <div className="system-xs-medium-uppercase text-text-tertiary">{t('segment.keywords', { ns: 'datasetDocuments' })}</div>
      <div className="flex max-h-[200px] w-full flex-wrap gap-1 overflow-auto text-text-tertiary">
        {(!segInfo?.keywords?.length && actionType === 'view')
          ? '-'
          : (
              <TagInput
                items={keywords}
                onChange={newKeywords => onKeywordsChange(newKeywords)}
                disableAdd={!isEditMode}
                disableRemove={!isEditMode || (keywords.length === 1)}
              />
            )}
      </div>
    </div>
  )
}

Keywords.displayName = 'Keywords'

export default React.memo(Keywords)
