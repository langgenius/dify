import FileThumb from '@/app/components/base/file-thumb'
import cn from '@/utils/classnames'
import { useCallback, useMemo, useState } from 'react'
import More from './more'

type ImageListProps = {
  images: {
    name: string
    mimeType: string
    sourceUrl: string
    size: number
    extension: string
  }[]
  size: 'sm' | 'md'
  limit?: number
  className?: string
}

const ImageList = ({
  images,
  size,
  limit = 9,
  className,
}: ImageListProps) => {
  const [showMore, setShowMore] = useState(false)

  const limitedImages = useMemo(() => {
    return showMore ? images : images.slice(0, limit)
  }, [images, limit, showMore])

  const handleShowMore = useCallback(() => {
    setShowMore(true)
  }, [])

  return (
    <div className={cn('flex flex-wrap gap-1', className)}>
      {
        limitedImages.map(image => (
          <FileThumb
            key={image.sourceUrl}
            file={image}
            size={size}
          />
        ))
      }
      {images.length > limit && !showMore && (
        <More
          count={images.length - limitedImages.length}
          onClick={handleShowMore}
        />
      )}
    </div>
  )
}

export default ImageList
