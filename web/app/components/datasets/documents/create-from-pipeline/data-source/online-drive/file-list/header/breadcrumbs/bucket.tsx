import { Button } from '@langgenius/dify-ui/button'
import { cn } from '@langgenius/dify-ui/cn'
import { Tooltip, TooltipContent, TooltipTrigger } from '@langgenius/dify-ui/tooltip'
import * as React from 'react'
import { useCallback } from 'react'
import { useTranslation } from 'react-i18next'
import { BucketsGray } from '@/app/components/base/icons/src/public/knowledge/online-drive'

type BucketProps = {
  bucketName: string
  isActive?: boolean
  disabled?: boolean
  showSeparator?: boolean
  handleBackToBucketList: () => void
  handleClickBucketName: () => void
}

const Bucket = ({
  bucketName,
  handleBackToBucketList,
  handleClickBucketName,
  disabled = false,
  isActive = false,
  showSeparator = true,
}: BucketProps) => {
  const { t } = useTranslation()
  const handleClickItem = useCallback(() => {
    if (!disabled)
      handleClickBucketName()
  }, [disabled, handleClickBucketName])
  const allBucketsLabel = t('onlineDrive.breadcrumbs.allBuckets', { ns: 'datasetPipeline' })

  return (
    <>
      <Tooltip>
        <TooltipTrigger
          render={(
            <Button
              type="button"
              variant="ghost"
              size="small"
              aria-label={allBucketsLabel}
              className="size-6 shrink-0 rounded-md px-0 hover:bg-state-base-hover focus-visible:ring-2 focus-visible:ring-state-accent-solid"
              onClick={handleBackToBucketList}
            >
              <BucketsGray aria-hidden />
            </Button>
          )}
        />
        <TooltipContent>
          {allBucketsLabel}
        </TooltipContent>
      </Tooltip>
      <span className="system-xs-regular text-divider-deep">/</span>
      <button
        type="button"
        className={cn(
          'max-w-full shrink truncate rounded-md px-[5px] py-1',
          isActive ? 'system-sm-medium text-text-secondary' : 'system-sm-regular text-text-tertiary',
          !disabled && 'hover:bg-state-base-hover',
        )}
        disabled={disabled}
        onClick={handleClickItem}
        title={bucketName}
      >
        {bucketName}
      </button>
      {showSeparator && <span className="shrink-0 system-xs-regular text-divider-deep">/</span>}
    </>
  )
}

export default React.memo(Bucket)
