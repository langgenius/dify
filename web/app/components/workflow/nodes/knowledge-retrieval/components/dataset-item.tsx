'use client'
import type { FC } from 'react'
import React, { useCallback } from 'react'
import { useBoolean } from 'ahooks'
import type { DataSet } from '@/models/datasets'
import { DataSourceType } from '@/models/datasets'
import { Settings01, Trash03 } from '@/app/components/base/icons/src/vender/line/general'
import FileIcon from '@/app/components/base/file-icon'
import { Folder } from '@/app/components/base/icons/src/vender/solid/files'
import SettingsModal from '@/app/components/app/configuration/dataset-config/settings-modal'
import Drawer from '@/app/components/base/drawer'
import useBreakpoints, { MediaType } from '@/hooks/use-breakpoints'

type Props = {
  payload: DataSet
  onRemove: () => void
  onChange: (dataSet: DataSet) => void
  readonly?: boolean
}

const DatasetItem: FC<Props> = ({
  payload,
  onRemove,
  onChange,
  readonly,
}) => {
  const media = useBreakpoints()
  const isMobile = media === MediaType.mobile

  const [isShowSettingsModal, {
    setTrue: showSettingsModal,
    setFalse: hideSettingsModal,
  }] = useBoolean(false)

  const handleSave = useCallback((newDataset: DataSet) => {
    onChange(newDataset)
    hideSettingsModal()
  }, [hideSettingsModal, onChange])

  return (
    <div className='flex items-center h-10 justify-between rounded-xl px-2 bg-white border border-gray-200  cursor-pointer group/dataset-item'>
      <div className='w-0 grow flex items-center space-x-1.5'>
        {
          payload.data_source_type === DataSourceType.NOTION
            ? (
              <div className='shrink-0 flex items-center justify-center w-6 h-6 rounded-md border-[0.5px] border-[#EAECF5]'>
                <FileIcon type='notion' className='w-4 h-4' />
              </div>
            )
            : <div className='shrink-0 flex items-center justify-center w-6 h-6 bg-[#F5F8FF] rounded-md border-[0.5px] border-[#E0EAFF]'>
              <Folder className='w-4 h-4 text-[#444CE7]' />
            </div>
        }
        <div className='w-0 grow text-[13px] font-normal text-gray-800 truncate'>{payload.name}</div>
      </div>
      {!readonly && (
        <div className='hidden group-hover/dataset-item:flex shrink-0 ml-2  items-center space-x-1'>
          <div
            className='flex items-center justify-center w-6 h-6 hover:bg-black/5 rounded-md cursor-pointer'
            onClick={showSettingsModal}
          >
            <Settings01 className='w-4 h-4 text-gray-500' />
          </div>
          <div
            className='flex items-center justify-center w-6 h-6 hover:bg-black/5 rounded-md cursor-pointer'
            onClick={onRemove}
          >
            <Trash03 className='w-4 h-4 text-gray-500' />
          </div>
        </div>
      )}

      {isShowSettingsModal && (
        <Drawer isOpen={isShowSettingsModal} onClose={hideSettingsModal} footer={null} mask={isMobile} panelClassname='mt-16 mx-2 sm:mr-2 mb-3 !p-0 !max-w-[640px] rounded-xl'>
          <SettingsModal
            currentDataset={payload}
            onCancel={hideSettingsModal}
            onSave={handleSave}
          />
        </Drawer>
      )}
    </div>
  )
}
export default React.memo(DatasetItem)
