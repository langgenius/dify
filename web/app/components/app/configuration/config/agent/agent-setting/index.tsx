'use client'
import type { AgentConfig } from '@/models/debug'
import { Button } from '@langgenius/dify-ui/button'
import { Dialog, DialogCloseButton, DialogContent, DialogTitle } from '@langgenius/dify-ui/dialog'
import { Fieldset, FieldsetLegend } from '@langgenius/dify-ui/fieldset'
import { Slider } from '@langgenius/dify-ui/slider'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { CuteRobot } from '@/app/components/base/icons/src/vender/solid/communication'
import { Unblur } from '@/app/components/base/icons/src/vender/solid/education'
import { DEFAULT_AGENT_PROMPT, MAX_ITERATIONS_NUM } from '@/config'
import ItemPanel from './item-panel'

type Props = Readonly<{
  isChatModel: boolean
  payload: AgentConfig
  isFunctionCall: boolean
  onCancel: () => void
  onSave: (payload: AgentConfig) => void
}>

const maxIterationsMin = 1

export function AgentSetting({ isChatModel, payload, isFunctionCall, onCancel, onSave }: Props) {
  const { t } = useTranslation()
  const [tempPayload, setTempPayload] = useState(payload)
  const maximumIterationsLabel = t(($) => $['agent.setting.maximumIterations.name'], {
    ns: 'appDebug',
  })

  const handleSave = () => {
    onSave(tempPayload)
  }

  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) onCancel()
      }}
    >
      <DialogContent className="top-2 right-2 bottom-2 left-auto flex h-auto max-h-none w-[640px] max-w-[calc(100vw-1rem)] translate-x-0 translate-y-0 flex-col overflow-hidden rounded-xl p-0">
        <div className="flex h-14 shrink-0 items-center justify-between border-b border-divider-regular pr-5 pl-6">
          <DialogTitle className="text-base leading-6 font-semibold text-text-primary">
            {t(($) => $['agent.setting.name'], { ns: 'appDebug' })}
          </DialogTitle>
          <DialogCloseButton
            className="static z-auto size-6 shrink-0"
            aria-label={t(($) => $['operation.close'], { ns: 'common' })}
          />
        </div>
        {/* Body */}
        <div
          className="grow overflow-y-auto border-b border-divider-regular p-6 pt-5 pb-[68px]"
          style={{
            borderBottom: 'rgba(0, 0, 0, 0.05)',
          }}
        >
          {/* Agent Mode */}
          <ItemPanel
            className="mb-4"
            icon={<CuteRobot className="size-4 text-indigo-600" />}
            name={t(($) => $['agent.agentMode'], { ns: 'appDebug' })}
            description={t(($) => $['agent.agentModeDes'], { ns: 'appDebug' })}
          >
            <div className="text-[13px] leading-[18px] font-medium text-text-primary">
              {isFunctionCall
                ? t(($) => $['agent.agentModeType.functionCall'], { ns: 'appDebug' })
                : t(($) => $['agent.agentModeType.ReACT'], { ns: 'appDebug' })}
            </div>
          </ItemPanel>

          <ItemPanel
            className="mb-4"
            icon={<Unblur className="h-4 w-4 text-[#FB6514]" />}
            name={maximumIterationsLabel}
            description={t(($) => $['agent.setting.maximumIterations.description'], {
              ns: 'appDebug',
            })}
          >
            <Fieldset className="flex items-center">
              <FieldsetLegend className="sr-only">{maximumIterationsLabel}</FieldsetLegend>
              <Slider
                className="mr-3 w-[156px]"
                min={maxIterationsMin}
                max={MAX_ITERATIONS_NUM}
                value={tempPayload.max_iteration}
                onValueChange={(value) => {
                  setTempPayload({
                    ...tempPayload,
                    max_iteration: value,
                  })
                }}
                aria-label={maximumIterationsLabel}
              />

              <input
                aria-label={maximumIterationsLabel}
                type="number"
                min={maxIterationsMin}
                max={MAX_ITERATIONS_NUM}
                step={1}
                className="block h-7 w-11 rounded-lg border-0 bg-components-input-bg-normal px-1.5 pl-1 leading-7 text-text-primary placeholder:text-text-tertiary focus:inset-ring-1 focus:inset-ring-primary-600"
                value={tempPayload.max_iteration}
                onChange={(e) => {
                  let value = Number.parseInt(e.target.value, 10)
                  if (value < maxIterationsMin) value = maxIterationsMin

                  if (value > MAX_ITERATIONS_NUM) value = MAX_ITERATIONS_NUM
                  setTempPayload({
                    ...tempPayload,
                    max_iteration: value,
                  })
                }}
              />
            </Fieldset>
          </ItemPanel>

          {!isFunctionCall && (
            <div className="rounded-xl bg-background-section-burn py-2 shadow-xs">
              <div className="flex h-8 items-center px-4 text-sm/6 font-semibold text-text-secondary">
                {t(($) => $.builtInPromptTitle, { ns: 'tools' })}
              </div>
              <div className="h-[396px] overflow-y-auto px-4 text-sm leading-5 font-normal whitespace-pre-line text-text-secondary">
                {isChatModel ? DEFAULT_AGENT_PROMPT.chat : DEFAULT_AGENT_PROMPT.completion}
              </div>
              <div className="px-4">
                <div className="inline-flex h-5 items-center rounded-md bg-components-input-bg-normal px-1 text-xs leading-[18px] font-medium text-text-tertiary">
                  {
                    (isChatModel ? DEFAULT_AGENT_PROMPT.chat : DEFAULT_AGENT_PROMPT.completion)
                      .length
                  }
                </div>
              </div>
            </div>
          )}
        </div>
        <div className="sticky bottom-0 z-5 flex w-full justify-end border-t border-divider-regular bg-background-section-burn px-6 py-4">
          <Button type="button" onClick={onCancel} className="mr-2">
            {t(($) => $['operation.cancel'], { ns: 'common' })}
          </Button>
          <Button type="button" variant="primary" onClick={handleSave}>
            {t(($) => $['operation.save'], { ns: 'common' })}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}
