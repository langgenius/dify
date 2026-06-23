import {
  RiDeleteBinLine,
  RiEditLine,
  RiFileDownloadLine,
  RiLock2Line,
} from '@remixicon/react'
import * as React from 'react'
import { useTranslation } from '#i18n'
import { useDatasetDetailContextWithSelector } from '@/context/dataset-detail'
import Divider from '../../base/divider'
import MenuItem from './menu-item'

type MenuProps = {
  showEdit?: boolean
  showDelete: boolean
  showExportPipeline?: boolean
  showAccessConfig?: boolean
  openRenameModal: () => void
  handleExportPipeline: () => void
  detectIsUsedByApp: () => void
  openAccessConfig?: () => void
}

const Menu = ({
  showEdit = true,
  showDelete,
  showExportPipeline = true,
  showAccessConfig = false,
  openRenameModal,
  handleExportPipeline,
  detectIsUsedByApp,
  openAccessConfig,
}: MenuProps) => {
  const { t } = useTranslation()
  const runtimeMode = useDatasetDetailContextWithSelector(state => state.dataset?.runtime_mode)

  return (
    <div className="flex w-[200px] flex-col rounded-xl border-[0.5px] border-components-panel-border bg-components-panel-bg-blur shadow-lg shadow-shadow-shadow-5 backdrop-blur-[5px]">
      <div className="flex flex-col p-1">
        {showEdit && (
          <MenuItem
            Icon={RiEditLine}
            name={t('operation.edit', { ns: 'common' })}
            handleClick={openRenameModal}
          />
        )}
        {showExportPipeline && runtimeMode === 'rag_pipeline' && (
          <MenuItem
            Icon={RiFileDownloadLine}
            name={t('operations.exportPipeline', { ns: 'datasetPipeline' })}
            handleClick={handleExportPipeline}
          />
        )}
        {showAccessConfig && (
          <MenuItem
            Icon={RiLock2Line}
            name={t('settings.resourceAccess', { ns: 'common' })}
            handleClick={openAccessConfig}
          />
        )}
      </div>
      {showDelete && (
        <>
          <Divider type="horizontal" className="my-0 bg-divider-subtle" />
          <div className="flex flex-col p-1">
            <MenuItem
              Icon={RiDeleteBinLine}
              name={t('operation.delete', { ns: 'common' })}
              handleClick={detectIsUsedByApp}
            />
          </div>
        </>
      )}
    </div>
  )
}

export default React.memo(Menu)
