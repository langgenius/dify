'use client'

import type { ExternalAgentActionRequest } from './components/external-agent-actions'
import type { ExternalAgentListItem } from './components/external-agent-list'
import { Checkbox } from '@langgenius/dify-ui/checkbox'
import { SegmentedControl, SegmentedControlItem } from '@langgenius/dify-ui/segmented-control'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectItemIndicator,
  SelectItemText,
  SelectTrigger,
  SelectValue,
} from '@langgenius/dify-ui/select'
import { useAtomValue } from 'jotai'
import { useQueryStates } from 'nuqs'
import { useId, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { SearchInput } from '@/app/components/base/search-input'
import { isCurrentWorkspaceManagerAtom } from '@/context/workspace-state'
import { ConnectExternalAgent } from './components/connect-external-agent'
import { ExternalAgentActions } from './components/external-agent-actions'
import { ExternalAgentList } from './components/external-agent-list'
import { createExternalRosterPreview } from './external-roster-preview'
import { externalRosterQueryParsers } from './query-params'

type ExternalRosterProps = {
  initialAgents?: readonly ExternalAgentListItem[]
}

export function ExternalRoster({ initialAgents }: ExternalRosterProps) {
  const { t } = useTranslation(['agentRoster'])
  const [agents, setAgents] = useState(() =>
    initialAgents ? [...initialAgents] : createExternalRosterPreview(),
  )
  const [actionRequest, setActionRequest] = useState<ExternalAgentActionRequest>()
  const [actionOpen, setActionOpen] = useState(false)
  const searchRef = useRef<HTMLInputElement>(null)
  const requestAction = (request: ExternalAgentActionRequest) => {
    setActionRequest(request)
    setActionOpen(true)
  }
  const canManage = useAtomValue(isCurrentWorkspaceManagerAtom)
  const [filters, setFilters] = useQueryStates(externalRosterQueryParsers)
  const sortLabelId = useId()
  const enabledCount = agents.filter((agent) => agent.enabled).length
  const keyword = filters.external_keyword.trim().toLocaleLowerCase()
  const filteredAgents = agents
    .filter(
      (agent) =>
        (filters.external_status === 'all' ||
          agent.enabled === (filters.external_status === 'enabled')) &&
        (!filters.external_connected_by_me || agent.connectedByMe) &&
        (!keyword || agent.name.toLocaleLowerCase().includes(keyword)),
    )
    .sort((a, b) => {
      switch (filters.external_sort_by) {
        case 'recently_created':
          return b.createdAt - a.createdAt
        case 'earliest_created':
          return a.createdAt - b.createdAt
        default:
          return b.updatedAt - a.updatedAt
      }
    })
  const statusOptions = [
    { value: 'all', label: t(($) => $['roster.filters.all']) },
    { value: 'enabled', label: t(($) => $['external.filters.enabled']), count: enabledCount },
    {
      value: 'disabled',
      label: t(($) => $['external.filters.disabled']),
      count: agents.length - enabledCount,
    },
  ] as const
  const sortOptions = [
    { value: 'last_modified', label: t(($) => $['roster.sort.lastModified']) },
    { value: 'recently_created', label: t(($) => $['roster.sort.recentlyCreated']) },
    { value: 'earliest_created', label: t(($) => $['roster.sort.earliestCreated']) },
  ]

  return (
    <>
      <div className="flex shrink-0 flex-wrap items-center gap-2 px-2 pt-3.5 pb-2 sm:px-8">
        <SegmentedControl
          aria-label={t(($) => $['external.filters.label'])}
          value={filters.external_status}
          onValueChange={(value) => void setFilters({ external_status: value })}
          className="shrink-0"
        >
          {statusOptions.map((option) => (
            <SegmentedControlItem
              key={option.value}
              value={option.value}
              className="gap-1 data-checked:text-text-secondary"
            >
              <span>{option.label}</span>
              {'count' in option && (
                <span className="flex min-w-4 shrink-0 items-center justify-center rounded-[5px] border border-divider-deep bg-components-badge-bg-dimm px-1 py-0.5 system-2xs-medium-uppercase text-text-tertiary tabular-nums">
                  {option.count}
                </span>
              )}
            </SegmentedControlItem>
          ))}
        </SegmentedControl>
        <SearchInput
          ref={searchRef}
          aria-label={t(($) => $['roster.searchLabel'])}
          placeholder={t(($) => $['external.searchPlaceholder'])}
          value={filters.external_keyword}
          onValueChange={(value) => void setFilters({ external_keyword: value })}
          className="h-8 w-full min-w-0 sm:w-50"
        />
        <div aria-hidden className="hidden h-4 shrink-0 px-1 sm:flex">
          <div className="h-full w-px bg-divider-regular" />
        </div>
        <label className="flex h-8 shrink-0 cursor-pointer items-center gap-1 rounded-lg bg-components-input-bg-normal px-2 py-1 whitespace-nowrap">
          <Checkbox
            checked={filters.external_connected_by_me}
            onCheckedChange={(checked) =>
              void setFilters({ external_connected_by_me: checked === true })
            }
          />
          <span className="p-1 system-sm-regular text-text-tertiary">
            {t(($) => $['external.filters.connectedByMe'])}
          </span>
        </label>
        <div className="ms-auto flex flex-wrap items-center justify-end gap-2">
          <Select
            items={sortOptions}
            value={filters.external_sort_by}
            onValueChange={(value) => {
              if (value !== null) void setFilters({ external_sort_by: value })
            }}
          >
            <SelectTrigger aria-labelledby={sortLabelId} className="w-auto max-w-45 min-w-0">
              <span className="flex min-w-0 items-center gap-1 whitespace-nowrap">
                <span
                  id={sortLabelId}
                  aria-hidden
                  className="shrink-0 font-normal text-text-tertiary"
                >
                  {t(($) => $['roster.sort.label'])}
                </span>
                <SelectValue className="min-w-0 truncate font-medium text-text-secondary" />
              </span>
            </SelectTrigger>
            <SelectContent>
              {sortOptions.map((option) => (
                <SelectItem key={option.value} value={option.value}>
                  <SelectItemText>{option.label}</SelectItemText>
                  <SelectItemIndicator />
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          {canManage && (
            <ConnectExternalAgent
              onConnect={(details) => {
                const now = Date.now()
                setAgents((current) => [
                  {
                    ...details,
                    key: crypto.randomUUID(),
                    enabled: true,
                    connectedByMe: true,
                    createdAt: now,
                    updatedAt: now,
                    apps: [],
                  },
                  ...current,
                ])
                void setFilters({
                  external_keyword: '',
                  external_status: 'all',
                  external_sort_by: 'last_modified',
                })
              }}
            />
          )}
        </div>
      </div>
      <div className="min-h-0 flex-1 max-md:min-h-64">
        <ExternalAgentList
          agents={filteredAgents}
          onAction={canManage ? requestAction : undefined}
          onClearFilters={() => {
            void setFilters({
              external_keyword: '',
              external_status: 'all',
              external_connected_by_me: false,
            })
            searchRef.current?.focus()
          }}
          filtered={Boolean(
            keyword || filters.external_status !== 'all' || filters.external_connected_by_me,
          )}
        />
      </div>
      <ExternalAgentActions
        request={actionRequest}
        open={actionOpen}
        onOpenChange={setActionOpen}
        onRequest={requestAction}
        fallbackFocus={searchRef}
        onEdit={(key, fields) => {
          const updatedAt = Date.now()
          setAgents((current) =>
            current.map((agent) =>
              agent.key === key ? { ...agent, ...fields, updatedAt } : agent,
            ),
          )
          setActionOpen(false)
        }}
        onToggle={(key) => {
          const updatedAt = Date.now()
          setAgents((current) =>
            current.map((agent) =>
              agent.key === key ? { ...agent, enabled: !agent.enabled, updatedAt } : agent,
            ),
          )
          setActionOpen(false)
        }}
        onDelete={(key) => {
          setAgents((current) => current.filter((agent) => agent.key !== key))
          setActionOpen(false)
        }}
      />
    </>
  )
}
