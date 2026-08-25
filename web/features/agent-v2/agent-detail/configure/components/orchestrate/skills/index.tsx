'use client'

import type {
  AgentSkillBindingItemResponse,
  SkillResponse,
} from '@dify/contracts/api/console/workspaces/types.gen'
import type { UIEvent } from 'react'
import type { AgentOrchestrateAddActionOptions } from '../add-actions-context'
import type { AgentSkill } from '@/features/agent-v2/agent-composer/form-state'
import { Button } from '@langgenius/dify-ui/button'
import { cn } from '@langgenius/dify-ui/cn'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@langgenius/dify-ui/dropdown-menu'
import { Popover, PopoverContent, PopoverTrigger } from '@langgenius/dify-ui/popover'
import { toast } from '@langgenius/dify-ui/toast'
import {
  keepPreviousData,
  useInfiniteQuery,
  useMutation,
  useQuery,
  useQueryClient,
} from '@tanstack/react-query'
import { useDebounce } from 'ahooks'
import { useAtomValue, useSetAtom } from 'jotai'
import { useCallback, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { SearchInput } from '@/app/components/base/search-input'
import { SkeletonRectangle } from '@/app/components/base/skeleton'
import {
  agentComposerSkillsAtom,
  removeAgentSkillAtom,
  upsertAgentSkillAtom,
} from '@/features/agent-v2/agent-composer/store-modules/skills'
import {
  getSkillErrorCode,
  getSkillErrorDetailString,
  normalizeSkillError,
} from '@/features/skills/error'
import { TagFilter } from '@/features/tag-management/components/tag-filter'
import Link from '@/next/link'
import { consoleQuery } from '@/service/client'
import { useRegisterAgentOrchestrateAddAction } from '../add-actions-context'
import { ConfigureSectionEmpty } from '../common/empty'
import { ConfigureSection } from '../common/section'
import { AgentConfigureTipContent } from '../common/tip-content'
import { useAgentConfigApiContext } from '../config-context'
import { useAgentOrchestrateReadOnly } from '../read-only-context'
import { AgentSkillItem } from './item'
import { AgentSkillUploadDialog } from './upload-dialog'

const WORKSPACE_SKILLS_PAGE_SIZE = 20
const MAX_AGENT_LIBRARY_SKILLS = 20

function AgentSkillAddMenuItem({
  badge,
  description,
  disabled,
  iconClassName,
  label,
  onClick,
}: {
  badge?: string
  description: string
  disabled?: boolean
  iconClassName: string
  label: string
  onClick: () => void
}) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      className="flex w-full min-w-0 items-start gap-3 rounded-lg px-2 py-2 text-left outline-hidden hover:not-disabled:bg-state-base-hover focus-visible:bg-state-base-hover focus-visible:ring-2 focus-visible:ring-state-accent-solid disabled:cursor-not-allowed disabled:opacity-50"
    >
      <span
        aria-hidden
        className={cn('mt-0.5 size-4 shrink-0 text-text-secondary', iconClassName)}
      />
      <span className="flex min-w-0 flex-1 flex-col gap-0.5">
        <span className="flex min-w-0 items-center gap-2">
          <span className="truncate system-sm-medium text-text-secondary">{label}</span>
          {badge && (
            <span className="shrink-0 rounded-[5px] border border-divider-deep bg-components-badge-bg-dimm px-1.5 py-0.5 system-2xs-medium-uppercase text-text-tertiary">
              {badge}
            </span>
          )}
        </span>
        <span className="line-clamp-2 system-xs-regular text-text-tertiary">{description}</span>
      </span>
    </button>
  )
}

function WorkspaceSkillIcon() {
  return (
    <span className="flex size-6 shrink-0 items-center justify-center rounded-md border-[0.5px] border-effects-icon-border bg-background-default-dodge p-1 backdrop-blur-xs">
      <span
        aria-hidden
        className="i-custom-vender-agent-v2-building-blocks size-4 text-text-secondary"
      />
    </span>
  )
}

