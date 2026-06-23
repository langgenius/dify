import {
  DropdownMenuItem,
  DropdownMenuSeparator,
} from '@langgenius/dify-ui/dropdown-menu'
import * as React from 'react'
import { useTranslation } from 'react-i18next'

type OperationsProps = {
  showEdit?: boolean
  showDelete: boolean
  showExportPipeline: boolean
  showAccessConfig?: boolean
  openRenameModal: () => void
  handleExportPipeline: () => void
  detectIsUsedByApp: () => void
  openAccessConfig: () => void
  onClose?: () => void
}

const Operations = ({
  showEdit = true,
  showDelete,
  showExportPipeline,
  showAccessConfig = false,
  openRenameModal,
  handleExportPipeline,
  detectIsUsedByApp,
  openAccessConfig,
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

  const handleAccessConfig = () => {
    onClose?.()
    openAccessConfig()
  }

  return (
    <>
      {showEdit && (
        <DropdownMenuItem onClick={handleRename}>
          <span aria-hidden className="mr-1 i-ri-edit-line size-4 text-text-tertiary" />
          {t('operation.edit', { ns: 'common' })}
        </DropdownMenuItem>
      )}
      {showExportPipeline && (
        <DropdownMenuItem onClick={handleExport}>
          <span aria-hidden className="mr-1 i-ri-file-download-line size-4 text-text-tertiary" />
          {t('operations.exportPipeline', { ns: 'datasetPipeline' })}
        </DropdownMenuItem>
      )}
      {showAccessConfig && (
        <DropdownMenuItem onClick={handleAccessConfig}>
          <span aria-hidden className="mr-1 i-ri-lock-line size-4 text-text-tertiary" />
          {t('settings.resourceAccess', { ns: 'common' })}
        </DropdownMenuItem>
      )}
      {showDelete && (
        <>
          <DropdownMenuSeparator />
          <DropdownMenuItem variant="destructive" onClick={handleDelete}>
            <span aria-hidden className="mr-1 i-ri-delete-bin-line size-4" />
            {t('operation.delete', { ns: 'common' })}
          </DropdownMenuItem>
        </>
      )}
    </>
  )
}

export default React.memo(Operations)
