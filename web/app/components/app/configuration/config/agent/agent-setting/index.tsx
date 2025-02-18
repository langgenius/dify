'use client'
import type { FC } from 'react'
import React, { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { RiCloseLine } from '@remixicon/react'
import ItemPanel from './item-panel'
import Button from '@/app/components/base/button'
import { CuteRobot } from '@/app/components/base/icons/src/vender/solid/communication'
import { Unblur } from '@/app/components/base/icons/src/vender/solid/education'
import Slider from '@/app/components/base/slider'
import type { AgentConfig } from '@/models/debug'
import { DEFAULT_AGENT_PROMPT } from '@/config'

type Props = {
  isChatModel: boolean
  payload: AgentConfig
  isFunctionCall: boolean
  onCancel: () => void
  onSave: (payload: any) => void
}

const maxIterationsMin = 1
const maxIterationsMax = 5

const AgentSetting: FC<Props> = ({
  isChatModel,
  payload,
  isFunctionCall,
  onCancel,
  onSave,
}) => {
  const { t } = useTranslation()
  const [tempPayload, setTempPayload] = useState(payload)
  const handleSave = () => {
    onSave(tempPayload)
  }

  return (
    <div className='fixed inset-0 z-[100] flex justify-end overflow-hidden p-2'
      style={{
        backgroundColor: 'rgba(16, 24, 40, 0.20)',
      }}
    >
      <div
        className='bg-components-panel-bg border-components-panel-border flex h-full w-[640px] flex-col overflow-hidden rounded-xl border-[0.5px] shadow-xl'
      >
        <div className='border-divider-regular flex h-14 shrink-0 items-center justify-between border-b pl-6 pr-5'>
          <div className='text-text-primary flex flex-col text-base font-semibold'>
            <div className='leading-6'>{t('appDebug.agent.setting.name')}</div>
          </div>
          <div className='flex items-center'>
            <div
              onClick={onCancel}
              className='flex h-6 w-6 cursor-pointer items-center justify-center'
            >
              <RiCloseLine className='text-text-tertiary h-4 w-4' />
            </div>
          </div>
        </div>
        {/* Body */}
        <div className='grow overflow-y-auto border-b p-6 pb-[68px] pt-5' style={{
          borderBottom: 'rgba(0, 0, 0, 0.05)',
        }}>
          {/* Agent Mode */}
          <ItemPanel
            className='mb-4'
            icon={
              <CuteRobot className='h-4 w-4 text-indigo-600' />
            }
            name={t('appDebug.agent.agentMode')}
            description={t('appDebug.agent.agentModeDes')}
          >
            <div className='text-text-primary text-[13px] font-medium leading-[18px]'>{isFunctionCall ? t('appDebug.agent.agentModeType.functionCall') : t('appDebug.agent.agentModeType.ReACT')}</div>
          </ItemPanel>

          <ItemPanel
            className='mb-4'
            icon={
              <Unblur className='h-4 w-4 text-[#FB6514]' />
            }
            name={t('appDebug.agent.setting.maximumIterations.name')}
            description={t('appDebug.agent.setting.maximumIterations.description')}
          >
            <div className='flex items-center'>
              <Slider
                className='mr-3 w-[156px]'
                min={maxIterationsMin}
                max={maxIterationsMax}
                value={tempPayload.max_iteration}
                onChange={(value) => {
                  setTempPayload({
                    ...tempPayload,
                    max_iteration: value,
                  })
                }}
              />

              <input
                type="number"
                min={maxIterationsMin}
                max={maxIterationsMax} step={1}
                className="bg-components-input-bg-normal text-text-primary placeholder:text-text-tertiary focus:ring-primary-600 block h-7 w-11 rounded-lg border-0 px-1.5 pl-1 leading-7 focus:ring-1 focus:ring-inset"
                value={tempPayload.max_iteration}
                onChange={(e) => {
                  let value = Number.parseInt(e.target.value, 10)
                  if (value < maxIterationsMin)
                    value = maxIterationsMin

                  if (value > maxIterationsMax)
                    value = maxIterationsMax
                  setTempPayload({
                    ...tempPayload,
                    max_iteration: value,
                  })
                }} />
            </div>
          </ItemPanel>

          {!isFunctionCall && (
            <div className='bg-background-section-burn shadow-xs rounded-xl py-2'>
              <div className='text-text-secondary flex h-8 items-center px-4 text-sm font-semibold leading-6'>{t('tools.builtInPromptTitle')}</div>
              <div className='text-text-secondary h-[396px] overflow-y-auto whitespace-pre-line px-4 text-sm font-normal leading-5'>
                {isChatModel ? DEFAULT_AGENT_PROMPT.chat : DEFAULT_AGENT_PROMPT.completion}
              </div>
              <div className='px-4'>
                <div className='bg-components-input-bg-normal text-text-tertiary inline-flex h-5 items-center rounded-md px-1 text-xs font-medium leading-[18px]'>{(isChatModel ? DEFAULT_AGENT_PROMPT.chat : DEFAULT_AGENT_PROMPT.completion).length}</div>
              </div>
            </div>
          )}

        </div>
        <div
          className='bg-background-section-burn border-divider-regular sticky bottom-0 z-[5] flex w-full justify-end border-t px-6 py-4'
        >
          <Button
            onClick={onCancel}
            className='mr-2'
          >
            {t('common.operation.cancel')}
          </Button>
          <Button
            variant='primary'
            onClick={handleSave}
          >
            {t('common.operation.save')}
          </Button>
        </div>
      </div>
    </div>
  )
}
export default React.memo(AgentSetting)
