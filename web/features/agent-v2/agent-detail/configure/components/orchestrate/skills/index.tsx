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
import Link from '@/next/link'
import { consoleQuery } from '@/service/client'
import { useRegisterAgentOrchestrateAddAction } from '../add-actions-context'
import { ConfigureSectionEmpty } from '../common/empty'
import { ConfigureSection } from '../common/section'
import { AgentConfigureTipContent } from '../common/tip-content'
import { useAgentConfigApiContext } from '../config-context'
import {
  useAgentOrchestrateReadOnly,
  useAgentOrchestrateViewingVersion,
} from '../read-only-context'
import { AgentSkillItem } from './item'
import { AgentSkillUploadDialog } from './upload-dialog'

const WORKSPACE_SKILLS_PAGE_SIZE = 20

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
        className={cn('mt-0.5 size-4 shrink-0 text-text-tertiary', iconClassName)}
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

function WorkspaceSkillIcon({ icon }: { icon?: string }) {
  return (
    <span className="flex size-5 shrink-0 items-center justify-center rounded-md border-[0.5px] border-divider-subtle bg-background-default-dodge">
      {icon ? (
        <span className="text-[12px] leading-none">{icon}</span>
      ) : (
        <span aria-hidden className="i-ri-box-3-line size-3.5 text-text-tertiary" />
      )}
    </span>
  )
}

function WorkspaceSkillRow({
  disabled,
  isAdded,
  isPending,
  onSelect,
  onPreview,
  selected,
  skill,
}: {
  disabled: boolean
  isAdded: boolean
  isPending: boolean
  onSelect: (skill: SkillResponse) => void
  onPreview: (skill: SkillResponse) => void
  selected: boolean
  skill: SkillResponse
}) {
  const { t } = useTranslation('agentV2')

  return (
    <button
      type="button"
      disabled={disabled || isAdded || isPending}
      onClick={() => onSelect(skill)}
      onFocus={() => onPreview(skill)}
      onMouseEnter={() => onPreview(skill)}
      className={cn(
        'flex h-12 w-full min-w-0 items-center gap-2 rounded-lg px-2 text-left outline-hidden hover:not-disabled:bg-state-base-hover focus-visible:bg-state-base-hover focus-visible:ring-2 focus-visible:ring-state-accent-solid disabled:cursor-default disabled:opacity-60',
        selected && 'bg-state-base-hover',
      )}
    >
      <WorkspaceSkillIcon icon={skill.icon} />
      <span className="flex w-0 min-w-0 flex-1 flex-col gap-0.5">
        <span className="truncate system-sm-medium text-text-secondary">{skill.display_name}</span>
        <span className="truncate system-xs-regular text-text-tertiary">{skill.name}</span>
      </span>
      {isAdded && (
        <span className="shrink-0 system-xs-medium text-text-tertiary">
          {t(($) => $['agentDetail.configure.skills.workspaceSelector.added'])}
        </span>
      )}
      {!isAdded && disabled && (
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
      <div className="flex h-full items-center justify-center px-6 text-center system-xs-regular text-text-tertiary">
        {t(($) => $['agentDetail.configure.skills.workspaceSelector.empty'])}
      </div>
    )
  }

  return (
    <div className="flex h-full flex-col gap-4 p-4">
      <div className="flex min-w-0 items-start gap-3">
        <WorkspaceSkillIcon icon={skill.icon} />
        <div className="min-w-0 flex-1">
          <div className="truncate system-md-semibold text-text-primary">{skill.display_name}</div>
          <div className="mt-0.5 truncate system-xs-regular text-text-tertiary">{skill.name}</div>
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
      <p className="line-clamp-6 system-sm-regular text-text-secondary">{skill.description}</p>
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
  const [previewSkillId, setPreviewSkillId] = useState<string | undefined>(undefined)
  const debouncedKeyword = useDebounce(keyword.trim(), { wait: 300 })
  const skillsQuery = useInfiniteQuery({
    ...consoleQuery.workspaces.current.skills.get.infiniteOptions({
      input: (pageParam) => ({
        query: {
          limit: WORKSPACE_SKILLS_PAGE_SIZE,
          page: Number(pageParam),
          ...(debouncedKeyword ? { keyword: debouncedKeyword } : {}),
        },
      }),
      getNextPageParam: (lastPage) => (lastPage.has_more ? (lastPage.page ?? 1) + 1 : undefined),
      initialPageParam: 1,
      placeholderData: keepPreviousData,
    }),
  })
  const boundSkillIdSet = useMemo(() => new Set(boundSkillIds), [boundSkillIds])
  const skills = skillsQuery.data?.pages.flatMap((page) => page.data ?? []) ?? []
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
    <div className="flex h-[520px] w-[560px] overflow-hidden rounded-xl border border-divider-regular bg-components-panel-bg shadow-lg">
      <div className="flex min-w-0 flex-1 flex-col border-r border-divider-subtle">
        <div className="border-b border-divider-subtle p-3">
          <div className="relative">
            <SearchInput
              value={keyword}
              onValueChange={setKeyword}
              placeholder={t(($) => $['agentDetail.configure.skills.workspaceSelector.search'])}
            />
            <span
              aria-hidden
              className="pointer-events-none absolute top-1/2 right-8 i-ri-price-tag-3-line size-4 -translate-y-1/2 text-text-tertiary"
            />
          </div>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto p-1.5" onScroll={handleListScroll}>
          {skillsQuery.isPending && (
            <div className="space-y-2 p-1">
              <SkeletonRectangle className="h-10 rounded-lg" />
              <SkeletonRectangle className="h-10 rounded-lg" />
              <SkeletonRectangle className="h-10 rounded-lg" />
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
                disabled={!skill.latest_published_version_id}
                isAdded={boundSkillIdSet.has(skill.id)}
                isPending={isBindingPending}
                selected={previewSkill?.id === skill.id}
                skill={skill}
                onPreview={(skill) => setPreviewSkillId(skill.id)}
                onSelect={onSelect}
              />
            ))}
          {skillsQuery.isFetchingNextPage && (
            <div className="space-y-2 p-1">
              <SkeletonRectangle className="h-10 rounded-lg" />
              <SkeletonRectangle className="h-10 rounded-lg" />
            </div>
          )}
        </div>
        <Link
          href="/skills"
          className="flex h-10 items-center justify-between border-t border-divider-subtle px-3 system-sm-medium text-text-secondary outline-hidden hover:bg-state-base-hover focus-visible:ring-2 focus-visible:ring-state-accent-solid"
        >
          <span>{t(($) => $['agentDetail.configure.skills.workspaceSelector.manage'])}</span>
          <span aria-hidden className="i-ri-arrow-right-up-line size-4 text-text-tertiary" />
        </Link>
      </div>
      <div className="w-[240px] shrink-0 bg-background-default">
        <WorkspaceSkillPreview skill={previewSkill} />
      </div>
    </div>
  )
}

