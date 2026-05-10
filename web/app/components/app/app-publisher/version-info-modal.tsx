import type { FC } from 'react'
import type { VersionHistory } from '@/types/workflow'
import { Button } from '@langgenius/dify-ui/button'
import { Dialog, DialogContent } from '@langgenius/dify-ui/dialog'
import { toast } from '@langgenius/dify-ui/toast'
import { RiCloseLine } from '@remixicon/react'
import * as React from 'react'
import { useCallback, useState } from 'react'
import { useTranslation } from 'react-i18next'
import Input from '../../base/input'
import Textarea from '../../base/textarea'

type VersionInfoModalProps = {
  isOpen: boolean
  versionInfo?: VersionHistory
  onClose: () => void
  onPublish: (params: { title: string, releaseNotes: string, id?: string }) => void
}

const TITLE_MAX_LENGTH = 15
const RELEASE_NOTES_MAX_LENGTH = 100

const VersionInfoModal: FC<VersionInfoModalProps> = ({
  isOpen,
  versionInfo,
  onClose,
  onPublish,
}) => {
  const { t } = useTranslation()
  const [title, setTitle] = useState(versionInfo?.marked_name || '')
  const [releaseNotes, setReleaseNotes] = useState(versionInfo?.marked_comment || '')
  const [titleError, setTitleError] = useState(false)
  const [releaseNotesError, setReleaseNotesError] = useState(false)

  const handlePublish = () => {
    if (title.length > TITLE_MAX_LENGTH) {
      setTitleError(true)
      toast.error(t('versionHistory.editField.titleLengthLimit', { ns: 'workflow', limit: TITLE_MAX_LENGTH }))
      return
    }
    else {
      if (titleError)
        setTitleError(false)
    }

    if (releaseNotes.length > RELEASE_NOTES_MAX_LENGTH) {
      setReleaseNotesError(true)
      toast.error(t('versionHistory.editField.releaseNotesLengthLimit', { ns: 'workflow', limit: RELEASE_NOTES_MAX_LENGTH }))
      return
    }
    else {
      if (releaseNotesError)
        setReleaseNotesError(false)
    }

    onPublish({ title, releaseNotes, id: versionInfo?.id })
    onClose()
  }

  const handleTitleChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    setTitle(e.target.value)
  }, [])

  const handleDescriptionChange = useCallback((e: React.ChangeEvent<HTMLTextAreaElement>) => {
    setReleaseNotes(e.target.value)
  }, [])

  return (
    <Dialog
      open={isOpen}
      onOpenChange={(open) => {
        if (!open)
          onClose()
      }}
    >
      <DialogContent className="w-full max-w-[480px] overflow-hidden! border-none p-0 text-left align-middle">

        <div className="relative w-full p-6 pr-14 pb-4">
          <div className="title-2xl-semi-bold text-text-primary first-letter:capitalize">
            {versionInfo?.marked_name ? t('versionHistory.editVersionInfo', { ns: 'workflow' }) : t('versionHistory.nameThisVersion', { ns: 'workflow' })}
          </div>
          <div className="absolute top-5 right-5 flex h-8 w-8 cursor-pointer items-center justify-center p-1.5" onClick={onClose}>
            <RiCloseLine className="h-[18px] w-[18px] text-text-tertiary" />
          </div>
        </div>
        <div className="flex flex-col gap-y-4 px-6 py-3">
          <div className="flex flex-col gap-y-1">
            <div className="flex h-6 items-center system-sm-semibold text-text-secondary">
              {t('versionHistory.editField.title', { ns: 'workflow' })}
            </div>
            <Input
              value={title}
              placeholder={`${t('versionHistory.nameThisVersion', { ns: 'workflow' })}${t('panel.optional', { ns: 'workflow' })}`}
              onChange={handleTitleChange}
              destructive={titleError}
            />
          </div>
          <div className="flex flex-col gap-y-1">
            <div className="flex h-6 items-center system-sm-semibold text-text-secondary">
              {t('versionHistory.editField.releaseNotes', { ns: 'workflow' })}
            </div>
            <Textarea
              value={releaseNotes}
              placeholder={`${t('versionHistory.releaseNotesPlaceholder', { ns: 'workflow' })}${t('panel.optional', { ns: 'workflow' })}`}
              onChange={handleDescriptionChange}
              destructive={releaseNotesError}
            />
          </div>
        </div>
        <div className="flex justify-end p-6 pt-5">
          <div className="flex items-center gap-x-3">
            <Button nativeButton={false} onClick={onClose}>{t('operation.cancel', { ns: 'common' })}</Button>
            <Button nativeButton={false} variant="primary" onClick={handlePublish}>{t('common.publish', { ns: 'workflow' })}</Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}

export default VersionInfoModal
