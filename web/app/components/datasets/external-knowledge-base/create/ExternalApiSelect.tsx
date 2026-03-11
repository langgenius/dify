import {
  RiAddLine,
  RiArrowDownSLine,
} from '@remixicon/react'
import { useRouter } from 'next/navigation'
import * as React from 'react'
import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { ApiConnectionMod } from '@/app/components/base/icons/src/vender/solid/development'
import { useExternalKnowledgeApi } from '@/context/external-knowledge-api-context'
import { useModalContext } from '@/context/modal-context'

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
        className={`flex cursor-pointer items-center justify-between gap-0.5 self-stretch rounded-lg bg-components-input-bg-normal px-2
        py-1 hover:bg-state-base-hover-alt ${isOpen && 'bg-state-base-hover-alt'}`}
        onClick={() => setIsOpen(!isOpen)}
      >
        {selectedItem
          ? (
              <div className="flex items-center gap-2 self-stretch rounded-lg p-1">
                <ApiConnectionMod className="h-4 w-4 text-text-secondary" />
                <div className="flex grow items-center">
                  <span className="system-sm-regular overflow-hidden text-ellipsis text-components-input-text-filled">{selectedItem.name}</span>
                </div>
              </div>
            )
          : (
              <span className="system-sm-regular text-components-input-text-placeholder">{t('selectExternalKnowledgeAPI.placeholder', { ns: 'dataset' })}</span>
            )}
        <RiArrowDownSLine className={`h-4 w-4 text-text-quaternary transition-transform ${isOpen ? 'text-text-secondary' : ''}`} />
      </div>
      {isOpen && (
        <div className="absolute z-10 mt-1 w-full rounded-xl border bg-components-panel-bg-blur shadow-lg">
          {items.map(item => (
            <div
              key={item.value}
              className="flex cursor-pointer items-center p-1"
              onClick={() => handleSelect(item)}
            >
              <div className="flex w-full items-center gap-2 self-stretch rounded-lg p-2 hover:bg-state-base-hover">
                <ApiConnectionMod className="h-4 w-4 text-text-secondary" />
                <span className="system-sm-medium grow overflow-hidden text-ellipsis text-text-secondary">{item.name}</span>
                <span className="system-xs-regular overflow-hidden text-ellipsis text-right text-text-tertiary">{item.url}</span>
              </div>
            </div>
          ))}
          <div className="flex flex-col items-start self-stretch p-1">
            <div
              className="flex cursor-pointer items-center gap-2 self-stretch rounded-lg p-2 hover:bg-state-base-hover"
              onClick={handleAddNewAPI}
            >
              <RiAddLine className="h-4 w-4 text-text-secondary" />
              <span className="system-sm-medium grow overflow-hidden text-ellipsis text-text-secondary">{t('createNewExternalAPI', { ns: 'dataset' })}</span>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

export default ExternalApiSelect
