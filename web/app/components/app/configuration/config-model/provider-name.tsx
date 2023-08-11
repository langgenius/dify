'use client'
import type { FC } from 'react'
import React from 'react'
import { useTranslation } from 'react-i18next'
import { ProviderEnum } from '@/app/components/header/account-setting/model-page/declarations'

export type IProviderNameProps = {
  provideName: ProviderEnum
}

const supportI18nProviderName = [
  ProviderEnum.openai,
  ProviderEnum.anthropic,
  ProviderEnum.replicate,
  ProviderEnum.azure_openai,
  ProviderEnum.huggingface_hub,
  ProviderEnum.wenxin,
  ProviderEnum.tongyi,
  ProviderEnum.spark,
  ProviderEnum.minimax,
  ProviderEnum.chatglm,
]

const ProviderName: FC<IProviderNameProps> = ({
  provideName,
}) => {
  const { t } = useTranslation()

  return (
    <span>
      {supportI18nProviderName.includes(provideName) ? t(`common.providerName.${provideName}`) : provideName}
    </span>
  )
}
export default React.memo(ProviderName)
