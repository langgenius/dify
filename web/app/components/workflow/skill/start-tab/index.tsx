'use client'

import { memo } from 'react'
import { useTranslation } from 'react-i18next'
import { ScrollArea } from '@/app/components/base/ui/scroll-area'
import CreateImportSection from './create-import-section'
import FileExplorerIntro from './file-explorer-intro'
import SkillTemplatesSection from './skill-templates-section'

const StartTabContent = () => {
  const { t } = useTranslation('workflow')

  return (
    <div className="flex h-full min-h-0 w-full flex-col bg-components-panel-bg">
      <ScrollArea
        className="min-h-0 flex-1 overflow-hidden"
        label={t('skill.startTab.templatesTitle')}
        slotClassNames={{
          content: 'pb-6',
          scrollbar: 'z-20',
        }}
      >
        <FileExplorerIntro />
        <CreateImportSection />
        <SkillTemplatesSection />
      </ScrollArea>
    </div>
  )
}

export default memo(StartTabContent)
