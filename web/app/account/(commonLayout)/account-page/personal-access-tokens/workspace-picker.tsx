import type { PersonalAccessTokenWorkspaceResponse } from '@dify/contracts/api/console/account/types.gen'
import { Checkbox } from '@langgenius/dify-ui/checkbox'
import { useInfiniteQuery } from '@tanstack/react-query'
import { useDebounce } from 'ahooks'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { SearchInput } from '@/app/components/base/search-input'
import { consoleQuery } from '@/service/console'
import PickerList from './picker-list'
import WorkspaceRole from './workspace-role'

export default function WorkspacePicker({
  selected,
  onToggle,
}: {
  selected: PersonalAccessTokenWorkspaceResponse[]
  onToggle: (workspace: PersonalAccessTokenWorkspaceResponse) => void
}) {
  const { t } = useTranslation(['accountSettings', 'common', 'navigation'])
  const [search, setSearch] = useState('')
  const keyword = useDebounce(search.trim(), { wait: 200 })
  const query = useInfiniteQuery(
    consoleQuery.account.personalAccessTokenWorkspaces.get.infiniteOptions({
      context: { silent: true },
      initialPageParam: 0,
      input: (cursor) => ({ query: { cursor, limit: 20, keyword } }),
      getNextPageParam: (page) => page.next_cursor ?? undefined,
    }),
  )
  const candidates = new Map(
    selected
      .filter((workspace) =>
        [workspace.display_name, workspace.workspace_id].some((value) =>
          value.toLowerCase().includes(keyword.toLowerCase()),
        ),
      )
      .map((workspace) => [workspace.workspace_id, workspace]),
  )
  for (const page of query.data?.pages ?? []) {
    for (const workspace of page.data) candidates.set(workspace.workspace_id, workspace)
  }
  return (
    <div className="contents">
      <SearchInput
        className="mt-2 sm:mt-0"
        value={search}
        onValueChange={setSearch}
        placeholder={t(($) => $['personalAccessToken.searchWorkspaces'])}
      />
      <PickerList
        query={query}
        keyword={keyword}
        hasVisibleItems={candidates.size > 0}
        labels={{
          loading: t(($) => $['dynamicSelect.loading'], { ns: 'common' }),
          loadError: t(($) => $['dynamicSelect.error'], { ns: 'common' }),
          empty: t(($) => $['mainNav.workspace.noResults'], { ns: 'navigation' }),
          loadMore: t(($) => $['personalAccessToken.loadMoreWorkspaces']),
        }}
      >
        {Array.from(candidates.values()).map((workspace) => {
          const checked = selected.some((item) => item.workspace_id === workspace.workspace_id)
          return (
            <label key={workspace.workspace_id} className="flex min-h-10 items-center gap-3 py-2">
              <span className="min-w-0 flex-1 system-sm-medium break-words text-text-secondary">
                {workspace.display_name}
              </span>
              <span className="system-xs-regular text-text-tertiary">
                {workspace.available ? (
                  <WorkspaceRole role={workspace.role} />
                ) : (
                  t(($) => $['personalAccessToken.notMember'])
                )}
              </span>
              <Checkbox
                data-pat-picker-item=""
                checked={checked}
                disabled={!workspace.available && !checked}
                aria-label={workspace.display_name}
                onCheckedChange={() => onToggle(workspace)}
              />
            </label>
          )
        })}
      </PickerList>
    </div>
  )
}
