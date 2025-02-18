import React, { useEffect, useState } from 'react'
import {
  RiAddLine,
  RiArrowDownSLine,
} from '@remixicon/react'
import { useTranslation } from 'react-i18next'
import { useRouter } from 'next/navigation'
import { ApiConnectionMod } from '@/app/components/base/icons/src/vender/solid/development'
import { useModalContext } from '@/context/modal-context'
import { useExternalKnowledgeApi } from '@/context/external-knowledge-api-context'

type ApiItem = {
  value: string
  name: string
  url: string
}

type ExternalApiSelectProps = {
  items: ApiItem[]
  value?: string
  onSelect: (item: ApiItem) => void
}

const ExternalApiSelect: React.FC<ExternalApiSelectProps> = ({ items, value, onSelect }) => {
  const { t } = useTranslation()
  const [isOpen, setIsOpen] = useState(false)
  const [selectedItem, setSelectedItem] = useState<ApiItem | null>(
    items.find(item => item.value === value) || null,
  )
  const { setShowExternalKnowledgeAPIModal } = useModalContext()
  const { mutateExternalKnowledgeApis } = useExternalKnowledgeApi()
  const router = useRouter()

  useEffect(() => {
    const newSelectedItem = items.find(item => item.value === value) || null
    setSelectedItem(newSelectedItem)
  }, [value, items])

  const handleAddNewAPI = () => {
    setShowExternalKnowledgeAPIModal({
      payload: { name: '', settings: { endpoint: '', api_key: '' } },
      onSaveCallback: async () => {
        mutateExternalKnowledgeApis()
        router.refresh()
      },
      onCancelCallback: () => {
        mutateExternalKnowledgeApis()
      },
      isEditMode: false,
    })
  }

  const handleSelect = (item: ApiItem) => {
    setSelectedItem(item)
    onSelect(item)
    setIsOpen(false)
  }

  return (
    <div className="relative w-full">
      <div
        className={`bg-components-input-bg-normal hover:bg-state-base-hover-alt flex cursor-pointer items-center justify-between gap-0.5 self-stretch rounded-lg 
        px-2 py-1 ${isOpen && 'bg-state-base-hover-alt'}`}
        onClick={() => setIsOpen(!isOpen)}
      >
        {selectedItem
          ? (
            <div className="flex items-center gap-2 self-stretch rounded-lg p-1">
              <ApiConnectionMod className='text-text-secondary h-4 w-4' />
              <div className='flex grow items-center'>
                <span className='text-components-input-text-filled system-sm-regular overflow-hidden text-ellipsis'>{selectedItem.name}</span>
              </div>
            </div>
          )
          : (
            <span className='text-components-input-text-placeholder system-sm-regular'>{t('dataset.selectExternalKnowledgeAPI.placeholder')}</span>
          )}
        <RiArrowDownSLine className={`text-text-quaternary h-4 w-4 transition-transform ${isOpen ? 'text-text-secondary' : ''}`} />
      </div>
      {isOpen && (
        <div className="bg-components-panel-bg-blur absolute z-10 mt-1 w-full rounded-xl border shadow-lg">
          {items.map(item => (
            <div
              key={item.value}
              className="flex cursor-pointer items-center p-1"
              onClick={() => handleSelect(item)}
            >
              <div className="hover:bg-state-base-hover flex w-full items-center gap-2 self-stretch rounded-lg p-2">
                <ApiConnectionMod className='text-text-secondary h-4 w-4' />
                <span className='text-text-secondary system-sm-medium grow overflow-hidden text-ellipsis'>{item.name}</span>
                <span className='text-text-tertiary system-xs-regular overflow-hidden text-ellipsis text-right'>{item.url}</span>
              </div>
            </div>
          ))}
          <div className='flex flex-col items-start self-stretch p-1'>
            <div
              className='hover:bg-state-base-hover flex cursor-pointer items-center gap-2 self-stretch rounded-lg p-2'
              onClick={handleAddNewAPI}
            >
              <RiAddLine className='text-text-secondary h-4 w-4' />
              <span className='text-text-secondary system-sm-medium grow overflow-hidden text-ellipsis'>{t('dataset.createNewExternalAPI')}</span>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

export default ExternalApiSelect
