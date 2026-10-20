'use client'
import type { PopoverContentProps } from '@langgenius/dify-ui/popover'
import type { ReactElement } from 'react'
import type { ToolDefaultValue, ToolValue } from './types'
import type { CustomCollectionBackend } from '@/app/components/tools/types'
import type { BlockEnum, OnSelectBlock } from '@/app/components/workflow/types'
import { cn } from '@langgenius/dify-ui/cn'
import { IconButton } from '@langgenius/dify-ui/icon-button'
import { Popover, PopoverContent, PopoverTitle, PopoverTrigger } from '@langgenius/dify-ui/popover'
import { useQuery, useQueryClient, useSuspenseQuery } from '@tanstack/react-query'
import { useBoolean } from 'ahooks'
import dynamic from 'next/dynamic'
import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { PluginSearchInput } from '@/app/components/plugins/plugin-search-input'
import EditCustomToolModal from '@/app/components/tools/edit-custom-collection-modal'
import { useCanManageTools } from '@/app/components/tools/hooks/use-tool-permissions'
import { selectToolsWithProvider } from '@/app/components/tools/utils/query-select'
import { systemFeaturesQueryOptions } from '@/features/system-features/client'
import { consoleQuery } from '@/service/console'
import { createCustomCollection } from '@/service/tools'
import { useFeaturedToolsRecommendations } from '@/service/use-plugins'

const ToolBrowser = dynamic(() => import('./tool-browser'), {
  loading: () => <div className="h-24 animate-pulse rounded-lg bg-background-section" />,
})

type Props = Readonly<
  Pick<PopoverContentProps, 'placement' | 'sideOffset'> & {
    disabled: boolean
    trigger: ReactElement
    isShow: boolean
    onShowChange: (isShow: boolean) => void
  }
> &
  ToolPickerContentProps

export type ToolPickerContentProps = Readonly<{
  focusSearchOnMount?: boolean
  panelClassName?: string
  onSelect: (tool: ToolDefaultValue) => void
  onSelectMultiple: (tools: ToolDefaultValue[]) => void
  supportAddCustomTool?: boolean
  scope?: ToolPickerScope
  selectedTools?: ToolValue[]
}>

export type ToolPickerScope = 'all' | 'plugins' | 'custom' | 'workflow'