function WorkspaceAgentSkillItem({
  skill,
  onRemove,
}: {
  skill: AgentSkillBindingItemResponse
  onRemove: (skillId: string) => void
}) {
  const { t } = useTranslation('agentV2')
  const readOnly = useAgentOrchestrateReadOnly()
  const displayName = skill.display_name || skill.name
  const handleOpenInLibrary = useCallback(() => {
    window.open(`/skills/${skill.id}`, '_blank', 'noopener,noreferrer')
  }, [skill.id])

  return (
    <div className="group relative h-8 overflow-hidden rounded-lg border-[0.5px] border-components-panel-border bg-components-panel-on-panel-item-bg shadow-xs shadow-shadow-shadow-3 hover:bg-components-panel-on-panel-item-bg-hover hover:shadow-sm">
      <Link
        href={`/skills/${skill.id}`}
        target="_blank"
        rel="noreferrer"
        className="flex h-full w-full min-w-0 cursor-pointer items-center gap-1 rounded-lg py-1 pr-8 pl-2 text-left outline-hidden select-none focus-visible:inset-ring-2 focus-visible:inset-ring-state-accent-solid"
      >
        <WorkspaceSkillIcon icon={skill.icon} />
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
          )}
        >
          {skill.name}
        </span>
      </Link>
      <DropdownMenu modal={false}>
        <DropdownMenuTrigger
          aria-label={t(($) => $['agentDetail.configure.skills.moreActions'], {
            name: displayName,
          })}
          className="absolute top-1/2 right-1 z-10 flex size-6 -translate-y-1/2 items-center justify-center rounded-md text-text-tertiary hover:bg-state-base-hover hover:text-text-secondary focus-visible:ring-2 focus-visible:ring-state-accent-solid focus-visible:outline-hidden data-popup-open:bg-state-base-hover data-popup-open:text-text-secondary"
          onClick={(event) => event.stopPropagation()}
        >
          <span aria-hidden className="i-ri-more-fill size-4" />
        </DropdownMenuTrigger>
        <DropdownMenuContent placement="bottom-end" sideOffset={4} popupClassName="w-48">
          <DropdownMenuItem className="gap-2" onClick={handleOpenInLibrary}>
            <span aria-hidden className="i-ri-arrow-right-up-line size-4 shrink-0" />
            <span>{t(($) => $['agentDetail.configure.skills.openInLibrary'])}</span>
          </DropdownMenuItem>
          <DropdownMenuItem
            variant="destructive"
            className="gap-2"
            onClick={() => onRemove(skill.id)}
          >
            <span aria-hidden className="i-ri-delete-bin-line size-4 shrink-0" />
            <span>{t(($) => $['agentDetail.configure.skills.removeAction'])}</span>
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  )
}

