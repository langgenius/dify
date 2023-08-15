import { useState } from 'react'
import type { FC } from 'react'
import { useTranslation } from 'react-i18next'
import { useContext } from 'use-context-selector'
import type { ProviderConfigItem, TypeWithI18N } from '../declarations'
import { ProviderEnum as ProviderEnumValue } from '../declarations'
import s from './index.module.css'
import I18n from '@/context/i18n'
import Button from '@/app/components/base/button'
import { submitFreeQuota } from '@/service/common'
import { LinkExternal01 } from '@/app/components/base/icons/src/vender/line/general'

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
type FreeQuotaProps = {
  modelItem: ProviderConfigItem
  onUpdate: () => void
}
const FreeQuota: FC<FreeQuotaProps> = ({
  modelItem,
  onUpdate,
}) => {
  const { locale } = useContext(I18n)
  const { t } = useTranslation()
  const [loading, setLoading] = useState(false)

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

  return (
    <div className='flex items-center'>
      📣
      <div className={`${s.vender} ml-1 text-xs font-medium text-transparent`}>{TIP_MAP[modelItem.key][locale]}</div>
      <div className='mx-1 text-xs font-medium text-gray-400'>·</div>
      <a
        href='https://docs.dify.ai/v/zh-hans/getting-started/faq/llms-use-faq#8.-ru-he-mian-fei-shen-ling-xun-fei-xing-huo-minimax-mo-xing-de-ti-yanedu'
        target='_blank'
        className='flex items-center text-xs font-medium text-[#155EEF]'>
        {t('common.modelProvider.freeQuota.howToEarn')}
        <LinkExternal01 className='ml-0.5 w-3 h-3' />
      </a>
      <Button
        type='primary'
        className='ml-3 !px-3 !h-7 !rounded-md !text-xs !font-medium'
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
