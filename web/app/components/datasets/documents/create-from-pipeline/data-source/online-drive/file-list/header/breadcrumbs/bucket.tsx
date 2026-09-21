import { BreadcrumbItem, BreadcrumbSeparator } from '@langgenius/dify-ui/breadcrumb'
import { IconButton } from '@langgenius/dify-ui/icon-button'
import { Tooltip, TooltipContent, TooltipTrigger } from '@langgenius/dify-ui/tooltip'
import * as React from 'react'
import { useTranslation } from 'react-i18next'
import DirectoryItem from './item'

type BucketProps = {
  bucketName: string
  current: boolean
  handleBackToBucketList: () => void
  handleClickBucketName: () => void
}

const Bucket = ({
  bucketName,
  handleBackToBucketList,
  handleClickBucketName,
  current,
}: BucketProps) => {
  const { t } = useTranslation()
  const allBucketsLabel = t(($) => $['onlineDrive.breadcrumbs.allBuckets'], {
    ns: 'datasetPipeline',
  })

  return (
    <>
      <BreadcrumbItem className="shrink-0">
        <Tooltip>
          <TooltipTrigger
            render={
              <IconButton
                type="button"
                variant="ghost"
                size="md"
                aria-label={allBucketsLabel}
                onClick={handleBackToBucketList}
              >
                <span
                  aria-hidden
                  className="i-custom-public-knowledge-online-drive-buckets-gray h-4.75 w-4.5"
                />
              </IconButton>
            }
          />
          <TooltipContent>{allBucketsLabel}</TooltipContent>
        </Tooltip>
      </BreadcrumbItem>
      <BreadcrumbSeparator className="system-xs-regular text-divider-deep" />
      <DirectoryItem
        name={bucketName}
        title={bucketName}
        current={current}
        onClick={handleClickBucketName}
      />
    </>
  )
}

export default React.memo(Bucket)
