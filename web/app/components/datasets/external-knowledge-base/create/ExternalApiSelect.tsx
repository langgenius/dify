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
        className={`flex items-center justify-between cursor-pointer px-2 py-1 gap-0.5 self-stretch rounded-lg 
        bg-components-input-bg-normal hover:bg-state-base-hover-alt ${isOpen && 'bg-state-base-hover-alt'}`}
        onClick={() => setIsOpen(!isOpen)}
      >
        {selectedItem
          ? (
            <div className="flex p-1 items-center gap-2 self-stretch rounded-lg">
              <ApiConnectionMod className='text-text-secondary w-4 h-4' />
              <div className='flex items-center flex-grow'>
                <span className='text-components-input-text-filled text-ellipsis system-sm-regular overflow-hidden'>{selectedItem.name}</span>
              </div>
            </div>
          )
          : (
            <span className='text-components-input-text-placeholder system-sm-regular'>{t('dataset.selectExternalKnowledgeAPI.placeholder')}</span>
          )}
        <RiArrowDownSLine className={`w-4 h-4 text-text-quaternary transition-transform ${isOpen ? 'text-text-secondary' : ''}`} />
      </div>
      {isOpen && (
        <div className="absolute z-10 w-full mt-1 bg-components-panel-bg-blur border rounded-xl shadow-lg">
          {items.map(item => (
            <div
              key={item.value}
              className="flex p-1 items-center cursor-pointer"
              onClick={() => handleSelect(item)}
            >
              <div className="flex p-2 items-center gap-2 self-stretch rounded-lg hover:bg-state-base-hover w-full">
                <ApiConnectionMod className='text-text-secondary w-4 h-4' />
                <span className='text-text-secondary text-ellipsis system-sm-medium overflow-hidden flex-grow'>{item.name}</span>
                <span className='text-text-tertiary overflow-hidden text-right text-ellipsis system-xs-regular'>{item.url}</span>
              </div>
            </div>
          ))}
          <div className='flex p-1 flex-col items-start self-stretch'>
            <div
              className='flex p-2 items-center gap-2 self-stretch rounded-lg cursor-pointer hover:bg-state-base-hover'
              onClick={handleAddNewAPI}
            >
              <RiAddLine className='text-text-secondary w-4 h-4' />
              <span className='flex-grow overflow-hidden text-text-secondary text-ellipsis system-sm-medium'>{t('dataset.createNewExternalAPI')}</span>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

export default ExternalApiSelect
