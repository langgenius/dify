'use client'

import type { FileTreeIconType } from '@langgenius/dify-ui/file-tree'
import {
  DialogCloseButton,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from '@langgenius/dify-ui/dialog'
import {
  FileTreeFile,
  FileTreeFolder,
  FileTreeFolderPanel,
  FileTreeFolderTrigger,
  FileTreeIcon,
  FileTreeLabel,
  FileTreeList,
  FileTreeRoot,
} from '@langgenius/dify-ui/file-tree'
import { ScrollArea } from '@langgenius/dify-ui/scroll-area'
import { useTranslation } from 'react-i18next'

export type AgentSkillFileNode = {
  id: string
  name: string
  icon: FileTreeIconType
  children?: AgentSkillFileNode[]
}

export type AgentSkillDetailSection = {
  id: string
  title: string
  paragraphs?: string[]
  items?: string[]
}

export type AgentSkillDetail = {
  description: string
  fileCount?: number
  files: AgentSkillFileNode[]
  sections: AgentSkillDetailSection[]
}

function AgentSkillFileRows({
  files,
}: {
  files: AgentSkillFileNode[]
}) {
  return files.map((file) => {
    if (file.children?.length) {
      return (
        <FileTreeFolder key={file.id} defaultOpen>
          <FileTreeFolderTrigger>
            <FileTreeIcon type="folder" />
            <FileTreeLabel className="max-w-full" title={file.name}>{file.name}</FileTreeLabel>
          </FileTreeFolderTrigger>
          <FileTreeFolderPanel>
            <AgentSkillFileRows files={file.children} />
          </FileTreeFolderPanel>
        </FileTreeFolder>
      )
    }

    return (
      <FileTreeFile key={file.id}>
        <FileTreeIcon type={file.icon} />
        <FileTreeLabel className="max-w-full" title={file.name}>{file.name}</FileTreeLabel>
      </FileTreeFile>
    )
  })
}

function countFiles(files: AgentSkillFileNode[]): number {
  return files.reduce((count, file) => count + 1 + (file.children ? countFiles(file.children) : 0), 0)
}

function AgentSkillFileList({
  files,
  fileCount,
}: {
  files: AgentSkillFileNode[]
  fileCount: number
}) {
  const { t } = useTranslation('agentV2')

  return (
    <aside className="flex h-64.5 w-54 max-w-54 min-w-0 flex-col overflow-hidden rounded-xl border-[0.5px] border-components-panel-border bg-components-panel-on-panel-item-bg p-1 shadow-xs shadow-shadow-shadow-3">
      <h3 id="agent-skill-detail-files-heading" className="sr-only">
        {t('agentDetail.configure.skills.detail.files')}
      </h3>
      <div
        aria-hidden="true"
        className="px-2 py-1 system-2xs-semibold-uppercase text-text-tertiary"
      >
        {t('agentDetail.configure.skills.detail.fileCount', { count: fileCount })}
      </div>
      <FileTreeRoot
        aria-labelledby="agent-skill-detail-files-heading"
        className="min-h-0 w-full max-w-full flex-1 overflow-hidden p-0"
      >
        <FileTreeList className="w-full max-w-full overflow-hidden">
          <AgentSkillFileRows files={files} />
        </FileTreeList>
      </FileTreeRoot>
    </aside>
  )
}

function AgentSkillDetailSectionBlock({
  section,
}: {
  section: AgentSkillDetailSection
}) {
  return (
    <section className="clear-none">
      <h3 className="system-sm-semibold text-text-primary">{section.title}</h3>
      {section.paragraphs?.map(paragraph => (
        <p key={paragraph} className="mt-1 system-xs-regular text-text-secondary">
          {paragraph}
        </p>
      ))}
      {!!section.items?.length && (
        <ul className="mt-1 flex list-disc flex-col gap-0.5 pl-5 system-xs-regular text-text-secondary">
          {section.items.map(item => (
            <li key={item} className="pl-0.5">
              {item}
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}

export function AgentSkillDetailDialog({
  skillName,
  detail,
}: {
  skillName: string
  detail: AgentSkillDetail
}) {
  const { t } = useTranslation('agentV2')
  const fileCount = detail.fileCount ?? countFiles(detail.files)

  return (
    <DialogContent className="flex h-[min(720px,calc(100dvh-2rem))] max-h-none w-[min(960px,calc(100vw-2rem))] flex-col overflow-hidden rounded-2xl p-0">
      <DialogCloseButton className="top-4 right-4" />
      <div className="shrink-0 px-4 pt-4 pr-12 pb-3">
        <DialogTitle className="title-xl-semi-bold text-text-primary">
          {skillName}
        </DialogTitle>
        <DialogDescription className="mt-1 system-xs-regular text-text-tertiary">
          {detail.description}
        </DialogDescription>
      </div>

      <div className="flex min-h-0 flex-1 items-start">
        <ScrollArea
          className="min-h-0 flex-1 self-stretch overflow-hidden"
          label={t('agentDetail.configure.skills.detail.contentRegion')}
          slotClassNames={{
            viewport: 'overscroll-contain',
            content: 'flex min-h-full flex-col gap-2 px-6 pt-4 pb-0',
            scrollbar: 'data-[orientation=vertical]:my-1 data-[orientation=vertical]:me-1',
          }}
        >
          {detail.sections.map(section => (
            <AgentSkillDetailSectionBlock key={section.id} section={section} />
          ))}
        </ScrollArea>
        <div className="flex w-56 max-w-56 min-w-0 shrink-0 items-start justify-center p-4 pl-2">
          <AgentSkillFileList files={detail.files} fileCount={fileCount} />
        </div>
      </div>
    </DialogContent>
  )
}
