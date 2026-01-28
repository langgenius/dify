'use client'

import type { FC } from 'react'
import { useTranslation } from 'react-i18next'
import CopyFeedback from '@/app/components/base/copy-feedback'
import SecretKeyButton from '@/app/components/develop/secret-key/secret-key-button'

type ApiServerProps = {
  apiBaseUrl: string
  appId?: string
}
const ApiServer: FC<ApiServerProps> = ({
  apiBaseUrl,
  appId,
}) => {
  const { t } = useTranslation()

  return (
    <div className="flex flex-wrap items-center gap-y-2">
      <div className="mr-2 flex h-8 items-center rounded-lg border-[0.5px] border-components-input-border-active bg-components-input-bg-normal pl-1.5 pr-1 leading-5">
        <div className="mr-0.5 h-5 shrink-0 rounded-md border border-divider-subtle px-1.5 text-[11px] text-text-tertiary">{t('apiServer', { ns: 'appApi' })}</div>
        <div className="w-fit truncate px-1 text-[13px] font-medium text-text-secondary sm:w-[248px]">{apiBaseUrl}</div>
        <div className="mx-1 h-[14px] w-[1px] bg-divider-regular"></div>
        <CopyFeedback content={apiBaseUrl} />
      </div>
      <div className="mr-2 flex h-8 items-center rounded-lg border-[0.5px] border-[#D1FADF] bg-[#ECFDF3] px-3 text-xs font-semibold text-[#039855]">
        {t('ok', { ns: 'appApi' })}
      </div>
      <SecretKeyButton
        className="!h-8 shrink-0"
        appId={appId}
      />
    </div>
  )
}

export default ApiServer
