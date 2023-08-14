import { useEffect, useState } from 'react'
import type { FC } from 'react'
import { useTranslation } from 'react-i18next'
import { useContext } from 'use-context-selector'
import type { ProviderConfigItem, ProviderWithQuota, TypeWithI18N } from '../declarations'
import { ProviderEnum as ProviderEnumValue } from '../declarations'
import s from './index.module.css'
import I18n from '@/context/i18n'
import Button from '@/app/components/base/button'
import { submitFreeQuota } from '@/service/common'
import { SPARK_FREE_QUOTA_PENDING } from '@/config'

const TIP_MAP: { [k: string]: TypeWithI18N } = {
  [ProviderEnumValue.minimax]: {
    'en': 'Earn 1 million tokens for free',
    'zh-Hans': '免费获取 100 万个 token',
  },
  [ProviderEnumValue.spark]: {
    'en': 'Earn 3 million tokens for free',
    'zh-Hans': '免费获取 300 万个 token',
  },
}
const FREE_QUOTA_TIP = {
  'en': 'Your 3 million tokens will be credited in 5 minutes.',
  'zh-Hans': '您的 300 万 token 将在 5 分钟内到账。',
}
type FreeQuotaProps = {
  modelItem: ProviderConfigItem
  onUpdate: () => void
  freeProvider?: ProviderWithQuota
}
const FreeQuota: FC<FreeQuotaProps> = ({
  modelItem,
  onUpdate,
  freeProvider,
}) => {
  const { locale } = useContext(I18n)
  const { t } = useTranslation()
  const [loading, setLoading] = useState(false)
  const [freeQuotaPending, setFreeQuotaPending] = useState(false)

  useEffect(() => {
    if (
      modelItem.key === ProviderEnumValue.spark
      && localStorage.getItem(SPARK_FREE_QUOTA_PENDING) === '1'
      && freeProvider
      && !freeProvider.is_valid
    )
      setFreeQuotaPending(true)
  }, [freeProvider, modelItem.key])

  const handleClick = async () => {
    try {
      setLoading(true)
      const res = await submitFreeQuota(`/workspaces/current/model-providers/${modelItem.key}/free-quota-submit`)

      if (res.type === 'redirect' && res.redirect_url)
        window.location.href = res.redirect_url
      else if (res.type === 'submit' && res.result === 'success')
        onUpdate()
    }
    finally {
      setLoading(false)
    }
  }

  if (freeQuotaPending) {
    return (
      <div className='flex items-center'>
        ⏳
        <div className={`${s.vender} ml-1 mr-2 text-xs font-medium text-transparent`}>{FREE_QUOTA_TIP[locale]}</div>
        <Button
          className='!px-3 !h-7 !rounded-md !text-xs !font-medium !bg-white !text-gray-700'
          onClick={onUpdate}
        >
          {t('common.operation.reload')}
        </Button>
        <div className='mx-2 w-[1px] h-4 bg-black/5' />
      </div>
    )
  }

  return (
    <div className='flex items-center'>
      📣
      <div className={`${s.vender} ml-1 mr-2 text-xs font-medium text-transparent`}>{TIP_MAP[modelItem.key][locale]}</div>
      <Button
        type='primary'
        className='!px-3 !h-7 !rounded-md !text-xs !font-medium'
        onClick={handleClick}
        disabled={loading}
      >
        {t('common.operation.getForFree')}
      </Button>
      <div className='mx-2 w-[1px] h-4 bg-black/5' />
    </div>
  )
}

export default FreeQuota
