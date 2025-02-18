import cn from '@/utils/classnames'

type FileImageRenderProps = {
  imageUrl: string
  className?: string
  alt?: string
  onLoad?: () => void
  onError?: () => void
  showDownloadAction?: boolean
}
const FileImageRender = ({
  imageUrl,
  className,
  alt,
  onLoad,
  onError,
  showDownloadAction,
}: FileImageRenderProps) => {
  return (
    <div className={cn('border-effects-image-frame shadow-xs border-[2px]', className)}>
      <img
        className={cn('h-full w-full object-cover', showDownloadAction && 'cursor-pointer')}
        alt={alt || 'Preview'}
        onLoad={onLoad}
        onError={onError}
        src={imageUrl}
      />
    </div>
  )
}

export default FileImageRender
