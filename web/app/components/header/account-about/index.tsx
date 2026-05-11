'use client'
import type { LangGeniusVersionResponse } from '@/models/common'
import { Button } from '@langgenius/dify-ui/button'
import { Dialog, DialogContent } from '@langgenius/dify-ui/dialog'
import { RiCloseLine } from '@remixicon/react'
import { useSuspenseQuery } from '@tanstack/react-query'
import dayjs from 'dayjs'
import { useTranslation } from 'react-i18next'
import DifyLogo from '@/app/components/base/logo/dify-logo'
import { IS_CE_EDITION } from '@/config'

import Link from '@/next/link'
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
  const isLatest = langGeniusVersionInfo.current_version === langGeniusVersionInfo.latest_version
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
            className="absolute top-0 right-0 flex h-8 w-8 cursor-pointer items-center justify-center border-none bg-transparent p-0 focus-visible:ring-1 focus-visible:ring-components-input-border-active focus-visible:outline-hidden"
            aria-label={t('operation.close', { ns: 'common' })}
            onClick={onCancel}
          >
            <RiCloseLine className="h-4 w-4 text-text-tertiary" aria-hidden="true" />
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
              <div className="text-text-accent">
                {
                  IS_CE_EDITION
                    ? <Link href="https://github.com/langgenius/dify/blob/main/LICENSE" target="_blank" rel="noopener noreferrer">Open Source License</Link>
                    : (
                        <>
                          <Link href="https://dify.ai/privacy" target="_blank" rel="noopener noreferrer">Privacy Policy</Link>
                          ,&nbsp;
                          <Link href="https://dify.ai/terms" target="_blank" rel="noopener noreferrer">Terms of Service</Link>
                        </>
                      )
                }
              </div>
            </div>
          </div>
          <div className="-mx-6 mb-4 h-[0.5px] bg-divider-regular" />
          <div className="flex items-center justify-between gap-3">
            <div className="min-w-0 text-xs font-medium text-text-tertiary">
              {
                isLatest
                  ? t('about.latestAvailable', { ns: 'common', version: langGeniusVersionInfo.latest_version })
                  : t('about.nowAvailable', { ns: 'common', version: langGeniusVersionInfo.latest_version })
              }
            </div>
            <div className="flex shrink-0 items-center">
              <Button className="mr-2" size="small">
                <Link
                  href="https://github.com/langgenius/dify/releases"
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  {t('about.changeLog', { ns: 'common' })}
                </Link>
              </Button>
              {
                !isLatest && !IS_CE_EDITION && (
                  <Button variant="primary" size="small">
                    <Link
                      href={langGeniusVersionInfo.release_notes}
                      target="_blank"
                      rel="noopener noreferrer"
                    >
                      {t('about.updateNow', { ns: 'common' })}
                    </Link>
                  </Button>
                )
              }
            </div>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}
