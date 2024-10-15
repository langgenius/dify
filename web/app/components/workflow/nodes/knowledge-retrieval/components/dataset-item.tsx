'use client'
import type { FC } from 'react'
import React, { useCallback, useState } from 'react'
import { useBoolean } from 'ahooks'
import {
  RiDeleteBinLine,
  RiEditLine,
} from '@remixicon/react'
import { useTranslation } from 'react-i18next'
import type { DataSet } from '@/models/datasets'
import { DataSourceType } from '@/models/datasets'
import ActionButton, { ActionButtonState } from '@/app/components/base/action-button'
import FileIcon from '@/app/components/base/file-icon'
import { Folder } from '@/app/components/base/icons/src/vender/solid/files'
import SettingsModal from '@/app/components/app/configuration/dataset-config/settings-modal'
import Drawer from '@/app/components/base/drawer'
import useBreakpoints, { MediaType } from '@/hooks/use-breakpoints'
import Badge from '@/app/components/base/badge'
import { useKnowledge } from '@/hooks/use-knowledge'

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
  const { t } = useTranslation()
  const isMobile = media === MediaType.mobile
  const { formatIndexingTechniqueAndMethod } = useKnowledge()
  const [isDeleteHovered, setIsDeleteHovered] = useState(false)

  const [isShowSettingsModal, {
    setTrue: showSettingsModal,
    setFalse: hideSettingsModal,
  }] = useBoolean(false)

  const handleSave = useCallback((newDataset: DataSet) => {
    onChange(newDataset)
    hideSettingsModal()
  }, [hideSettingsModal, onChange])

  const handleRemove = useCallback((e: React.MouseEvent) => {
    e.stopPropagation()
    onRemove()
  }, [onRemove])

  return (
    <div className={`flex items-center h-10 justify-between rounded-xl px-2 border-[0.5px] 
      border-components-panel-border-subtle cursor-pointer group/dataset-item 
      ${isDeleteHovered
      ? 'bg-state-destructive-hover border-state-destructive-border'
      : 'bg-components-panel-on-panel-item-bg hover:bg-components-panel-on-panel-item-bg-hover'
    }`}>
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
          <ActionButton
            onClick={(e) => {
              e.stopPropagation()
              showSettingsModal()
            }}
          >
            <RiEditLine className='w-4 h-4 flex-shrink-0 text-text-tertiary' />
          </ActionButton>
          <ActionButton
            onClick={handleRemove}
            state={ActionButtonState.Destructive}
            onMouseEnter={() => setIsDeleteHovered(true)}
            onMouseLeave={() => setIsDeleteHovered(false)}
          >
            <RiDeleteBinLine className={`w-4 h-4 flex-shrink-0 ${isDeleteHovered ? 'text-text-destructive' : 'text-text-tertiary'}`} />
          </ActionButton>
        </div>
      )}
      {
        payload.indexing_technique && <Badge
          className='group-hover/dataset-item:hidden shrink-0'
          text={formatIndexingTechniqueAndMethod(payload.indexing_technique, payload.retrieval_model_dict?.search_method)}
        />
      }
      {
        payload.provider === 'external' && <Badge
          className='group-hover/dataset-item:hidden shrink-0'
          text={t('dataset.externalTag')}
        />
      }

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
