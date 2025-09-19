import Divider from '@/app/components/base/divider'
import React from 'react'
import { useTranslation } from 'react-i18next'
import { RiDeleteBinLine, RiEditLine, RiFileDownloadLine } from '@remixicon/react'
import OperationItem from './operation-item'

type OperationsProps = {
  showDelete: boolean
  showExportPipeline: boolean
  openRenameModal: () => void
  handleExportPipeline: () => void
  detectIsUsedByApp: () => void
}

const Operations = ({
  showDelete,
  showExportPipeline,
  openRenameModal,
  handleExportPipeline,
  detectIsUsedByApp,
}: OperationsProps) => {
  const { t } = useTranslation()

  return (
    <div className='relative flex w-full flex-col rounded-xl border-[0.5px] border-components-panel-border bg-components-panel-bg-blur shadow-lg shadow-shadow-shadow-5'>
      <div className='flex flex-col p-1'>
        <OperationItem
          Icon={RiEditLine}
          name={t('common.operation.edit')}
          handleClick={openRenameModal}
        />
        {showExportPipeline && (
          <OperationItem
            Icon={RiFileDownloadLine}
            name={t('datasetPipeline.operations.exportPipeline')}
            handleClick={handleExportPipeline}
          />
        )}
      </div>
      {showDelete && (
        <>
          <Divider type='horizontal' className='my-0 bg-divider-subtle' />
          <div className='flex flex-col p-1'>
            <OperationItem
              Icon={RiDeleteBinLine}
              name={t('common.operation.delete')}
              handleClick={detectIsUsedByApp}
            />
          </div>
        </>
      )}
    </div>
  )
}

export default React.memo(Operations)
