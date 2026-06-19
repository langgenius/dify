'use client'

import type { IntegrationSection } from '@/app/components/integrations/routes'
import { Button } from '@langgenius/dify-ui/button'
import { cn } from '@langgenius/dify-ui/cn'
import { useCallback } from 'react'
import { useTranslation } from 'react-i18next'
import MenuDialog from '@/app/components/header/account-setting/menu-dialog'
import IntegrationsPage from '@/app/components/integrations/page'
import { getMarketplaceUrl } from '@/utils/var'

type IntegrationsSettingModalProps = {
  section: IntegrationSection
  source?: 'agent'
  onCancel: () => void
  onSectionChange: (section: IntegrationSection) => void
}

export default function IntegrationsSettingModal({
  section,
  source,
  onCancel,
  onSectionChange,
}: IntegrationsSettingModalProps) {
  const { t } = useTranslation()
  const isAgentSource = source === 'agent'
  const handleSwitchToMarketplace = useCallback((path: string) => {
    window.open(getMarketplaceUrl(path), '_blank', 'noopener,noreferrer')
  }, [])

  return (
    <MenuDialog
      show
      backdropClassName={isAgentSource ? 'bg-background-overlay' : undefined}
      className={isAgentSource ? 'bg-transparent backdrop-blur-none' : undefined}
      onClose={onCancel}
    >
      <div className={cn(
        'mx-auto flex h-dvh w-[min(1440px,calc(100vw-48px))] shrink-0 py-6',
        isAgentSource && 'w-full p-6',
      )}
      >
        <div className="relative flex min-h-0 w-full shrink-0 overflow-hidden rounded-2xl border border-divider-subtle bg-components-panel-bg shadow-2xl">
          <div className="fixed top-6 right-6 z-9999 flex flex-col items-center">
            <Button
              variant="tertiary"
              size="large"
              className="px-2"
              aria-label={t('operation.close', { ns: 'common' })}
              onClick={onCancel}
            >
              <span className="i-ri-close-line h-5 w-5" />
            </Button>
            <div className="mt-1 system-2xs-medium-uppercase text-text-tertiary">ESC</div>
          </div>
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
