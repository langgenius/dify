'use client'
import type { FC } from 'react'
import type { AgentConfig } from '@/models/debug'
import { RiCloseLine } from '@remixicon/react'
import { useClickAway } from 'ahooks'
import * as React from 'react'
import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import Button from '@/app/components/base/button'
import { CuteRobot } from '@/app/components/base/icons/src/vender/solid/communication'
import { Unblur } from '@/app/components/base/icons/src/vender/solid/education'
import Slider from '@/app/components/base/slider'
import { DEFAULT_AGENT_PROMPT, MAX_ITERATIONS_NUM } from '@/config'
import ItemPanel from './item-panel'

type Props = {
  isChatModel: boolean
  payload: AgentConfig
  isFunctionCall: boolean
  onCancel: () => void
  onSave: (payload: any) => void
}

const maxIterationsMin = 1

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
    <div
      className="fixed inset-0 z-[100] flex justify-end overflow-hidden p-2"
      style={{
        backgroundColor: 'rgba(16, 24, 40, 0.20)',
      }}
    >
      <div
        ref={ref}
        className="flex h-full w-[640px] flex-col overflow-hidden rounded-xl border-[0.5px] border-components-panel-border bg-components-panel-bg shadow-xl"
      >
        <div className="flex h-14 shrink-0 items-center justify-between border-b border-divider-regular pl-6 pr-5">
          <div className="flex flex-col text-base font-semibold text-text-primary">
            <div className="leading-6">{t('agent.setting.name', { ns: 'appDebug' })}</div>
          </div>
          <div className="flex items-center">
            <div
              onClick={onCancel}
              className="flex h-6 w-6 cursor-pointer items-center justify-center"
            >
              <RiCloseLine className="h-4 w-4 text-text-tertiary" />
            </div>
          </div>
        </div>
        {/* Body */}
        <div
          className="grow overflow-y-auto border-b p-6 pb-[68px] pt-5"
          style={{
            borderBottom: 'rgba(0, 0, 0, 0.05)',
          }}
        >
          {/* Agent Mode */}
          <ItemPanel
            className="mb-4"
            icon={
              <CuteRobot className="h-4 w-4 text-indigo-600" />
            }
            name={t('agent.agentMode', { ns: 'appDebug' })}
            description={t('agent.agentModeDes', { ns: 'appDebug' })}
          >
            <div className="text-[13px] font-medium leading-[18px] text-text-primary">{isFunctionCall ? t('agent.agentModeType.functionCall', { ns: 'appDebug' }) : t('agent.agentModeType.ReACT', { ns: 'appDebug' })}</div>
          </ItemPanel>

          <ItemPanel
            className="mb-4"
            icon={
              <Unblur className="h-4 w-4 text-[#FB6514]" />
            }
            name={t('agent.setting.maximumIterations.name', { ns: 'appDebug' })}
            description={t('agent.setting.maximumIterations.description', { ns: 'appDebug' })}
          >
            <div className="flex items-center">
              <Slider
                className="mr-3 w-[156px]"
                min={maxIterationsMin}
                max={MAX_ITERATIONS_NUM}
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
                max={MAX_ITERATIONS_NUM}
                step={1}
                className="block h-7 w-11 rounded-lg border-0 bg-components-input-bg-normal px-1.5 pl-1 leading-7 text-text-primary placeholder:text-text-tertiary focus:ring-1 focus:ring-inset focus:ring-primary-600"
                value={tempPayload.max_iteration}
                onChange={(e) => {
                  let value = Number.parseInt(e.target.value, 10)
                  if (value < maxIterationsMin)
                    value = maxIterationsMin

                  if (value > MAX_ITERATIONS_NUM)
                    value = MAX_ITERATIONS_NUM
                  setTempPayload({
                    ...tempPayload,
                    max_iteration: value,
                  })
                }}
              />
            </div>
          </ItemPanel>

          {!isFunctionCall && (
            <div className="rounded-xl bg-background-section-burn py-2 shadow-xs">
              <div className="flex h-8 items-center px-4 text-sm font-semibold leading-6 text-text-secondary">{t('builtInPromptTitle', { ns: 'tools' })}</div>
              <div className="h-[396px] overflow-y-auto whitespace-pre-line px-4 text-sm font-normal leading-5 text-text-secondary">
                {isChatModel ? DEFAULT_AGENT_PROMPT.chat : DEFAULT_AGENT_PROMPT.completion}
              </div>
              <div className="px-4">
                <div className="inline-flex h-5 items-center rounded-md bg-components-input-bg-normal px-1 text-xs font-medium leading-[18px] text-text-tertiary">{(isChatModel ? DEFAULT_AGENT_PROMPT.chat : DEFAULT_AGENT_PROMPT.completion).length}</div>
              </div>
            </div>
          )}

        </div>
        <div
          className="sticky bottom-0 z-[5] flex w-full justify-end border-t border-divider-regular bg-background-section-burn px-6 py-4"
        >
          <Button
            onClick={onCancel}
            className="mr-2"
          >
            {t('operation.cancel', { ns: 'common' })}
          </Button>
          <Button
            variant="primary"
            onClick={handleSave}
          >
            {t('operation.save', { ns: 'common' })}
          </Button>
        </div>
      </div>
    </div>
  )
}
export default React.memo(AgentSetting)
