import * as React from 'react'
import { useTranslation } from 'react-i18next'
import Divider from '@/app/components/base/divider'

type OperationsProps = {
  openEditModal: () => void
  onDelete: () => void
  onExport: () => void
  onClose?: () => void
}

const Operations = ({
  openEditModal,
  onDelete,
  onExport,
  onClose,
}: OperationsProps) => {
  const { t } = useTranslation()

  const onClickEdit = (e: React.MouseEvent<HTMLDivElement>) => {
    e.stopPropagation()
    e.preventDefault()
    onClose?.()
    openEditModal()
  }

  const onClickExport = (e: React.MouseEvent<HTMLDivElement>) => {
    e.stopPropagation()
    e.preventDefault()
    onClose?.()
    onExport()
  }

  const onClickDelete = (e: React.MouseEvent<HTMLDivElement>) => {
    e.stopPropagation()
    e.preventDefault()
    onClose?.()
    onDelete()
  }

  return (
    <div className="relative flex w-full flex-col rounded-xl border-[0.5px] border-components-panel-border bg-components-panel-bg-blur shadow-lg shadow-shadow-shadow-5">
      <div className="flex flex-col p-1">
        <div
          className="flex cursor-pointer items-center gap-x-1 rounded-lg px-2 py-1.5 hover:bg-state-base-hover"
          onClick={onClickEdit}
        >
          <span className="px-1 system-md-regular text-text-secondary">
            {t('operations.editInfo', { ns: 'datasetPipeline' })}
          </span>
        </div>
        <div
          className="flex cursor-pointer items-center gap-x-1 rounded-lg px-2 py-1.5 hover:bg-state-base-hover"
          onClick={onClickExport}
        >
          <span className="px-1 system-md-regular text-text-secondary">
            {t('operations.exportPipeline', { ns: 'datasetPipeline' })}
          </span>
        </div>
      </div>
      <Divider type="horizontal" className="my-0 bg-divider-subtle" />
      <div className="flex flex-col p-1">
        <div
          className="group flex cursor-pointer items-center gap-x-1 rounded-lg px-2 py-1.5 hover:bg-state-destructive-hover"
          onClick={onClickDelete}
        >
          <span className="px-1 system-md-regular text-text-secondary group-hover:text-text-destructive">
            {t('operation.delete', { ns: 'common' })}
          </span>
        </div>
      </div>
    </div>
  )
}

export default React.memo(Operations)
