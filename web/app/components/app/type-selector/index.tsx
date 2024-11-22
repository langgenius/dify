import { useTranslation } from 'react-i18next'
import React, { useState } from 'react'
import { RiArrowDownSLine, RiFilter3Line } from '@remixicon/react'
import cn from '@/utils/classnames'
import {
  PortalToFollowElem,
  PortalToFollowElemContent,
  PortalToFollowElemTrigger,
} from '@/app/components/base/portal-to-follow-elem'
import { Check } from '@/app/components/base/icons/src/vender/line/general'
import { XCircle } from '@/app/components/base/icons/src/vender/solid/general'
import { ChatBot, CuteRobot } from '@/app/components/base/icons/src/vender/solid/communication'
import { Route } from '@/app/components/base/icons/src/vender/solid/mapsAndTravel'
export type AppSelectorProps = {
  value: string
  className?: string
  onChange: (value: string) => void
}

const AppTypeSelector = ({ value, className, onChange }: AppSelectorProps) => {
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
            'flex items-center justify-between gap-1 h-8 rounded-md system-sm-medium text-text-tertiary cursor-pointer px-2 hover:bg-state-base-hover',
            className,
          )}>
            {!value && (
              <>
                <RiFilter3Line className='w-4 h-4' />
                <div className='flex-1 min-w-[65px] text-center'>{t('app.typeSelector.all')}</div>
                <div className='w-4 h-4 p-[1px]'>
                  <RiArrowDownSLine className='w-4 h-4' />
                </div>
              </>
            )}
            {value === 'chatbot' && (
              <>
                <div className='w-4 h-4 p-[1px]'>
                  <ChatBot className='w-3.5 h-3.5 text-[#1570EF]' />
                </div>
                <div className=''>{t('app.typeSelector.chatbot')}</div>
                <div className='w-4 h-4 p-[1px]' onClick={(e) => {
                  e.stopPropagation()
                  onChange('')
                }}>
                  <XCircle className='w-3.5 h-3.5 text-gray-400 cursor-pointer  hover:text-gray-600' />
                </div>
              </>
            )}
            {value === 'agent' && (
              <>
                <div className='w-4 h-4 p-[1px]'>
                  <CuteRobot className='w-3.5 h-3.5 text-indigo-600' />
                </div>
                <div className=''>{t('app.typeSelector.agent')}</div>
                <div className='w-4 h-4 p-[1px]' onClick={(e) => {
                  e.stopPropagation()
                  onChange('')
                }}>
                  <XCircle className='w-3.5 h-3.5 text-gray-400 cursor-pointer  hover:text-gray-600' />
                </div>
              </>
            )}
            {value === 'workflow' && (
              <>
                <div className='w-4 h-4 p-[1px]'>
                  <Route className='w-3.5 h-3.5 text-[#F79009]' />
                </div>
                <div className=''>{t('app.typeSelector.workflow')}</div>
                <div className='w-4 h-4 p-[1px]' onClick={(e) => {
                  e.stopPropagation()
                  onChange('')
                }}>
                  <XCircle className='w-3.5 h-3.5 text-gray-400 cursor-pointer  hover:text-gray-600' />
                </div>
              </>
            )}
          </div>
        </PortalToFollowElemTrigger>
        <PortalToFollowElemContent className='z-[1002]'>
          <div className='relative p-1 w-[180px] bg-white rounded-lg shadow-xl'>
            <div className='flex items-center pl-3 py-[6px] pr-2 rounded-lg cursor-pointer hover:bg-gray-50' onClick={() => {
              onChange('chatbot')
              setOpen(false)
            }}>
              <ChatBot className='mr-2 w-4 h-4 text-[#1570EF]' />
              <div className='grow text-gray-700 text-[13px] font-medium leading-[18px]'>{t('app.typeSelector.chatbot')}</div>
              {value === 'chatbot' && <Check className='w-4 h-4 text-primary-600' />}
            </div>
            <div className='flex items-center pl-3 py-[6px] pr-2 rounded-lg cursor-pointer hover:bg-gray-50' onClick={() => {
              onChange('agent')
              setOpen(false)
            }}>
              <CuteRobot className='mr-2 w-4 h-4 text-indigo-600' />
              <div className='grow text-gray-700 text-[13px] font-medium leading-[18px]'>{t('app.typeSelector.agent')}</div>
              {value === 'agent' && <Check className='w-4 h-4 text-primary-600' />}
            </div>
            <div className='flex items-center pl-3 py-[6px] pr-2 rounded-lg cursor-pointer hover:bg-gray-50' onClick={() => {
              onChange('workflow')
              setOpen(false)
            }}>
              <Route className='mr-2 w-4 h-4 text-[#F79009]' />
              <div className='grow text-gray-700 text-[13px] font-medium leading-[18px]'>{t('app.typeSelector.workflow')}</div>
              {value === 'workflow' && <Check className='w-4 h-4 text-primary-600' />}
            </div>
          </div>
        </PortalToFollowElemContent>
      </div>
    </PortalToFollowElem>
  )
}

export default React.memo(AppTypeSelector)
