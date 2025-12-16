import React from 'react'
import { useTranslation } from 'react-i18next'
import MenuItem from './menu-item'
import { RiDeleteBinLine, RiEditLine, RiFileDownloadLine } from '@remixicon/react'
import Divider from '../../base/divider'
import { useDatasetDetailContextWithSelector } from '@/context/dataset-detail'

type MenuProps = {
  showDelete: boolean
  openRenameModal: () => void
  handleExportPipeline: () => void
  detectIsUsedByApp: () => void
}

const Menu = ({
  showDelete,
  openRenameModal,
  handleExportPipeline,
  detectIsUsedByApp,
}: MenuProps) => {
  const { t } = useTranslation()
  const runtimeMode = useDatasetDetailContextWithSelector(state => state.dataset?.runtime_mode)

  return (
    <div className='flex w-[200px] flex-col rounded-xl border-[0.5px] border-components-panel-border bg-components-panel-bg-blur shadow-lg shadow-shadow-shadow-5 backdrop-blur-[5px]'>
      <div className='flex flex-col p-1'>
        <MenuItem
          Icon={RiEditLine}
          name={t('common.operation.edit')}
          handleClick={openRenameModal}
        />
        {runtimeMode === 'rag_pipeline' && (
          <MenuItem
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
            <MenuItem
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

export default React.memo(Menu)
