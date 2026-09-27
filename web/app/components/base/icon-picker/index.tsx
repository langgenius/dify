'use client'

import type { DialogContentProps } from '@langgenius/dify-ui/dialog'
import type { RefCallback } from 'react'
import type { ImageIconInputValue } from './image-input'
import { Button } from '@langgenius/dify-ui/button'
import { cn } from '@langgenius/dify-ui/cn'
import { Dialog, DialogContent, DialogTitle } from '@langgenius/dify-ui/dialog'
import { Tabs, TabsList, TabsPanel, TabsTab } from '@langgenius/dify-ui/tabs'
import { useMutation } from '@tanstack/react-query'
import { useCallback, useLayoutEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { DISABLE_UPLOAD_IMAGE_AS_ICON } from '@/config'
import { consoleQuery } from '@/service/console'
import { resolveEmoji } from '@/utils/emoji'
import { EmojiIconEditor } from './emoji-icon-editor'
import { defaultEmojiBackground, getRandomEmoji, getRandomEmojiBackground } from './emoji-styles'
import getCroppedImg from './image-crop'
import { ImageIconInput } from './image-input'
import { addRecentEmoji, useRecentEmojis } from './recent-emojis'

export type EmojiIcon = {
  type: 'emoji'
  icon: string
  background: string
}

export type ImageIcon = {
  type: 'image'
  fileId: string
  url: string
}

export type IconPickerValue = EmojiIcon | ImageIcon

export type IconPickerDefaultValue =
  | (Omit<EmojiIcon, 'background'> & { background?: EmojiIcon['background'] | null })
  | ImageIcon

export type IconPickerDialogProps = Pick<DialogContentProps, 'initialFocus' | 'finalFocus'> & {
  open: boolean
  onOpenChange: (open: boolean) => void
  /** Initial draft for each mounted dialog session; changes while open do not replace edits. */
  defaultValue?: IconPickerDefaultValue
  /** Receives the confirmed value after any image upload; does not await consumer persistence. */
  onConfirm: (value: IconPickerValue) => void
  enableImageUpload?: boolean
  className?: string
}

export function IconPickerDialog({
  open,
  onOpenChange,
  className,
  initialFocus,
  finalFocus,
  ...props
}: IconPickerDialogProps) {
  const { t } = useTranslation(['app'])
  const popupRef = useRef<HTMLDivElement>(null)
  const focusTargetRef = useRef<HTMLElement | null>(null)
  const setFocusTarget = useCallback((element: HTMLElement | null) => {
    focusTargetRef.current = element
  }, [])
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        ref={popupRef}
        backdropProps={{ forceRender: true }}
        initialFocus={
          initialFocus ??
          ((interaction) =>
            interaction === 'touch' ? popupRef.current : (focusTargetRef.current ?? true))
        }
        finalFocus={finalFocus}
        className={cn(
          'flex max-h-[calc(100dvh-2rem)] w-80.5 flex-col overflow-hidden p-0 text-left',
          className,
        )}
      >
        <DialogTitle className="sr-only">
          {t(($) => $['iconPicker.title'], { ns: 'app' })}
        </DialogTitle>
        <IconPickerSession
          {...props}
          open={open}
          onOpenChange={onOpenChange}
          initialFocusRef={setFocusTarget}
        />
      </DialogContent>
    </Dialog>
  )
}

