'use client'

import type { ReactNode } from 'react'
import type { AgentFileNode, AgentKnowledgeRetrievalItem, AgentTool } from '../../data'
import type { AgentSkill } from '../skills/item'
import { useTranslation } from 'react-i18next'

export type SlashMenuView = 'main' | 'skills' | 'files' | 'tools' | 'knowledge'

export type SlashMenuCategory = {
  key: Exclude<SlashMenuView, 'main'>
  label: string
  icon: string
}

type AgentPromptSlashMenuProps = {
  view: SlashMenuView
  categories: SlashMenuCategory[]
  skills: AgentSkill[]
  files: AgentFileNode[]
  tools: AgentTool[]
  retrievals: AgentKnowledgeRetrievalItem[]
  onBack: () => void
  onOpenCategory: (view: Exclude<SlashMenuView, 'main'>) => void
  onSelect: (token: string) => void
}

const createReferenceToken = (kind: string, id: string, label?: string) => (
  `[§${kind}:${id}${label ? `:${label}` : ''}§]`
)

const getFileIcon = (file: AgentFileNode) => {
  if (file.children?.length || file.icon === 'folder')
    return 'i-ri-folder-2-line'
  if (file.icon === 'json')
    return 'i-ri-file-code-line'
  if (file.icon === 'markdown')
    return 'i-ri-markdown-line'

  return 'i-ri-file-line'
}

export function AgentPromptSlashMenu({
  view,
  categories,
  skills,
  files,
  tools,
  retrievals,
  onBack,
  onOpenCategory,
  onSelect,
}: AgentPromptSlashMenuProps) {
  const { t } = useTranslation('agentV2')
  const title = categories.find(category => category.key === view)?.label

  if (view === 'main') {
    return (
      <AgentPromptSlashPanel className="w-[200px]">
        <div className="flex flex-col gap-px p-1">
          {categories.map(category => (
            <button
              key={category.key}
              type="button"
              className="flex h-6 w-full items-center gap-1 rounded-md pr-2 pl-3 text-left hover:bg-state-base-hover focus-visible:bg-state-base-hover focus-visible:outline-hidden"
              onClick={() => onOpenCategory(category.key)}
            >
              <span aria-hidden className={`${category.icon} size-4 shrink-0 text-text-secondary`} />
              <span className="min-w-0 flex-1 truncate system-sm-regular text-text-secondary">{category.label}</span>
              <span aria-hidden className="i-ri-arrow-right-s-line size-3.5 shrink-0 text-text-tertiary" />
            </button>
          ))}
        </div>
      </AgentPromptSlashPanel>
    )
  }

  return (
    <AgentPromptSlashPanel className="w-[360px]">
      <div className="flex flex-col p-1">
        <button
          type="button"
          className="flex h-6 w-full items-center gap-1 rounded-md pr-2 pl-3 text-left text-text-tertiary hover:bg-state-base-hover focus-visible:bg-state-base-hover focus-visible:outline-hidden"
          onClick={onBack}
        >
          <span aria-hidden className="i-ri-arrow-left-line size-4 shrink-0" />
          <span className="min-w-0 flex-1 truncate system-xs-medium-uppercase">{title}</span>
        </button>
        {view === 'skills' && (
          <AgentPromptSkillRows skills={skills} onSelect={onSelect} />
        )}
        {view === 'files' && (
          <AgentPromptFileRows files={files} onSelect={onSelect} />
        )}
        {view === 'tools' && (
          <AgentPromptToolRows tools={tools} onSelect={onSelect} />
        )}
        {view === 'knowledge' && (
          <AgentPromptKnowledgeRows retrievals={retrievals} onSelect={onSelect} />
        )}
      </div>
      <div className="border-t border-divider-subtle p-1">
        <button
          type="button"
          className="flex h-6 w-full items-center gap-1 rounded-md pr-2 pl-3 text-left hover:bg-state-base-hover focus-visible:bg-state-base-hover focus-visible:outline-hidden"
        >
          <span aria-hidden className="i-ri-add-line size-4 shrink-0 text-text-secondary" />
          <span className="system-sm-regular text-text-secondary">
            {view === 'skills' && t('agentDetail.configure.skills.add')}
            {view === 'files' && t('agentDetail.configure.files.add')}
            {view === 'tools' && t('agentDetail.configure.tools.add')}
            {view === 'knowledge' && t('agentDetail.configure.knowledgeRetrieval.add')}
          </span>
        </button>
      </div>
    </AgentPromptSlashPanel>
  )
}

function AgentPromptSlashPanel({
  className,
  children,
}: {
  className: string
  children: ReactNode
}) {
  return (
    <div className={`${className} isolate overflow-hidden rounded-xl border-[0.5px] border-components-panel-border bg-components-panel-bg-blur shadow-lg backdrop-blur-[5px]`}>
      {children}
    </div>
  )
}

