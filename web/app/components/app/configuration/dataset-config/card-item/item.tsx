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
import cn from '@/utils/classnames'

type ItemProps = {
  className?: string
  config: DataSet
  onRemove: (id: string) => void
  readonly?: boolean
  onSave: (newDataset: DataSet) => void
  editable?: boolean
}

const Item: FC<ItemProps> = ({
  config,
  onSave,
  onRemove,
  editable = true,
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

  const [isDeleting, setIsDeleting] = useState(false)

  return (
    <div className={cn('bg-components-panel-on-panel-item-bg border-components-panel-border-subtle shadow-xs hover:bg-components-panel-on-panel-item-bg-hover group relative  mb-1 flex w-full items-center rounded-lg border-[0.5px] py-2 pl-2.5 pr-3 last-of-type:mb-0 hover:shadow-sm', isDeleting && 'hover:bg-state-destructive-hover border-state-destructive-border')}>
      {
        config.data_source_type === DataSourceType.FILE && (
          <div className='mr-2 flex h-6 w-6 shrink-0 items-center justify-center rounded-md border-[0.5px] border-[#E0EAFF] bg-[#F5F8FF]'>
            <Folder className='h-4 w-4 text-[#444CE7]' />
          </div>
        )
      }
      {
        config.data_source_type === DataSourceType.NOTION && (
          <div className='mr-2 flex h-6 w-6 shrink-0 items-center justify-center rounded-md border-[0.5px] border-[#EAECF5]'>
            <FileIcon type='notion' className='h-4 w-4' />
          </div>
        )
      }
      {
        config.data_source_type === DataSourceType.WEB && (
          <div className='mr-2 flex h-6 w-6 shrink-0 items-center justify-center rounded-md border-[0.5px] border-blue-100 bg-[#F5FAFF]'>
            <Globe06 className='h-4 w-4 text-blue-600' />
          </div>
        )
      }
      <div className='grow'>
        <div className='flex h-[18px] items-center'>
          <div className='text-text-secondary grow truncate text-[13px] font-medium' title={config.name}>{config.name}</div>
          {config.provider === 'external'
            ? <Badge text={t('dataset.externalTag') as string} />
            : <Badge
              text={formatIndexingTechniqueAndMethod(config.indexing_technique, config.retrieval_model_dict?.search_method)}
            />}
        </div>
      </div >
      <div className='absolute bottom-0 right-0 top-0 hidden w-[124px] items-center justify-end rounded-lg bg-gradient-to-r from-white/50 to-white to-50% pr-2 group-hover:flex'>
        {
          editable && <div
            className='mr-1 flex h-6 w-6 cursor-pointer items-center justify-center rounded-md hover:bg-black/5'
            onClick={() => setShowSettingsModal(true)}
          >
            <RiEditLine className='text-text-tertiary h-4 w-4' />
          </div>
        }
        <div
          className='text-text-tertiary hover:text-text-destructive flex h-6 w-6  cursor-pointer items-center justify-center'
          onClick={() => onRemove(config.id)}
          onMouseOver={() => setIsDeleting(true)}
          onMouseLeave={() => setIsDeleting(false)}
        >
          <RiDeleteBinLine className='h-4 w-4' />
        </div>
      </div>
      <Drawer isOpen={showSettingsModal} onClose={() => setShowSettingsModal(false)} footer={null} mask={isMobile} panelClassname='mt-16 mx-2 sm:mr-2 mb-3 !p-0 !max-w-[640px] rounded-xl'>
        <SettingsModal
          currentDataset={config}
          onCancel={() => setShowSettingsModal(false)}
          onSave={handleSave}
        />
      </Drawer>
    </div >
  )
}

export default Item
