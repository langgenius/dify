'use client'

import type { FC } from 'react'
import * as React from 'react'
import { SkillEditorProvider } from './context'
import EditorArea from './editor-area'
import EditorBody from './editor-body'
import EditorTabs from './editor-tabs'
import Files from './files'
import Sidebar from './sidebar'
import SidebarSearchAdd from './sidebar-search-add'
import SkillDocEditor from './skill-doc-editor'
import SkillPageLayout from './skill-page-layout'

/**
 * SkillMain - Main entry point for Skill Editor view
 *
 * This component provides the SkillEditorContext and renders the
 * complete Skill Editor UI including:
 * - File tree sidebar
 * - Tab bar
 * - Editor area
 *
 * The store is created at this level and shared with all child components.
 * API data is fetched using TanStack Query hooks within child components.
 */
const SkillMain: FC = () => {
  return (
    <SkillEditorProvider>
      <div className="h-full bg-workflow-canvas-workflow-top-bar-1 pl-3 pt-[52px]">
        <SkillPageLayout>
          <Sidebar>
            <SidebarSearchAdd />
            <Files />
          </Sidebar>
          <EditorArea>
            <EditorTabs />
            <EditorBody>
              <SkillDocEditor />
            </EditorBody>
          </EditorArea>
        </SkillPageLayout>
      </div>
    </SkillEditorProvider>
  )
}

export default React.memo(SkillMain)
