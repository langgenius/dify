'use client'
import type { FC } from 'react'
import React, { useEffect, useState } from 'react'
import cn from 'classnames'
import { useTranslation } from 'react-i18next'
import { useBoolean, useClickAway } from 'ahooks'
import ParamItem from './param-item'
import Radio from '@/app/components/base/radio'
import Panel from '@/app/components/base/panel'
import type { CompletionParams } from '@/models/debug'
import { Cog8ToothIcon, InformationCircleIcon, ChevronDownIcon } from '@heroicons/react/24/outline'
import { AppType } from '@/types/app'
import { TONE_LIST } from '@/config'
import Toast from '@/app/components/base/toast'

export type IConifgModelProps = {
  mode: string
  modelId: string
  setModelId: (id: string) => void
  completionParams: CompletionParams
  onCompletionParamsChange: (newParams: CompletionParams) => void
  disabled: boolean
  canUseGPT4: boolean
  onShowUseGPT4Confirm: () => void
}

const options = [
  { id: 'gpt-3.5-turbo', name: 'gpt-3.5-turbo', type: AppType.chat },
  { id: 'gpt-4', name: 'gpt-4', type: AppType.chat }, // 8k version
  { id: 'gpt-3.5-turbo', name: 'gpt-3.5-turbo', type: AppType.completion },
  { id: 'text-davinci-003', name: 'text-davinci-003', type: AppType.completion },
  { id: 'gpt-4', name: 'gpt-4', type: AppType.completion }, // 8k version
]

