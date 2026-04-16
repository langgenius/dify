'use client'

import type { SnippetListItem } from '@/types/snippet'
import { useTranslation } from 'react-i18next'
import AppIcon from '@/app/components/base/app-icon'
import Link from '@/next/link'

type Props = {
  snippet: SnippetListItem
}

const SnippetCard = ({ snippet }: Props) => {
  const { t } = useTranslation('snippet')

  return (
    <Link href={`/snippets/${snippet.id}/orchestrate`} className="group col-span-1">
      <article className="relative inline-flex h-[160px] w-full flex-col rounded-xl border border-components-card-border bg-components-card-bg shadow-sm transition-all duration-200 ease-in-out hover:-translate-y-0.5 hover:shadow-lg">
        {!snippet.is_published && (
          <div className="absolute right-0 top-0 rounded-bl-lg rounded-tr-xl bg-background-default-dimmed px-2 py-1 text-[10px] font-medium uppercase leading-3 text-text-placeholder">
            Draft
          </div>
        )}
        <div className="flex h-[66px] items-center gap-3 px-[14px] pb-3 pt-[14px]">
          <AppIcon
            size="large"
            iconType={snippet.icon_info.icon_type}
            icon={snippet.icon_info.icon}
            background={snippet.icon_info.icon_background}
            imageUrl={snippet.icon_info.icon_url}
          />
          <div className="w-0 grow py-[1px]">
            <div className="truncate text-sm font-semibold leading-5 text-text-secondary" title={snippet.name}>
              {snippet.name}
            </div>
          </div>
        </div>
        <div className="h-[58px] px-[14px] text-xs leading-normal text-text-tertiary">
          <div className="line-clamp-2" title={snippet.description}>
            {snippet.description}
          </div>
        </div>
        <div className="mt-auto flex items-center gap-1 px-[14px] pb-3 pt-2 text-xs leading-4 text-text-tertiary">
          <span className="truncate">{snippet.author}</span>
          <span>·</span>
          <span className="truncate">{snippet.updated_at}</span>
          {!snippet.is_published && (
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
