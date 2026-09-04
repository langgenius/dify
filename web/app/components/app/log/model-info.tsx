'use client'
import type { ModelConfig } from '@dify/contracts/api/console/apps/types.gen'
import type { FC } from 'react'
import { cn } from '@langgenius/dify-ui/cn'
import { Popover, PopoverContent, PopoverTrigger } from '@langgenius/dify-ui/popover'
import { RiInformation2Line } from '@remixicon/react'
import * as React from 'react'
import { useTranslation } from 'react-i18next'
import { useTextGenerationCurrentProviderAndModelAndModelList } from '@/app/components/header/account-setting/model-provider-page/hooks'
import ModelIcon from '@/app/components/header/account-setting/model-provider-page/model-icon'
import ModelName from '@/app/components/header/account-setting/model-provider-page/model-name'

const PARAM_MAP = {
  temperature: 'Temperature',
  top_p: 'Top P',
  presence_penalty: 'Presence Penalty',
  max_tokens: 'Max Token',
  stop: 'Stop',
  frequency_penalty: 'Frequency Penalty',
}

type Props = Readonly<{
  model: Pick<ModelConfig, 'completion_params' | 'name' | 'provider'>
}>

const ModelInfo: FC<Props> = ({ model }) => {
  const { t } = useTranslation()
  const modelName = model.name
  const providerName = model.provider
  const { currentModel, currentProvider } = useTextGenerationCurrentProviderAndModelAndModelList({
    provider: providerName,
    model: modelName,
  })

  const [open, setOpen] = React.useState(false)

  const getParamValue = (param: keyof typeof PARAM_MAP) => {
    const value = model.completion_params?.[param] ?? '-'
    if (param === 'stop') {
      if (Array.isArray(value)) return value.join(',')
      else return '-'
    }

    return typeof value === 'string' || typeof value === 'number' ? value : '-'
  }

  return (
    <div className={cn('flex items-center rounded-lg')}>
      <div className="mr-px flex h-8 shrink-0 items-center gap-1 rounded-l-lg bg-components-input-bg-normal pr-2 pl-1.5">
        <ModelIcon className="size-5!" provider={currentProvider} modelName={currentModel?.model} />
        <ModelName modelItem={currentModel} showMode />
      </div>
      <Popover open={open} onOpenChange={setOpen}>
        <div className="relative">
          <PopoverTrigger
            render={
              <button type="button" className="group block border-none bg-transparent p-0">
                <div
                  className={cn(
                    'cursor-pointer rounded-r-lg bg-components-button-tertiary-bg p-2 hover:bg-components-button-tertiary-bg-hover',
                    'group-data-popup-open:bg-components-button-tertiary-bg-hover',
                  )}
                >
                  <RiInformation2Line className="size-4 text-text-tertiary" />
                </div>
              </button>
            }
          />
          <PopoverContent
            placement="bottom-end"
            sideOffset={4}
            className="border-none bg-transparent shadow-none"
          >
            <div className="relative w-70 overflow-hidden rounded-2xl border-[0.5px] border-components-panel-border bg-components-panel-bg px-4 pt-3 pb-2 shadow-xl">
              <div className="mb-1 h-6 system-sm-semibold-uppercase text-text-secondary">
                {t(($) => $['detail.modelParams'], { ns: 'appLog' })}
              </div>
              <div className="py-1">
                {(['temperature', 'top_p', 'presence_penalty', 'max_tokens', 'stop'] as const).map(
                  (param) => {
                    return (
                      <div className="flex justify-between py-1.5" key={param}>
                        <span className="system-xs-medium-uppercase text-text-tertiary">
                          {PARAM_MAP[param]}
                        </span>
                        <span className="system-xs-medium-uppercase text-text-secondary">
                          {getParamValue(param)}
                        </span>
                      </div>
                    )
                  },
                )}
              </div>
            </div>
          </PopoverContent>
        </div>
      </Popover>
    </div>
  )
}
export default React.memo(ModelInfo)
