import * as React from 'react'
import { useTranslation } from 'react-i18next'
import Divider from '@/app/components/base/divider'
import OperationItem from './operation-item'

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
    <div className="relative flex w-full flex-col rounded-xl border-[0.5px] border-components-panel-border bg-components-panel-bg-blur shadow-lg shadow-shadow-shadow-5">
      <div className="flex flex-col p-1">
        <OperationItem
          iconClassName="i-ri-edit-line"
          name={t('operation.edit', { ns: 'common' })}
          handleClick={handleRename}
        />
        {showExportPipeline && (
          <OperationItem
            iconClassName="i-ri-file-download-line"
            name={t('operations.exportPipeline', { ns: 'datasetPipeline' })}
            handleClick={handleExport}
          />
        )}
      </div>
      {showDelete && (
        <>
          <Divider type="horizontal" className="my-0 bg-divider-subtle" />
          <div className="flex flex-col p-1">
            <OperationItem
              iconClassName="i-ri-delete-bin-line"
              name={t('operation.delete', { ns: 'common' })}
              handleClick={handleDelete}
            />
          </div>
        </>
      )}
    </div>
  )
}

export default React.memo(Operations)
