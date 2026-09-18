'use client'
import type { FC } from 'react'
import { cn } from '@langgenius/dify-ui/cn'
import * as React from 'react'
import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import ImagePreview from '@/app/components/base/image-uploader/image-preview'
import s from './style.module.css'

type Props = Readonly<{
  srcs: string[]
  onPreviewOpenChange?: (open: boolean) => void
}>

const getWidthStyle = (imgNum: number) => {
  if (imgNum === 1) {
    return {
      maxWidth: '100%',
    }
  }

  if (imgNum === 2 || imgNum === 4) {
    return {
      width: 'calc(50% - 4px)',
    }
  }

  return {
    width: 'calc(33.3333% - 5.3333px)',
  }
}

const ImageGallery: FC<Props> = ({ srcs, onPreviewOpenChange }) => {
  const { t } = useTranslation('common')
  const [imagePreviewUrl, setImagePreviewUrl] = useState('')
  const isPreviewOpen = Boolean(imagePreviewUrl)

  // Synchronize embedding surfaces with the preview's lifetime, including
  // navigation that unmounts the gallery before the preview is dismissed.
  useEffect(() => {
    if (!isPreviewOpen || !onPreviewOpenChange) return

    onPreviewOpenChange(true)
    const handlePageHide = () => onPreviewOpenChange(false)
    const handlePageShow = () => onPreviewOpenChange(true)
    window.addEventListener('pagehide', handlePageHide)
    window.addEventListener('pageshow', handlePageShow)
    return () => {
      window.removeEventListener('pagehide', handlePageHide)
      window.removeEventListener('pageshow', handlePageShow)
      onPreviewOpenChange(false)
    }
  }, [isPreviewOpen, onPreviewOpenChange])

  const imgNum = srcs.length
  const imgStyle = getWidthStyle(imgNum)
  return (
    <div className={cn(s[`img-${imgNum}`], 'flex flex-wrap')} data-testid="image-gallery">
      {srcs.map((src, index) =>
        !src ? null : (
          <button
            type="button"
            key={index}
            className={s.item}
            style={imgStyle}
            aria-label={t(($) => $['imageGallery.previewImage'], {
              index: index + 1,
              total: imgNum,
            })}
            onClick={() => setImagePreviewUrl(src)}
          >
            <img
              className={s.image}
              src={src}
              alt=""
              data-testid="gallery-image" // Added for testing
              onError={(e) => e.currentTarget.parentElement?.remove()}
            />
          </button>
        ),
      )}
      {imagePreviewUrl && (
        <ImagePreview url={imagePreviewUrl} onCancel={() => setImagePreviewUrl('')} title="" />
      )}
    </div>
  )
}

export default React.memo(ImageGallery)
