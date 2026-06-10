'use client'

import { useTranslation } from 'react-i18next'
import { StepShell } from '../../shell/layout'
import { SourceAppList } from './list'
import { SourceSearchInput } from './search-input'

export function SourceAppSelectionSection() {
  const { t } = useTranslation('deployments')

  return (
    <StepShell
      title={t('createGuide.source.title')}
      description={t('createGuide.source.description')}
      descriptionClassName="lg:hidden"
      hideHeader
      className="min-h-0 flex-1"
    >
      <div className="flex min-h-0 flex-1 flex-col gap-3">
        <SourceSearchInput />
        <SourceAppList />
      </div>
    </StepShell>
  )
}
