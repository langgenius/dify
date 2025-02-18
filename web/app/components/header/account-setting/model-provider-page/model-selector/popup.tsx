import type { FC } from 'react'
import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import {
  RiArrowRightUpLine,
  RiSearchLine,
} from '@remixicon/react'
import type {
  DefaultModel,
  Model,
  ModelItem,
} from '../declarations'
import { ModelFeatureEnum } from '../declarations'
import { useLanguage } from '../hooks'
import PopupItem from './popup-item'
import { XCircle } from '@/app/components/base/icons/src/vender/solid/general'
import { useModalContext } from '@/context/modal-context'

type PopupProps = {
  defaultModel?: DefaultModel
  modelList: Model[]
  onSelect: (provider: string, model: ModelItem) => void
  scopeFeatures?: string[]
  onHide: () => void
}
const Popup: FC<PopupProps> = ({
  defaultModel,
  modelList,
  onSelect,
  scopeFeatures = [],
  onHide,
}) => {
  const { t } = useTranslation()
  const language = useLanguage()
  const [searchText, setSearchText] = useState('')
  const { setShowAccountSettingModal } = useModalContext()

  const filteredModelList = useMemo(() => {
    return modelList.map((model) => {
      const filteredModels = model.models
        .filter((modelItem) => {
          if (modelItem.label[language] !== undefined)
            return modelItem.label[language].toLowerCase().includes(searchText.toLowerCase())
          return Object.values(modelItem.label).some(label =>
            label.toLowerCase().includes(searchText.toLowerCase()),
          )
        })
        .filter((modelItem) => {
          if (scopeFeatures.length === 0)
            return true
          return scopeFeatures.every((feature) => {
            if (feature === ModelFeatureEnum.toolCall)
              return modelItem.features?.some(featureItem => featureItem === ModelFeatureEnum.toolCall || featureItem === ModelFeatureEnum.multiToolCall)
            return modelItem.features?.some(featureItem => featureItem === feature)
          })
        })
      return { ...model, models: filteredModels }
    }).filter(model => model.models.length > 0)
  }, [language, modelList, scopeFeatures, searchText])

  return (
    <div className='border-components-panel-border bg-components-panel-bg max-h-[480px] w-[320px] overflow-y-auto rounded-lg border-[0.5px] shadow-lg'>
      <div className='bg-components-panel-bg sticky top-0 z-10 pb-1 pl-3 pr-2 pt-3'>
        <div className={`
          flex h-8 items-center rounded-lg border pl-[9px] pr-[10px]
          ${searchText ? 'bg-components-input-bg-active border-components-input-border-active shadow-xs' : 'bg-components-input-bg-normal border-transparent'}
        `}>
          <RiSearchLine
            className={`
              mr-[7px] h-[14px] w-[14px] shrink-0
              ${searchText ? 'text-text-tertiary' : 'text-text-quaternary'}
            `}
          />
          <input
            className='text-text-primary block h-[18px] grow appearance-none bg-transparent text-[13px] outline-none'
            placeholder='Search model'
            value={searchText}
            onChange={e => setSearchText(e.target.value)}
          />
          {
            searchText && (
              <XCircle
                className='text-text-quaternary ml-1.5 h-[14px] w-[14px] shrink-0 cursor-pointer'
                onClick={() => setSearchText('')}
              />
            )
          }
        </div>
      </div>
      <div className='p-1'>
        {
          filteredModelList.map(model => (
            <PopupItem
              key={model.provider}
              defaultModel={defaultModel}
              model={model}
              onSelect={onSelect}
            />
          ))
        }
        {
          !filteredModelList.length && (
            <div className='text-text-tertiary break-all px-3 py-1.5 text-center text-xs leading-[18px]'>
              {`No model found for “${searchText}”`}
            </div>
          )
        }
      </div>
      <div className='border-divider-subtle text-text-accent-light-mode-only bg-components-panel-bg sticky bottom-0 flex cursor-pointer items-center rounded-b-lg border-t px-4 py-2' onClick={() => {
        onHide()
        setShowAccountSettingModal({ payload: 'provider' })
      }}>
        <span className='system-xs-medium'>{t('common.model.settingsLink')}</span>
        <RiArrowRightUpLine className='ml-0.5 h-3 w-3' />
      </div>
    </div>
  )
}

export default Popup
