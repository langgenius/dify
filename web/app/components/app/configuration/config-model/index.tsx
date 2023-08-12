'use client'
import type { FC } from 'react'
import React, { useEffect, useState } from 'react'
import cn from 'classnames'
import { useTranslation } from 'react-i18next'
import { useBoolean, useClickAway, useGetState } from 'ahooks'
import { Cog8ToothIcon, InformationCircleIcon } from '@heroicons/react/24/outline'
import produce from 'immer'
import ParamItem from './param-item'
import ModelIcon from './model-icon'
import ModelName from './model-name'
import Radio from '@/app/components/base/radio'
import Panel from '@/app/components/base/panel'
import type { CompletionParams } from '@/models/debug'
import { TONE_LIST } from '@/config'
import Toast from '@/app/components/base/toast'
import { AlertTriangle } from '@/app/components/base/icons/src/vender/solid/alertsAndFeedback'
import { formatNumber } from '@/utils/format'
import { Brush01 } from '@/app/components/base/icons/src/vender/solid/editor'
import { Scales02 } from '@/app/components/base/icons/src/vender/solid/FinanceAndECommerce'
import { Target04 } from '@/app/components/base/icons/src/vender/solid/general'
import { Sliders02 } from '@/app/components/base/icons/src/vender/solid/mediaAndDevices'
import { fetchModelParams } from '@/service/debug'
import Loading from '@/app/components/base/loading'
import ModelSelector from '@/app/components/header/account-setting/model-page/model-selector'
import { ModelType, ProviderEnum } from '@/app/components/header/account-setting/model-page/declarations'
import { useProviderContext } from '@/context/provider-context'

export type IConfigModelProps = {
  mode: string
  modelId: string
  provider: ProviderEnum
  setModelId: (id: string, provider: ProviderEnum) => void
  completionParams: CompletionParams
  onCompletionParamsChange: (newParams: CompletionParams) => void
  disabled: boolean
}

