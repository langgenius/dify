'use client'

import type { FC } from 'react'
import type { AppIconSelection } from '@/app/components/base/app-icon-picker'
import type { SnippetCanvasData } from '@/models/snippet'
import { Button } from '@langgenius/dify-ui/button'
import { Dialog, DialogCloseButton, DialogContent, DialogPortal, DialogTitle } from '@langgenius/dify-ui/dialog'
import { useKeyPress } from 'ahooks'
import { useCallback, useState } from 'react'
import { useTranslation } from 'react-i18next'
import AppIcon from '@/app/components/base/app-icon'
import AppIconPicker from '@/app/components/base/app-icon-picker'
import Input from '@/app/components/base/input'
import Textarea from '@/app/components/base/textarea'
import ShortcutsName from './shortcuts-name'

export type CreateSnippetDialogPayload = {
  name: string
  description: string
  icon: AppIconSelection
  graph: SnippetCanvasData
}

type CreateSnippetDialogInitialValue = {
  name?: string
  description?: string
  icon?: AppIconSelection
}

type CreateSnippetDialogProps = {
  isOpen: boolean
  selectedGraph?: SnippetCanvasData
  onClose: () => void
  onConfirm: (payload: CreateSnippetDialogPayload) => void
  isSubmitting?: boolean
  title?: string
  confirmText?: string
  initialValue?: CreateSnippetDialogInitialValue
}

const defaultIcon: AppIconSelection = {
  type: 'emoji',
  icon: '🤖',
  background: '#FFEAD5',
}

const defaultGraph: SnippetCanvasData = {
  nodes: [],
  edges: [],
  viewport: { x: 0, y: 0, zoom: 1 },
}

const CreateSnippetDialog: FC<CreateSnippetDialogProps> = ({
  isOpen,
  selectedGraph,
  onClose,
  onConfirm,
  isSubmitting = false,
  title,
  confirmText,
  initialValue,
}) => {
  const { t } = useTranslation()
  const [name, setName] = useState(initialValue?.name ?? '')
  const [description, setDescription] = useState(initialValue?.description ?? '')
  const [icon, setIcon] = useState<AppIconSelection>(initialValue?.icon ?? defaultIcon)
  const [showAppIconPicker, setShowAppIconPicker] = useState(false)

  const resetForm = useCallback(() => {
    setName('')
    setDescription('')
    setIcon(defaultIcon)
    setShowAppIconPicker(false)
  }, [])

  const handleClose = useCallback(() => {
    resetForm()
    onClose()
  }, [onClose, resetForm])

  const handleConfirm = useCallback(() => {
    const trimmedName = name.trim()
    const trimmedDescription = description.trim()

    if (!trimmedName)
      return

    const payload = {
      name: trimmedName,
      description: trimmedDescription,
      icon,
      graph: selectedGraph ?? defaultGraph,
    }

    onConfirm(payload)
  }, [description, icon, name, onConfirm, selectedGraph])

  useKeyPress(['meta.enter', 'ctrl.enter'], () => {
    if (!isOpen)
      return

    if (isSubmitting)
      return

    handleConfirm()
  })

  return (
    <>
      <Dialog open={isOpen} onOpenChange={open => !open && handleClose()}>
        <DialogContent className="w-[520px] max-w-[520px] p-0">
          <DialogCloseButton />

          <div className="px-6 pt-6 pb-3">
            <DialogTitle className="title-2xl-semi-bold text-text-primary">
              {title || t('snippet.createDialogTitle', { ns: 'workflow' })}
            </DialogTitle>
          </div>

          <div className="space-y-4 px-6 py-2">
            <div className="flex items-end gap-3">
              <div className="flex-1 pb-0.5">
                <div className="mb-1 flex h-6 items-center system-sm-medium text-text-secondary">
                  {t('snippet.nameLabel', { ns: 'workflow' })}
                </div>
                <Input
                  value={name}
                  onChange={e => setName(e.target.value)}
                  placeholder={t('snippet.namePlaceholder', { ns: 'workflow' }) || ''}
                  disabled={isSubmitting}
                  autoFocus
                />
              </div>

              <AppIcon
                size="xxl"
                className="shrink-0 cursor-pointer"
                iconType={icon.type}
                icon={icon.type === 'emoji' ? icon.icon : icon.fileId}
                background={icon.type === 'emoji' ? icon.background : undefined}
                imageUrl={icon.type === 'image' ? icon.url : undefined}
                onClick={() => setShowAppIconPicker(true)}
              />
            </div>

            <div>
              <div className="mb-1 flex h-6 items-center system-sm-medium text-text-secondary">
                {t('snippet.descriptionLabel', { ns: 'workflow' })}
              </div>
              <Textarea
                className="resize-none"
                value={description}
                onChange={e => setDescription(e.target.value)}
                placeholder={t('snippet.descriptionPlaceholder', { ns: 'workflow' }) || ''}
                disabled={isSubmitting}
              />
            </div>
          </div>

          <div className="flex items-center justify-end gap-2 px-6 pt-5 pb-6">
            <Button disabled={isSubmitting} onClick={handleClose}>
              {t('operation.cancel', { ns: 'common' })}
            </Button>
            <Button
              variant="primary"
              disabled={!name.trim() || isSubmitting}
              loading={isSubmitting}
              onClick={handleConfirm}
            >
              {confirmText || t('snippet.confirm', { ns: 'workflow' })}
              <ShortcutsName className="ml-1" keys={['ctrl', 'enter']} bgColor="white" />
            </Button>
          </div>
        </DialogContent>

        <DialogPortal>
          <div className="pointer-events-none fixed top-1/2 left-1/2 z-[1002] flex -translate-x-1/2 translate-y-[170px] items-center gap-1 body-xs-regular text-text-quaternary">
            <span>{t('snippet.shortcuts.press', { ns: 'workflow' })}</span>
            <ShortcutsName keys={['ctrl', 'enter']} textColor="secondary" />
            <span>{t('snippet.shortcuts.toConfirm', { ns: 'workflow' })}</span>
          </div>
        </DialogPortal>
      </Dialog>

      {showAppIconPicker && (
        <AppIconPicker
          className="z-[1100]"
          onSelect={(selection) => {
            setIcon(selection)
            setShowAppIconPicker(false)
          }}
          onClose={() => setShowAppIconPicker(false)}
        />
      )}
    </>
  )
}

export default CreateSnippetDialog