function AgentPromptSkillRows({
  skills,
  onSelect,
}: {
  skills: AgentSkill[]
  onSelect: (token: string) => void
}) {
  return (
    <>
      {skills.map(skill => (
        <AgentPromptSubmenuRow
          key={skill.id}
          icon="i-ri-box-3-line"
          label={skill.name}
          onClick={() => onSelect(createReferenceToken('skill', skill.id, skill.name))}
        />
      ))}
    </>
  )
}

function AgentPromptFileRows({
  files,
  depth = 0,
  onSelect,
}: {
  files: AgentFileNode[]
  depth?: number
  onSelect: (token: string) => void
}) {
  return (
    <>
      {files.map(file => (
        <div key={file.id}>
          <AgentPromptSubmenuRow
            icon={getFileIcon(file)}
            label={file.name}
            depth={depth}
            hasChildren={!!file.children?.length}
            onClick={() => onSelect(createReferenceToken('file', file.id, file.name))}
          />
          {!!file.children?.length && (
            <AgentPromptFileRows files={file.children} depth={depth + 1} onSelect={onSelect} />
          )}
        </div>
      ))}
    </>
  )
}

function AgentPromptToolRows({
  tools,
  onSelect,
}: {
  tools: AgentTool[]
  onSelect: (token: string) => void
}) {
  return (
    <>
      {tools.map(tool => (
        <div key={tool.id}>
          <AgentPromptToolRow
            tool={tool}
            onClick={() => {
              if (tool.kind === 'provider')
                onSelect(createReferenceToken('tool-all', tool.id, tool.name))
              else
                onSelect(createReferenceToken('cli_tool', tool.id, tool.name))
            }}
          />
          {tool.kind === 'provider' && tool.actions.map(action => (
            <AgentPromptSubmenuRow
              key={action.id}
              label={action.name}
              depth={1}
              onClick={() => onSelect(createReferenceToken('tool', `${tool.id}/${action.toolName}`, action.toolName))}
            />
          ))}
        </div>
      ))}
    </>
  )
}

function AgentPromptKnowledgeRows({
  retrievals,
  onSelect,
}: {
  retrievals: AgentKnowledgeRetrievalItem[]
  onSelect: (token: string) => void
}) {
  const { t } = useTranslation('agentV2')

  return (
    <>
      {retrievals.map(retrieval => (
        <AgentPromptSubmenuRow
          key={retrieval.id}
          icon="i-ri-book-open-line"
          label={t(retrieval.nameKey)}
          onClick={() => onSelect(createReferenceToken('knowledge', retrieval.id, t(retrieval.nameKey)))}
        />
      ))}
    </>
  )
}

function AgentPromptToolRow({
  tool,
  onClick,
}: {
  tool: AgentTool
  onClick: () => void
}) {
  const { t } = useTranslation('agentV2')
  const typeLabel = tool.kind === 'provider'
    ? t('agentDetail.configure.tools.pluginType')
    : t('agentDetail.configure.tools.cliTool')

  return (
    <button
      type="button"
      className="flex h-7 w-full items-center gap-1 rounded-md text-left hover:bg-state-base-hover focus-visible:bg-state-base-hover focus-visible:outline-hidden"
      onClick={onClick}
    >
      <span className="flex min-w-0 flex-1 items-center gap-1.5 py-1 pr-1 pl-2">
        <span className="flex size-5 shrink-0 items-center justify-center rounded-md border-[0.5px] border-effects-icon-border bg-background-default-dodge">
          <span aria-hidden className={`${tool.kind === 'provider' ? tool.iconClassName : 'i-ri-terminal-box-line text-text-tertiary'} size-3.5`} />
        </span>
        <span className="min-w-0 flex-1 truncate system-sm-regular text-text-secondary">{tool.name}</span>
        <span className="shrink-0 system-xs-regular text-text-quaternary">{typeLabel}</span>
      </span>
      {tool.kind === 'provider' && (
        <span aria-hidden className="mr-1.5 i-ri-arrow-down-s-line size-4 shrink-0 text-text-tertiary" />
      )}
    </button>
  )
}

function AgentPromptSubmenuRow({
  icon,
  label,
  depth = 0,
  hasChildren = false,
  onClick,
}: {
  icon?: string
  label: string
  depth?: number
  hasChildren?: boolean
  onClick: () => void
}) {
  const indent = depth === 0 ? 'pl-3' : depth === 1 ? 'pl-8' : 'pl-12'

  return (
    <button
      type="button"
      className="flex h-6 w-full items-center gap-1 rounded-md text-left hover:bg-state-base-hover focus-visible:bg-state-base-hover focus-visible:outline-hidden"
      onClick={onClick}
    >
      <span className={`flex min-w-0 flex-1 items-center gap-1 ${indent} pr-2`}>
        {icon && <span aria-hidden className={`${icon} size-4 shrink-0 text-text-secondary`} />}
        <span className="min-w-0 flex-1 truncate system-sm-regular text-text-secondary">{label}</span>
      </span>
      {hasChildren && <span aria-hidden className="mr-1.5 i-ri-arrow-right-s-line size-4 shrink-0 text-text-tertiary" />}
    </button>
  )
}
