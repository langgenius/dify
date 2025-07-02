import Button from '@/app/components/base/button'
import { SearchMenu } from '@/app/components/base/icons/src/vender/knowledge'
import React from 'react'
import { useTranslation } from 'react-i18next'

type EmptySearchResultProps = {
  onResetKeywords: () => void
}

const EmptySearchResult = ({
  onResetKeywords,
}: EmptySearchResultProps & {
  className?: string
}) => {
  const { t } = useTranslation()

  return (
    <div className='flex size-full flex-col items-center justify-center gap-y-2 rounded-[10px] bg-background-section p-6'>
      <SearchMenu className='size-8 text-text-tertiary' />
      <div className='system-sm-regular text-text-secondary'>
        {t('datasetPipeline.onlineDrive.emptySearchResult')}
      </div>
      <Button
        variant='secondary-accent'
        size='small'
        onClick={onResetKeywords}
        className='px-1.5'
      >
        <span className='px-[3px]'>{t('datasetPipeline.onlineDrive.resetKeywords')}</span>
      </Button>
    </div>
  )
}

export default React.memo(EmptySearchResult)
