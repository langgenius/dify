'use client'

import type { FC } from 'react'
import * as React from 'react'
import EditorArea from './editor-area'
import EditorBody from './editor-body'
import EditorTabs from './editor-tabs'
import FileTree from './file-tree'
import Sidebar from './sidebar'
import SidebarSearchAdd from './sidebar-search-add'
import SkillDocEditor from './skill-doc-editor'
import SkillPageLayout from './skill-page-layout'

const SkillMain: FC = () => {
  return (
    <div className="h-full bg-workflow-canvas-workflow-top-bar-1 pl-3 pt-[52px]">
      <SkillPageLayout>
        <Sidebar>
          <SidebarSearchAdd />
          <FileTree />
        </Sidebar>
        <EditorArea>
          <EditorTabs />
          <EditorBody>
            <SkillDocEditor />
          </EditorBody>
        </EditorArea>
      </SkillPageLayout>
    </div>
  )
}

export default React.memo(SkillMain)
