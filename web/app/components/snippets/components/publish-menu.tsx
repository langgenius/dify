'use client'

import type { SnippetDetailUIModel } from '@/models/snippet'
import { useTranslation } from 'react-i18next'
import Button from '@/app/components/base/button'

const PublishMenu = ({
  uiMeta,
}: {
  uiMeta: SnippetDetailUIModel
}) => {
  const { t } = useTranslation('snippet')

  return (
    <div className="w-80 rounded-2xl border border-components-panel-border bg-components-panel-bg p-4 shadow-[0px_20px_24px_-4px_rgba(9,9,11,0.08),0px_8px_8px_-4px_rgba(9,9,11,0.03)]">
      <div className="text-text-tertiary system-xs-semibold-uppercase">
        {t('publishMenuCurrentDraft')}
      </div>
      <div className="pt-1 text-text-secondary system-sm-medium">
        {uiMeta.autoSavedAt}
      </div>
      <Button variant="primary" size="small" className="mt-4 w-full justify-center">
        {t('publishButton')}
      </Button>
    </div>
  )
}

export default PublishMenu
