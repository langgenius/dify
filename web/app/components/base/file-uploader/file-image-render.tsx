import cn from '@/utils/classnames'

type FileImageRenderProps = {
  imageUrl: string
  className?: string
  alt?: string
  onLoad?: () => void
  onError?: () => void
}
const FileImageRender = ({
  imageUrl,
  className,
  alt,
  onLoad,
  onError,
}: FileImageRenderProps) => {
  return (
    <div className={cn('border-[2px] border-effects-image-frame shadow-xs', className)}>
      <img
        className='w-full h-full object-cover'
        alt={alt}
        onLoad={onLoad}
        onError={onError}
        src={imageUrl}
      />
    </div>
  )
}

export default FileImageRender
