import Divider from '@/app/components/base/divider'
import React from 'react'
import { useTranslation } from 'react-i18next'

type OperationsProps = {
  openEditModal: () => void
  onDelete: () => void
  onExport: () => void
}

const Operations = ({
  openEditModal,
  onDelete,
  onExport,
}: OperationsProps) => {
  const { t } = useTranslation()

  const onClickEdit = (e: React.MouseEvent<HTMLDivElement>) => {
    e.stopPropagation()
    e.preventDefault()
    openEditModal()
  }

  const onClickExport = (e: React.MouseEvent<HTMLDivElement>) => {
    e.stopPropagation()
    e.preventDefault()
    onExport()
  }

  const onClickDelete = (e: React.MouseEvent<HTMLDivElement>) => {
    e.stopPropagation()
    e.preventDefault()
    onDelete()
  }

  return (
    <div className='relative flex w-full flex-col rounded-xl border-[0.5px] border-components-panel-border bg-components-panel-bg-blur shadow-lg shadow-shadow-shadow-5'>
      <div className='flex flex-col p-1'>
        <div
          className='flex cursor-pointer items-center gap-x-1 rounded-lg px-2 py-1.5 hover:bg-state-base-hover'
          onClick={onClickEdit}
        >
          <span className='system-md-regular px-1 text-text-secondary'>
            {t('datasetPipeline.operations.editInfo')}
          </span>
        </div>
        <div
          className='flex cursor-pointer items-center gap-x-1 rounded-lg px-2 py-1.5 hover:bg-state-base-hover'
          onClick={onClickExport}
        >
          <span className='system-md-regular px-1 text-text-secondary'>
            {t('datasetPipeline.operations.exportPipeline')}
          </span>
        </div>
      </div>
      <Divider type='horizontal' className='my-0 bg-divider-subtle' />
      <div className='flex flex-col p-1'>
        <div
          className='group flex cursor-pointer items-center gap-x-1 rounded-lg px-2 py-1.5 hover:bg-state-destructive-hover'
          onClick={onClickDelete}
        >
          <span className='system-md-regular px-1 text-text-secondary group-hover:text-text-destructive'>
            {t('common.operation.delete')}
          </span>
        </div>
      </div>
    </div>
  )
}

export default React.memo(Operations)
