import type { FC } from 'react'
import { useContext } from 'use-context-selector'
import type { ModelItem } from '../declarations'
import {
  languageMaps,
} from '../utils'
import ModelBadge from '../model-badge'
import I18n from '@/context/i18n'
// import { AlertTriangle } from '@/app/components/base/icons/src/vender/solid/alertsAndFeedback'
import { ChevronDown } from '@/app/components/base/icons/src/vender/line/arrows'

type ModelTriggerProps = {
  open: boolean
  model: ModelItem
}
const ModelTrigger: FC<ModelTriggerProps> = ({
  open,
  model,
}) => {
  const { locale } = useContext(I18n)
  const language = languageMaps[locale]

  return (
    <div
      className={`
        flex items-center px-2 h-8 rounded-lg bg-gray-100 hover:bg-gray-200 cursor-pointer
        ${open && '!bg-gray-200'}
      `}
    >
      <div className='grow flex items-center'>
        <div className='mr-1.5 w-4 h-4'></div>
        <div
          className='text-[13px] font-medium text-gray-800 truncate'
          title={model.label[language]}
        >
          {model.label[language]}
        </div>
        {
          model.model_properties.mode && (
            <ModelBadge className='mr-0.5'>
              {(model.model_properties.mode as string).toLocaleUpperCase()}
            </ModelBadge>
          )
        }
      </div>
      <div className='shrink-0 flex items-center justify-center w-4 h-4'>
        <ChevronDown
          className='w-3.5 h-3.5 text-gray-500'
        />
      </div>
    </div>
  )
}

export default ModelTrigger
