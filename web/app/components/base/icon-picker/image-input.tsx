'use client'

import type { Ref } from 'react'
import type { Area, CropperProps } from 'react-easy-crop'
import { Button } from '@langgenius/dify-ui/button'
import { cn } from '@langgenius/dify-ui/cn'
import {
  Slider,
  SliderControl,
  SliderIndicator,
  SliderLabel,
  SliderThumb,
  SliderTrack,
} from '@langgenius/dify-ui/slider'
import { useEffect, useRef, useState } from 'react'
import Cropper from 'react-easy-crop'
import { useTranslation } from 'react-i18next'
import { ALLOW_FILE_EXTENSIONS } from '@/types/app'
import { checkIsAnimatedImage } from './image-crop'
import { useImageDrop } from './image-input-drag'

export type ImageIconInputValue =
  | { type: 'file'; file: File }
  | { type: 'crop'; url: string; area: Area; fileName: string }

export type ImageIconInputProps = {
  previewUrl?: string
  initialFocusRef?: Ref<HTMLButtonElement>
  disabled?: boolean
  className?: string
  cropShape?: CropperProps['cropShape']
  onChange?: (value: ImageIconInputValue | null) => void
}

export function ImageIconInput({
  className,
  cropShape,
  onChange,
  initialFocusRef,
  previewUrl,
  disabled = false,
}: ImageIconInputProps) {
  const { t } = useTranslation(['common', 'app'])
  const [inputImage, setInputImage] = useState<{ file: File; url: string; animated: boolean }>()
  const [error, setError] = useState('')
  const [pending, setPending] = useState(false)
  const [crop, setCrop] = useState({ x: 0, y: 0 })
  const [zoom, setZoom] = useState(1)
  const inputRef = useRef<HTMLInputElement>(null)
  const selectionRef = useRef(0)
  useEffect(
    () => () => {
      selectionRef.current += 1
    },
    [],
  )
  useEffect(
    () => () => {
      if (inputImage) URL.revokeObjectURL(inputImage.url)
    },
    [inputImage],
  )

  const selectFile = async (file: File) => {
    if (disabled) return
    if (!ALLOW_FILE_EXTENSIONS.includes(file.type.split('/')[1]!) || file.size > 3 * 1024 * 1024) {
      setError(
        file.size > 3 * 1024 * 1024
          ? t(($) => $['imageUploader.uploadFromComputerLimit'], { ns: 'common', size: 3 })
          : t(($) => $['imageInput.supportedFormats'], { ns: 'common' }),
      )
      return
    }
    const selection = ++selectionRef.current
    setPending(true)
    setError('')
    setInputImage(undefined)
    onChange?.(null)
    try {
      const animated = await checkIsAnimatedImage(file)
      if (selection !== selectionRef.current) return
      setCrop({ x: 0, y: 0 })
      setZoom(1)
      setInputImage({ file, url: URL.createObjectURL(file), animated })
      if (animated) onChange?.({ type: 'file', file })
    } catch {
      if (selection === selectionRef.current)
        setError(t(($) => $['imageUploader.uploadFromComputerReadError'], { ns: 'common' }))
    } finally {
      if (selection === selectionRef.current) setPending(false)
    }
  }
  const showPreview = !inputImage && !!previewUrl
  const { isDragActive, ...dropHandlers } = useImageDrop((file) => void selectFile(file), disabled)
  const handleImageError = () => {
    setInputImage(undefined)
    onChange?.(null)
    setError(t(($) => $['imageUploader.uploadFromComputerReadError'], { ns: 'common' }))
  }

  return (
    <div className={cn('w-full p-3', className)}>
      <input
        ref={inputRef}
        type="file"
        disabled={disabled}
        className="hidden"
        accept={ALLOW_FILE_EXTENSIONS.map((ext) => `.${ext}`).join(',')}
        onChange={(event) => {
          const file = event.target.files?.[0]
          event.target.value = ''
          if (file) void selectFile(file)
        }}
        data-testid="image-input"
      />
      <div
        {...dropHandlers}
        className={cn(
          'relative flex flex-col items-center justify-center overflow-hidden text-center',
          showPreview
            ? 'h-46 gap-3'
            : 'h-60 gap-2 rounded-[10px] border border-dashed border-components-dropzone-border bg-components-dropzone-bg px-4 py-3 text-text-secondary',
          isDragActive &&
            'border-components-dropzone-border-accent bg-components-dropzone-bg-accent',
        )}
      >
        {showPreview ? (
          <>
            <img
              src={previewUrl}
              alt={t(($) => $['iconPicker.image'], { ns: 'app' })}
              className="size-16 rounded-2xl object-contain"
            />
            <Button
              ref={initialFocusRef}
              disabled={disabled}
              onClick={() => inputRef.current?.click()}
            >
              {t(($) => $['operation.change'], { ns: 'common' })}
            </Button>
          </>
        ) : inputImage ? (
          inputImage.animated ? (
            <img
              src={inputImage.url}
              alt={t(($) => $['iconPicker.image'], { ns: 'app' })}
              className="h-full w-full object-contain"
              data-testid="animated-image"
              onError={handleImageError}
            />
          ) : (
            <div inert={disabled}>
              <Cropper
                image={inputImage.url}
                crop={crop}
                zoom={zoom}
                aspect={1}
                cropShape={cropShape}
                onCropChange={setCrop}
                onZoomChange={setZoom}
                mediaProps={{ onError: handleImageError }}
                cropperProps={{
                  role: 'group',
                  'aria-label': t(($) => $['iconPicker.crop'], { ns: 'app' }),
                }}
                classes={{
                  cropAreaClassName:
                    'focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-state-accent-solid',
                }}
                onCropComplete={(_, area) =>
                  onChange?.({
                    type: 'crop',
                    url: inputImage.url,
                    area,
                    fileName: inputImage.file.name,
                  })
                }
              />
            </div>
          )
        ) : (
          <>
            <span className="i-ri-image-add-line size-5 text-text-tertiary" aria-hidden="true" />
            <div className="system-sm-medium">
              {t(($) => $['imageInput.dropImageHere'], { ns: 'common' })}{' '}
              <button
                type="button"
                ref={initialFocusRef}
                disabled={disabled}
                className="rounded-sm text-text-accent focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-state-accent-solid"
                onClick={() => inputRef.current?.click()}
              >
                {t(($) => $['imageInput.browse'], { ns: 'common' })}
              </button>
            </div>
            <div className="system-xs-regular text-text-tertiary">
              {t(($) => $['imageInput.supportedFormats'], { ns: 'common' })}
            </div>
          </>
        )}
      </div>
      {pending && <p role="status">{t(($) => $.loading, { ns: 'common' })}</p>}
      {error && (
        <p role="alert" className="mt-2 text-text-destructive">
          {error}
        </p>
      )}
      {inputImage && (
        <div className="mt-3 flex items-center justify-end gap-2">
          {!inputImage.animated && (
            <Slider
              disabled={disabled}
              min={1}
              max={3}
              step={0.1}
              value={zoom}
              onValueChange={setZoom}
              className="min-w-0 flex-1 items-center gap-2"
            >
              <SliderLabel className="shrink-0 system-xs-regular">
                {t(($) => $['iconPicker.zoom'], { ns: 'app' })}
              </SliderLabel>
              <SliderControl>
                <SliderTrack>
                  <SliderIndicator />
                  <SliderThumb />
                </SliderTrack>
              </SliderControl>
            </Slider>
          )}
          <Button disabled={disabled} onClick={() => inputRef.current?.click()}>
            {t(($) => $['operation.change'], { ns: 'common' })}
          </Button>
        </div>
      )}
    </div>
  )
}