function WorkspaceSkillRow({
  unavailable,
  isAdded,
  isPending,
  onSelect,
  onPreview,
  selected,
  skill,
}: {
  unavailable: boolean
  isAdded: boolean
  isPending: boolean
  onSelect: (skill: SkillResponse) => void
  onPreview: (skill: SkillResponse) => void
  selected: boolean
  skill: SkillResponse
}) {
  const { t } = useTranslation('agentV2')
  const cannotAdd = unavailable || isAdded || isPending

  return (
    <button
      type="button"
      aria-disabled={cannotAdd}
      onClick={() => {
        onPreview(skill)
        if (!cannotAdd) onSelect(skill)
      }}
      onFocus={() => onPreview(skill)}
      onMouseEnter={() => onPreview(skill)}
      className={cn(
        'flex h-8 w-full min-w-0 items-center gap-1 rounded-lg pr-2.5 pl-3 text-left outline-hidden hover:bg-state-base-hover focus-visible:bg-state-base-hover focus-visible:ring-2 focus-visible:ring-state-accent-solid',
        selected && 'bg-state-base-hover',
        isPending && 'cursor-wait opacity-60',
      )}
    >
      <WorkspaceSkillIcon />
      <span className="w-0 min-w-0 flex-1 truncate system-sm-medium text-text-secondary">
        {skill.display_name}
      </span>
      {isAdded && (
        <span className="shrink-0 system-xs-medium text-text-tertiary">
          {t(($) => $['agentDetail.configure.skills.workspaceSelector.added'])}
        </span>
      )}
      {!isAdded && unavailable && (
        <span className="shrink-0 system-xs-medium text-text-tertiary">
          {t(($) => $['agentDetail.configure.skills.workspaceSelector.draft'])}
        </span>
      )}
    </button>
  )
}

function WorkspaceSkillPreview({ skill }: { skill?: SkillResponse }) {
  const { t } = useTranslation('agentV2')

  if (!skill) {
    return (
      <div className="flex min-h-32 items-center justify-center px-6 text-center system-xs-regular text-text-tertiary">
        {t(($) => $['agentDetail.configure.skills.workspaceSelector.empty'])}
      </div>
    )
  }

  return (
    <div className="flex max-h-[428px] flex-col gap-2 overflow-y-auto px-3 pt-3 pb-4">
      <div className="flex min-w-0 flex-col items-start gap-1">
        <WorkspaceSkillIcon />
        <div className="min-w-0 flex-1">
          <div className="truncate system-md-medium text-text-primary">{skill.display_name}</div>
          <div className="truncate system-xs-regular text-text-tertiary">{skill.name}</div>
        </div>
      </div>
      {!!skill.tags?.length && (
        <div className="flex flex-wrap gap-1">
          {skill.tags.slice(0, 5).map((tag) => (
            <span
              key={tag}
              className="rounded-[5px] border border-divider-subtle bg-components-badge-bg-dimm px-1.5 py-0.5 system-2xs-medium-uppercase text-text-tertiary"
            >
              {tag}
            </span>
          ))}
        </div>
      )}
      <p className="system-xs-regular text-text-secondary">{skill.description}</p>
      {(skill.updated_by_name || skill.created_by_name) && (
        <div className="mt-auto system-xs-regular text-text-tertiary">
          {skill.updated_by_name || skill.created_by_name}
        </div>
      )}
    </div>
  )
}