export function ToolPickerContent({
  focusSearchOnMount = false,
  onSelect,
  onSelectMultiple,
  supportAddCustomTool,
  scope = 'all',
  selectedTools,
  panelClassName,
}: ToolPickerContentProps) {
  const { t } = useTranslation(['common', 'plugin', 'tools'])
  const [searchText, setSearchText] = useState('')
  const [tags, setTags] = useState<string[]>([])
  const canManageTools = useCanManageTools()

  const { data: enable_marketplace } = useSuspenseQuery({
    ...systemFeaturesQueryOptions(),
    select: (s) => s.enable_marketplace,
  })
  const { data: buildInTools } = useQuery(
    consoleQuery.workspaces.current.tools.builtin.get.queryOptions({
      select: selectToolsWithProvider,
    }),
  )
  const installedPluginIds = useMemo(
    () => new Set(buildInTools?.map((provider) => provider.plugin_id || provider.id)),
    [buildInTools],
  )
  const shouldFetchCustomTools = scope !== 'plugins' && scope !== 'workflow'
  const { data: customTools } = useQuery(
    consoleQuery.workspaces.current.tools.api.get.queryOptions({
      enabled: shouldFetchCustomTools,
      select: selectToolsWithProvider,
    }),
  )
  const queryClient = useQueryClient()
  const shouldFetchWorkflowTools = scope !== 'plugins' && scope !== 'custom'
  const { data: workflowTools } = useQuery(
    consoleQuery.workspaces.current.tools.workflow.get.queryOptions({
      enabled: shouldFetchWorkflowTools,
      select: selectToolsWithProvider,
    }),
  )
  const { data: mcpTools } = useQuery(
    consoleQuery.workspaces.current.tools.mcp.get.queryOptions({ select: selectToolsWithProvider }),
  )

  const { plugins: featuredPlugins = [], isLoading: isFeaturedLoading } =
    useFeaturedToolsRecommendations(enable_marketplace)

  const { builtinToolList, customToolList, workflowToolList } = useMemo(() => {
    if (scope === 'plugins') {
      return {
        builtinToolList: buildInTools,
        customToolList: [],
        workflowToolList: [],
      }
    }
    if (scope === 'custom') {
      return {
        builtinToolList: [],
        customToolList: customTools,
        workflowToolList: [],
      }
    }
    if (scope === 'workflow') {
      return {
        builtinToolList: [],
        customToolList: [],
        workflowToolList: workflowTools,
      }
    }
    return {
      builtinToolList: buildInTools,
      customToolList: customTools,
      workflowToolList: workflowTools,
    }
  }, [scope, buildInTools, customTools, workflowTools])

  const handleSelect = (_type: BlockEnum, tool?: ToolDefaultValue) => {
    onSelect(tool!)
  }

  const handleSelectMultiple = (_type: BlockEnum, tools: ToolDefaultValue[]) => {
    onSelectMultiple(tools)
  }

  const [
    isShowEditCollectionToolModal,
    { setFalse: hideEditCustomCollectionModal, setTrue: showEditCustomCollectionModal },
  ] = useBoolean(false)

  const doCreateCustomToolCollection = async (data: CustomCollectionBackend) => {
    if (!canManageTools) return

    await createCustomCollection(data)
    hideEditCustomCollectionModal()
    queryClient.invalidateQueries({
      queryKey: consoleQuery.workspaces.current.tools.api.get.queryKey(),
    })
  }

  if (isShowEditCollectionToolModal && canManageTools) {
    return (
      <EditCustomToolModal
        dialogClassName="bg-background-overlay"
        payload={null}
        onHide={hideEditCustomCollectionModal}
        onAdd={doCreateCustomToolCollection}
      />
    )
  }

  return (
    <div
      className={cn(
        'relative min-h-20 rounded-xl border-[0.5px] border-components-panel-border bg-components-panel-bg-blur shadow-lg backdrop-blur-xs',
        panelClassName,
      )}
    >
      <div className="flex items-center gap-2 p-2 pb-1">
        <PluginSearchInput
          value={searchText}
          onValueChange={setSearchText}
          tags={tags}
          onTagsChange={setTags}
          placeholder={t(($) => $.searchTools, { ns: 'plugin' })!}
          // The picker replaces the focused menu item inside an already-open popover.
          // Focusing search keeps keyboard users in the same add-tool workflow.
          /* oxlint-disable-next-line jsx-a11y/no-autofocus -- The picker replaces the focused menu item in an open popover. */
          autoFocus={focusSearchOnMount}
          className="flex-1"
        />
        {supportAddCustomTool && canManageTools && (
          <IconButton
            variant="primary"
            size="md"
            aria-label={t(($) => $['addToolModal.custom.tip'], { ns: 'tools' })}
            className="shrink-0 rounded-full"
            onClick={showEditCustomCollectionModal}
          >
            <span className="i-ri-add-line size-4" aria-hidden />
          </IconButton>
        )}
      </div>
      <ToolBrowser
        className="mt-1"
        toolContentClassName="max-w-full"
        tags={tags}
        searchText={searchText}
        onSelect={handleSelect as OnSelectBlock}
        onSelectMultiple={handleSelectMultiple}
        buildInTools={builtinToolList || []}
        installedPluginIds={installedPluginIds}
        customTools={customToolList || []}
        workflowTools={workflowToolList || []}
        mcpTools={mcpTools || []}
        selectedTools={selectedTools}
        onTagsChange={setTags}
        featuredPlugins={featuredPlugins}
        featuredLoading={isFeaturedLoading}
        showFeatured={scope === 'all' && enable_marketplace}
        onFeaturedInstallSuccess={async () => {
          const tools = consoleQuery.workspaces.current.tools
          queryClient.invalidateQueries({ queryKey: tools.builtin.get.queryKey() })
          queryClient.invalidateQueries({ queryKey: tools.api.get.queryKey() })
          queryClient.invalidateQueries({ queryKey: tools.workflow.get.queryKey() })
          queryClient.invalidateQueries({ queryKey: tools.mcp.get.queryKey() })
        }}
      />
    </div>
  )
}

function ToolPicker({
  disabled,
  trigger,
  placement = 'right-start',
  sideOffset = 0,
  isShow,
  onShowChange,
  ...contentProps
}: Props) {
  const { t } = useTranslation(['plugin'])
  const handleOpenChange = (nextOpen: boolean) => {
    if (nextOpen && disabled) return
    onShowChange(nextOpen)
  }
  return (
    <Popover open={isShow} onOpenChange={handleOpenChange}>
      <PopoverTrigger disabled={disabled} render={trigger} />

      <PopoverContent
        placement={placement}
        sideOffset={sideOffset}
        className="border-none bg-transparent shadow-none"
      >
        <PopoverTitle className="sr-only">
          {t(($) => $['detailPanel.toolSelector.title'], { ns: 'plugin' })}
        </PopoverTitle>
        <ToolPickerContent {...contentProps} />
      </PopoverContent>
    </Popover>
  )
}

export default ToolPicker
