import type { FC } from 'react'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import cn from 'classnames'
import { RiArrowDownSLine } from '@remixicon/react'
import {
  PortalToFollowElem,
  PortalToFollowElemContent,
  PortalToFollowElemTrigger,
} from '@/app/components/base/portal-to-follow-elem'
import { Check } from '@/app/components/base/icons/src/vender/line/general'

type MethodSelectorProps = {
  value?: string
  onChange: (v: string) => void
}
const MethodSelector: FC<MethodSelectorProps> = ({
  value,
  onChange,
}) => {
  const { t } = useTranslation()
  const [open, setOpen] = useState(false)

  return (
    <PortalToFollowElem
      open={open}
      onOpenChange={setOpen}
      placement='bottom-start'
      offset={4}
    >
      <div className='relative'>
        <PortalToFollowElemTrigger
          onClick={() => setOpen(v => !v)}
          className='block'
        >
          <div className={cn(
            'flex items-center gap-1 min-h-[56px] px-3 py-2 h-9 bg-white cursor-pointer hover:bg-gray-100',
            open && '!bg-gray-100 hover:bg-gray-100',
          )}>
            <div className={cn('grow text-[13px] leading-[18px] text-gray-700 truncate')}>
              {value === 'llm' ? t('tools.createTool.toolInput.methodParameter') : t('tools.createTool.toolInput.methodSetting')}
            </div>
            <div className='shrink-0 ml-1 text-gray-700 opacity-60'>
              <RiArrowDownSLine className='h-4 w-4'/>
            </div>
          </div>
        </PortalToFollowElemTrigger>
        <PortalToFollowElemContent className='z-[1040]'>
          <div className='relative w-[320px] bg-white rounded-lg border-[0.5px] border-gray-200  shadow-lg'>
            <div className='p-1'>
              <div className='pl-3 pr-2 py-2.5 rounded-lg hover:bg-gray-50 cursor-pointer' onClick={() => onChange('llm')}>
                <div className='flex item-center gap-1'>
                  <div className='shrink-0 w-4 h-4'>
                    {value === 'llm' && <Check className='shrink-0 w-4 h-4 text-primary-600'/>}
                  </div>
                  <div className='text-[13px] text-gray-700 font-medium leading-[18px]'>{t('tools.createTool.toolInput.methodParameter')}</div>
                </div>
                <div className='pl-5 text-gray-500 text-[13px] leading-[18px]'>{t('tools.createTool.toolInput.methodParameterTip')}</div>
              </div>
              <div className='pl-3 pr-2 py-2.5 rounded-lg hover:bg-gray-50 cursor-pointer' onClick={() => onChange('form')}>
                <div className='flex item-center gap-1'>
                  <div className='shrink-0 w-4 h-4'>
                    {value === 'form' && <Check className='shrink-0 w-4 h-4 text-primary-600'/>}
                  </div>
                  <div className='text-[13px] text-gray-700 font-medium leading-[18px]'>{t('tools.createTool.toolInput.methodSetting')}</div>
                </div>
                <div className='pl-5 text-gray-500 text-[13px] leading-[18px]'>{t('tools.createTool.toolInput.methodSettingTip')}</div>
              </div>
            </div>
          </div>
        </PortalToFollowElemContent>
      </div>
    </PortalToFollowElem>
  )
}

export default MethodSelector