export function AgentSkills() {
  const { t } = useTranslation('agentV2')
  const { t: tCommon } = useTranslation('common')
  const skillsTip = t(($) => $['agentDetail.configure.skills.tip'])
  const skillsListId = 'agent-configure-skills-list'
  const queryClient = useQueryClient()
  const isViewingVersion = useAgentOrchestrateViewingVersion()
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
          onError: () => {
            toast.error(t(($) => $['agentDetail.configure.skills.workspaceSelector.saveFailed']))
          },
          onSuccess: () => {
            invalidateAgentSkillBindings()
            onSuccess?.()
          },
        },
      )
    },
    [apiContext.agentId, invalidateAgentSkillBindings, replaceAgentSkillBindings, t],
  )

  const handleOpenUpload = useCallback((options?: AgentOrchestrateAddActionOptions) => {
    promptAddCallbackRef.current = options?.onAdded
    setIsUploadOpen(true)
  }, [])
  useRegisterAgentOrchestrateAddAction('skills', handleOpenUpload)

  const handleAddMenuOpenChange = useCallback((open: boolean) => {
    setAddMenuOpen(open)
    if (!open) setAddMenuView('menu')
  }, [])

  const handleOpenWorkspaceSelector = useCallback(() => {
    setAddMenuView('workspace-selector')
  }, [])

  const handleOpenUploadFromMenu = useCallback(() => {
    setAddMenuOpen(false)
    handleOpenUpload()
  }, [handleOpenUpload])

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
      if (!skill.latest_published_version_id || boundSkillIds.includes(skill.id)) return

      replaceWorkspaceSkillBindings([...boundSkillIds, skill.id], () => {
        toast.success(t(($) => $['agentDetail.configure.skills.workspaceSelector.addSuccess']))
        setAddMenuOpen(false)
        setAddMenuView('menu')
      })
    },
    [boundSkillIds, replaceWorkspaceSkillBindings, t],
  )

  const handleUploadOpenChange = useCallback((open: boolean) => {
    if (!open) promptAddCallbackRef.current = undefined
    setIsUploadOpen(open)
  }, [])

  const handleRemoveWorkspaceSkill = useCallback(
    (skillId: string) => {
      replaceWorkspaceSkillBindings(
        boundSkillIds.filter((item) => item !== skillId),
        () => {
          toast.success(t(($) => $['agentDetail.configure.skills.workspaceSelector.removeSuccess']))
        },
      )
    },
    [boundSkillIds, replaceWorkspaceSkillBindings, t],
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
          !isViewingVersion && (
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
                popupClassName={
                  addMenuView === 'menu'
                    ? 'w-[320px] bg-components-panel-bg-blur p-1 shadow-lg backdrop-blur-[5px]'
                    : 'w-[560px] overflow-hidden border-none bg-transparent p-0 shadow-none'
                }
              >
                {addMenuView === 'menu' ? (
                  <>
                    <AgentSkillAddMenuItem
                      iconClassName="i-custom-public-agent-building-blocks"
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
                    isBindingPending={isReplacingAgentSkillBindings}
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
            {workspaceSkills.length > 0 && (
              <div className="px-1 pt-1 pb-0.5 system-xs-medium-uppercase text-text-tertiary">
                {t(($) => $['agentDetail.configure.skills.fromSkillLibrary'])}
              </div>
            )}
            {workspaceSkills.map((skill) => (
              <WorkspaceAgentSkillItem
                key={skill.id}
                skill={skill}
                onRemove={handleRemoveWorkspaceSkill}
              />
            ))}
            {skills.map((skill) => (
              <AgentSkillItem
                key={skill.id}
                apiContext={apiContext}
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
