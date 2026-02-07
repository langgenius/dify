'use client'

import { parseAsString, useQueryState } from 'nuqs'
import * as React from 'react'
import { useStore as useAppStore } from '@/app/components/app/store'
import { useStore, useWorkflowStore } from '@/app/components/workflow/store'
import { isArtifactTab } from './constants'
import ArtifactsSection from './file-tree/artifacts/artifacts-section'
import FileTree from './file-tree/tree/file-tree'
import { useSkillAutoSave } from './hooks/use-skill-auto-save'
import { SkillSaveProvider } from './hooks/use-skill-save-manager'
import ContentArea from './skill-body/layout/content-area'
import ContentBody from './skill-body/layout/content-body'
import Sidebar from './skill-body/layout/sidebar'
import SkillPageLayout from './skill-body/layout/skill-page-layout'
import ArtifactContentPanel from './skill-body/panels/artifact-content-panel'
import FileContentPanel from './skill-body/panels/file-content-panel'
import SidebarSearchAdd from './skill-body/sidebar-search-add'
import FileTabs from './skill-body/tabs/file-tabs'

const SkillAutoSaveManager = () => {
  useSkillAutoSave()
  return null
}

const ContentRouter = () => {
  const activeTabId = useStore(s => s.activeTabId)
  if (isArtifactTab(activeTabId))
    return <ArtifactContentPanel />
  return <FileContentPanel />
}

const SkillMain = () => {
  const appDetail = useAppStore(s => s.appDetail)
  const appId = appDetail?.id || ''
  const [queryFileId] = useQueryState('fileId', parseAsString)
  const storeApi = useWorkflowStore()
  const openedFileRef = React.useRef<string | null>(null)

  React.useEffect(() => {
    if (!queryFileId || openedFileRef.current === queryFileId)
      return
    openedFileRef.current = queryFileId
    storeApi.getState().openTab(queryFileId, { pinned: true })
  }, [queryFileId, storeApi])

  return (
    <div className="h-full bg-workflow-canvas-workflow-top-bar-1 pl-3 pt-[52px]">
      <SkillSaveProvider appId={appId}>
        <SkillAutoSaveManager />
        <SkillPageLayout>
          <Sidebar>
            <SidebarSearchAdd />
            <FileTree />
            <ArtifactsSection />
          </Sidebar>
          <ContentArea>
            <FileTabs />
            <ContentBody>
              <ContentRouter />
            </ContentBody>
          </ContentArea>
        </SkillPageLayout>
      </SkillSaveProvider>
    </div>
  )
}

export default React.memo(SkillMain)