function WorkspaceSkillSelector({
  boundSkillIds,
  isBindingPending,
  onSelect,
}: {
  boundSkillIds: string[]
  isBindingPending: boolean
  onSelect: (skill: SkillResponse) => void
}) {
  const { t } = useTranslation('agentV2')
  const [keyword, setKeyword] = useState('')
  const [selectedTagIds, setSelectedTagIds] = useState<string[]>([])
  const [previewSkillId, setPreviewSkillId] = useState<string | undefined>(undefined)
  const selectorRef = useRef<HTMLDivElement>(null)
  const debouncedKeyword = useDebounce(keyword.trim(), { wait: 300 })
  const { data: tagList = [] } = useQuery(
    consoleQuery.tags.get.queryOptions({
      input: {
        query: {
          type: 'skill',
        },
      },
    }),
  )
  const tagNameById = useMemo(() => new Map(tagList.map((tag) => [tag.id, tag.name])), [tagList])
  const selectedTagNames = useMemo(
    () => selectedTagIds.flatMap((tagId) => tagNameById.get(tagId) ?? []),
    [selectedTagIds, tagNameById],
  )
  const skillsQuery = useInfiniteQuery({
    ...consoleQuery.workspaces.current.skills.get.infiniteOptions({
      input: (pageParam) => ({
        query: {
          limit: WORKSPACE_SKILLS_PAGE_SIZE,
          page: Number(pageParam),
          ...(debouncedKeyword ? { keyword: debouncedKeyword } : {}),
          ...(selectedTagNames.length ? { tag: selectedTagNames } : {}),
        },
      }),
      getNextPageParam: (lastPage) => (lastPage.has_more ? (lastPage.page ?? 1) + 1 : undefined),
      initialPageParam: 1,
      placeholderData: keepPreviousData,
    }),
  })
  const boundSkillIdSet = useMemo(() => new Set(boundSkillIds), [boundSkillIds])
  const skills =
    skillsQuery.data?.pages
      .flatMap((page) => page.data ?? [])
      .filter((skill) => Boolean(skill.latest_published_version_id)) ?? []
  const previewSkill = skills.find((skill) => skill.id === previewSkillId) ?? skills[0]
  const hasNextPage = skillsQuery.hasNextPage ?? false
  const isFetchingNextPage = skillsQuery.isFetchingNextPage
  const fetchNextPage = skillsQuery.fetchNextPage

  const handleListScroll = useCallback(
    (event: UIEvent<HTMLDivElement>) => {
      const target = event.currentTarget
      const scrollBottom = target.scrollHeight - target.scrollTop - target.clientHeight
      if (scrollBottom < 80 && hasNextPage && !isFetchingNextPage) void fetchNextPage()
    },
    [fetchNextPage, hasNextPage, isFetchingNextPage],
  )

  return (
    <div ref={selectorRef} className="relative h-[520px] w-[320px]">
      <div className="flex h-full w-full flex-col overflow-hidden rounded-xl border-[0.5px] border-components-panel-border bg-components-panel-bg shadow-lg backdrop-blur-[5px]">
        <div className="border-b border-divider-subtle p-2">
          <div className="relative">
            <SearchInput
              className={keyword ? '[&_input]:pr-14' : '[&_input]:pr-9'}
              value={keyword}
              onValueChange={setKeyword}
              placeholder={t(($) => $['agentDetail.configure.skills.workspaceSelector.search'])}
            />
            <div
              className={cn(
                'absolute top-1/2 size-6 -translate-y-1/2',
                keyword ? 'right-7' : 'right-1.5',
              )}
            >
              <TagFilter
                iconOnly
                type="skill"
                value={selectedTagIds}
                onChange={setSelectedTagIds}
                portalProps={{ container: selectorRef }}
                showTagManagement={false}
                triggerClassName="bg-transparent hover:bg-state-base-hover focus-visible:bg-state-base-hover data-popup-open:bg-state-base-hover"
              />
            </div>
          </div>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto p-1" onScroll={handleListScroll}>
          {skillsQuery.isPending && (
            <div className="space-y-1">
              <SkeletonRectangle className="h-8 rounded-lg" />
              <SkeletonRectangle className="h-8 rounded-lg" />
              <SkeletonRectangle className="h-8 rounded-lg" />
            </div>
          )}
          {!skillsQuery.isPending && skills.length === 0 && (
            <div className="flex h-full items-center justify-center px-4 text-center system-xs-regular text-text-tertiary">
              {t(($) => $['agentDetail.configure.skills.workspaceSelector.empty'])}
            </div>
          )}
          {!skillsQuery.isPending &&
            skills.map((skill) => (
              <WorkspaceSkillRow
                key={skill.id}
                unavailable={!skill.latest_published_version_id}
                isAdded={boundSkillIdSet.has(skill.id)}
                isPending={isBindingPending}
                selected={previewSkill?.id === skill.id}
                skill={skill}
                onPreview={(skill) => setPreviewSkillId(skill.id)}
                onSelect={onSelect}
              />
            ))}
          {skillsQuery.isFetchingNextPage && (
            <div className="space-y-1">
              <SkeletonRectangle className="h-8 rounded-lg" />
              <SkeletonRectangle className="h-8 rounded-lg" />
            </div>
          )}
        </div>
        <Link
          href="/skills"
          className="flex h-8 items-center gap-0.5 border-t border-divider-subtle px-4 system-xs-medium text-text-tertiary outline-hidden hover:bg-state-base-hover hover:text-text-secondary focus-visible:ring-2 focus-visible:ring-state-accent-solid"
        >
          <span>{t(($) => $['agentDetail.configure.skills.workspaceSelector.manage'])}</span>
          <span aria-hidden className="i-ri-arrow-right-up-line size-3" />
        </Link>
      </div>
      <div className="absolute top-[52px] left-[-244px] w-[240px] overflow-hidden rounded-xl border-[0.5px] border-components-panel-border bg-components-panel-bg-blur shadow-lg backdrop-blur-[5px]">
        <WorkspaceSkillPreview skill={previewSkill} />
      </div>
    </div>
  )
}

