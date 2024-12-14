'use client'
import AppList from './app-list'
import FullScreenModal from '@/app/components/base/fullscreen-modal'

type CreateAppDialogProps = {
  show: boolean
  onSuccess: () => void
  onClose: () => void
  onCreateFromBlank?: () => void
}

const CreateAppTemplateDialog = ({ show, onSuccess, onClose, onCreateFromBlank }: CreateAppDialogProps) => {
  return (
    <FullScreenModal
      open={show}
      closable
      onClose={onClose}
    >
      <AppList onCreateFromBlank={onCreateFromBlank} onSuccess={() => {
        onSuccess()
        onClose()
      }} />
    </FullScreenModal>
  )
}

export default CreateAppTemplateDialog
