'use client'

import type { FC } from 'react'
import * as React from 'react'
import { useCallback, useState } from 'react'
import ContentArea from './content-area'
import ContentBody from './content-body'
import FileContentPanel from './file-content-panel'
import FileTabs from './file-tabs'
import FileTree from './file-tree'
import Sidebar from './sidebar'
import SidebarSearchAdd from './sidebar-search-add'
import SkillPageLayout from './skill-page-layout'

const SkillMain: FC = () => {
  const [searchTerm, setSearchTerm] = useState('')

  const handleSearchChange = useCallback((term: string) => {
    setSearchTerm(term)
  }, [])

  return (
    <div className="h-full bg-workflow-canvas-workflow-top-bar-1 pl-3 pt-[52px]">
      <SkillPageLayout>
        <Sidebar>
          <SidebarSearchAdd onSearchChange={handleSearchChange} />
          <FileTree searchTerm={searchTerm} />
        </Sidebar>
        <ContentArea>
          <FileTabs />
          <ContentBody>
            <FileContentPanel />
          </ContentBody>
        </ContentArea>
      </SkillPageLayout>
    </div>
  )
}

export default React.memo(SkillMain)