function WorkspaceAgentSkillItem({
  canRemove,
  skill,
  onRemove,
}: {
  canRemove: boolean
  skill: AgentSkillBindingItemResponse
  onRemove: (skillId: string) => void
}) {
  const { t } = useTranslation('agentV2')
  const readOnly = useAgentOrchestrateReadOnly()
  const [isActionsOpen, setIsActionsOpen] = useState(false)
  const [isRemoveHighlighted, setIsRemoveHighlighted] = useState(false)
  const displayName = skill.display_name || skill.name
  const handleOpenInLibrary = useCallback(() => {
    window.open(`/skills/${skill.id}`, '_blank', 'noopener,noreferrer')
  }, [skill.id])

  return (
    <div
      data-workspace-skill-row
      className={cn(
        'group relative h-8 overflow-hidden rounded-lg border-[0.5px] border-components-panel-border bg-components-panel-on-panel-item-bg shadow-xs shadow-shadow-shadow-3 hover:bg-components-panel-on-panel-item-bg-hover hover:shadow-sm',
        isRemoveHighlighted &&
          'border-state-destructive-border! bg-state-destructive-hover! shadow-xs!',
      )}
    >
      <Link
        href={`/skills/${skill.id}`}
        target="_blank"
        rel="noreferrer"
        className="flex h-full w-full min-w-0 cursor-pointer items-center gap-1 rounded-lg px-2 py-1 text-left outline-hidden select-none focus-visible:inset-ring-2 focus-visible:inset-ring-state-accent-solid"
      >
        <span
          aria-hidden
          className="i-custom-vender-agent-v2-building-blocks size-4 shrink-0 text-text-secondary"
        />
        <span className="flex w-0 min-w-0 flex-1 items-center gap-1">
          <span className="min-w-0 truncate system-sm-medium text-text-secondary">
            {displayName}
          </span>
          <span
            aria-hidden
            className="i-ri-arrow-right-up-line size-3.5 shrink-0 text-text-quaternary opacity-0 group-focus-within:opacity-100 group-hover:opacity-100"
          />
        </span>
        <span
          className={cn(
            'shrink-0 system-xs-regular text-text-tertiary',
            !readOnly && 'group-focus-within:opacity-0 group-hover:opacity-0',
            isActionsOpen && 'opacity-0',
          )}
        >
          {skill.name}
        </span>
      </Link>
      <DropdownMenu
        modal={false}
        onOpenChange={(open) => {
          setIsActionsOpen(open)
          if (!open) setIsRemoveHighlighted(false)
        }}
      >
        <DropdownMenuTrigger
          aria-label={t(($) => $['agentDetail.configure.skills.moreActions'], {
            name: displayName,
          })}
          className={cn(
            'pointer-events-none absolute top-1/2 right-1 z-10 flex size-6 -translate-y-1/2 items-center justify-center rounded-md text-text-tertiary opacity-0 group-focus-within:pointer-events-auto group-focus-within:opacity-100 group-hover:pointer-events-auto group-hover:opacity-100 hover:bg-state-base-hover hover:text-text-secondary focus-visible:ring-2 focus-visible:ring-state-accent-solid focus-visible:outline-hidden data-popup-open:pointer-events-auto data-popup-open:bg-state-base-hover data-popup-open:text-text-secondary data-popup-open:opacity-100',
            isRemoveHighlighted && 'text-text-destructive!',
          )}
          onClick={(event) => event.stopPropagation()}
        >
          <span aria-hidden className="i-ri-more-fill size-4" />
        </DropdownMenuTrigger>
        <DropdownMenuContent placement="bottom-end" sideOffset={4} className="w-48">
          <DropdownMenuItem className="gap-2" onClick={handleOpenInLibrary}>
            <span
              aria-hidden
              className="i-ri-arrow-right-up-line size-4 shrink-0 text-text-tertiary"
            />
            <span>{t(($) => $['agentDetail.configure.skills.openInLibrary'])}</span>
          </DropdownMenuItem>
          {canRemove && (
            <>
              <DropdownMenuSeparator />
              <DropdownMenuItem
                data-workspace-skill-remove-action
                className="group gap-2 data-highlighted:bg-state-destructive-hover data-highlighted:text-text-destructive"
                onClick={() => onRemove(skill.id)}
                onFocus={() => setIsRemoveHighlighted(true)}
                onBlur={() => setIsRemoveHighlighted(false)}
                onMouseEnter={() => setIsRemoveHighlighted(true)}
                onMouseLeave={() => setIsRemoveHighlighted(false)}
              >
                <span
                  aria-hidden
                  className="i-ri-delete-bin-line size-4 shrink-0 text-text-tertiary group-data-highlighted:text-text-destructive"
                />
                <span>{t(($) => $['agentDetail.configure.skills.removeAction'])}</span>
              </DropdownMenuItem>
            </>
          )}
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  )
}

