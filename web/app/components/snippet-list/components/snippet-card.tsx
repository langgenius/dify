'use client'

import type { SnippetListItem } from '@/types/snippet'
import { useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import AppIcon from '@/app/components/base/app-icon'
import Link from '@/next/link'
import { useMembers } from '@/service/use-common'
import { formatTime } from '@/utils/time'

type Props = {
  snippet: SnippetListItem
}

const SnippetCard = ({ snippet }: Props) => {
  const { t } = useTranslation('snippet')
  const { data: membersData } = useMembers()

  const memberNameById = useMemo(() => {
    return new Map((membersData?.accounts ?? []).map(member => [member.id, member.name]))
  }, [membersData?.accounts])

  const updatedByName = memberNameById.get(snippet.updated_by)
    || memberNameById.get(snippet.created_by)
    || t('unknownUser')

  const updatedAt = snippet.updated_at || snippet.created_at
  const updatedAtText = formatTime({
    date: (updatedAt > 1_000_000_000_000 ? updatedAt : updatedAt * 1000),
    dateFormat: `${t('segment.dateTimeFormat', { ns: 'datasetDocuments' })}`,
  })
  const updatedText = t('updatedBy', {
    name: updatedByName,
    time: updatedAtText,
  })

  return (
    <Link href={`/snippets/${snippet.id}/orchestrate`} className="group col-span-1">
      <article className="relative inline-flex h-[160px] w-full flex-col rounded-xl border border-components-card-border bg-components-card-bg shadow-sm transition-all duration-200 ease-in-out hover:-translate-y-0.5 hover:shadow-lg">
        {!snippet.is_published && (
          <div className="absolute top-0 right-0 rounded-tr-xl rounded-bl-lg bg-background-default-dimmed px-2 py-1 text-[10px] leading-3 font-medium text-text-placeholder uppercase">
            {t('draft')}
          </div>
        )}
        <div className="flex h-[66px] items-center gap-3 px-[14px] pt-[14px] pb-3">
          <AppIcon
            size="large"
            iconType={snippet.icon_info.icon_type}
            icon={snippet.icon_info.icon}
            background={snippet.icon_info.icon_background}
            imageUrl={snippet.icon_info.icon_url}
          />
          <div className="w-0 grow py-px">
            <div className="truncate text-sm leading-5 font-semibold text-text-secondary" title={snippet.name}>
              {snippet.name}
            </div>
          </div>
        </div>
        <div className="h-[58px] px-[14px] text-xs leading-normal text-text-tertiary">
          <div className="line-clamp-2" title={snippet.description}>
            {snippet.description}
          </div>
        </div>
        <div className="mt-auto flex items-center gap-1 px-[14px] pt-2 pb-3 text-xs leading-4 text-text-tertiary">
          <span className="truncate" title={updatedText}>{updatedText}</span>
          {snippet.is_published && (
            <>
              <span>·</span>
              <span className="truncate">{t('usageCount', { count: snippet.use_count })}</span>
            </>
          )}
        </div>
      </article>
    </Link>
  )
}

export default SnippetCard
