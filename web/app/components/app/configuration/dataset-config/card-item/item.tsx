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
import ActionButton, { ActionButtonState } from '@/app/components/base/action-button'
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
    <div className={cn(
      'group relative mb-1 flex h-10 w-full cursor-pointer items-center justify-between rounded-lg border-[0.5px] border-components-panel-border-subtle bg-components-panel-on-panel-item-bg px-2 last-of-type:mb-0 hover:bg-components-panel-on-panel-item-bg-hover',
      isDeleting && 'border-state-destructive-border hover:bg-state-destructive-hover',
    )}>
      <div className='flex w-0 grow items-center space-x-1.5'>
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
        <div className='system-sm-medium w-0 grow truncate text-text-secondary' title={config.name}>{config.name}</div>
      </div>
      <div className='ml-2 hidden shrink-0 items-center space-x-1 group-hover:flex'>
        {
          editable && <ActionButton
            onClick={(e) => {
              e.stopPropagation()
              setShowSettingsModal(true)
            }}
          >
            <RiEditLine className='h-4 w-4 shrink-0 text-text-tertiary' />
          </ActionButton>
        }
        <ActionButton
          onClick={() => onRemove(config.id)}
          state={isDeleting ? ActionButtonState.Destructive : ActionButtonState.Default}
          onMouseEnter={() => setIsDeleting(true)}
          onMouseLeave={() => setIsDeleting(false)}
        >
          <RiDeleteBinLine className={cn('h-4 w-4 shrink-0 text-text-tertiary', isDeleting && 'text-text-destructive')} />
        </ActionButton>
      </div>
      {
        config.indexing_technique && <Badge
          className='shrink-0 group-hover:hidden'
          text={formatIndexingTechniqueAndMethod(config.indexing_technique, config.retrieval_model_dict?.search_method)}
        />
      }
      {
        config.provider === 'external' && <Badge
          className='shrink-0 group-hover:hidden'
          text={t('dataset.externalTag') as string}
        />
      }
      <Drawer isOpen={showSettingsModal} onClose={() => setShowSettingsModal(false)} footer={null} mask={isMobile} panelClassName='mt-16 mx-2 sm:mr-2 mb-3 !p-0 !max-w-[640px] rounded-xl'>
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
