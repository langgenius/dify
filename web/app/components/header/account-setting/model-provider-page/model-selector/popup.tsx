import type { FC } from 'react'
import { useState } from 'react'
import {
  RiSearchLine,
} from '@remixicon/react'
import type {
  DefaultModel,
  Model,
  ModelItem,
} from '../declarations'
import { useLanguage } from '../hooks'
import PopupItem from './popup-item'
import { XCircle } from '@/app/components/base/icons/src/vender/solid/general'

type PopupProps = {
  defaultModel?: DefaultModel
  modelList: Model[]
  onSelect: (provider: string, model: ModelItem) => void
}
const Popup: FC<PopupProps> = ({
  defaultModel,
  modelList,
  onSelect,
}) => {
  const language = useLanguage()
  const [searchText, setSearchText] = useState('')

  const filteredModelList = modelList.map((model) => {
    const filteredModels = model.models.filter((modelItem) => {
      if (modelItem.label[language] !== undefined)
        return modelItem.label[language].toLowerCase().includes(searchText.toLowerCase())

      return Object.values(modelItem.label).some(label =>
        label.toLowerCase().includes(searchText.toLowerCase()),
      )
    })

    return { ...model, models: filteredModels }
  }).filter(model => model.models.length > 0)

  return (
    <div className='w-[320px] max-h-[480px] rounded-lg border-[0.5px] border-gray-200 bg-white shadow-lg overflow-y-auto'>
      <div className='sticky top-0 pl-3 pt-3 pr-2 pb-1 bg-white z-10'>
        <div className={`
          flex items-center pl-[9px] pr-[10px] h-8 rounded-lg border
          ${searchText ? 'bg-white border-gray-300 shadow-xs' : 'bg-gray-100 border-transparent'}
        `}>
          <RiSearchLine
            className={`
              shrink-0 mr-[7px] w-[14px] h-[14px]
              ${searchText ? 'text-gray-500' : 'text-gray-400'}
            `}
          />
          <input
            className='block grow h-[18px] text-[13px] appearance-none outline-none bg-transparent'
            placeholder='Search model'
            value={searchText}
            onChange={e => setSearchText(e.target.value)}
          />
          {
            searchText && (
              <XCircle
                className='shrink-0 ml-1.5 w-[14px] h-[14px] text-gray-400 cursor-pointer'
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
            <div className='px-3 py-1.5 leading-[18px] text-center text-xs text-gray-500 break-all'>
              {`No model found for “${searchText}”`}
            </div>
          )
        }
      </div>
    </div>
  )
}

export default Popup
