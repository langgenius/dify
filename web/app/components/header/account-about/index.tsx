'use client'
import type { LangGeniusVersionResponse } from '@/models/common'
import { Dialog, DialogContent } from '@langgenius/dify-ui/dialog'
import { RiCloseLine } from '@remixicon/react'
import { useSuspenseQuery } from '@tanstack/react-query'
import dayjs from 'dayjs'
import { useTranslation } from 'react-i18next'
import DifyLogo from '@/app/components/base/logo/dify-logo'

import { systemFeaturesQueryOptions } from '@/service/system-features'

type IAccountSettingProps = {
  langGeniusVersionInfo: LangGeniusVersionResponse
  onCancel: () => void
}

export default function AccountAbout({
  langGeniusVersionInfo,
  onCancel,
}: IAccountSettingProps) {
  const { t } = useTranslation()
  const { data: systemFeatures } = useSuspenseQuery(systemFeaturesQueryOptions())

  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open)
          onCancel()
      }}
    >
      <DialogContent className="w-[calc(100vw-2rem)]! max-w-[480px]! overflow-hidden! border-none px-6! py-4! text-left align-middle">

        <div className="relative">
          <button
            type="button"
            className="absolute top-0 right-0 flex size-8 cursor-pointer items-center justify-center border-none bg-transparent p-0 focus-visible:ring-1 focus-visible:ring-components-input-border-active focus-visible:outline-hidden"
            aria-label={t('operation.close', { ns: 'common' })}
            onClick={onCancel}
          >
            <RiCloseLine className="size-4 text-text-tertiary" aria-hidden="true" />
          </button>
          <div className="flex flex-col items-center gap-4 py-8">
            {systemFeatures.branding.enabled && systemFeatures.branding.workspace_logo
              ? (
                  <img
                    src={systemFeatures.branding.workspace_logo}
                    className="block h-7 w-auto object-contain"
                    alt="logo"
                  />
                )
              : <DifyLogo size="large" className="mx-auto" />}

            <div className="text-center text-xs font-normal text-text-tertiary">
              Version
              {langGeniusVersionInfo?.current_version}
            </div>
            <div className="flex flex-col items-center gap-2 text-center text-xs font-normal text-text-secondary">
              <div>
                ©
                {dayjs().year()}
                {' '}
                LangGenius, Inc., Contributors.
              </div>
            </div>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}
