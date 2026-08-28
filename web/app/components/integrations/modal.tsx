'use client'

import type { IntegrationSection } from './routes'
import { useCallback } from 'react'
import { useTranslation } from 'react-i18next'
import MenuDialog from '@/app/components/header/account-setting/menu-dialog'
import { getMarketplaceUrl } from '@/utils/var'
import IntegrationsPage from './index'

type IntegrationsSettingModalProps = {
  section: IntegrationSection
  onCancel: () => void
  onSectionChange: (section: IntegrationSection) => void
}

export default function IntegrationsSettingModal({
  section,
  onCancel,
  onSectionChange,
}: IntegrationsSettingModalProps) {
  const { t } = useTranslation()
  const handleSwitchToMarketplace = useCallback((path: string) => {
    window.open(
      getMarketplaceUrl(path, undefined, { source: window.location.origin }),
      '_blank',
      'noopener,noreferrer',
    )
  }, [])

  return (
    <MenuDialog title={t(($) => $['settings.integrations'], { ns: 'common' })} onClose={onCancel}>
      <div className="mx-auto flex h-dvh w-[min(1440px,calc(100vw-48px))] shrink-0 py-6">
        <div className="relative flex min-h-0 w-full shrink-0 overflow-hidden rounded-2xl border border-divider-subtle bg-components-panel-bg shadow-2xl">
          <IntegrationsPage
            section={section}
            onSectionChange={onSectionChange}
            onSwitchToMarketplace={handleSwitchToMarketplace}
          />
        </div>
      </div>
    </MenuDialog>
  )
}
