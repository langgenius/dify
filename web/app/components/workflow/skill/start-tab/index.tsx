'use client'

import type { FC } from 'react'
import { memo } from 'react'
import CreateImportSection from './create-import-section'
import SkillTemplatesSection from './skill-templates-section'

const StartTabContent: FC = () => {
  return (
    <div className="h-full w-full overflow-auto bg-components-panel-bg">
      <CreateImportSection />
      <SkillTemplatesSection />
    </div>
  )
}

export default memo(StartTabContent)
