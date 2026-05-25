'use client'

import type { SnippetDetailUIModel } from '@/models/snippet'
import { Button } from '@langgenius/dify-ui/button'
import { useTranslation } from 'react-i18next'
import ShortcutsName from '@/app/components/workflow/shortcuts-name'
import { useFormatTimeFromNow } from '@/hooks/use-format-time-from-now'

const PublishMenu = ({
  draftUpdatedAt,
  publishedAt,
  uiMeta,
  onPublish,
  isPublishing = false,
}: {
  draftUpdatedAt: number
  publishedAt: number
  uiMeta: SnippetDetailUIModel
  onPublish: () => void
  isPublishing?: boolean
}) => {
  const { t } = useTranslation('snippet')
  const { formatTimeFromNow } = useFormatTimeFromNow()

  const hasPublishedVersion = Boolean(publishedAt)

  return (
    <div className="flex flex-col gap-3 px-4 pt-3 pb-4">
      <div className="flex flex-col">
        <div className="min-h-6 system-xs-medium-uppercase text-text-tertiary">
          {hasPublishedVersion
            ? t('common.latestPublished', { ns: 'workflow' })
            : t('publishMenuCurrentDraft')}
        </div>
        <div className="system-sm-medium text-text-secondary">
          {hasPublishedVersion
            ? `${t('common.publishedAt', { ns: 'workflow' })} ${formatTimeFromNow(publishedAt)}`
            : draftUpdatedAt
              ? `${t('common.autoSaved', { ns: 'workflow' })} · ${formatTimeFromNow(draftUpdatedAt)}`
              : uiMeta.autoSavedAt}
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
