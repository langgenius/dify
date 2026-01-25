'use client'

import type { FC } from 'react'
import * as React from 'react'
import { useStore as useAppStore } from '@/app/components/app/store'
import { useStore } from '@/app/components/workflow/store'
import ContentArea from './content-area'
import ContentBody from './content-body'
import FileContentPanel from './file-content-panel'
import FileTabs from './file-tabs'
import FileTree from './file-tree'
import { useSkillAutoSave } from './hooks/use-skill-auto-save'
import { SkillSaveProvider } from './hooks/use-skill-save-manager'
import Sidebar from './sidebar'
import SidebarSearchAdd from './sidebar-search-add'
import SkillPageLayout from './skill-page-layout'

const SkillAutoSaveManager: FC = () => {
  const activeTabId = useStore(s => s.activeTabId)

  useSkillAutoSave({ activeTabId })

  return null
}

const SkillMain: FC = () => {
  const appDetail = useAppStore(s => s.appDetail)
  const appId = appDetail?.id || ''

  return (
    <div className="h-full bg-workflow-canvas-workflow-top-bar-1 pl-3 pt-[52px]">
      <SkillSaveProvider appId={appId}>
        <SkillAutoSaveManager />
        <SkillPageLayout>
          <Sidebar>
            <SidebarSearchAdd />
            <FileTree />
          </Sidebar>
          <ContentArea>
            <FileTabs />
            <ContentBody>
              <FileContentPanel />
            </ContentBody>
          </ContentArea>
        </SkillPageLayout>
      </SkillSaveProvider>
    </div>
  )
}

export default React.memo(SkillMain)
