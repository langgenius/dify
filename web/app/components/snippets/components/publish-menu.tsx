'use client'

import type { SnippetDetailUIModel } from '@/models/snippet'
import { useTranslation } from 'react-i18next'
import { Button } from '@/app/components/base/ui/button'
import ShortcutsName from '@/app/components/workflow/shortcuts-name'

const PublishMenu = ({
  uiMeta,
  onPublish,
  isPublishing = false,
}: {
  uiMeta: SnippetDetailUIModel
  onPublish: () => void
  isPublishing?: boolean
}) => {
  const { t } = useTranslation('snippet')

  return (
    <div className="flex flex-col gap-3 px-4 pb-4 pt-3">
      <div className="flex flex-col">
        <div className="min-h-6 text-text-tertiary system-xs-medium-uppercase">
          {t('publishMenuCurrentDraft')}
        </div>
        <div className="text-text-secondary system-sm-medium">
          {uiMeta.autoSavedAt}
        </div>
      </div>
      <Button
        variant="primary"
        loading={isPublishing}
        disabled={isPublishing}
        className="w-full justify-center gap-1.5"
        onClick={onPublish}
      >
        <span>{t('publishButton')}</span>
        <div aria-hidden="true">
          <ShortcutsName
            keys={['ctrl', 'shift', 'p']}
            bgColor="white"
          />
        </div>
      </Button>
    </div>
  )
}

export default PublishMenu
