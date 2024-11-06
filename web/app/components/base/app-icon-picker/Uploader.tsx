'use client'

import type { ChangeEvent, FC } from 'react'
import { createRef, useEffect, useState } from 'react'
import type { Area } from 'react-easy-crop'
import Cropper from 'react-easy-crop'
import classNames from 'classnames'

import { ImagePlus } from '../icons/src/vender/line/images'
import { useDraggableUploader } from './hooks'
import { checkIsAnimatedImage } from './utils'
import { ALLOW_FILE_EXTENSIONS } from '@/types/app'

type UploaderProps = {
  className?: string
  onImageCropped?: (tempUrl: string, croppedAreaPixels: Area, fileName: string) => void
  onUpload?: (file?: File) => void
}

const Uploader: FC<UploaderProps> = ({
  className,
  onImageCropped,
  onUpload,
}) => {
  const [inputImage, setInputImage] = useState<{ file: File; url: string }>()
  const [isAnimatedImage, setIsAnimatedImage] = useState<boolean>(false)
  useEffect(() => {
    return () => {
      if (inputImage)
        URL.revokeObjectURL(inputImage.url)
    }
  }, [inputImage])

  const [crop, setCrop] = useState({ x: 0, y: 0 })
  const [zoom, setZoom] = useState(1)

  const onCropComplete = async (_: Area, croppedAreaPixels: Area) => {
    if (!inputImage)
      return
    onImageCropped?.(inputImage.url, croppedAreaPixels, inputImage.file.name)
    onUpload?.(undefined)
  }

  const handleLocalFileInput = (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (file) {
      setInputImage({ file, url: URL.createObjectURL(file) })
      checkIsAnimatedImage(file).then((isAnimatedImage) => {
        setIsAnimatedImage(!!isAnimatedImage)
        if (isAnimatedImage)
          onUpload?.(file)
      })
    }
  }

  const {
    isDragActive,
    handleDragEnter,
    handleDragOver,
    handleDragLeave,
    handleDrop,
  } = useDraggableUploader((file: File) => setInputImage({ file, url: URL.createObjectURL(file) }))

  const inputRef = createRef<HTMLInputElement>()

  const handleShowImage = () => {
    if (isAnimatedImage) {
      return (
        <img src={inputImage?.url} alt='' />
      )
    }

    return (
      <Cropper
        image={inputImage?.url}
        crop={crop}
        zoom={zoom}
        aspect={1}
        onCropChange={setCrop}
        onCropComplete={onCropComplete}
        onZoomChange={setZoom}
      />
    )
  }

  return (
    <div className={classNames(className, 'w-full px-3 py-1.5')}>
      <div
        className={classNames(
          isDragActive && 'border-primary-600',
          'relative aspect-square bg-gray-50 border-[1.5px] border-gray-200 border-dashed rounded-lg flex flex-col justify-center items-center text-gray-500')}
        onDragEnter={handleDragEnter}
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
      >
        {
          !inputImage
            ? <>
              <ImagePlus className="w-[30px] h-[30px] mb-3 pointer-events-none" />
              <div className="text-sm font-medium mb-[2px]">
                <span className="pointer-events-none">Drop your image here, or&nbsp;</span>
                <button className="text-components-button-primary-bg" onClick={() => inputRef.current?.click()}>browse</button>
                <input
                  ref={inputRef} type="file" className="hidden"
                  onClick={e => ((e.target as HTMLInputElement).value = '')}
                  accept={ALLOW_FILE_EXTENSIONS.map(ext => `.${ext}`).join(',')}
                  onChange={handleLocalFileInput}
                />
              </div>
              <div className="text-xs pointer-events-none">Supports PNG, JPG, JPEG, WEBP and GIF</div>
            </>
            : handleShowImage()
        }
      </div>
    </div>
  )
}

export default Uploader
