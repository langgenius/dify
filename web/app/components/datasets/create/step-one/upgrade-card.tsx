'use client'
import UpgradeBtn from '@/app/components/billing/upgrade-btn'
import { useModalContext } from '@/context/modal-context'
import type { FC } from 'react'
import React, { useCallback } from 'react'
import { useTranslation } from 'react-i18next'

const UpgradeCard: FC = () => {
  const { t } = useTranslation()
  const { setShowPricingModal } = useModalContext()

  const handleUpgrade = useCallback(() => {
    setShowPricingModal()
  }, [setShowPricingModal])

  return (
    <div className='flex items-center justify-between rounded-xl border-[0.5px] border-components-panel-border-subtle bg-components-panel-on-panel-item-bg py-3 pl-4 pr-3.5 shadow-xs backdrop-blur-[5px] '>
      <div>
        <div className='title-md-semi-bold bg-[linear-gradient(92deg,_var(--components-input-border-active-prompt-1,_#0BA5EC)_0%,_var(--components-input-border-active-prompt-2,_#155AEF)_99.21%)] bg-clip-text text-transparent'>{t('billing.upgrade.uploadMultipleFiles.title')}</div>
        <div className='system-xs-regular text-text-tertiary'>{t('billing.upgrade.uploadMultipleFiles.description')}</div>
      </div>
      <UpgradeBtn
        size='custom'
        isShort
        className='ml-3 !h-8 !rounded-lg px-2'
        labelKey='billing.triggerLimitModal.upgrade'
        loc='upload-multiple-files'
        onClick={handleUpgrade}
      />
    </div>
  )
}
export default React.memo(UpgradeCard)
