'use client'
import { useKeyPress } from 'ahooks'
import { useCallback } from 'react'
import FullScreenModal from '@/app/components/base/fullscreen-modal'
import AppList from './app-list'

type CreateAppDialogProps = {
  show: boolean
  onSuccess: () => void
  onClose: () => void
  onCreateFromBlank?: () => void
}

const CreateAppTemplateDialog = ({ show, onSuccess, onClose, onCreateFromBlank }: CreateAppDialogProps) => {
  const handleEscKeyPress = useCallback(() => {
    if (show)
      onClose()
  }, [show, onClose])

  useKeyPress('esc', handleEscKeyPress)

  return (
    <FullScreenModal
      open={show}
      closable
      onClose={onClose}
    >
      <AppList
        onCreateFromBlank={onCreateFromBlank}
        onSuccess={() => {
          onSuccess()
          onClose()
        }}
      />
    </FullScreenModal>
  )
}

export default CreateAppTemplateDialog
