'use client'
import type { FC } from 'react'
import React from 'react'
import { useTranslation } from 'react-i18next'
import {
  RiInformation2Line,
} from '@remixicon/react'
import ModelIcon from '@/app/components/header/account-setting/model-provider-page/model-icon'
import ModelName from '@/app/components/header/account-setting/model-provider-page/model-name'
import {
  PortalToFollowElem,
  PortalToFollowElemContent,
  PortalToFollowElemTrigger,
} from '@/app/components/base/portal-to-follow-elem'
import { useTextGenerationCurrentProviderAndModelAndModelList } from '@/app/components/header/account-setting/model-provider-page/hooks'
import cn from '@/utils/classnames'

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
      <div className='shrink-0 flex items-center gap-1 mr-px h-8 pl-1.5 pr-2 rounded-l-lg bg-components-input-bg-normal'>
        <ModelIcon
          className='!w-5 !h-5'
          provider={currentProvider}
          modelName={currentModel?.model}
        />
        <ModelName
          modelItem={currentModel!}
          showMode
        />
      </div>
      <PortalToFollowElem
        open={open}
        onOpenChange={setOpen}
        placement='bottom-end'
        offset={4}
      >
        <div className='relative'>
          <PortalToFollowElemTrigger
            onClick={() => setOpen(v => !v)}
            className='block'
          >
            <div className={cn(
              'p-2 rounded-r-lg bg-components-button-tertiary-bg hover:bg-components-button-tertiary-bg-hover cursor-pointer',
              open && 'bg-components-button-tertiary-bg-hover',
            )}>
              <RiInformation2Line className='h-4 w-4 text-text-tertiary' />
            </div>
          </PortalToFollowElemTrigger>
          <PortalToFollowElemContent className='z-[1002]'>
            <div className='relative w-[280px] pt-3 px-4 pb-2 bg-components-panel-bg rounded-2xl border-[0.5px] border-components-panel-border shadow-xl overflow-hidden'>
              <div className='mb-1 h-6 text-text-secondary system-sm-semibold-uppercase'>{t('appLog.detail.modelParams')}</div>
              <div className='py-1'>
                {['temperature', 'top_p', 'presence_penalty', 'max_tokens', 'stop'].map((param: string, index: number) => {
                  return <div className='flex justify-between py-1.5' key={index}>
                    <span className='text-text-tertiary system-xs-medium-uppercase'>{PARAM_MAP[param as keyof typeof PARAM_MAP]}</span>
                    <span className='text-text-secondary system-xs-medium-uppercase'>{getParamValue(param)}</span>
                  </div>
                })}
              </div>
            </div>
          </PortalToFollowElemContent>
        </div>
      </PortalToFollowElem>
    </div>
  )
}
export default React.memo(ModelInfo)
