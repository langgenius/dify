'use client'
import type { FC } from 'react'
import React from 'react'
import { useContext } from 'use-context-selector'
import I18n from '@/context/i18n'
import type { ProviderEnum } from '@/app/components/header/account-setting/model-page/declarations'
import ProviderConfig from '@/app/components/header/account-setting/model-page/configs'

export type IProviderNameProps = {
  provideName: ProviderEnum
}

const ProviderName: FC<IProviderNameProps> = ({
  provideName,
}) => {
  const { locale } = useContext(I18n)

  return (
    <span>
      {ProviderConfig[provideName]?.selector?.name[locale]}
    </span>
  )
}
export default React.memo(ProviderName)
