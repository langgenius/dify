'use client'
import type { FC } from 'react'
import React, { useState } from 'react'
import {
  RiDeleteBinLine,
  RiEditLine,
} from '@remixicon/react'
import { useTranslation } from 'react-i18next'
import SettingsModal from '../settings-modal'
import type { DataSet } from '@/models/datasets'
import { DataSourceType } from '@/models/datasets'
import FileIcon from '@/app/components/base/file-icon'
import { Folder } from '@/app/components/base/icons/src/vender/solid/files'
import { Globe06 } from '@/app/components/base/icons/src/vender/solid/mapsAndTravel'
import Drawer from '@/app/components/base/drawer'
import useBreakpoints, { MediaType } from '@/hooks/use-breakpoints'
import Badge from '@/app/components/base/badge'
import { useKnowledge } from '@/hooks/use-knowledge'

type ItemProps = {
  className?: string
  config: DataSet
  onRemove: (id: string) => void
  readonly?: boolean
  onSave: (newDataset: DataSet) => void
}

const Item: FC<ItemProps> = ({
  config,
  onSave,
  onRemove,
}) => {
  const media = useBreakpoints()
  const isMobile = media === MediaType.mobile
  const [showSettingsModal, setShowSettingsModal] = useState(false)
  const { formatIndexingTechniqueAndMethod } = useKnowledge()
  const { t } = useTranslation()

  const handleSave = (newDataset: DataSet) => {
    onSave(newDataset)
    setShowSettingsModal(false)
  }

  return (
    <div className='group relative flex items-center mb-1 last-of-type:mb-0  pl-2.5 py-2 pr-3 w-full bg-white rounded-lg border-[0.5px] border-gray-200 shadow-xs'>
      {
        config.data_source_type === DataSourceType.FILE && (
          <div className='shrink-0 flex items-center justify-center mr-2 w-6 h-6 bg-[#F5F8FF] rounded-md border-[0.5px] border-[#E0EAFF]'>
            <Folder className='w-4 h-4 text-[#444CE7]' />
          </div>
        )
      }
      {
        config.data_source_type === DataSourceType.NOTION && (
          <div className='shrink-0 flex items-center justify-center mr-2 w-6 h-6 rounded-md border-[0.5px] border-[#EAECF5]'>
            <FileIcon type='notion' className='w-4 h-4' />
          </div>
        )
      }
      {
        config.data_source_type === DataSourceType.WEB && (
          <div className='shrink-0 flex items-center justify-center mr-2 w-6 h-6 bg-[#F5FAFF] border-[0.5px] border-blue-100 rounded-md'>
            <Globe06 className='w-4 h-4 text-blue-600' />
          </div>
        )
      }
      <div className='grow'>
        <div className='flex items-center h-[18px]'>
          <div className='grow text-[13px] font-medium text-gray-800 truncate' title={config.name}>{config.name}</div>
          {config.provider === 'external'
            ? <Badge text={t('dataset.externalTag')}></Badge>
            : <Badge
              text={formatIndexingTechniqueAndMethod(config.indexing_technique, config.retrieval_model_dict?.search_method)}
            />}
        </div>
      </div>
      <div className='hidden rounded-lg group-hover:flex items-center justify-end absolute right-0 top-0 bottom-0 pr-2 w-[124px] bg-gradient-to-r from-white/50 to-white to-50%'>
        <div
          className='flex items-center justify-center mr-1 w-6 h-6 hover:bg-black/5 rounded-md cursor-pointer'
          onClick={() => setShowSettingsModal(true)}
        >
          <RiEditLine className='w-4 h-4 text-gray-500' />
        </div>
        <div
          className='group/action flex items-center justify-center w-6 h-6 hover:bg-[#FEE4E2] rounded-md cursor-pointer'
          onClick={() => onRemove(config.id)}
        >
          <RiDeleteBinLine className='w-4 h-4 text-gray-500 group-hover/action:text-[#D92D20]' />
        </div>
      </div>
      <Drawer isOpen={showSettingsModal} onClose={() => setShowSettingsModal(false)} footer={null} mask={isMobile} panelClassname='mt-16 mx-2 sm:mr-2 mb-3 !p-0 !max-w-[640px] rounded-xl'>
        <SettingsModal
          currentDataset={config}
          onCancel={() => setShowSettingsModal(false)}
          onSave={handleSave}
        />
      </Drawer>
    </div>
  )
}

export default Item
