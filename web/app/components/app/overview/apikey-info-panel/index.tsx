'use client'
import type { FC } from 'react'
import { RiCloseLine } from '@remixicon/react'
import * as React from 'react'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import Button from '@/app/components/base/button'
import { LinkExternal02 } from '@/app/components/base/icons/src/vender/line/general'
import { ACCOUNT_SETTING_TAB } from '@/app/components/header/account-setting/constants'
import { IS_CE_EDITION } from '@/config'
import { useModalContext } from '@/context/modal-context'
import { useProviderContext } from '@/context/provider-context'
import { cn } from '@/utils/classnames'

const APIKeyInfoPanel: FC = () => {
  const isCloud = !IS_CE_EDITION

  const { isAPIKeySet } = useProviderContext()
  const { setShowAccountSettingModal } = useModalContext()

  const { t } = useTranslation()

  const [isShow, setIsShow] = useState(true)

  if (isAPIKeySet)
    return null

  if (!(isShow))
    return null

  return (
    <div className={cn('border-components-panel-border bg-components-panel-bg', 'relative mb-6 rounded-2xl border p-8 shadow-md ')}>
      <div className={cn('text-[24px] font-semibold text-text-primary', isCloud ? 'flex h-8 items-center space-x-1' : 'mb-6 leading-8')}>
        {isCloud && <em-emoji id="😀" />}
        {isCloud
          ? (
              <div>{t('apiKeyInfo.cloud.trial.title', { ns: 'appOverview', providerName: 'OpenAI' })}</div>
            )
          : (
              <div>
                <div>{t('apiKeyInfo.selfHost.title.row1', { ns: 'appOverview' })}</div>
                <div>{t('apiKeyInfo.selfHost.title.row2', { ns: 'appOverview' })}</div>
              </div>
            )}
      </div>
      {isCloud && (
        <div className="mt-1 text-sm font-normal text-text-tertiary">{t(`apiKeyInfo.cloud.${'trial'}.description`, { ns: 'appOverview' })}</div>
      )}
      <Button
        variant="primary"
        className="mt-2 space-x-2"
        onClick={() => setShowAccountSettingModal({ payload: ACCOUNT_SETTING_TAB.PROVIDER })}
      >
        <div className="text-sm font-medium">{t('apiKeyInfo.setAPIBtn', { ns: 'appOverview' })}</div>
        <LinkExternal02 className="h-4 w-4" />
      </Button>
      {!isCloud && (
        <a
          className="mt-2 flex h-[26px] items-center space-x-1  p-1 text-xs font-medium text-[#155EEF]"
          href="https://cloud.dify.ai/apps"
          target="_blank"
          rel="noopener noreferrer"
        >
          <div>{t('apiKeyInfo.tryCloud', { ns: 'appOverview' })}</div>
          <LinkExternal02 className="h-3 w-3" />
        </a>
      )}
      <div
        onClick={() => setIsShow(false)}
        className="absolute right-4 top-4 flex h-8 w-8 cursor-pointer items-center justify-center "
      >
        <RiCloseLine className="h-4 w-4 text-text-tertiary" />
      </div>
    </div>
  )
}
export default React.memo(APIKeyInfoPanel)
