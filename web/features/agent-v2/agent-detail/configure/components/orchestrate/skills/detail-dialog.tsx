'use client'

import type { AgentFileNode } from '@/features/agent-v2/agent-composer/form-state'
import {
  DialogCloseButton,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from '@langgenius/dify-ui/dialog'
import { ScrollArea } from '@langgenius/dify-ui/scroll-area'
import { useTranslation } from 'react-i18next'
import Loading from '@/app/components/base/loading'
import { AgentFileTree } from '../files/tree'
import { countAgentFileNodes } from '../utils'

type AgentSkillFileNode = AgentFileNode

type AgentSkillDetailSection = {
  id: string
  title: string
  paragraphs?: string[]
  items?: string[]
}

export type AgentSkillDetail = {
  description: string
  fileCount?: number
  files: AgentSkillFileNode[]
  filePreview?: {
    content?: string
    isError?: boolean
    isLoading?: boolean
  }
  selectedFileId?: string
  sections: AgentSkillDetailSection[]
}

function AgentSkillFileList({
  files,
  fileCount,
  selectedFileId,
}: {
  files: AgentSkillFileNode[]
  fileCount: number
  selectedFileId?: string
}) {
  const { t } = useTranslation('agentV2')

  return (
    <AgentFileTree
      files={files}
      selectedFileId={selectedFileId}
      labelledBy="agent-skill-detail-files-heading"
      className="h-[258px] rounded-xl border-[0.5px] border-components-panel-border bg-components-panel-on-panel-item-bg p-1 shadow-xs shadow-shadow-shadow-3"
      header={(
        <>
          <h3 id="agent-skill-detail-files-heading" className="sr-only">
            {t('agentDetail.configure.skills.detail.files')}
          </h3>
          <div
            aria-hidden="true"
            className="px-2 py-1 system-2xs-semibold-uppercase text-text-tertiary"
          >
            {t('agentDetail.configure.skills.detail.fileCount', { count: fileCount })}
          </div>
        </>
      )}
    />
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

function AgentFilePreviewContent({
  content,
  isError,
  isLoading,
}: {
  content?: string
  isError?: boolean
  isLoading?: boolean
}) {
  const { t } = useTranslation('agentV2')

  if (isLoading) {
    return (
      <div className="flex min-h-40 items-center justify-center">
        <Loading type="area" />
      </div>
    )
  }

  if (isError) {
    return (
      <p className="system-sm-regular text-text-tertiary">
        {t('agentDetail.configure.files.preview.failed')}
      </p>
    )
  }

  if (!content) {
    return (
      <p className="system-sm-regular text-text-tertiary">
        {t('agentDetail.configure.files.preview.empty')}
      </p>
    )
  }

  return (
    <pre className="m-0 font-mono text-xs leading-5 break-words whitespace-pre-wrap text-text-secondary">
      {content}
    </pre>
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
  const fileCount = detail.fileCount ?? countAgentFileNodes(detail.files)

  return (
    <DialogContent className="flex h-[min(720px,calc(100dvh-2rem))] max-h-none w-[min(960px,calc(100vw-2rem))] flex-col overflow-hidden rounded-2xl p-0">
      <DialogCloseButton className="top-5 right-5" />
      <div className="shrink-0 border-b-[0.5px] border-components-panel-border-subtle pt-6 pr-14 pb-3 pl-6">
        <DialogTitle className="title-xl-semi-bold text-text-primary">
          {skillName}
        </DialogTitle>
        <DialogDescription className="mt-1 system-xs-regular text-text-tertiary">
          {detail.description}
        </DialogDescription>
      </div>

      <div className="flex min-h-0 flex-1 items-start">
        <ScrollArea
          className="relative min-h-0 flex-1 self-stretch overflow-hidden has-[>_:first-child:focus-visible]:outline-2 has-[>_:first-child:focus-visible]:outline-offset-0 has-[>_:first-child:focus-visible]:outline-state-accent-solid"
          label={t('agentDetail.configure.skills.detail.contentRegion')}
          slotClassNames={{
            viewport: 'overscroll-contain outline-none focus-visible:outline-none mask-linear-[to_bottom,transparent_0,black_min(40px,var(--scroll-area-overflow-y-start)),black_calc(100%_-_min(40px,var(--scroll-area-overflow-y-end,40px))),transparent_100%] mask-no-repeat',
            content: 'flex min-h-full w-full max-w-full min-w-0 flex-col gap-2 px-6 pt-4 pb-0',
            scrollbar: 'data-[orientation=vertical]:my-1 data-[orientation=vertical]:me-1',
          }}
        >
          {detail.filePreview && (
            <AgentFilePreviewContent
              content={detail.filePreview.content}
              isError={detail.filePreview.isError}
              isLoading={detail.filePreview.isLoading}
            />
          )}
          {detail.sections.map(section => (
            <AgentSkillDetailSectionBlock key={section.id} section={section} />
          ))}
        </ScrollArea>
        <div className="flex w-56 max-w-56 min-w-0 shrink-0 items-start justify-center p-4 pl-2">
          <AgentSkillFileList files={detail.files} fileCount={fileCount} selectedFileId={detail.selectedFileId} />
        </div>
      </div>
    </DialogContent>
  )
}
