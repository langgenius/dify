import {
  DropdownMenuItem,
  DropdownMenuSeparator,
} from '@langgenius/dify-ui/dropdown-menu'
import * as React from 'react'
import { useTranslation } from 'react-i18next'

type OperationsProps = {
  showDelete: boolean
  showExportPipeline: boolean
  openRenameModal: () => void
  handleExportPipeline: () => void
  detectIsUsedByApp: () => void
  onClose?: () => void
}

const Operations = ({
  showDelete,
  showExportPipeline,
  openRenameModal,
  handleExportPipeline,
  detectIsUsedByApp,
  onClose,
}: OperationsProps) => {
  const { t } = useTranslation()

  const handleRename = () => {
    onClose?.()
    openRenameModal()
  }

  const handleExport = () => {
    onClose?.()
    handleExportPipeline()
  }

  const handleDelete = () => {
    onClose?.()
    detectIsUsedByApp()
  }

  return (
    <>
      <DropdownMenuItem onClick={handleRename}>
        <span aria-hidden className="i-ri-edit-line size-4 text-text-tertiary" />
        {t('operation.edit', { ns: 'common' })}
      </DropdownMenuItem>
      {showExportPipeline && (
        <DropdownMenuItem onClick={handleExport}>
          <span aria-hidden className="i-ri-file-download-line size-4 text-text-tertiary" />
          {t('operations.exportPipeline', { ns: 'datasetPipeline' })}
        </DropdownMenuItem>
      )}
      {showDelete && (
        <>
          <DropdownMenuSeparator />
          <DropdownMenuItem variant="destructive" onClick={handleDelete}>
            <span aria-hidden className="i-ri-delete-bin-line size-4" />
            {t('operation.delete', { ns: 'common' })}
          </DropdownMenuItem>
        </>
      )}
    </>
  )
}

export default React.memo(Operations)
