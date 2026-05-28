'use client'

import { useTranslation } from 'react-i18next'

export function IntegrationSidebarMarketplaceCard() {
  const { t } = useTranslation()

  return (
    <div className="flex min-h-[123px] w-full shrink-0 flex-col items-start gap-2 rounded-xl bg-background-default-hover p-4">
      <div className="relative isolate h-[34.654px] w-[86.251px] shrink-0">
        <div className="absolute top-0 left-[-1px] z-[3] flex size-[34.139px] items-center justify-center">
          <div className="flex size-8 rotate-[-3.97deg] items-center justify-center rounded-lg border border-background-default-subtle bg-background-default-subtle">
            <div className="flex size-full items-center justify-center rounded-lg border-[0.5px] border-divider-regular bg-components-icon-bg-pink-soft p-1 text-[20px] leading-[1.2]">
              🕹️
            </div>
          </div>
        </div>
        <div className="absolute top-0 left-[26.14px] z-[2] flex size-[34.654px] items-center justify-center">
          <div className="flex size-8 rotate-[4.97deg] items-center justify-center rounded-lg border border-background-default-subtle bg-background-default-subtle">
            <div className="flex size-full items-center justify-center rounded-lg border-[0.5px] border-divider-regular bg-components-icon-bg-orange-dark-soft p-1 text-[20px] leading-[1.2]">
              📙
            </div>
          </div>
        </div>
        <div className="absolute top-px left-[53.79px] z-[1] flex size-[33.458px] items-center justify-center">
          <div className="flex size-8 rotate-[-2.67deg] items-center justify-center rounded-lg border border-background-default-subtle bg-background-default-subtle">
            <div className="flex size-full items-center justify-center rounded-lg border-[0.5px] border-divider-regular bg-components-icon-bg-teal-soft p-1 text-[20px] leading-[1.2]">
              🤖
            </div>
          </div>
        </div>
      </div>
      <div className="w-full system-xs-medium text-text-secondary">
        {t('settings.discoverMoreIntegrationsInMarketplace', { ns: 'common' })}
      </div>
    </div>
  )
}
