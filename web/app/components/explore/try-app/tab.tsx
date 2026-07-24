'use client'
import type { FC } from 'react'
import * as React from 'react'
import { useTranslation } from 'react-i18next'
import { IS_CLOUD_EDITION } from '@/config'
import TabHeader from '../../base/tab-header'

export enum TypeEnum {
  TRY = 'try',
  DETAIL = 'detail',
}

type Props = {
  value: TypeEnum
  onChange: (value: TypeEnum) => void
  disableTry?: boolean
}

const Tab: FC<Props> = ({
  value,
  onChange,
  disableTry,
}) => {
  const { t } = useTranslation()

  const tabs = React.useMemo(() => {
    return [
      IS_CLOUD_EDITION ? { id: TypeEnum.TRY, name: t('tryApp.tabHeader.try', { ns: 'explore' }), disabled: disableTry } : null,
      { id: TypeEnum.DETAIL, name: t('tryApp.tabHeader.detail', { ns: 'explore' }) },
    ].filter(item => item !== null) as { id: TypeEnum, name: string }[]
  }, [t, disableTry])
  return (
    <TabHeader
      items={tabs}
      value={value}
      onChange={onChange as (value: string) => void}
      itemClassName="ml-0 system-md-semibold-uppercase"
      itemWrapClassName="pt-2"
      activeItemClassName="border-util-colors-blue-brand-blue-brand-500"
    />
  )
}
export default React.memo(Tab)