export function AgentSkills() {
  const { t } = useTranslation('agentV2')
  const { t: tSkill } = useTranslation('skill')
  const { t: tCommon } = useTranslation('common')
  const skillsTip = t(($) => $['agentDetail.configure.skills.tip'])
  const skillsListId = 'agent-configure-skills-list'
  const queryClient = useQueryClient()
  const readOnly = useAgentOrchestrateReadOnly()
  const [addMenuOpen, setAddMenuOpen] = useState(false)
  const [addMenuView, setAddMenuView] = useState<'menu' | 'workspace-selector'>('menu')
  const [isUploadOpen, setIsUploadOpen] = useState(false)
  const promptAddCallbackRef = useRef<AgentOrchestrateAddActionOptions['onAdded']>(undefined)
  const apiContext = useAgentConfigApiContext()
  const skills = useAtomValue(agentComposerSkillsAtom)
  const upsertAgentSkill = useSetAtom(upsertAgentSkillAtom)
  const removeAgentSkill = useSetAtom(removeAgentSkillAtom)
  const { mutate: deleteAgentSkill } = useMutation(
    consoleQuery.agent.byAgentId.config.skills.byName.delete.mutationOptions(),
  )
  const { mutate: deleteAppSkill } = useMutation(
    consoleQuery.apps.byAppId.agent.config.skills.byName.delete.mutationOptions(),
  )
  const agentSkillBindingsQueryOptions =
    consoleQuery.workspaces.current.agents.byAgentId.skills.get.queryOptions({
      input: {
        params: {
          agent_id: apiContext.agentId,
        },
      },
    })
  const agentSkillBindingsQuery = useQuery({
    ...agentSkillBindingsQueryOptions,
  })
  const hasLoadedAgentSkillBindings = agentSkillBindingsQuery.data !== undefined
  const { isPending: isReplacingAgentSkillBindings, mutate: replaceAgentSkillBindings } =
    useMutation(consoleQuery.workspaces.current.agents.byAgentId.skills.put.mutationOptions())
  const workspaceSkills = agentSkillBindingsQuery.data?.data ?? []
  const boundSkillIds =
    agentSkillBindingsQuery.data?.skill_ids ?? workspaceSkills.map((skill) => skill.id)
  const hasSkills = skills.length > 0 || workspaceSkills.length > 0
  const invalidateAgentSkillBindings = useCallback(() => {
    void queryClient.invalidateQueries({
      queryKey: consoleQuery.workspaces.current.agents.byAgentId.skills.get.key({
        type: 'query',
        input: {
          params: {
            agent_id: apiContext.agentId,
          },
        },
      }),
    })
  }, [apiContext.agentId, queryClient])

  const replaceWorkspaceSkillBindings = useCallback(
    (skillIds: string[], onSuccess?: () => void) => {
      if (readOnly || !hasLoadedAgentSkillBindings) return

      replaceAgentSkillBindings(
        {
          params: {
            agent_id: apiContext.agentId,
          },
          body: {
            skill_ids: skillIds,
          },
        },
        {
          onError: async (error) => {
            const normalizedError = await normalizeSkillError(error)
            const errorCode = getSkillErrorCode(normalizedError)
            if (errorCode === 'too_many_agent_skills') {
              toast.error(
                t(($) => $['agentDetail.configure.skills.workspaceSelector.limitReached']),
              )
              return
            }
            if (errorCode === 'skill_name_conflict') {
              toast.error(
                tSkill(($) => $['skillManagement.errors.nameConflict'], {
                  name: getSkillErrorDetailString(normalizedError, 'name') ?? '',
                }),
              )
              return
            }
            toast.error(t(($) => $['agentDetail.configure.skills.workspaceSelector.saveFailed']))
          },
          onSuccess: () => {
            invalidateAgentSkillBindings()
            void queryClient.invalidateQueries({
              queryKey: consoleQuery.agent.byAgentId.composer.get.key({
                type: 'query',
                input: {
                  params: {
                    agent_id: apiContext.agentId,
                  },
                },
              }),
            })
            onSuccess?.()
          },
        },
      )
    },
    [
      apiContext.agentId,
      hasLoadedAgentSkillBindings,
      invalidateAgentSkillBindings,
      queryClient,
      readOnly,
      replaceAgentSkillBindings,
      t,
      tSkill,
    ],
  )

  const handlePromptAdd = useCallback((options?: AgentOrchestrateAddActionOptions) => {
    promptAddCallbackRef.current = options?.onAdded
    if (options?.skillSource === 'library') {
      setAddMenuView('workspace-selector')
      setAddMenuOpen(true)
      return
    }

    if (options?.skillSource === 'upload') {
      setIsUploadOpen(true)
      return
    }

    setAddMenuView('menu')
    setAddMenuOpen(true)
  }, [])
  useRegisterAgentOrchestrateAddAction('skills', handlePromptAdd)

  const handleAddMenuOpenChange = useCallback((open: boolean) => {
    setAddMenuOpen(open)
    if (!open) {
      setAddMenuView('menu')
      promptAddCallbackRef.current = undefined
    }
  }, [])

  const handleOpenWorkspaceSelector = useCallback(() => {
    setAddMenuView('workspace-selector')
  }, [])

  const handleOpenUploadFromMenu = useCallback(() => {
    setAddMenuOpen(false)
    setIsUploadOpen(true)
  }, [])

  const handleUploaded = useCallback(
    (skill: AgentSkill) => {
      upsertAgentSkill(skill)
      promptAddCallbackRef.current?.(skill)
      promptAddCallbackRef.current = undefined
    },
    [upsertAgentSkill],
  )

  const handleSelectWorkspaceSkill = useCallback(
    (skill: SkillResponse) => {
      if (
        !hasLoadedAgentSkillBindings ||
        !skill.latest_published_version_id ||
        boundSkillIds.includes(skill.id)
      )
        return
      if (boundSkillIds.length >= MAX_AGENT_LIBRARY_SKILLS) {
        toast.error(t(($) => $['agentDetail.configure.skills.workspaceSelector.limitReached']))
        return
      }

      replaceWorkspaceSkillBindings([...boundSkillIds, skill.id], () => {
        promptAddCallbackRef.current?.({
          description: skill.description,
          id: skill.name,
          name: skill.display_name,
        })
        promptAddCallbackRef.current = undefined
        setAddMenuOpen(false)
        setAddMenuView('menu')
      })
    },
    [boundSkillIds, hasLoadedAgentSkillBindings, replaceWorkspaceSkillBindings, t],
  )

  const handleUploadOpenChange = useCallback((open: boolean) => {
    if (!open) promptAddCallbackRef.current = undefined
    setIsUploadOpen(open)
  }, [])

  const handleRemoveWorkspaceSkill = useCallback(
    (skillId: string) => {
      replaceWorkspaceSkillBindings(boundSkillIds.filter((item) => item !== skillId))
    },
    [boundSkillIds, replaceWorkspaceSkillBindings],
  )

  const handleRemoveSkill = useCallback(
    (skillId: string) => {
      const skill = skills.find((item) => item.id === skillId)
      if (!skill) return

      const onSuccess = () => {
        removeAgentSkill(skillId)
      }
      if (apiContext.workflow) {
        deleteAppSkill(
          {
            params: {
              app_id: apiContext.workflow.appId,
              name: skill.name,
            },
            query: {
              node_id: apiContext.workflow.nodeId,
              draft_type: apiContext.draftType,
              version_id: apiContext.versionId,
            },
          },
          { onSuccess },
        )
        return
      }

      deleteAgentSkill(
        {
          params: {
            agent_id: apiContext.agentId,
            name: skill.name,
          },
          query: {
            draft_type: apiContext.draftType,
            version_id: apiContext.versionId,
          },
        },
        { onSuccess },
      )
    },
    [apiContext, deleteAgentSkill, deleteAppSkill, removeAgentSkill, skills],
  )

  return (
    <>
      <ConfigureSection
        label={t(($) => $['agentDetail.configure.skills.label'])}
        labelId="agent-configure-skills-label"
        buildDraftChangeSection="skills"
        panelId={skillsListId}
        tip={<AgentConfigureTipContent type="skills" />}
        tipAriaLabel={skillsTip}
        rootClassName="border-b border-divider-subtle pt-4"
        panelContentClassName="flex flex-col gap-1 pb-4"
        actions={
          !readOnly && (
            <Popover open={addMenuOpen} onOpenChange={handleAddMenuOpenChange}>
              <PopoverTrigger
                render={
                  <Button
                    aria-label={t(($) => $['agentDetail.configure.skills.add'])}
                    variant="ghost"
                    size="small"
                    className="shrink-0 gap-1 px-2"
                  >
                    <span aria-hidden className="i-ri-add-line size-3.5" />
                    <span>{tCommon(($) => $['operation.add'])}</span>
                  </Button>
                }
              />
              <PopoverContent
                placement="bottom-end"
                sideOffset={4}
                className={
                  addMenuView === 'menu'
                    ? 'w-[280px] bg-components-panel-bg-blur p-1 shadow-lg backdrop-blur-[5px]'
                    : 'w-[320px] overflow-visible border-none bg-transparent p-0 shadow-none'
                }
              >
                {addMenuView === 'menu' ? (
                  <>
                    <AgentSkillAddMenuItem
                      iconClassName="i-custom-vender-agent-v2-building-blocks"
                      label={t(($) => $['agentDetail.configure.skills.addMenu.workspace.label'])}
                      description={t(
                        ($) => $['agentDetail.configure.skills.addMenu.workspace.description'],
                      )}
                      onClick={handleOpenWorkspaceSelector}
                    />
                    <AgentSkillAddMenuItem
                      badge={t(($) => $['agentDetail.configure.skills.addMenu.upload.badge'])}
                      iconClassName="i-ri-upload-cloud-2-line"
                      label={t(($) => $['agentDetail.configure.skills.addMenu.upload.label'])}
                      description={t(
                        ($) => $['agentDetail.configure.skills.addMenu.upload.description'],
                      )}
                      onClick={handleOpenUploadFromMenu}
                    />
                  </>
                ) : (
                  <WorkspaceSkillSelector
                    boundSkillIds={boundSkillIds}
                    isBindingPending={!hasLoadedAgentSkillBindings || isReplacingAgentSkillBindings}
                    onSelect={handleSelectWorkspaceSkill}
                  />
                )}
              </PopoverContent>
            </Popover>
          )
        }
      >
        {!hasSkills ? (
          <ConfigureSectionEmpty
            title={t(($) => $['agentDetail.configure.skills.empty.title'])}
            description={t(($) => $['agentDetail.configure.skills.empty.description'])}
          />
        ) : (
          <>
            {workspaceSkills.map((skill) => (
              <WorkspaceAgentSkillItem
                key={skill.id}
                canRemove={!readOnly}
                skill={skill}
                onRemove={handleRemoveWorkspaceSkill}
              />
            ))}
            {skills.map((skill) => (
              <AgentSkillItem
                key={skill.id}
                apiContext={apiContext}
                canRemove={!readOnly}
                skill={skill}
                onRemove={handleRemoveSkill}
              />
            ))}
          </>
        )}
      </ConfigureSection>
      <AgentSkillUploadDialog
        apiContext={apiContext}
        open={isUploadOpen}
        onOpenChange={handleUploadOpenChange}
        onUploaded={handleUploaded}
      />
    </>
  )
}
