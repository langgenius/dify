import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import AddModal from './add-modal'
import Switch from '@/app/components/base/switch'
import TooltipPlus from '@/app/components/base/tooltip-plus'
import { Tool03 } from '@/app/components/base/icons/src/vender/solid/general'
import {
  HelpCircle,
  Plus,
  Settings01,
  Trash03,
} from '@/app/components/base/icons/src/vender/line/general'
import { ChevronDown } from '@/app/components/base/icons/src/vender/line/arrows'

const Tools = () => {
  const { t } = useTranslation()
  const [expanded, setExpanded] = useState(true)
  const [showModal, setShowModal] = useState(false)

  const items = [
    {
      name: 'Data Search',
      variableName: 'extradata',
      enabled: true,
    },
    {
      name: 'File Reader',
      variableName: 'file_reader',
      enable: true,
    },
    {
      name: 'Calenader',
      variableName: 'calenader',
      enable: false,
    },
  ]

  return (
    <div className='mt-3 px-3 rounded-xl bg-gray-50'>
      <div className='flex items-center h-12'>
        <div className='grow flex items-center'>
          <div
            className='group flex items-center justify-center mr-1 w-6 h-6 rounded-md hover:shadow-xs hover:bg-white'
            onClick={() => setExpanded(v => !v)}
          >
            <Tool03 className='group-hover:hidden w-4 h-4 text-[#444CE7]' />
            <ChevronDown className={`hidden group-hover:block w-4 h-4 text-primary-600 ${expanded ? 'rotate-180' : 'rotate-0'}`} />
          </div>
          <div className='mr-1 text-sm font-semibold text-gray-800'>
            {t('appDebug.feature.tools.title')}
          </div>
          <HelpCircle className='w-3.5 h-3.5 text-gray-400' />
        </div>
        {
          !expanded && (
            <>
              <div className='mr-3 text-xs text-gray-500'>{t('appDebug.feature.tools.toolsInUse', { count: items.length })}</div>
              <div className='mr-1 w-[1px] h-3.5 bg-gray-200' />
            </>
          )
        }
        <div
          className='flex items-center h-7 px-3 text-xs font-medium text-gray-700 cursor-pointer'
          onClick={() => setShowModal(true)}
        >
          <Plus className='mr-[5px] w-3.5 h-3.5 ' />
          {t('common.operation.add')}
        </div>
      </div>
      {
        expanded && (
          <div className='pb-3'>
            {
              items.map(item => (
                <div
                  key={item.variableName}
                  className='group flex items-center mb-1 last-of-type:mb-0 px-2.5 py-2 rounded-lg border-[0.5px] border-gray-200 bg-white shadow-xs'
                >
                  <div className='grow flex items-center'>
                    <div className='mr-2 w-6 h-6 rounded-md border-[0.5px] border-black/5'></div>
                    <div className='mr-2 text-[13px] font-medium text-gray-800'>{item.name}</div>
                    <TooltipPlus popupContent='111'>
                      <div className='text-xs text-gray-500'>{item.variableName}</div>
                    </TooltipPlus>
                  </div>
                  <div
                    className='hidden group-hover:flex items-center justify-center mr-1 w-6 h-6 hover:bg-black/5 rounded-md cursor-pointer'
                    onClick={() => {}}
                  >
                    <Settings01 className='w-4 h-4 text-gray-500' />
                  </div>
                  <div
                    className='hidden group/action group-hover:flex items-center justify-center w-6 h-6 hover:bg-[#FEE4E2] rounded-md cursor-pointer'
                  >
                    <Trash03 className='w-4 h-4 text-gray-500 group-hover/action:text-[#D92D20]' />
                  </div>
                  <div className='hidden group-hover:block ml-2 mr-3 w-[1px] h-3.5 bg-gray-200' />
                  <Switch size='l' onChange={() => {}} />
                </div>
              ))
            }
          </div>
        )
      }
      {
        showModal && (
          <AddModal onCancel={() => setShowModal(false)} />
        )
      }
    </div>
  )
}

export default Tools
