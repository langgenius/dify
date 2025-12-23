import type { ImageInfo } from '../image-previewer'
import type { FileEntity } from '@/app/components/base/file-thumb'
import { useCallback, useMemo, useState } from 'react'
import FileThumb from '@/app/components/base/file-thumb'
import { cn } from '@/utils/classnames'
import ImagePreviewer from '../image-previewer'
import More from './more'

type Image = {
  name: string
  mimeType: string
  sourceUrl: string
  size: number
  extension: string
}

type ImageListProps = {
  images: Image[]
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
  const [previewIndex, setPreviewIndex] = useState(0)
  const [previewImages, setPreviewImages] = useState<ImageInfo[]>([])

  const limitedImages = useMemo(() => {
    return showMore ? images : images.slice(0, limit)
  }, [images, limit, showMore])

  const handleShowMore = useCallback(() => {
    setShowMore(true)
  }, [])

  const handleImageClick = useCallback((file: FileEntity) => {
    const index = limitedImages.findIndex(image => image.sourceUrl === file.sourceUrl)
    if (index === -1)
      return
    setPreviewIndex(index)
    setPreviewImages(limitedImages.map(image => ({
      url: image.sourceUrl,
      name: image.name,
      size: image.size,
    })))
  }, [limitedImages])

  const handleClosePreview = useCallback(() => {
    setPreviewImages([])
  }, [])

  return (
    <>
      <div className={cn('flex flex-wrap gap-1', className)}>
        {
          limitedImages.map(image => (
            <FileThumb
              key={image.sourceUrl}
              file={image}
              size={size}
              onClick={handleImageClick}
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
      {previewImages.length > 0 && (
        <ImagePreviewer
          images={previewImages}
          initialIndex={previewIndex}
          onClose={handleClosePreview}
        />
      )}
    </>
  )
}

export default ImageList
