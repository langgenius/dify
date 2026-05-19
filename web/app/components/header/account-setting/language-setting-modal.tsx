'use client'

import { Button } from '@langgenius/dify-ui/button'
import { ScrollArea } from '@langgenius/dify-ui/scroll-area'
import { useTranslation } from 'react-i18next'
import LanguagePage from './language-page'
import MenuDialog from './menu-dialog'

type LanguageSettingModalProps = {
  onCancel: () => void
}

export default function LanguageSettingModal({
  onCancel,
}: LanguageSettingModalProps) {
  const { t } = useTranslation()

  return (
    <MenuDialog show onClose={onCancel}>
      <div className="mx-auto flex h-dvh w-[min(900px,calc(100vw-48px))] shrink-0 py-6">
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
          <ScrollArea
            className="h-full min-h-0 flex-1"
            slotClassNames={{
              viewport: 'overscroll-contain',
              content: 'min-h-full px-8 pt-8 pb-6',
            }}
          >
            <div className="mb-6 title-2xl-semi-bold text-text-primary">
              {t('settings.language', { ns: 'common' })}
            </div>
            <LanguagePage />
          </ScrollArea>
        </div>
      </div>
    </MenuDialog>
  )
}
