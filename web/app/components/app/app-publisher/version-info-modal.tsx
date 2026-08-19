import type { WorkflowResponse } from '@dify/contracts/api/console/apps/types.gen'
import type { FC } from 'react'
import { Button } from '@langgenius/dify-ui/button'
import { Dialog, DialogContent } from '@langgenius/dify-ui/dialog'
import { Field, FieldLabel } from '@langgenius/dify-ui/field'
import { Input } from '@langgenius/dify-ui/input'
import { Textarea } from '@langgenius/dify-ui/textarea'
import { toast } from '@langgenius/dify-ui/toast'
import { useCallback, useState } from 'react'
import { useTranslation } from 'react-i18next'

type VersionInfoModalProps = {
  isOpen: boolean
  versionInfo?: Pick<WorkflowResponse, 'id' | 'marked_comment' | 'marked_name'>
  onClose: () => void
  onPublish: (params: { title: string; releaseNotes: string; id?: string }) => void
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
      toast.error(
        t(($) => $['versionHistory.editField.titleLengthLimit'], {
          ns: 'workflow',
          limit: TITLE_MAX_LENGTH,
        }),
      )
      return
    } else {
      if (titleError) setTitleError(false)
    }

    if (releaseNotes.length > RELEASE_NOTES_MAX_LENGTH) {
      setReleaseNotesError(true)
      toast.error(
        t(($) => $['versionHistory.editField.releaseNotesLengthLimit'], {
          ns: 'workflow',
          limit: RELEASE_NOTES_MAX_LENGTH,
        }),
      )
      return
    } else {
      if (releaseNotesError) setReleaseNotesError(false)
    }

    onPublish({ title, releaseNotes, id: versionInfo?.id })
    onClose()
  }

  const handleDescriptionChange = useCallback((value: string) => {
    setReleaseNotes(value)
  }, [])

  return (
    <Dialog
      open={isOpen}
      onOpenChange={(open) => {
        if (!open) onClose()
      }}
    >
      <DialogContent className="w-full max-w-120 overflow-hidden! border-none p-0 text-left align-middle">
        <div className="relative w-full p-6 pr-14 pb-4">
          <div className="title-2xl-semi-bold text-text-primary first-letter:capitalize">
            {versionInfo?.marked_name
              ? t(($) => $['versionHistory.editVersionInfo'], { ns: 'workflow' })
              : t(($) => $['versionHistory.nameThisVersion'], { ns: 'workflow' })}
          </div>
          <button
            type="button"
            className="absolute top-5 right-5 flex size-8 cursor-pointer items-center justify-center border-none bg-transparent p-1.5 focus-visible:ring-1 focus-visible:ring-components-input-border-active focus-visible:outline-hidden"
            aria-label={t(($) => $['operation.close'], { ns: 'common' })}
            onClick={onClose}
          >
            <span className="i-ri-close-line h-4.5 w-4.5 text-text-tertiary" aria-hidden="true" />
          </button>
        </div>
        <div className="flex flex-col gap-y-4 px-6 py-3">
          <Field name="title" invalid={titleError} className="gap-y-1">
            <FieldLabel className="flex h-6 items-center py-0 system-sm-semibold text-text-secondary">
              {t(($) => $['versionHistory.editField.title'], { ns: 'workflow' })}
            </FieldLabel>
            <Input
              value={title}
              placeholder={`${t(($) => $['versionHistory.nameThisVersion'], { ns: 'workflow' })}${t(($) => $['panel.optional'], { ns: 'workflow' })}`}
              onValueChange={setTitle}
            />
          </Field>
          <Field name="releaseNotes" invalid={releaseNotesError} className="gap-y-1">
            <FieldLabel className="flex h-6 items-center py-0 system-sm-semibold text-text-secondary">
              {t(($) => $['versionHistory.editField.releaseNotes'], { ns: 'workflow' })}
            </FieldLabel>
            <Textarea
              value={releaseNotes}
              placeholder={`${t(($) => $['versionHistory.releaseNotesPlaceholder'], { ns: 'workflow' })}${t(($) => $['panel.optional'], { ns: 'workflow' })}`}
              onValueChange={handleDescriptionChange}
            />
          </Field>
        </div>
        <div className="flex justify-end p-6 pt-5">
          <div className="flex items-center gap-x-3">
            <Button nativeButton={false} onClick={onClose}>
              {t(($) => $['operation.cancel'], { ns: 'common' })}
            </Button>
            <Button nativeButton={false} variant="primary" onClick={handlePublish}>
              {t(($) => $['operation.save'], { ns: 'common' })}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}

export default VersionInfoModal