const ModelIcon = ({ className }: { className?: string }) => (
  <svg className={`w-4 h-4 ${className}`} width="20" height="20" viewBox="0 0 20 20" fill="none" xmlns="http://www.w3.org/2000/svg">
    <rect width="20" height="20" rx="6" fill="black" />
    <path d="M16.5963 9.65729C16.748 9.99569 16.8443 10.3574 16.8836 10.7265C16.9216 11.0955 16.9026 11.4689 16.8238 11.8321C16.7465 12.1953 16.6123 12.5439 16.4256 12.8648C16.3031 13.0793 16.1587 13.2805 15.9924 13.4658C15.8276 13.6496 15.6438 13.8159 15.444 13.9617C15.2427 14.1076 15.0283 14.2301 14.8007 14.3308C14.5746 14.4299 14.3383 14.5058 14.0962 14.5554C13.9824 14.9084 13.8132 15.2424 13.5944 15.5429C13.3771 15.8434 13.1131 16.1074 12.8126 16.3247C12.5121 16.5435 12.1795 16.7127 11.8266 16.8265C11.4736 16.9417 11.1045 16.9986 10.7326 16.9986C10.4861 17.0001 10.2381 16.9738 9.99596 16.9242C9.75529 16.8732 9.51899 16.7959 9.2929 16.6952C9.06681 16.5946 8.85239 16.4691 8.65256 16.3233C8.45418 16.1774 8.2704 16.0097 8.10703 15.8244C7.74237 15.9032 7.36896 15.9221 6.99992 15.8842C6.63089 15.8448 6.26914 15.7486 5.92928 15.5969C5.59088 15.4466 5.27727 15.2424 5.00159 14.993C4.72591 14.7436 4.49107 14.4518 4.30582 14.1309C4.18184 13.9165 4.07973 13.6904 4.00242 13.4556C3.92511 13.2207 3.87406 12.9786 3.84781 12.7321C3.82155 12.487 3.82301 12.2391 3.84927 11.9926C3.87552 11.7475 3.92949 11.5054 4.0068 11.2705C3.75883 10.9949 3.55462 10.6813 3.40292 10.3428C3.25268 10.003 3.15495 9.6427 3.11703 9.27367C3.07765 8.90463 3.09807 8.53122 3.17538 8.16802C3.25268 7.80482 3.38688 7.4562 3.57358 7.1353C3.69611 6.92088 3.84051 6.71813 4.00534 6.53434C4.17017 6.35056 4.35541 6.18427 4.55525 6.03841C4.75508 5.89254 4.97096 5.76856 5.19705 5.66937C5.42459 5.56873 5.66089 5.49434 5.90303 5.44474C6.0168 5.09029 6.186 4.75772 6.40334 4.45725C6.62213 4.15677 6.88615 3.89275 7.18663 3.67396C7.48711 3.45662 7.81968 3.28742 8.17267 3.17219C8.52566 3.05841 8.89469 3.00007 9.26664 3.00153C9.51315 3.00007 9.76112 3.02486 10.0033 3.07592C10.2454 3.12697 10.4817 3.20282 10.7078 3.30346C10.9339 3.40557 11.1483 3.52955 11.3481 3.67542C11.548 3.82274 11.7317 3.98902 11.8951 4.17427C12.2583 4.09696 12.6317 4.078 13.0008 4.11592C13.3698 4.15385 13.7301 4.25158 14.0699 4.40182C14.4083 4.55352 14.7219 4.75627 14.9976 5.00569C15.2733 5.25366 15.5082 5.54393 15.6934 5.86629C15.8174 6.07925 15.9195 6.30534 15.9968 6.54164C16.0741 6.77648 16.1266 7.01861 16.1514 7.26512C16.1777 7.51163 16.1777 7.7596 16.15 8.00611C16.1237 8.25262 16.0697 8.49475 15.9924 8.72959C16.2418 9.00528 16.4446 9.31742 16.5963 9.65729ZM11.7361 15.8842C12.0541 15.7529 12.3429 15.5589 12.5865 15.3153C12.8301 15.0717 13.0241 14.7829 13.1554 14.4635C13.2866 14.1455 13.3552 13.8042 13.3552 13.46V10.2072C13.3542 10.2043 13.3533 10.2009 13.3523 10.197C13.3513 10.1941 13.3499 10.1911 13.3479 10.1882C13.346 10.1853 13.3435 10.1829 13.3406 10.1809C13.3377 10.178 13.3348 10.1761 13.3319 10.1751L12.1547 9.49538V13.4249C12.1547 13.4643 12.1489 13.5052 12.1387 13.5431C12.1285 13.5825 12.1139 13.6189 12.0935 13.654C12.0731 13.689 12.0497 13.7211 12.0206 13.7488C11.9922 13.777 11.9603 13.8015 11.9257 13.8217L9.13828 15.4306C9.11495 15.4452 9.07556 15.4656 9.05514 15.4772C9.17037 15.575 9.29582 15.661 9.42709 15.7369C9.55983 15.8127 9.69694 15.8769 9.83989 15.9294C9.98284 15.9805 10.1302 16.0199 10.2789 16.0461C10.4292 16.0724 10.5809 16.0855 10.7326 16.0855C11.0768 16.0855 11.4181 16.0169 11.7361 15.8842ZM5.09786 13.6758C5.27144 13.9749 5.50044 14.2345 5.77321 14.4445C6.04743 14.6546 6.35812 14.8077 6.69069 14.8967C7.02326 14.9857 7.37042 15.009 7.71174 14.9638C8.05306 14.9186 8.38125 14.8077 8.68027 14.6356L11.4984 13.0092L11.5057 13.0019C11.5076 13 11.5091 12.9971 11.51 12.9932C11.512 12.9903 11.5134 12.9874 11.5144 12.9844V11.6133L8.11286 13.581C8.07786 13.6014 8.04139 13.616 8.00346 13.6277C7.96408 13.6379 7.9247 13.6423 7.88386 13.6423C7.84447 13.6423 7.80509 13.6379 7.76571 13.6277C7.72778 13.616 7.68986 13.6014 7.65485 13.581L4.86739 11.9707C4.8426 11.9561 4.80613 11.9342 4.78571 11.9211C4.75946 12.0713 4.74633 12.223 4.74633 12.3747C4.74633 12.5264 4.76091 12.6781 4.78717 12.8284C4.81342 12.9771 4.85427 13.1245 4.90532 13.2674C4.95783 13.4104 5.02201 13.5475 5.09786 13.6788V13.6758ZM4.36562 7.59332C4.1935 7.89234 4.08265 8.22199 4.03743 8.56331C3.99221 8.90463 4.01555 9.25033 4.10453 9.58436C4.1935 9.91692 4.34666 10.2276 4.5567 10.5018C4.76675 10.7746 5.02784 11.0036 5.32541 11.1757L8.14204 12.8036C8.14495 12.8045 8.14836 12.8055 8.15225 12.8065H8.16246C8.16635 12.8065 8.16975 12.8055 8.17267 12.8036C8.17558 12.8026 8.1785 12.8011 8.18142 12.7992L9.36291 12.1165L5.96137 10.1532C5.92782 10.1328 5.89573 10.108 5.86656 10.0803C5.8383 10.0519 5.81379 10.0201 5.79363 9.98548C5.77467 9.95047 5.75862 9.91401 5.74841 9.87462C5.7382 9.8367 5.73237 9.79732 5.73383 9.75647V6.44391C5.59088 6.49642 5.45231 6.5606 5.32103 6.63645C5.18975 6.71376 5.06577 6.80128 4.94908 6.899C4.83385 6.99673 4.72591 7.10467 4.62818 7.22136C4.53045 7.3366 4.44439 7.46204 4.36854 7.59332H4.36562ZM14.0408 9.84545C14.0758 9.86587 14.1079 9.88921 14.137 9.91838C14.1647 9.9461 14.1895 9.97819 14.21 10.0132C14.2289 10.0482 14.245 10.0861 14.2552 10.1241C14.2639 10.1634 14.2698 10.2028 14.2683 10.2437V13.5562C14.7365 13.3841 15.145 13.0822 15.4469 12.6854C15.7503 12.2887 15.9326 11.8146 15.9749 11.3187C16.0172 10.8227 15.918 10.3239 15.6876 9.88192C15.4571 9.43995 15.1056 9.07237 14.6738 8.82441L11.8572 7.19657C11.8543 7.19559 11.8509 7.19462 11.847 7.19365H11.8368C11.8338 7.19462 11.8304 7.19559 11.8266 7.19657C11.8236 7.19754 11.8207 7.199 11.8178 7.20094L10.6421 7.88067L14.0437 9.84545H14.0408ZM15.215 8.0805H15.2135V8.08196L15.215 8.0805ZM15.2135 8.07904C15.2981 7.58894 15.2412 7.08425 15.0487 6.62478C14.8576 6.16531 14.5382 5.77002 14.1297 5.48413C13.7213 5.19969 13.24 5.03632 12.7426 5.01445C12.2437 4.99402 11.7507 5.11509 11.3189 5.36306L8.50232 6.98944C8.4994 6.99138 8.49697 6.99382 8.49503 6.99673L8.48919 7.00549C8.48822 7.0084 8.48725 7.01181 8.48627 7.0157C8.4853 7.01861 8.48482 7.02202 8.48482 7.02591V8.38536L11.8864 6.42057C11.9214 6.40015 11.9593 6.38556 11.9972 6.37389C12.0366 6.36368 12.076 6.35931 12.1154 6.35931C12.1562 6.35931 12.1956 6.36368 12.235 6.37389C12.2729 6.38556 12.3094 6.40015 12.3444 6.42057L15.1318 8.03091C15.1566 8.04549 15.1931 8.06591 15.2135 8.07904ZM7.84301 6.57373C7.84301 6.53434 7.84885 6.49496 7.85906 6.45558C7.86927 6.41765 7.88386 6.37973 7.90428 6.34472C7.9247 6.31117 7.94804 6.27908 7.97721 6.24991C8.00492 6.2222 8.03701 6.1974 8.07202 6.17844L10.8595 4.56956C10.8857 4.55352 10.9222 4.53309 10.9426 4.52288C10.5605 4.20344 10.0937 3.99923 9.59921 3.93651C9.10474 3.87233 8.60296 3.9511 8.15225 4.1626C7.70007 4.3741 7.3179 4.71105 7.05097 5.13114C6.78404 5.55268 6.64256 6.03987 6.64256 6.53872V9.79148C6.64353 9.79537 6.6445 9.79878 6.64547 9.80169C6.64645 9.80461 6.6479 9.80753 6.64985 9.81044C6.65179 9.81336 6.65422 9.81628 6.65714 9.8192C6.65909 9.82114 6.662 9.82309 6.66589 9.82503L7.84301 10.5048V6.57373ZM8.4819 10.8723L9.99742 11.7475L11.5129 10.8723V9.12343L9.99888 8.24824L8.48336 9.12343L8.4819 10.8723Z" fill="white" />
  </svg>
)

