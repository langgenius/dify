'use client'
import type { FC } from 'react'
import { cn } from '@langgenius/dify-ui/cn'
import {
  RiInformation2Line,
} from '@remixicon/react'
import * as React from 'react'
import { useTranslation } from 'react-i18next'
import { Popover, PopoverContent, PopoverTrigger } from '@/app/components/base/ui/popover'
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

type Props = {
  model: any
}

const ModelInfo: FC<Props> = ({
  model,
}) => {
  const { t } = useTranslation()
  const modelName = model.name
  const provideName = model.provider as any
  const {
    currentModel,
    currentProvider,
  } = useTextGenerationCurrentProviderAndModelAndModelList(
    { provider: provideName, model: modelName },
  )

  const [open, setOpen] = React.useState(false)

  const getParamValue = (param: string) => {
    const value = model.completion_params?.[param] || '-'
    if (param === 'stop') {
      if (Array.isArray(value))
        return value.join(',')
      else
        return '-'
    }

    return value
  }

  return (
    <div className={cn('flex items-center rounded-lg')}>
      <div className="mr-px flex h-8 shrink-0 items-center gap-1 rounded-l-lg bg-components-input-bg-normal pr-2 pl-1.5">
        <ModelIcon
          className="h-5! w-5!"
          provider={currentProvider}
          modelName={currentModel?.model}
        />
        <ModelName
          modelItem={currentModel!}
          showMode
        />
      </div>
      <Popover
        open={open}
        onOpenChange={setOpen}
      >
        <div className="relative">
          <PopoverTrigger
            render={(
              <button type="button" className="block border-none bg-transparent p-0">
                <div className={cn(
                  'cursor-pointer rounded-r-lg bg-components-button-tertiary-bg p-2 hover:bg-components-button-tertiary-bg-hover',
                  open && 'bg-components-button-tertiary-bg-hover',
                )}
                >
                  <RiInformation2Line className="h-4 w-4 text-text-tertiary" />
                </div>
              </button>
            )}
          />
          <PopoverContent
            placement="bottom-end"
            sideOffset={4}
            popupClassName="border-none bg-transparent shadow-none"
          >
            <div className="relative w-[280px] overflow-hidden rounded-2xl border-[0.5px] border-components-panel-border bg-components-panel-bg px-4 pt-3 pb-2 shadow-xl">
              <div className="mb-1 h-6 system-sm-semibold-uppercase text-text-secondary">{t('detail.modelParams', { ns: 'appLog' })}</div>
              <div className="py-1">
                {['temperature', 'top_p', 'presence_penalty', 'max_tokens', 'stop'].map((param: string, index: number) => {
                  return (
                    <div className="flex justify-between py-1.5" key={index}>
                      <span className="system-xs-medium-uppercase text-text-tertiary">{PARAM_MAP[param as keyof typeof PARAM_MAP]}</span>
                      <span className="system-xs-medium-uppercase text-text-secondary">{getParamValue(param)}</span>
                    </div>
                  )
                })}
              </div>
            </div>
          </PopoverContent>
        </div>
      </Popover>
    </div>
  )
}
export default React.memo(ModelInfo)
