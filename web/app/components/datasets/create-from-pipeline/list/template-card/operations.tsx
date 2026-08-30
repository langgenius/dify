import { DropdownMenuItem, DropdownMenuSeparator } from '@langgenius/dify-ui/dropdown-menu'
import * as React from 'react'
import { useTranslation } from 'react-i18next'

type OperationsProps = {
  openEditModal: () => void
  onDelete: () => void
  onExport: () => void
  onClose?: () => void
}

const Operations = ({ openEditModal, onDelete, onExport, onClose }: OperationsProps) => {
  const { t } = useTranslation()

  const onClickEdit = () => {
    onClose?.()
    openEditModal()
  }

  const onClickExport = () => {
    onClose?.()
    onExport()
  }

  const onClickDelete = () => {
    onClose?.()
    onDelete()
  }

  return (
    <>
      <DropdownMenuItem onClick={onClickEdit}>
        <span className="system-md-regular text-text-secondary">
          {t(($) => $['operations.editInfo'], { ns: 'datasetPipeline' })}
        </span>
      </DropdownMenuItem>
      <DropdownMenuItem onClick={onClickExport}>
        <span className="system-md-regular text-text-secondary">
          {t(($) => $['operations.exportPipeline'], { ns: 'datasetPipeline' })}
        </span>
      </DropdownMenuItem>
      <DropdownMenuSeparator />
      <DropdownMenuItem variant="destructive" onClick={onClickDelete}>
        <span className="system-md-regular">
          {t(($) => $['operation.delete'], { ns: 'common' })}
        </span>
      </DropdownMenuItem>
    </>
  )
}

export default React.memo(Operations)
