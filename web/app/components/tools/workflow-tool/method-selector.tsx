import type { FC } from 'react'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { RiArrowDownSLine } from '@remixicon/react'
import cn from '@/utils/classnames'
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
            'hover:bg-background-section-burn flex h-9 min-h-[56px] cursor-pointer items-center gap-1 bg-transparent px-3 py-2',
            open && '!bg-background-section-burn hover:bg-background-section-burn',
          )}>
            <div className={cn('text-text-secondary grow truncate text-[13px] leading-[18px]')}>
              {value === 'llm' ? t('tools.createTool.toolInput.methodParameter') : t('tools.createTool.toolInput.methodSetting')}
            </div>
            <div className='text-text-secondary ml-1 shrink-0 opacity-60'>
              <RiArrowDownSLine className='h-4 w-4' />
            </div>
          </div>
        </PortalToFollowElemTrigger>
        <PortalToFollowElemContent className='z-[1040]'>
          <div className='bg-components-panel-bg-blur border-components-panel-border relative w-[320px] rounded-lg border-[0.5px] shadow-lg  backdrop-blur-sm'>
            <div className='p-1'>
              <div className='hover:bg-components-panel-on-panel-item-bg-hover cursor-pointer rounded-lg py-2.5 pl-3 pr-2' onClick={() => onChange('llm')}>
                <div className='item-center flex gap-1'>
                  <div className='h-4 w-4 shrink-0'>
                    {value === 'llm' && <Check className='text-text-accent h-4 w-4 shrink-0' />}
                  </div>
                  <div className='text-text-secondary text-[13px] font-medium leading-[18px]'>{t('tools.createTool.toolInput.methodParameter')}</div>
                </div>
                <div className='text-text-tertiary pl-5 text-[13px] leading-[18px]'>{t('tools.createTool.toolInput.methodParameterTip')}</div>
              </div>
              <div className='hover:bg-components-panel-on-panel-item-bg-hover cursor-pointer rounded-lg py-2.5 pl-3 pr-2' onClick={() => onChange('form')}>
                <div className='item-center flex gap-1'>
                  <div className='h-4 w-4 shrink-0'>
                    {value === 'form' && <Check className='text-text-accent h-4 w-4 shrink-0' />}
                  </div>
                  <div className='text-text-secondary text-[13px] font-medium leading-[18px]'>{t('tools.createTool.toolInput.methodSetting')}</div>
                </div>
                <div className='text-text-tertiary pl-5 text-[13px] leading-[18px]'>{t('tools.createTool.toolInput.methodSettingTip')}</div>
              </div>
            </div>
          </div>
        </PortalToFollowElemContent>
      </div>
    </PortalToFollowElem>
  )
}

export default MethodSelector
