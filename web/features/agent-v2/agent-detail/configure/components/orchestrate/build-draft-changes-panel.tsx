'use client'

import type { TFunction } from 'i18next'
import type { AgentBuildDraftChangeItem, AgentBuildDraftChangeSummary } from './build-draft-changes-context'
import { cn } from '@langgenius/dify-ui/cn'
import { FileTreeIcon } from '@langgenius/dify-ui/file-tree'
import { useTranslation } from 'react-i18next'

type AgentBuildDraftChangeSection = {
  key: string
  label: string
  items?: readonly AgentBuildDraftChangeItem[]
}

export function AgentBuildDraftChangesPanel({
  changeSummary,
  changesLabel,
  onToggle,
}: {
  changeSummary?: AgentBuildDraftChangeSummary
  changesLabel: string
  onToggle: () => void
}) {
  const { t } = useTranslation('agentV2')
  const sections = getChangeSections({ changeSummary, t })

  return (
    <section className="flex w-full max-w-full flex-col px-2 pt-2">
      <div className="flex h-6 min-w-0 items-center gap-3 pr-8 pl-2">
        <p className="min-w-0 truncate system-sm-semibold text-text-primary">
          {t('agentDetail.configure.buildDraft.title')}
        </p>
        <button
          type="button"
          className="flex min-w-0 cursor-pointer items-center gap-0.5 rounded-sm text-text-tertiary hover:text-text-secondary focus-visible:ring-2 focus-visible:ring-state-accent-solid focus-visible:outline-hidden"
          onClick={onToggle}
        >
          <span className="min-w-0 truncate system-xs-regular">
            {changesLabel}
          </span>
          <span aria-hidden className="i-ri-arrow-right-s-line size-4 shrink-0 rotate-90" />
        </button>
      </div>
      <div className="flex max-h-[232px] flex-col gap-1 overflow-y-auto pt-2 pb-1">
        {sections.map(section => (
          <AgentBuildDraftChangeSectionRow key={section.key} section={section} />
        ))}
      </div>
    </section>
  )
}

function AgentBuildDraftChangeSectionRow({
  section,
}: {
  section: AgentBuildDraftChangeSection
}) {
  return (
    <div className="flex w-full items-start p-2">
      <div className="flex min-w-20 shrink-0 items-center gap-1.5">
        <span aria-hidden className="size-[5px] rounded-full bg-text-warning" />
        <p className="min-w-0 flex-1 truncate system-xs-medium-uppercase text-text-tertiary">
          {section.label}
        </p>
      </div>
      {section.items?.length
        ? (
            <div className="flex min-w-0 flex-1 flex-col gap-2">
              {section.items.map(item => (
                <AgentBuildDraftChangeItemRow key={`${item.operation}-${item.id}`} item={item} />
              ))}
            </div>
          )
        : (
            null
          )}
    </div>
  )
}

function AgentBuildDraftChangeItemRow({
  item,
}: {
  item: AgentBuildDraftChangeItem
}) {
  const { t } = useTranslation('agentV2')

  return (
    <div className="flex min-w-0 flex-col gap-0.5">
      <div className="flex min-w-0 items-center gap-1">
        <span
          aria-hidden
          className={cn(
            'size-3 shrink-0',
            item.operation === 'removed'
              ? 'i-ri-indeterminate-circle-fill text-text-destructive'
              : item.operation === 'added'
                ? 'i-ri-add-circle-fill text-text-success'
                : 'i-ri-add-circle-fill text-text-accent',
          )}
        />
        <div className="flex min-w-0 flex-1 items-center gap-1">
          {item.icon
            ? <FileTreeIcon type={item.icon} className="size-4" />
            : <span aria-hidden className="i-custom-public-agent-building-blocks size-4 shrink-0 text-text-tertiary" />}
          <p className="min-w-0 truncate system-sm-regular text-text-secondary">
            {item.name}
          </p>
        </div>
      </div>
      {item.descriptionKey && (
        <p className="ms-4 system-xs-regular text-text-tertiary">
          {t(item.descriptionKey)}
        </p>
      )}
    </div>
  )
}

function getChangeSections({
  changeSummary,
  t,
}: {
  changeSummary?: AgentBuildDraftChangeSummary
  t: TFunction<'agentV2'>
}): AgentBuildDraftChangeSection[] {
  if (!changeSummary)
    return []

  const sections: AgentBuildDraftChangeSection[] = []
  const pushItemSection = (key: string, label: string, items: readonly AgentBuildDraftChangeItem[]) => {
    if (items.length === 0)
      return

    sections.push({
      key,
      label,
      items,
    })
  }

  pushItemSection('skills', t('agentDetail.configure.skills.label'), changeSummary.skills)
  pushItemSection('files', t('agentDetail.configure.files.label'), changeSummary.files)
  pushItemSection('envVariables', t('agentDetail.configure.advancedSettings.envEditor.shortLabel'), changeSummary.envVariables)

  return sections
}
