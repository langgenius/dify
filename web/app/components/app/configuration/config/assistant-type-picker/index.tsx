'use client'
import type { FC } from 'react'
import type { AgentConfig } from '@/models/debug'
import { RiArrowDownSLine } from '@remixicon/react'
import * as React from 'react'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { ArrowUpRight } from '@/app/components/base/icons/src/vender/line/arrows'
import { Settings04 } from '@/app/components/base/icons/src/vender/line/general'
import { CuteRobot } from '@/app/components/base/icons/src/vender/solid/communication'
import { BubbleText } from '@/app/components/base/icons/src/vender/solid/education'
import {
  PortalToFollowElem,
  PortalToFollowElemContent,
  PortalToFollowElemTrigger,
} from '@/app/components/base/portal-to-follow-elem'
import Radio from '@/app/components/base/radio/ui'
import { cn } from '@/utils/classnames'
import AgentSetting from '../agent/agent-setting'

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
      className={cn(disabled ? 'opacity-50' : 'cursor-pointer', isChecked ? 'border-[2px] border-indigo-600 shadow-sm' : 'border border-gray-100', 'mb-2 rounded-xl bg-gray-25 p-3 pr-4 hover:bg-gray-50')}
      onClick={() => !disabled && onClick(value)}
    >
      <div className="flex items-center justify-between">
        <div className="flex items-center ">
          <div className="mr-3 rounded-lg bg-indigo-50 p-1">
            <Icon className="h-4 w-4 text-indigo-600" />
          </div>
          <div className="text-sm font-medium leading-5 text-gray-900">{text}</div>
        </div>
        <Radio isChecked={isChecked} />
      </div>
      <div className="ml-9 text-xs font-normal leading-[18px] text-gray-500">{description}</div>
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
      <div className="my-4 h-px bg-gray-100"></div>
      <div
        className={cn(isAgent ? 'group cursor-pointer hover:bg-primary-50' : 'opacity-30', 'rounded-xl bg-gray-50 p-3 pr-4 ')}
        onClick={() => {
          if (isAgent) {
            setOpen(false)
            setIsShowAgentSetting(true)
          }
        }}
      >
        <div className="flex items-center justify-between">
          <div className="flex items-center ">
            <div className="mr-3 rounded-lg bg-gray-200 p-1 group-hover:bg-white">
              <Settings04 className="h-4 w-4 text-gray-600 group-hover:text-[#155EEF]" />
            </div>
            <div className="text-sm font-medium leading-5 text-gray-900 group-hover:text-[#155EEF]">{t('agent.setting.name', { ns: 'appDebug' })}</div>
          </div>
          <ArrowUpRight className="h-4 w-4 text-gray-500 group-hover:text-[#155EEF]" />
        </div>
        <div className="ml-9 text-xs font-normal leading-[18px] text-gray-500">{t('agent.setting.description', { ns: 'appDebug' })}</div>
      </div>
    </>
  )
  return (
    <>
      <PortalToFollowElem
        open={open}
        onOpenChange={setOpen}
        placement="bottom-end"
        offset={{
          mainAxis: 8,
          crossAxis: -2,
        }}
      >
        <PortalToFollowElemTrigger onClick={() => setOpen(v => !v)}>
          <div className={cn(open && 'bg-gray-50', 'flex h-8 cursor-pointer select-none items-center space-x-1 rounded-lg border border-black/5 px-3 text-indigo-600')}>
            {isAgent ? <BubbleText className="h-3 w-3" /> : <CuteRobot className="h-3 w-3" />}
            <div className="text-xs font-medium">{t(`assistantType.${isAgent ? 'agentAssistant' : 'chatAssistant'}.name`, { ns: 'appDebug' })}</div>
            <RiArrowDownSLine className="h-3 w-3" />
          </div>
        </PortalToFollowElemTrigger>
        <PortalToFollowElemContent style={{ zIndex: 1000 }}>
          <div className="relative left-0.5 w-[480px] rounded-xl border border-black/8 bg-white p-6 shadow-lg">
            <div className="mb-2 text-sm font-semibold leading-5 text-gray-900">{t('assistantType.name', { ns: 'appDebug' })}</div>
            <SelectItem
              Icon={BubbleText}
              value="chat"
              disabled={disabled}
              text={t('assistantType.chatAssistant.name', { ns: 'appDebug' })}
              description={t('assistantType.chatAssistant.description', { ns: 'appDebug' })}
              isChecked={!isAgent}
              onClick={handleChange}
            />
            <SelectItem
              Icon={CuteRobot}
              value="agent"
              disabled={disabled}
              text={t('assistantType.agentAssistant.name', { ns: 'appDebug' })}
              description={t('assistantType.agentAssistant.description', { ns: 'appDebug' })}
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
