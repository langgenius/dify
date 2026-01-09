import type { FC } from 'react'
import { useTranslation } from 'react-i18next'
import { ZapFast } from '@/app/components/base/icons/src/vender/solid/general'
import UpgradeBtn from '@/app/components/billing/upgrade-btn'

const UpgradeBanner: FC = () => {
  const { t } = useTranslation()

  return (
    <div className="flex h-14 items-center rounded-xl border-[0.5px] border-black/5 bg-white p-3 shadow-md">
      <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-[#FFF6ED]">
        <ZapFast className="h-4 w-4 text-[#FB6514]" />
      </div>
      <div className="mx-3 grow text-[13px] font-medium text-gray-700">
        {t('plansCommon.documentProcessingPriorityUpgrade', { ns: 'billing' })}
      </div>
      <UpgradeBtn loc="knowledge-speed-up" />
    </div>
  )
}

export default UpgradeBanner
