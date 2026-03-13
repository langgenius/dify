'use client'

import type { FC } from 'react'
import type { AppIconSelection } from '@/app/components/base/app-icon-picker'
import { useKeyPress } from 'ahooks'
import { useCallback, useState } from 'react'
import { useTranslation } from 'react-i18next'
import AppIcon from '@/app/components/base/app-icon'
import AppIconPicker from '@/app/components/base/app-icon-picker'
import Button from '@/app/components/base/button'
import Input from '@/app/components/base/input'
import Textarea from '@/app/components/base/textarea'
import Toast from '@/app/components/base/toast'
import { Dialog, DialogCloseButton, DialogContent, DialogPortal, DialogTitle } from '@/app/components/base/ui/dialog'
import ShortcutsName from './shortcuts-name'

export type CreateSnippetDialogPayload = {
  name: string
  description: string
  icon: AppIconSelection
  selectedNodeIds: string[]
}

type CreateSnippetDialogProps = {
  isOpen: boolean
  selectedNodeIds: string[]
  onClose: () => void
  onConfirm: (payload: CreateSnippetDialogPayload) => void
}

const defaultIcon: AppIconSelection = {
  type: 'emoji',
  icon: '🤖',
  background: '#FFEAD5',
}

const CreateSnippetDialog: FC<CreateSnippetDialogProps> = ({
  isOpen,
  selectedNodeIds,
  onClose,
  onConfirm,
}) => {
  const { t } = useTranslation()
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [icon, setIcon] = useState<AppIconSelection>(defaultIcon)
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
      selectedNodeIds,
    }

    onConfirm(payload)
    Toast.notify({
      type: 'success',
      message: t('snippet.createSuccess', { ns: 'workflow' }),
    })
    handleClose()
  }, [description, handleClose, icon, name, onConfirm, selectedNodeIds, t])

  useKeyPress(['meta.enter', 'ctrl.enter'], () => {
    if (!isOpen)
      return

    handleConfirm()
  })

  return (
    <>
      <Dialog open={isOpen} onOpenChange={open => !open && handleClose()}>
        <DialogContent className="w-[520px] max-w-[520px] p-0">
          <DialogCloseButton />

          <div className="px-6 pb-3 pt-6">
            <DialogTitle className="text-text-primary title-2xl-semi-bold">
              {t('snippet.createDialogTitle', { ns: 'workflow' })}
            </DialogTitle>
          </div>

          <div className="space-y-4 px-6 py-2">
            <div className="flex items-end gap-3">
              <div className="flex-1 pb-0.5">
                <div className="mb-1 flex h-6 items-center text-text-secondary system-sm-medium">
                  {t('snippet.nameLabel', { ns: 'workflow' })}
                </div>
                <Input
                  value={name}
                  onChange={e => setName(e.target.value)}
                  placeholder={t('snippet.namePlaceholder', { ns: 'workflow' }) || ''}
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
              <div className="mb-1 flex h-6 items-center text-text-secondary system-sm-medium">
                {t('snippet.descriptionLabel', { ns: 'workflow' })}
              </div>
              <Textarea
                className="resize-none"
                value={description}
                onChange={e => setDescription(e.target.value)}
                placeholder={t('snippet.descriptionPlaceholder', { ns: 'workflow' }) || ''}
              />
            </div>
          </div>

          <div className="flex items-center justify-end gap-2 px-6 pb-6 pt-5">
            <Button onClick={handleClose}>
              {t('operation.cancel', { ns: 'common' })}
            </Button>
            <Button
              variant="primary"
              disabled={!name.trim()}
              onClick={handleConfirm}
            >
              {t('snippet.confirm', { ns: 'workflow' })}
              <ShortcutsName className="ml-1" keys={['ctrl', 'enter']} bgColor="white" />
            </Button>
          </div>
        </DialogContent>

        <DialogPortal>
          <div className="pointer-events-none fixed left-1/2 top-1/2 z-[1002] flex -translate-x-1/2 translate-y-[170px] items-center gap-1 text-text-quaternary body-xs-regular">
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
