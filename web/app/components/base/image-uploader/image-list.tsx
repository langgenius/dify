import type { FC } from 'react'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import {
  RiCloseLine,
  RiLoader2Line,
} from '@remixicon/react'
import cn from '@/utils/classnames'
import { RefreshCcw01 } from '@/app/components/base/icons/src/vender/line/arrows'
import { AlertTriangle } from '@/app/components/base/icons/src/vender/solid/alertsAndFeedback'
import Tooltip from '@/app/components/base/tooltip'
import type { ImageFile } from '@/types/app'
import { TransferMethod } from '@/types/app'
import ImagePreview from '@/app/components/base/image-uploader/image-preview'

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
    )
      onImageLinkLoadSuccess(item._id)
  }
  const handleImageLinkLoadError = (item: ImageFile) => {
    if (item.type === TransferMethod.remote_url && onImageLinkLoadError)
      onImageLinkLoadError(item._id)
  }

  return (
    <div className="flex flex-wrap">
      {list.map(item => (
        <div
          key={item._id}
          className="group relative mr-1 rounded-lg border-[0.5px] border-black/5"
        >
          {item.type === TransferMethod.local_file && item.progress !== 100 && (
            <>
              <div
                className="absolute inset-0 z-[1] flex items-center justify-center bg-black/30"
                style={{ left: item.progress > -1 ? `${item.progress}%` : 0 }}
              >
                {item.progress === -1 && (
                  <RefreshCcw01
                    className="h-5 w-5 text-white"
                    onClick={() => onReUpload && onReUpload(item._id)}
                  />
                )}
              </div>
              {item.progress > -1 && (
                <span className="absolute left-[50%] top-[50%] z-[1] translate-x-[-50%] translate-y-[-50%] text-sm text-white mix-blend-lighten">
                  {item.progress}%
                </span>
              )}
            </>
          )}
          {item.type === TransferMethod.remote_url && item.progress !== 100 && (
            <div
              className={`
                  absolute inset-0 z-[1] flex items-center justify-center rounded-lg border
                  ${item.progress === -1
              ? 'border-[#DC6803] bg-[#FEF0C7]'
              : 'border-transparent bg-black/[0.16]'
            }
                `}
            >
              {item.progress > -1 && (
                <RiLoader2Line className="h-5 w-5 animate-spin text-white" />
              )}
              {item.progress === -1 && (
                <Tooltip
                  popupContent={t('common.imageUploader.pasteImageLinkInvalid')}
                >
                  <AlertTriangle className="h-4 w-4 text-[#DC6803]" />
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
              )
            }
          />
          {!readonly && (
            <button
              type="button"
              className={cn(
                'absolute -right-[9px] -top-[9px] z-10 h-[18px] w-[18px] items-center justify-center',
                'hover:bg-state-base-hover rounded-2xl shadow-lg',
                item.progress === -1 ? 'flex' : 'hidden group-hover:flex',
              )}
              onClick={() => onRemove && onRemove(item._id)}
            >
              <RiCloseLine className="text-text-tertiary h-3 w-3" />
            </button>
          )}
        </div>
      ))}
      {imagePreviewUrl && (
        <ImagePreview
          url={imagePreviewUrl}
          onCancel={() => setImagePreviewUrl('')}
          title=''
        />
      )}
    </div>
  )
}

export default ImageList