const ConfigModel: FC<IConfigModelProps> = ({
  modelId,
  provider,
  setModelId,
  completionParams,
  onCompletionParamsChange,
  disabled,
}) => {
  const { t } = useTranslation()
  const { textGenerationModelList } = useProviderContext()
  const [isShowConfig, { setFalse: hideConfig, toggle: toogleShowConfig }] = useBoolean(false)
  const [maxTokenSettingTipVisible, setMaxTokenSettingTipVisible] = useState(false)
  const configContentRef = React.useRef(null)
  const currModel = textGenerationModelList.find(item => item.model_name === modelId)
  // Cache loaded model param
  const [allParams, setAllParams, getAllParams] = useGetState<Record<string, Record<string, any>>>({})
  const currParams = allParams[provider]?.[modelId]
  const hasEnableParams = currParams && Object.keys(currParams).some(key => currParams[key].enabled)
  const allSupportParams = ['temperature', 'top_p', 'presence_penalty', 'frequency_penalty', 'max_tokens']
  const currSupportParams = currParams ? allSupportParams.filter(key => currParams[key].enabled) : allSupportParams

  useEffect(() => {
    (async () => {
      if (!allParams[provider]?.[modelId]) {
        const res = await fetchModelParams(provider, modelId)
        const newAllParams = produce(allParams, (draft) => {
          if (!draft[provider])
            draft[provider] = {}

          draft[provider][modelId] = res
        })
        setAllParams(newAllParams)
      }
    })()
  }, [provider, modelId])

  useClickAway(() => {
    hideConfig()
  }, configContentRef)

  const selectedModel = { name: modelId } // options.find(option => option.id === modelId)

  const ensureModelParamLoaded = (provider: ProviderEnum, modelId: string) => {
    return new Promise<void>((resolve) => {
      if (getAllParams()[provider]?.[modelId]) {
        resolve()
        return
      }
      const runId = setInterval(() => {
        if (getAllParams()[provider]?.[modelId]) {
          resolve()
          clearInterval(runId)
        }
      }, 500)
    })
  }

  const transformValue = (value: number, fromRange: [number, number], toRange: [number, number]): number => {
    const [fromStart = 0, fromEnd] = fromRange
    const [toStart = 0, toEnd] = toRange

    // The following three if is to avoid precision loss
    if (fromStart === toStart && fromEnd === toEnd)
      return value

    if (value <= fromStart)
      return toStart

    if (value >= fromEnd)
      return toEnd

    const fromLength = fromEnd - fromStart
    const toLength = toEnd - toStart

    let adjustedValue = (value - fromStart) * (toLength / fromLength) + toStart
    adjustedValue = parseFloat(adjustedValue.toFixed(2))
    return adjustedValue
  }

  const handleSelectModel = (id: string, nextProvider = ProviderEnum.openai) => {
    return async () => {
      const prevParamsRule = getAllParams()[provider]?.[modelId]

      setModelId(id, nextProvider)

      await ensureModelParamLoaded(nextProvider, id)

      const nextParamsRule = getAllParams()[nextProvider]?.[id]
      // debugger
      const nextSelectModelMaxToken = nextParamsRule.max_tokens.max
      const newConCompletionParams = produce(completionParams, (draft: any) => {
        if (nextParamsRule.max_tokens.enabled) {
          if (completionParams.max_tokens > nextSelectModelMaxToken) {
            Toast.notify({
              type: 'warning',
              message: t('common.model.params.setToCurrentModelMaxTokenTip', { maxToken: formatNumber(nextSelectModelMaxToken) }),
            })
            draft.max_tokens = parseFloat((nextSelectModelMaxToken * 0.8).toFixed(2))
          }
          // prev don't have max token
          if (!completionParams.max_tokens)
            draft.max_tokens = nextParamsRule.max_tokens.default
        }
        else {
          delete draft.max_tokens
        }

        allSupportParams.forEach((key) => {
          if (key === 'max_tokens')
            return

          if (!nextParamsRule[key].enabled) {
            delete draft[key]
            return
          }

          if (draft[key] === undefined) {
            draft[key] = nextParamsRule[key].default || 0
            return
          }

          if (!prevParamsRule[key].enabled) {
            draft[key] = nextParamsRule[key].default || 0
            return
          }

          draft[key] = transformValue(
            draft[key],
            [prevParamsRule[key].min, prevParamsRule[key].max],
            [nextParamsRule[key].min, nextParamsRule[key].max],
          )
        })
      })
      onCompletionParamsChange(newConCompletionParams)
    }
  }

  // only openai support this
  function matchToneId(completionParams: CompletionParams): number {
    const remvoedCustomeTone = TONE_LIST.slice(0, -1)
    const CUSTOM_TONE_ID = 4
    const tone = remvoedCustomeTone.find((tone) => {
      return tone.config?.temperature === completionParams.temperature
        && tone.config?.top_p === completionParams.top_p
        && tone.config?.presence_penalty === completionParams.presence_penalty
        && tone.config?.frequency_penalty === completionParams.frequency_penalty
    })
    return tone ? tone.id : CUSTOM_TONE_ID
  }

  // tone is a preset of completionParams.
  const [toneId, setToneId] = React.useState(matchToneId(completionParams)) // default is Balanced
  const toneTabBgClassName = ({
    1: 'bg-[#F5F8FF]',
    2: 'bg-[#F4F3FF]',
    3: 'bg-[#F6FEFC]',
  })[toneId] || ''
  // set completionParams by toneId
  const handleToneChange = (id: number) => {
    if (id === 4)
      return // custom tone
    const tone = TONE_LIST.find(tone => tone.id === id)
    if (tone) {
      setToneId(id)
      onCompletionParamsChange({
        ...tone.config,
        max_tokens: completionParams.max_tokens,
      } as CompletionParams)
    }
  }

  useEffect(() => {
    setToneId(matchToneId(completionParams))
  }, [completionParams])

  const handleParamChange = (key: string, value: number) => {
    const currParamsRule = getAllParams()[provider]?.[modelId]
    let notOutRangeValue = parseFloat(value.toFixed(2))
    notOutRangeValue = Math.max(currParamsRule[key].min, notOutRangeValue)
    notOutRangeValue = Math.min(currParamsRule[key].max, notOutRangeValue)

    onCompletionParamsChange({
      ...completionParams,
      [key]: notOutRangeValue,
    })
  }
  const ableStyle = 'bg-indigo-25 border-[#2A87F5] cursor-pointer'
  const diabledStyle = 'bg-[#FFFCF5] border-[#F79009]'

  const getToneIcon = (toneId: number) => {
    const className = 'w-[14px] h-[14px]'
    const res = ({
      1: <Brush01 className={className}/>,
      2: <Scales02 className={className} />,
      3: <Target04 className={className} />,
      4: <Sliders02 className={className} />,
    })[toneId]
    return res
  }
  useEffect(() => {
    if (!currParams)
      return

    const max = currParams.max_tokens.max
    const isSupportMaxToken = currParams.max_tokens.enabled
    if (isSupportMaxToken && currModel?.model_provider.provider_name !== ProviderEnum.anthropic && completionParams.max_tokens > max * 2 / 3)
      setMaxTokenSettingTipVisible(true)
    else
      setMaxTokenSettingTipVisible(false)
  }, [currParams, completionParams.max_tokens, setMaxTokenSettingTipVisible])
  return (
    <div className='relative' ref={configContentRef}>
      <div
        className={cn('flex items-center border h-8 px-2.5 space-x-2 rounded-lg', disabled ? diabledStyle : ableStyle)}
        onClick={() => !disabled && toogleShowConfig()}
      >
        <ModelIcon
          modelId={modelId}
          providerName={provider}
        />
        <div className='text-[13px] text-gray-900 font-medium'>
          <ModelName modelId={selectedModel.name} />
        </div>
        {disabled ? <InformationCircleIcon className='w-3.5 h-3.5 text-[#F79009]' /> : <Cog8ToothIcon className='w-3.5 h-3.5 text-gray-500' />}
      </div>
      {isShowConfig && (
        <Panel
          className='absolute z-20 top-8 right-0 !w-[496px] bg-white !overflow-visible shadow-md'
          keepUnFold
          headerIcon={
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">
              <path d="M8.26865 0.790031C8.09143 0.753584 7.90866 0.753584 7.73144 0.790031C7.52659 0.832162 7.3435 0.934713 7.19794 1.01624L7.15826 1.03841L6.17628 1.58395C5.85443 1.76276 5.73846 2.16863 5.91727 2.49049C6.09608 2.81234 6.50195 2.9283 6.82381 2.74949L7.80579 2.20395C7.90681 2.14782 7.95839 2.11946 7.99686 2.10091L8.00004 2.09938L8.00323 2.10091C8.0417 2.11946 8.09327 2.14782 8.1943 2.20395L9.17628 2.74949C9.49814 2.9283 9.90401 2.81234 10.0828 2.49048C10.2616 2.16863 10.1457 1.76276 9.82381 1.58395L8.84183 1.03841L8.80215 1.01624C8.65659 0.934713 8.4735 0.832162 8.26865 0.790031Z" fill="#1C64F2" />
              <path d="M12.8238 3.25062C12.5019 3.07181 12.0961 3.18777 11.9173 3.50963C11.7385 3.83148 11.8544 4.23735 12.1763 4.41616L12.6272 4.66668L12.1763 4.91719C11.8545 5.096 11.7385 5.50186 11.9173 5.82372C12.0961 6.14558 12.502 6.26154 12.8238 6.08273L13.3334 5.79966V6.33339C13.3334 6.70158 13.6319 7.00006 14 7.00006C14.3682 7.00006 14.6667 6.70158 14.6667 6.33339V5.29435L14.6668 5.24627C14.6673 5.12441 14.6678 4.98084 14.6452 4.83482C14.6869 4.67472 14.6696 4.49892 14.5829 4.34286C14.4904 4.1764 14.3371 4.06501 14.1662 4.02099C14.0496 3.93038 13.9239 3.86116 13.8173 3.8024L13.7752 3.77915L12.8238 3.25062Z" fill="#1C64F2" />
              <path d="M3.8238 4.41616C4.14566 4.23735 4.26162 3.83148 4.08281 3.50963C3.90401 3.18777 3.49814 3.07181 3.17628 3.25062L2.22493 3.77915L2.18284 3.8024C2.07615 3.86116 1.95045 3.9304 1.83382 4.02102C1.66295 4.06506 1.50977 4.17643 1.41731 4.34286C1.33065 4.49886 1.31323 4.67459 1.35493 4.83464C1.33229 4.98072 1.33281 5.12436 1.33326 5.24627L1.33338 5.29435V6.33339C1.33338 6.70158 1.63185 7.00006 2.00004 7.00006C2.36823 7.00006 2.66671 6.70158 2.66671 6.33339V5.79961L3.17632 6.08273C3.49817 6.26154 3.90404 6.14558 4.08285 5.82372C4.26166 5.50186 4.1457 5.096 3.82384 4.91719L3.3729 4.66666L3.8238 4.41616Z" fill="#1C64F2" />
              <path d="M2.66671 9.66672C2.66671 9.29853 2.36823 9.00006 2.00004 9.00006C1.63185 9.00006 1.33338 9.29853 1.33338 9.66672V10.7058L1.33326 10.7538C1.33262 10.9298 1.33181 11.1509 1.40069 11.3594C1.46024 11.5397 1.55759 11.7051 1.68622 11.8447C1.835 12.0061 2.02873 12.1128 2.18281 12.1977L2.22493 12.221L3.17628 12.7495C3.49814 12.9283 3.90401 12.8123 4.08281 12.4905C4.26162 12.1686 4.14566 11.7628 3.8238 11.584L2.87245 11.0554C2.76582 10.9962 2.71137 10.9656 2.67318 10.9413L2.66995 10.9392L2.66971 10.9354C2.66699 10.8902 2.66671 10.8277 2.66671 10.7058V9.66672Z" fill="#1C64F2" />
              <path d="M14.6667 9.66672C14.6667 9.29853 14.3682 9.00006 14 9.00006C13.6319 9.00006 13.3334 9.29853 13.3334 9.66672V10.7058C13.3334 10.8277 13.3331 10.8902 13.3304 10.9354L13.3301 10.9392L13.3269 10.9413C13.2887 10.9656 13.2343 10.9962 13.1276 11.0554L12.1763 11.584C11.8544 11.7628 11.7385 12.1686 11.9173 12.4905C12.0961 12.8123 12.5019 12.9283 12.8238 12.7495L13.7752 12.221L13.8172 12.1977C13.9713 12.1128 14.1651 12.0061 14.3139 11.8447C14.4425 11.7051 14.5398 11.5397 14.5994 11.3594C14.6683 11.1509 14.6675 10.9298 14.6668 10.7538L14.6667 10.7058V9.66672Z" fill="#1C64F2" />
              <path d="M6.82381 13.2506C6.50195 13.0718 6.09608 13.1878 5.91727 13.5096C5.73846 13.8315 5.85443 14.2374 6.17628 14.4162L7.15826 14.9617L7.19793 14.9839C7.29819 15.04 7.41625 15.1061 7.54696 15.1556C7.66589 15.2659 7.82512 15.3333 8.00008 15.3333C8.17507 15.3333 8.33431 15.2659 8.45324 15.1556C8.58391 15.1061 8.70193 15.04 8.80215 14.9839L8.84183 14.9617L9.82381 14.4162C10.1457 14.2374 10.2616 13.8315 10.0828 13.5096C9.90401 13.1878 9.49814 13.0718 9.17628 13.2506L8.66675 13.5337V13C8.66675 12.6318 8.36827 12.3333 8.00008 12.3333C7.63189 12.3333 7.33341 12.6318 7.33341 13V13.5337L6.82381 13.2506Z" fill="#1C64F2" />
              <path d="M6.82384 6.58385C6.50199 6.40505 6.09612 6.52101 5.91731 6.84286C5.7385 7.16472 5.85446 7.57059 6.17632 7.7494L7.33341 8.39223V9.66663C7.33341 10.0348 7.63189 10.3333 8.00008 10.3333C8.36827 10.3333 8.66675 10.0348 8.66675 9.66663V8.39223L9.82384 7.7494C10.1457 7.57059 10.2617 7.16472 10.0829 6.84286C9.90404 6.52101 9.49817 6.40505 9.17632 6.58385L8.00008 7.23732L6.82384 6.58385Z" fill="#1C64F2" />
            </svg>
          }
          title={t('appDebug.modelConfig.title')}
        >
          <div className='py-3 pl-10 pr-6 text-sm'>
            <div className="flex items-center justify-between my-5 h-9">
              <div>{t('appDebug.modelConfig.model')}</div>
              <ModelSelector
                popClassName='right-0'
                triggerIconSmall
                value={{
                  modelName: modelId,
                  providerName: provider,
                }}
                modelType={ModelType.textGeneration}
                onChange={(model) => {
                  handleSelectModel(model.model_name, model.model_provider.provider_name as ProviderEnum)()
                }}
              />
            </div>
            {hasEnableParams && (
              <div className="border-b border-gray-100"></div>
            )}

            {/* Tone type */}
            {[ProviderEnum.openai, ProviderEnum.azure_openai].includes(provider) && (
              <div className="mt-5 mb-4">
                <div className="mb-3 text-sm text-gray-900">{t('appDebug.modelConfig.setTone')}</div>
                <Radio.Group className={cn('!rounded-lg', toneTabBgClassName)} value={toneId} onChange={handleToneChange}>
                  <>
                    {TONE_LIST.slice(0, 3).map(tone => (
                      <div className='grow flex items-center' key={tone.id}>
                        <Radio
                          value={tone.id}
                          className={cn(tone.id === toneId && 'rounded-md border border-gray-200 shadow-md', '!mr-0 grow !px-2 !justify-center text-[13px] font-medium')}
                          labelClassName={cn(tone.id === toneId
                            ? ({
                              1: 'text-[#6938EF]',
                              2: 'text-[#444CE7]',
                              3: 'text-[#107569]',
                            })[toneId]
                            : 'text-[#667085]', 'flex items-center space-x-2')}
                        >
                          <>
                            {getToneIcon(tone.id)}
                            <div>{t(`common.model.tone.${tone.name}`) as string}</div>
                            <div className=""></div>
                          </>
                        </Radio>
                        {tone.id !== toneId && tone.id + 1 !== toneId && (<div className='h-5 border-r border-gray-200'></div>)}
                      </div>
                    ))}
                  </>
                  <Radio
                    value={TONE_LIST[3].id}
                    className={cn(toneId === 4 && 'rounded-md border border-gray-200 shadow-md', '!mr-0 grow !px-2 !justify-center text-[13px] font-medium')}
                    labelClassName={cn('flex items-center space-x-2 ', toneId === 4 ? 'text-[#155EEF]' : 'text-[#667085]')}
                  >
                    <>
                      {getToneIcon(TONE_LIST[3].id)}
                      <div>{t(`common.model.tone.${TONE_LIST[3].name}`) as string}</div>
                    </>
                  </Radio>
                </Radio.Group>
              </div>
            )}

            {/* Params */}
            <div className={cn(hasEnableParams && 'mt-4', 'space-y-4', !allParams[provider]?.[modelId] && 'flex items-center min-h-[200px]')}>
              {allParams[provider]?.[modelId]
                ? (
                  currSupportParams.map(key => (<ParamItem
                    key={key}
                    id={key}
                    name={t(`common.model.params.${key}`)}
                    tip={t(`common.model.params.${key}Tip`)}
                    {...currParams[key] as any}
                    value={(completionParams as any)[key] as any}
                    onChange={handleParamChange}
                  />))
                )
                : (
                  <Loading type='area'/>
                )}
            </div>
          </div>
          {
            maxTokenSettingTipVisible && (
              <div className='flex py-2 pr-4 pl-5 rounded-bl-xl rounded-br-xl bg-[#FFFAEB] border-t border-[#FEF0C7]'>
                <AlertTriangle className='shrink-0 mr-2 mt-[3px] w-3 h-3 text-[#F79009]' />
                <div className='mr-2 text-xs font-medium text-gray-700'>{t('common.model.params.maxTokenSettingTip')}</div>
              </div>
            )
          }
        </Panel>
      )}
    </div>

  )
}

export default React.memo(ConfigModel)
