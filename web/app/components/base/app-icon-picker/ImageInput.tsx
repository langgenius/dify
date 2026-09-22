'use client'

import type { ChangeEvent, FC } from 'react'
import type { Area, CropperProps } from 'react-easy-crop'
import { cn } from '@langgenius/dify-ui/cn'
import { useEffect, useRef, useState } from 'react'
import Cropper from 'react-easy-crop'
import { useTranslation } from 'react-i18next'
import { ALLOW_FILE_EXTENSIONS } from '@/types/app'
import { useDraggableUploader } from './hooks'
import { checkIsAnimatedImage } from './utils'

export type OnImageInput = {
  (isCropped: true, tempUrl: string, croppedAreaPixels: Area, fileName: string): void
  (isCropped: false, file: File): void
}

type UploaderProps = {
  className?: string
  cropShape?: CropperProps['cropShape']
  onImageInput?: OnImageInput
}

const ImageInput: FC<UploaderProps> = ({ className, cropShape, onImageInput }) => {
  const { t } = useTranslation()
  const [inputImage, setInputImage] = useState<{ file: File; url: string }>()
  const [isAnimatedImage, setIsAnimatedImage] = useState<boolean>(false)
  useEffect(() => {
    return () => {
      if (inputImage) URL.revokeObjectURL(inputImage.url)
    }
  }, [inputImage])

  const [crop, setCrop] = useState({ x: 0, y: 0 })
  const [zoom, setZoom] = useState(1)

  const onCropComplete = async (_: Area, croppedAreaPixels: Area) => {
    /* v8 ignore next -- unreachable guard when Cropper is rendered @preserve */
    if (!inputImage) return
    onImageInput?.(true, inputImage.url, croppedAreaPixels, inputImage.file.name)
  }

  const handleLocalFileInput = (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (file) {
      setInputImage({ file, url: URL.createObjectURL(file) })
      checkIsAnimatedImage(file).then((isAnimatedImage) => {
        setIsAnimatedImage(!!isAnimatedImage)
        if (isAnimatedImage) onImageInput?.(false, file)
      })
    }
  }

  const { isDragActive, handleDragEnter, handleDragOver, handleDragLeave, handleDrop } =
    useDraggableUploader((file: File) => setInputImage({ file, url: URL.createObjectURL(file) }))

  const inputRef = useRef<HTMLInputElement>(null)

  const handleShowImage = () => {
    if (isAnimatedImage) {
      return (
        <img
          src={inputImage?.url}
          alt=""
          className="h-full w-full object-contain"
          data-testid="animated-image"
        />
      )
    }

    return (
      <Cropper
        image={inputImage?.url}
        crop={crop}
        zoom={zoom}
        aspect={1}
        cropShape={cropShape}
        onCropChange={setCrop}
        onCropComplete={onCropComplete}
        onZoomChange={setZoom}
      />
    )
  }

  return (
    <div className={cn(className, 'w-full p-3')}>
      <div
        className={cn(
          'relative flex h-60 flex-col items-center justify-center gap-2 overflow-hidden rounded-[10px] border border-dashed border-components-dropzone-border bg-components-dropzone-bg px-4 py-3 text-center text-text-secondary',
          isDragActive &&
            'border-components-dropzone-border-accent bg-components-dropzone-bg-accent',
        )}
        onDragEnter={handleDragEnter}
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
      >
        {!inputImage ? (
          <>
            <span
              className="pointer-events-none i-ri-image-add-line size-5 text-text-tertiary"
              aria-hidden="true"
            />
            <div className="system-sm-medium">
              <span className="pointer-events-none">
                {t(($) => $['imageInput.dropImageHere'], { ns: 'common' })}
                &nbsp;
              </span>
              <button
                type="button"
                className="rounded-sm text-text-accent focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-state-accent-solid"
                onClick={() => inputRef.current?.click()}
              >
                {t(($) => $['imageInput.browse'], { ns: 'common' })}
              </button>
              <input
                ref={inputRef}
                type="file"
                className="hidden"
                onClick={(e) => ((e.target as HTMLInputElement).value = '')}
                accept={ALLOW_FILE_EXTENSIONS.map((ext) => `.${ext}`).join(',')}
                onChange={handleLocalFileInput}
                data-testid="image-input"
              />
            </div>
            <div className="pointer-events-none system-xs-regular text-text-tertiary">
              {t(($) => $['imageInput.supportedFormats'], { ns: 'common' })}
            </div>
          </>
        ) : (
          handleShowImage()
        )}
      </div>
    </div>
  )
}

export default ImageInput
