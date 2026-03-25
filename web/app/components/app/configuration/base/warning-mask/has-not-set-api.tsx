'use client'
import type { FC } from 'react'
import * as React from 'react'
import { useTranslation } from 'react-i18next'

export type IHasNotSetAPIProps = {
  onSetting: () => void
}

const HasNotSetAPI: FC<IHasNotSetAPIProps> = ({
  onSetting,
}) => {
  const { t } = useTranslation()

  return (
    <div className="flex grow flex-col items-center justify-center pb-[120px]">
      <div className="flex w-full max-w-[400px] flex-col gap-2 px-4 py-4">
        <div className="flex h-10 w-10 items-center justify-center rounded-[10px]">
          <div className="flex h-full w-full items-center justify-center overflow-hidden rounded-[10px] border-[0.5px] border-components-card-border bg-components-card-bg p-1 shadow-lg backdrop-blur-[5px]">
            <span className="i-ri-brain-2-line h-5 w-5 text-text-tertiary" />
          </div>
        </div>
        <div className="flex flex-col gap-1">
          <div className="text-text-secondary system-md-semibold">{t('noModelProviderConfigured', { ns: 'appDebug' })}</div>
          <div className="text-text-tertiary system-xs-regular">{t('noModelProviderConfiguredTip', { ns: 'appDebug' })}</div>
        </div>
        <button
          type="button"
          className="flex w-fit items-center gap-1 rounded-lg border-[0.5px] border-components-button-secondary-border bg-components-button-secondary-bg px-3 py-2 shadow-xs backdrop-blur-[5px]"
          onClick={onSetting}
        >
          <span className="text-components-button-secondary-accent-text system-sm-medium">{t('manageModels', { ns: 'appDebug' })}</span>
          <span className="i-ri-arrow-right-line h-4 w-4 text-components-button-secondary-accent-text" />
        </button>
      </div>
    </div>
  )
}
export default React.memo(HasNotSetAPI)
