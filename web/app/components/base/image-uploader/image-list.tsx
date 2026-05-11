import type { FC } from 'react'
import type { ImageFile } from '@/types/app'
import { cn } from '@langgenius/dify-ui/cn'
import { Tooltip, TooltipContent, TooltipTrigger } from '@langgenius/dify-ui/tooltip'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { AlertTriangle } from '@/app/components/base/icons/src/vender/solid/alertsAndFeedback'
import ImagePreview from '@/app/components/base/image-uploader/image-preview'
import { TransferMethod } from '@/types/app'

type ImageListProps = {
  list: ImageFile[]
  readonly?: boolean
  onRemove?: (imageFileId: string) => void
  onReUpload?: (imageFileId: string) => void
  onImageLinkLoadSuccess?: (imageFileId: string) => void
  onImageLinkLoadError?: (imageFileId: string) => void
}

const ImageList: FC<ImageListProps> = ({
  list,
  readonly,
  onRemove,
  onReUpload,
  onImageLinkLoadSuccess,
  onImageLinkLoadError,
}) => {
  const { t } = useTranslation()
  const [imagePreviewUrl, setImagePreviewUrl] = useState('')

  const handleImageLinkLoadSuccess = (item: ImageFile) => {
    if (
      item.type === TransferMethod.remote_url
      && onImageLinkLoadSuccess
      && item.progress !== -1
    ) {
      onImageLinkLoadSuccess(item._id)
    }
  }
  const handleImageLinkLoadError = (item: ImageFile) => {
    if (item.type === TransferMethod.remote_url && onImageLinkLoadError)
      onImageLinkLoadError(item._id)
  }

  return (
    <div className="flex flex-wrap" role="list" aria-label={t('imageUploader.imageList', { ns: 'common' })}>
      {list.map(item => (
        <div
          key={item._id}
          role="listitem"
          className="group relative mr-1 rounded-lg border-[0.5px] border-black/5"
        >
          {item.type === TransferMethod.local_file && item.progress !== 100 && (
            <>
              <div
                className="absolute inset-0 z-1 flex items-center justify-center bg-black/30"
                style={{ left: item.progress > -1 ? `${item.progress}%` : 0 }}
              >
                {item.progress === -1 && (
                  <button
                    type="button"
                    aria-label={t('operation.retry', { ns: 'common' })}
                    className="h-5 w-5 border-none bg-transparent p-0 text-white focus-visible:ring-1 focus-visible:ring-white focus-visible:outline-hidden"
                    onClick={() => onReUpload?.(item._id)}
                  >
                    <span className="i-custom-vender-line-arrows-refresh-ccw-01 h-5 w-5" aria-hidden="true" />
                  </button>
                )}
              </div>
              {item.progress > -1 && (
                <span className="absolute top-[50%] left-[50%] z-1 translate-x-[-50%] translate-y-[-50%] text-sm text-white mix-blend-lighten">
                  {item.progress}
                  %
                </span>
              )}
            </>
          )}
          {item.type === TransferMethod.remote_url && item.progress !== 100 && (
            <div
              className={`
                  absolute inset-0 z-1 flex items-center justify-center rounded-lg border
                  ${item.progress === -1
              ? 'border-[#DC6803] bg-[#FEF0C7]'
              : 'border-transparent bg-black/16'
            }
                `}
              data-testid="image-error-container"
            >
              {item.progress > -1 && (
                <span className="i-ri-loader-2-line h-5 w-5 animate-spin text-white" data-testid="image-loader" />
              )}
              {item.progress === -1 && (
                <Tooltip>
                  <TooltipTrigger
                    render={(
                      <AlertTriangle className="h-4 w-4 text-[#DC6803]" />
                    )}
                  />
                  <TooltipContent>
                    {t('imageUploader.pasteImageLinkInvalid', { ns: 'common' })}
                  </TooltipContent>
                </Tooltip>
              )}
            </div>
          )}
          <img
            className="h-16 w-16 cursor-pointer rounded-lg border-[0.5px] border-black/5 object-cover"
            alt={item.file?.name}
            onLoad={() => handleImageLinkLoadSuccess(item)}
            onError={() => handleImageLinkLoadError(item)}
            src={
              item.type === TransferMethod.remote_url
                ? item.url
                : item.base64Url
            }
            onClick={() =>
              item.progress === 100
              && setImagePreviewUrl(
                (item.type === TransferMethod.remote_url
                  ? item.url
                  : item.base64Url) as string,
              )}
          />
          {!readonly && (
            <button
              type="button"
              className={cn(
                'absolute -top-[9px] -right-[9px] z-10 h-[18px] w-[18px] items-center justify-center border-none bg-transparent p-0',
                'rounded-2xl shadow-lg hover:bg-state-base-hover',
                item.progress === -1 ? 'flex' : 'hidden group-hover:flex',
              )}
              onClick={() => onRemove?.(item._id)}
              aria-label={t('operation.remove', { ns: 'common' })}
            >
              <span className="i-ri-close-line h-3 w-3 text-text-tertiary" aria-hidden="true" />
            </button>
          )}
        </div>
      ))}
      {imagePreviewUrl && (
        <ImagePreview
          url={imagePreviewUrl}
          onCancel={() => setImagePreviewUrl('')}
          title=""
        />
      )}
    </div>
  )
}

export default ImageList
