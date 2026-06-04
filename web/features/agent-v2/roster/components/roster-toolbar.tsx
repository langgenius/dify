'use client'

import { useTranslation } from 'react-i18next'
import SearchInput from '@/app/components/base/search-input'
import { CreateAgentDialog } from './create-agent-dialog'

type RosterToolbarProps = {
  keyword: string
  totalAgents: number
  onKeywordChange: (value: string) => void
}

export function RosterToolbar({
  keyword,
  totalAgents,
  onKeywordChange,
}: RosterToolbarProps) {
  const { t } = useTranslation('agentV2')

  return (
    <div className="mt-4 flex flex-wrap items-center gap-3">
      <SearchInput
        aria-label={t('roster.searchLabel')}
        className="w-82 max-w-full"
        name="agent-search"
        placeholder={t('roster.searchPlaceholder')}
        value={keyword}
        onChange={onKeywordChange}
      />
      <div className="system-sm-regular text-text-tertiary">
        {t('roster.agentCount', { count: totalAgents })}
      </div>
      <div className="ml-auto flex min-w-0 items-center gap-2">
        <CreateAgentDialog />
      </div>
    </div>
  )
}
