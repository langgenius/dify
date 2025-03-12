'use client'
import type { FC } from 'react'
import React, { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { RiCloseLine } from '@remixicon/react'
import { useClickAway } from 'ahooks'
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
  const ref = useRef(null)
  const [mounted, setMounted] = useState(false)

  useClickAway(() => {
    if (mounted)
      onCancel()
  }, ref)

  useEffect(() => {
    setMounted(true)
  }, [])

  const handleSave = () => {
    onSave(tempPayload)
  }

  return (
    <div className='fixed z-[100] inset-0 overflow-hidden flex justify-end p-2'
      style={{
        backgroundColor: 'rgba(16, 24, 40, 0.20)',
      }}
    >
      <div
        ref={ref}
        className='w-[640px] flex flex-col h-full overflow-hidden bg-components-panel-bg border-[0.5px] border-components-panel-border rounded-xl shadow-xl'
      >
        <div className='shrink-0 flex justify-between items-center pl-6 pr-5 h-14 border-b border-divider-regular'>
          <div className='flex flex-col text-base font-semibold text-text-primary'>
            <div className='leading-6'>{t('appDebug.agent.setting.name')}</div>
          </div>
          <div className='flex items-center'>
            <div
              onClick={onCancel}
              className='flex justify-center items-center w-6 h-6 cursor-pointer'
            >
              <RiCloseLine className='w-4 h-4 text-text-tertiary' />
            </div>
          </div>
        </div>
        {/* Body */}
        <div className='grow p-6 pt-5 border-b overflow-y-auto pb-[68px]' style={{
          borderBottom: 'rgba(0, 0, 0, 0.05)',
        }}>
          {/* Agent Mode */}
          <ItemPanel
            className='mb-4'
            icon={
              <CuteRobot className='w-4 h-4 text-indigo-600' />
            }
            name={t('appDebug.agent.agentMode')}
            description={t('appDebug.agent.agentModeDes')}
          >
            <div className='leading-[18px] text-[13px] font-medium text-text-primary'>{isFunctionCall ? t('appDebug.agent.agentModeType.functionCall') : t('appDebug.agent.agentModeType.ReACT')}</div>
          </ItemPanel>

          <ItemPanel
            className='mb-4'
            icon={
              <Unblur className='w-4 h-4 text-[#FB6514]' />
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
                className="block w-11 h-7 leading-7 rounded-lg border-0 pl-1 px-1.5 bg-components-input-bg-normal text-text-primary placeholder:text-text-tertiary focus:ring-1 focus:ring-inset focus:ring-primary-600"
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
            <div className='py-2 bg-background-section-burn rounded-xl shadow-xs'>
              <div className='flex items-center h-8 px-4 leading-6 text-sm font-semibold text-text-secondary'>{t('tools.builtInPromptTitle')}</div>
              <div className='h-[396px] px-4 overflow-y-auto leading-5 text-sm font-normal text-text-secondary whitespace-pre-line'>
                {isChatModel ? DEFAULT_AGENT_PROMPT.chat : DEFAULT_AGENT_PROMPT.completion}
              </div>
              <div className='px-4'>
                <div className='inline-flex items-center h-5 px-1 bg-components-input-bg-normal rounded-md leading-[18px] text-xs font-medium text-text-tertiary'>{(isChatModel ? DEFAULT_AGENT_PROMPT.chat : DEFAULT_AGENT_PROMPT.completion).length}</div>
              </div>
            </div>
          )}

        </div>
        <div
          className='sticky z-[5] bottom-0 w-full flex justify-end py-4 px-6 border-t bg-background-section-burn border-divider-regular'
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