const ConifgModel: FC<IConifgModelProps> = ({
  mode,
  modelId,
  setModelId,
  completionParams,
  onCompletionParamsChange,
  disabled,
  canUseGPT4,
  onShowUseGPT4Confirm,
}) => {
  const { t } = useTranslation()
  const isChatApp = mode === AppType.chat
  const availableModels = options.filter((item) => item.type === mode)
  const [isShowConfig, { setFalse: hideConfig, toggle: toogleShowConfig }] = useBoolean(false)
  const configContentRef = React.useRef(null)
  useClickAway(() => {
    hideConfig()
  }, configContentRef)

  const params = [
    {
      id: 1,
      name: t('common.model.params.temperature'),
      key: 'temperature',
      tip: t('common.model.params.temperatureTip'),
      max: 2,
    },
    {
      id: 2,
      name: t('common.model.params.topP'),
      key: 'top_p',
      tip: t('common.model.params.topPTip'),
      max: 1,
    },
    {
      id: 3,
      name: t('common.model.params.presencePenalty'),
      key: 'presence_penalty',
      tip: t('common.model.params.presencePenaltyTip'),
      min: -2,
      max: 2,
    },
    {
      id: 4,
      name: t('common.model.params.frequencyPenalty'),
      key: 'frequency_penalty',
      tip: t('common.model.params.frequencyPenaltyTip'),
      min: -2,
      max: 2,
    },
    {
      id: 5,
      name: t('common.model.params.maxToken'),
      key: 'max_tokens',
      tip: t('common.model.params.maxTokenTip'),
      step: 100,
      max: modelId === 'gpt-4' ? 8000 : 4000,
    },
  ]

  const selectModelDisabled = false // chat  gpt-3.5-turbo, gpt-4; text generation text-davinci-003, gpt-3.5-turbo

  const selectedModel = { name: modelId } // options.find(option => option.id === modelId)
  const [isShowOption, { setFalse: hideOption, toggle: toogleOption }] = useBoolean(false)
  const triggerRef = React.useRef(null)
  useClickAway(() => {
    hideOption()
  }, triggerRef)

  const handleSelectModel = (id: string) => {
    return () => {
      if (id === 'gpt-4' && !canUseGPT4) {
        hideConfig()
        hideOption()
        onShowUseGPT4Confirm()
        return
      }
      if(id !== 'gpt-4' && completionParams.max_tokens > 4000) {
        Toast.notify({
          type: 'warning',
          message: t('common.model.params.setToCurrentModelMaxTokenTip')
        })
        onCompletionParamsChange({
          ...completionParams,
          max_tokens: 4000
        })
      }
      setModelId(id)
    }
  }

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
  // set completionParams by toneId
  const handleToneChange = (id: number) => {
    if (id === 4)
      return // custom tone
    const tone = TONE_LIST.find(tone => tone.id === id)
    if (tone) {
      setToneId(id)
      onCompletionParamsChange({
        ...tone.config,
        max_tokens: completionParams.max_tokens
      } as CompletionParams)
    }
  }

  useEffect(() => {
    setToneId(matchToneId(completionParams))
  }, [completionParams])

  const handleParamChange = (id: number, value: number) => {
    const key = params.find(item => item.id === id)?.key

    if (key) {
      onCompletionParamsChange({
        ...completionParams,
        [key]: value,
      })
    }
  }
  const ableStyle = 'bg-indigo-25 border-[#2A87F5] cursor-pointer'
  const diabledStyle = 'bg-[#FFFCF5] border-[#F79009]'

  return (
    <div className='relative' ref={configContentRef}>
      <div
        className={cn(`flex items-center border h-8 px-2.5 space-x-2 rounded-lg`, disabled ? diabledStyle : ableStyle)}
        onClick={() => !disabled && toogleShowConfig()}
      >
        <ModelIcon />
        <div className='text-[13px] text-gray-900 font-medium'>{selectedModel.name}</div>
        {disabled ? <InformationCircleIcon className='w-3.5 h-3.5 text-[#F79009]' /> : <Cog8ToothIcon className='w-3.5 h-3.5 text-gray-500' />}
      </div>
      {isShowConfig && (
        <Panel
          className='absolute z-20 top-8 right-0 !w-[496px] bg-white'
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
              {/* model selector */}
              <div className="relative" style={{zIndex: 30}}>
                <div ref={triggerRef} onClick={() => !selectModelDisabled && toogleOption()} className={cn(selectModelDisabled ? 'cursor-not-allowed' : 'cursor-pointer', "flex items-center h-9 px-3 space-x-2 rounded-lg bg-gray-50 ")}>
                  <ModelIcon />
                  <div className="text-sm gray-900">{selectedModel?.name}</div>
                  {!selectModelDisabled && <ChevronDownIcon className={cn(isShowOption && 'rotate-180', 'w-[14px] h-[14px] text-gray-500')} />}
                </div>
                {isShowOption && (
                  <div className={cn(isChatApp ? 'w-[159px]' : 'w-[179px]', "absolute right-0 bg-gray-50 rounded-lg shadow")}>
                    {availableModels.map(item => (
                      <div key={item.id} onClick={handleSelectModel(item.id)} className="flex items-center h-9 px-3 rounded-lg cursor-pointer hover:bg-gray-100">
                        <ModelIcon className='mr-2' />
                        <div className="text-sm gray-900">{item.name}</div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
            <div className="border-b border-gray-100"></div>

            {/* Response type */}
            <div className="mt-5 mb-4">
              <div className="mb-4 text-sm text-gray-900">{t('appDebug.modelConfig.setTone')}</div>
              <Radio.Group value={toneId} onChange={handleToneChange}>
                <>
                  {TONE_LIST.slice(0, 3).map(tone => (
                    <Radio key={tone.id} value={tone.id} className="grow !px-0 !justify-center">{t(`common.model.tone.${tone.name}`) as string}</Radio>
                  ))}
                </>
                <div className="ml-[2px] mr-[3px] h-5 border-r border-gray-200"></div>
                <Radio value={TONE_LIST[3].id}>{t(`common.model.tone.${TONE_LIST[3].name}`) as string}</Radio>
              </Radio.Group>
            </div>

            {/* Params */}
            <div className="mt-4 space-y-4">
              {params.map(({ key, ...param }) => (<ParamItem key={key} {...param} value={(completionParams as any)[key] as any} onChange={handleParamChange} />))}
            </div>
          </div>
        </Panel>
      )}
    </div>

  )
}

export default React.memo(ConifgModel)
