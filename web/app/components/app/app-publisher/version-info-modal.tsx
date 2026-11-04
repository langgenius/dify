import type { WorkflowResponse } from '@dify/contracts/api/console/apps/types.gen'
import type { FC } from 'react'
import { Button } from '@langgenius/dify-ui/button'
import {
  Dialog,
  DialogBody,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogHeaderCloseButton,
  DialogTitle,
} from '@langgenius/dify-ui/dialog'
import { Field, FieldLabel } from '@langgenius/dify-ui/field'
import { Input } from '@langgenius/dify-ui/input'
import { Textarea } from '@langgenius/dify-ui/textarea'
import { useCallback, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from '@/app/notifications'

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
  const { t } = useTranslation(['common', 'workflow', 'workflowHistory'])
  const [title, setTitle] = useState(versionInfo?.marked_name || '')
  const [releaseNotes, setReleaseNotes] = useState(versionInfo?.marked_comment || '')
  const [titleError, setTitleError] = useState(false)
  const [releaseNotesError, setReleaseNotesError] = useState(false)

  const handlePublish = () => {
    if (title.length > TITLE_MAX_LENGTH) {
      setTitleError(true)
      toast.error(
        t(($) => $['versionHistory.editField.titleLengthLimit'], {
          ns: 'workflowHistory',
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
          ns: 'workflowHistory',
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
      <DialogContent className="w-120">
        <DialogHeader>
          <DialogTitle>
            {versionInfo?.marked_name
              ? t(($) => $['versionHistory.editVersionInfo'], { ns: 'workflowHistory' })
              : t(($) => $['versionHistory.nameThisVersion'], { ns: 'workflowHistory' })}
          </DialogTitle>
          <DialogHeaderCloseButton aria-label={t(($) => $['operation.close'], { ns: 'common' })} />
        </DialogHeader>
        <DialogBody className="flex flex-col gap-y-4">
          <Field name="title" invalid={titleError}>
            <FieldLabel className="system-sm-semibold">
              {t(($) => $['versionHistory.editField.title'], { ns: 'workflowHistory' })}
            </FieldLabel>
            <Input
              value={title}
              placeholder={`${t(($) => $['versionHistory.nameThisVersion'], { ns: 'workflowHistory' })}${t(($) => $['panel.optional'], { ns: 'workflow' })}`}
              onValueChange={setTitle}
            />
          </Field>
          <Field name="releaseNotes" invalid={releaseNotesError}>
            <FieldLabel className="system-sm-semibold">
              {t(($) => $['versionHistory.editField.releaseNotes'], { ns: 'workflowHistory' })}
            </FieldLabel>
            <Textarea
              value={releaseNotes}
              placeholder={`${t(($) => $['versionHistory.releaseNotesPlaceholder'], { ns: 'workflowHistory' })}${t(($) => $['panel.optional'], { ns: 'workflow' })}`}
              onValueChange={handleDescriptionChange}
            />
          </Field>
        </DialogBody>
        <DialogFooter>
          <Button onClick={onClose}>{t(($) => $['operation.cancel'], { ns: 'common' })}</Button>
          <Button variant="primary" onClick={handlePublish}>
            {t(($) => $['operation.save'], { ns: 'common' })}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

export default VersionInfoModal
