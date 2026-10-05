import { cn } from '@langgenius/dify-ui/cn'
import { DialogTrigger } from '@langgenius/dify-ui/dialog'
import { useCallback, useMemo, useState } from 'react'
import { FileThumb } from '@/app/components/base/file-thumb'
import { ImagePreviewer } from '../image-previewer'
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

export function ImageList({ images, size, limit = 9, className }: ImageListProps) {
  const [showMore, setShowMore] = useState(false)

  const limitedImages = useMemo(() => {
    return showMore ? images : images.slice(0, limit)
  }, [images, limit, showMore])

  const handleShowMore = useCallback(() => {
    setShowMore(true)
  }, [])

  const previewImages = limitedImages
    .filter((image) => image.sourceUrl)
    .map((image) => ({
      url: image.sourceUrl,
      name: image.name,
      size: image.size,
    }))

  return (
    <ImagePreviewer>
      <div className={cn('flex flex-wrap gap-1', className)}>
        {limitedImages.map((image) => (
          <DialogTrigger
            key={image.sourceUrl || image.name}
            payload={{
              images: previewImages,
              initialIndex: previewImages.findIndex((item) => item.url === image.sourceUrl),
            }}
            disabled={!image.sourceUrl}
            onClick={(event) => event.stopPropagation()}
            render={<FileThumb file={image} size={size} />}
          />
        ))}
        {images.length > limit && !showMore && (
          <More count={images.length - limitedImages.length} onClick={handleShowMore} />
        )}
      </div>
    </ImagePreviewer>
  )
}