function IconPickerSession({
  open,
  defaultValue,
  onConfirm,
  onOpenChange,
  enableImageUpload = true,
  initialFocusRef,
}: Pick<
  IconPickerDialogProps,
  'open' | 'defaultValue' | 'onConfirm' | 'onOpenChange' | 'enableImageUpload'
> & { initialFocusRef: RefCallback<HTMLElement> }) {
  const { t } = useTranslation(['app', 'common'])
  const imageEnabled = enableImageUpload && !DISABLE_UPLOAD_IMAGE_AS_ICON
  const [activeTab, setActiveTab] = useState<IconPickerValue['type']>(
    defaultValue?.type === 'image' && imageEnabled ? 'image' : 'emoji',
  )
  const [emoji, setEmoji] = useState<EmojiIcon | undefined>(() =>
    defaultValue?.type === 'emoji'
      ? {
          ...defaultValue,
          icon: resolveEmoji(defaultValue.icon),
          background: defaultValue.background || defaultEmojiBackground,
        }
      : undefined,
  )
  const handleEmojiChange = useCallback((icon: string) => {
    setEmoji((current) =>
      current?.icon === icon
        ? current
        : {
            type: 'emoji',
            icon,
            background: current?.background ?? defaultEmojiBackground,
          },
    )
  }, [])
  const handleBackgroundChange = useCallback((background: string) => {
    setEmoji((current) =>
      !current || current.background === background ? current : { ...current, background },
    )
  }, [])
  const [imageDraft, setImageDraft] = useState<ImageIcon | ImageIconInputValue | null>(() =>
    defaultValue?.type === 'image' ? defaultValue : null,
  )
  const [preparing, setPreparing] = useState(false)
  const [, setRecentEmojis] = useRecentEmojis()
  const [preparationError, setPreparationError] = useState('')
  const isOpenRef = useRef(open)
  useLayoutEffect(() => {
    isOpenRef.current = open
    return () => {
      isOpenRef.current = false
    }
  }, [open])

  const upload = useMutation(
    consoleQuery.files.upload.post.mutationOptions({ context: { silent: true } }),
  )
  const uploading = preparing || upload.isPending
  const uploadError =
    preparationError ||
    (upload.isError
      ? t(($) => $['imageUploader.uploadFromComputerUploadError'], { ns: 'common' })
      : '')
  const handleImageChange = (value: ImageIconInputValue | null) => {
    if (uploading) return
    setImageDraft(value)
    setPreparationError('')
    upload.reset()
  }
  const confirm = async () => {
    if (activeTab === 'emoji') {
      if (!emoji) return
      setRecentEmojis((recent) => addRecentEmoji(recent, emoji.icon))
      onConfirm(emoji)
      onOpenChange(false)
    } else if (imageDraft) {
      if (!imageEnabled || uploading) return
      if (imageDraft.type === 'image') {
        onConfirm(imageDraft)
        onOpenChange(false)
        return
      }
      setPreparationError('')
      upload.reset()
      setPreparing(true)
      try {
        let file: File
        if (imageDraft.type === 'file') file = imageDraft.file
        else {
          const blob = await getCroppedImg(imageDraft.url, imageDraft.area, imageDraft.fileName)
          file = new File([blob], imageDraft.fileName, { type: blob.type })
        }
        if (!isOpenRef.current) return
        if (file.size > 3 * 1024 * 1024) {
          setPreparationError(
            t(($) => $['imageUploader.uploadFromComputerLimit'], { ns: 'common', size: 3 }),
          )
          return
        }
        const url = await readImageDataURL(file)
        if (!isOpenRef.current) return
        upload.mutate(
          { body: { file } },
          {
            onSuccess: (uploaded) => {
              if (!isOpenRef.current) return
              onConfirm({ type: 'image', fileId: uploaded.id, url })
              onOpenChange(false)
            },
          },
        )
      } catch {
        if (isOpenRef.current)
          setPreparationError(
            t(($) => $['imageUploader.uploadFromComputerReadError'], { ns: 'common' }),
          )
      } finally {
        if (isOpenRef.current) setPreparing(false)
      }
    }
  }

  return (
    <Tabs
      value={activeTab}
      onValueChange={(value) => {
        if (value === 'emoji' || value === 'image') setActiveTab(value)
      }}
      className={cn(
        'flex min-h-0 flex-col',
        activeTab === 'emoji'
          ? 'h-[min(479px,calc(100dvh-2rem-1px))]'
          : 'max-h-[calc(100dvh-2rem)]',
      )}
    >
      {imageEnabled && (
        <div
          className={cn(
            'shrink-0 px-3 pt-3 pb-2',
            activeTab === 'image' && 'border-b border-divider-subtle',
          )}
        >
          <TabsList
            aria-label={t(($) => $['iconPicker.title'], { ns: 'app' })}
            className="gap-px rounded-[10px] bg-components-segmented-control-bg-normal p-0.5"
          >
            {(['emoji', 'image'] as const).map((kind) => (
              <TabsTab
                key={kind}
                value={kind}
                disabled={uploading}
                className="flex h-7 flex-1 items-center justify-center gap-1 rounded-lg border-0 p-1 system-sm-medium data-active:bg-components-segmented-control-item-active-bg data-active:text-text-accent-light-mode-only data-active:shadow-xs"
              >
                <span
                  aria-hidden="true"
                  className={kind === 'image' ? 'i-ri-image-circle-ai-line size-4' : 'text-base'}
                >
                  {kind === 'emoji' ? '🤖' : null}
                </span>
                {t(($) => $[kind === 'emoji' ? 'iconPicker.emoji' : 'iconPicker.image'], {
                  ns: 'app',
                })}
              </TabsTab>
            ))}
          </TabsList>
        </div>
      )}
      {imageEnabled ? (
        <TabsPanel
          keepMounted
          value="emoji"
          tabIndex={-1}
          className="flex min-h-0 flex-1 flex-col data-hidden:hidden"
        >
          <EmojiIconEditor
            inputRef={activeTab === 'emoji' ? initialFocusRef : undefined}
            value={emoji}
            onEmojiChange={handleEmojiChange}
            onBackgroundChange={handleBackgroundChange}
          />
        </TabsPanel>
      ) : (
        <div className="flex min-h-0 flex-1 flex-col pt-3">
          <EmojiIconEditor
            inputRef={activeTab === 'emoji' ? initialFocusRef : undefined}
            value={emoji}
            onEmojiChange={handleEmojiChange}
            onBackgroundChange={handleBackgroundChange}
          />
        </div>
      )}
      {imageEnabled && (
        <TabsPanel
          keepMounted
          value="image"
          tabIndex={-1}
          className="min-h-0 overflow-y-auto data-hidden:hidden"
        >
          <ImageIconInput
            previewUrl={imageDraft?.type === 'image' ? imageDraft.url : undefined}
            initialFocusRef={activeTab === 'image' ? initialFocusRef : undefined}
            disabled={uploading}
            onChange={handleImageChange}
          />
        </TabsPanel>
      )}
      {uploadError && (
        <p role="alert" className="px-3 text-text-destructive">
          {uploadError}
        </p>
      )}
      {(activeTab === 'emoji' || imageDraft) && (
        <div className="flex shrink-0 gap-2 border-t border-divider-subtle bg-components-panel-bg-blur p-3 backdrop-blur-sm">
          {activeTab === 'emoji' ? (
            <Button
              className="min-w-0 flex-1"
              onClick={() =>
                setEmoji({
                  type: 'emoji',
                  icon: getRandomEmoji(emoji?.icon),
                  background: getRandomEmojiBackground(emoji?.background),
                })
              }
            >
              <span className="i-ri-dice-line size-4" aria-hidden="true" />
              {t(($) => $['iconPicker.tryYourLuck'], { ns: 'app' })}
            </Button>
          ) : (
            <Button className="min-w-0 flex-1" onClick={() => onOpenChange(false)}>
              {t(($) => $['iconPicker.cancel'], { ns: 'app' })}
            </Button>
          )}
          <Button
            variant="primary"
            className="min-w-0 flex-1"
            disabled={activeTab === 'emoji' ? !emoji : !imageDraft}
            loading={uploading}
            onClick={() => void confirm()}
          >
            {t(($) => $['iconPicker.ok'], { ns: 'app' })}
          </Button>
        </div>
      )}
    </Tabs>
  )
}

function readImageDataURL(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => {
      if (typeof reader.result === 'string') resolve(reader.result)
      else reject(new Error('Invalid image preview'))
    }
    reader.onerror = () => reject(reader.error)
    reader.onabort = () => reject(new DOMException('Image read aborted', 'AbortError'))
    reader.readAsDataURL(file)
  })
}
