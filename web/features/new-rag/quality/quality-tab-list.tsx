'use client'

import { TabsList, TabsTab } from '@langgenius/dify-ui/tabs'
import { useTranslation } from 'react-i18next'

const qualityTabClassName =
  'h-7 rounded-md border-0 px-2.5 py-0 system-xs-medium text-text-tertiary data-active:bg-background-default data-active:text-text-primary data-active:shadow-xs'

export function QualityTabList() {
  const { t } = useTranslation(['knowledgeQuality'])

  return (
    <TabsList
      aria-label={t(($) => $['qualityPage.title'], { ns: 'knowledgeQuality' })}
      className="flex h-8 items-center gap-0 rounded-lg bg-background-section-burn p-0.5"
    >
      <TabsTab value="golden" className={qualityTabClassName}>
        {t(($) => $['qualityPage.goldenTab'], { ns: 'knowledgeQuality' })}
      </TabsTab>
      <TabsTab value="bad" className={qualityTabClassName}>
        {t(($) => $['qualityPage.badCasesTab'], { ns: 'knowledgeQuality' })}
      </TabsTab>
      <TabsTab value="evaluation" className={qualityTabClassName}>
        {t(($) => $['qualityPage.evaluationTab'], { ns: 'knowledgeQuality' })}
      </TabsTab>
    </TabsList>
  )
}
