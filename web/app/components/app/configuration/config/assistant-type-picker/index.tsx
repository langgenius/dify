'use client'
import type { FC } from 'react'
import React, { useState } from 'react'
import { useTranslation } from 'react-i18next'
import cn from 'classnames'
import { RiArrowDownSLine } from '@remixicon/react'
import AgentSetting from '../agent/agent-setting'
import {
  PortalToFollowElem,
  PortalToFollowElemContent,
  PortalToFollowElemTrigger,
} from '@/app/components/base/portal-to-follow-elem'
import { BubbleText } from '@/app/components/base/icons/src/vender/solid/education'
import Radio from '@/app/components/base/radio/ui'
import { CuteRobote } from '@/app/components/base/icons/src/vender/solid/communication'
import { Settings04 } from '@/app/components/base/icons/src/vender/line/general'
import { ArrowUpRight } from '@/app/components/base/icons/src/vender/line/arrows'
import type { AgentConfig } from '@/models/debug'

type Props = {
  value: string
  disabled: boolean
  onChange: (value: string) => void
  isFunctionCall: boolean
  isChatModel: boolean
  agentConfig?: AgentConfig
  onAgentSettingChange: (payload: AgentConfig) => void
}

type ItemProps = {
  text: string
  disabled: boolean
  value: string
  isChecked: boolean
  description: string
  Icon: any
  onClick: (value: string) => void
}

const SelectItem: FC<ItemProps> = ({ text, value, Icon, isChecked, description, onClick, disabled }) => {
  return (
    <div
      className={cn(disabled ? 'opacity-50' : 'cursor-pointer', isChecked ? 'border-[2px] border-indigo-600 shadow-sm' : 'border border-gray-100', 'mb-2 p-3 pr-4 rounded-xl bg-gray-25 hover:bg-gray-50')}
      onClick={() => !disabled && onClick(value)}
    >
      <div className='flex items-center justify-between'>
        <div className='flex items-center '>
          <div className='mr-3 p-1 bg-indigo-50 rounded-lg'>
            <Icon className='w-4 h-4 text-indigo-600' />
          </div>
          <div className='leading-5 text-sm font-medium text-gray-900'>{text}</div>
        </div>
        <Radio isChecked={isChecked} />
      </div>
      <div className='ml-9 leading-[18px] text-xs font-normal text-gray-500'>{description}</div>
    </div>
  )
}

const AssistantTypePicker: FC<Props> = ({
  value,
  disabled,
  onChange,
  onAgentSettingChange,
  isFunctionCall,
  isChatModel,
  agentConfig,
}) => {
  const { t } = useTranslation()
  const [open, setOpen] = useState(false)
  const handleChange = (chosenValue: string) => {
    if (value === chosenValue)
      return

    onChange(chosenValue)
    if (chosenValue !== 'agent')
      setOpen(false)
  }
  const isAgent = value === 'agent'
  const [isShowAgentSetting, setIsShowAgentSetting] = useState(false)

  const agentConfigUI = (
    <>
      <div className='my-4 h-[1px] bg-gray-100'></div>
      <div
        className={cn(isAgent ? 'group cursor-pointer hover:bg-primary-50' : 'opacity-30', 'p-3 pr-4 rounded-xl bg-gray-50 ')}
        onClick={() => {
          if (isAgent) {
            setOpen(false)
            setIsShowAgentSetting(true)
          }
        }}
      >
        <div className='flex items-center justify-between'>
          <div className='flex items-center '>
            <div className='mr-3 p-1 bg-gray-200 group-hover:bg-white rounded-lg'>
              <Settings04 className='w-4 h-4 text-gray-600 group-hover:text-[#155EEF]' />
            </div>
            <div className='leading-5 text-sm font-medium text-gray-900 group-hover:text-[#155EEF]'>{t('appDebug.agent.setting.name')}</div>
          </div>
          <ArrowUpRight className='w-4 h-4 text-gray-500 group-hover:text-[#155EEF]' />
        </div>
        <div className='ml-9 leading-[18px] text-xs font-normal text-gray-500'>{t('appDebug.agent.setting.description')}</div>
      </div>
    </>
  )
  return (
    <>
      <PortalToFollowElem
        open={open}
        onOpenChange={setOpen}
        placement='bottom-end'
        offset={{
          mainAxis: 8,
          crossAxis: -2,
        }}
      >
        <PortalToFollowElemTrigger onClick={() => setOpen(v => !v)}>
          <div className={cn(open && 'bg-gray-50', 'flex items-center h-8 px-3 border border-black/5 rounded-lg cursor-pointer select-none space-x-1 text-indigo-600')}>
            {isAgent ? <BubbleText className='w-3 h-3' /> : <CuteRobote className='w-3 h-3' />}
            <div className='text-xs font-medium'>{t(`appDebug.assistantType.${isAgent ? 'agentAssistant' : 'chatAssistant'}.name`)}</div>
            <RiArrowDownSLine className='w-3 h-3' />
          </div>
        </PortalToFollowElemTrigger>
        <PortalToFollowElemContent style={{ zIndex: 1000 }}>
          <div className='relative left-0.5 p-6 bg-white border border-black/8 shadow-lg rounded-xl w-[480px]'>
            <div className='mb-2 leading-5 text-sm font-semibold text-gray-900'>{t('appDebug.assistantType.name')}</div>
            <SelectItem
              Icon={BubbleText}
              value='chat'
              disabled={disabled}
              text={t('appDebug.assistantType.chatAssistant.name')}
              description={t('appDebug.assistantType.chatAssistant.description')}
              isChecked={!isAgent}
              onClick={handleChange}
            />
            <SelectItem
              Icon={CuteRobote}
              value='agent'
              disabled={disabled}
              text={t('appDebug.assistantType.agentAssistant.name')}
              description={t('appDebug.assistantType.agentAssistant.description')}
              isChecked={isAgent}
              onClick={handleChange}
            />
            {!disabled && agentConfigUI}
          </div>
        </PortalToFollowElemContent>
      </PortalToFollowElem>
      {isShowAgentSetting && (
        <AgentSetting
          isFunctionCall={isFunctionCall}
          payload={agentConfig as AgentConfig}
          isChatModel={isChatModel}
          onSave={(payloadNew) => {
            onAgentSettingChange(payloadNew)
            setIsShowAgentSetting(false)
          }}
          onCancel={() => setIsShowAgentSetting(false)}
        />
      )}
    </>
  )
}
export default React.memo(AssistantTypePicker)
