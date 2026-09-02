import type { ChecklistItem } from '../../hooks/use-checklist'
import type { CommonEdgeType } from '../../types'
import type { ChecklistErrorPayload } from '@/app/components/dify-builder/types'
import { cn } from '@langgenius/dify-ui/cn'
import {
  Popover,
  PopoverClose,
  PopoverContent,
  PopoverDescription,
  PopoverTitle,
  PopoverTrigger,
} from '@langgenius/dify-ui/popover'
import { useAtomValue, useSetAtom } from 'jotai'
import { memo, useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useEdges } from 'reactflow'
import {
  difyBuilderAvailableAtom,
  difyBuilderCanStartFixAtom,
  difyBuilderCanvasRefreshGenerationAtom,
  difyBuilderRegisterChecklistErrorsAtom,
  difyBuilderStartChecklistFixAtom,
} from '@/app/components/workflow-app/components/dify-builder/store'
import useNodes from '@/app/components/workflow/store/workflow/use-nodes'
import DifyBuilderEntry from '../../dify-builder-entry'
import { useHooksStore } from '../../hooks-store/store'
import { useChecklist } from '../../hooks/use-checklist'
import { useNodesInteractions } from '../../hooks/use-nodes-interactions'
import { useStore } from '../../store'
import { ChecklistNodeGroup } from './node-group'
import { ChecklistPluginGroup } from './plugin-group'

type WorkflowChecklistProps = {
  disabled: boolean
  showGoTo?: boolean
  onItemClick?: (item: ChecklistItem) => void
}

const toChecklistErrorPayload = (item: ChecklistItem): ChecklistErrorPayload => ({
  node_id: item.id,
  node_type: String(item.type),
  title: item.title,
  messages: item.errorMessages,
  unconnected: !!item.unConnected,
  plugin_missing: !!item.isPluginMissing,
})

const WorkflowChecklist = ({ disabled, showGoTo = true, onItemClick }: WorkflowChecklistProps) => {
  const { t } = useTranslation()
  const [open, setOpen] = useState(false)
  const edges = useEdges<CommonEdgeType>()
  const nodes = useNodes()
  const flowType = useHooksStore((s) => s.configsMap?.flowType)
  const needWarningNodes = useChecklist(nodes, edges, { flowType })
  const { handleNodeSelect } = useNodesInteractions()
  const setOpenInlineAgentPanelNodeId = useStore((state) => state.setOpenInlineAgentPanelNodeId)
  const checklistLabel = t(($) => $['panel.checklist'], { ns: 'workflow' })
  const difyBuilderAvailable = useAtomValue(difyBuilderAvailableAtom)
  const canvasRefreshGeneration = useAtomValue(difyBuilderCanvasRefreshGenerationAtom)
  const canStartFix = useAtomValue(difyBuilderCanStartFixAtom)
  const registerChecklistErrors = useSetAtom(difyBuilderRegisterChecklistErrorsAtom)
  const startChecklistFix = useSetAtom(difyBuilderStartChecklistFixAtom)

  const { pluginItems, nodeItems } = useMemo(() => {
    const plugins: ChecklistItem[] = []
    const regular: ChecklistItem[] = []
    for (const item of needWarningNodes) {
      if (item.isPluginMissing) plugins.push(item)
      else regular.push(item)
    }
    return { pluginItems: plugins, nodeItems: regular }
  }, [needWarningNodes])
  const fixableChecklistErrors = useMemo(
    () =>
      needWarningNodes
        .filter(
          (item) => !item.unConnected && !item.isPluginMissing && item.errorMessages.length > 0,
        )
        .map(toChecklistErrorPayload),
    [needWarningNodes],
  )

  useEffect(() => {
    registerChecklistErrors({
      errors: fixableChecklistErrors,
      generation: canvasRefreshGeneration,
    })
  }, [canvasRefreshGeneration, fixableChecklistErrors, registerChecklistErrors])

  const handleItemClick = (item: ChecklistItem) => {
    if (onItemClick) onItemClick(item)
    else {
      handleNodeSelect(item.id)
      if (item.openInlineAgentPanel) setOpenInlineAgentPanelNodeId(item.id)
    }
    setOpen(false)
  }

  return (
    <Popover open={open} onOpenChange={(newOpen) => !disabled && setOpen(newOpen)}>
      <PopoverTrigger
        disabled={disabled}
        render={
          <button
            type="button"
            className={cn(
              'group relative ml-0.5 flex size-7 items-center justify-center rounded-md border-none bg-transparent p-0',
              'data-disabled:cursor-not-allowed data-disabled:opacity-50',
            )}
            disabled={disabled || undefined}
            aria-label={checklistLabel}
          >
            <span className="flex size-full items-center justify-center rounded-md group-data-popup-open:bg-state-accent-hover hover:bg-state-accent-hover">
              <span
                className="i-ri-list-check-3 size-4 text-components-button-ghost-text group-hover:text-components-button-secondary-accent-text group-data-popup-open:text-components-button-secondary-accent-text"
                aria-hidden="true"
              />
            </span>
            {!!needWarningNodes.length && (
              <span className="absolute -top-1.5 -right-1.5 flex h-4.5 min-w-4.5 items-center justify-center rounded-full border border-gray-100 bg-text-warning-secondary text-[11px] font-semibold text-white">
                {needWarningNodes.length}
              </span>
            )}
          </button>
        }
      />
      <PopoverContent
        placement="bottom-start"
        sideOffset={12}
        alignOffset={-30}
        className="w-[420px] rounded-2xl bg-background-default-subtle"
      >
        <div className="overflow-y-auto" style={{ maxHeight: 'calc(2 / 3 * 100vh)' }}>
          <div className="flex flex-col gap-0.5 px-3 pt-3.5 pb-1">
            <div className="flex items-start px-1">
              <div className="min-w-0 grow pr-8">
                <PopoverTitle className="text-base/6 font-semibold text-text-primary">
                  {checklistLabel}
                  {needWarningNodes.length > 0 && `(${needWarningNodes.length})`}
                </PopoverTitle>
              </div>
              <PopoverClose
                className="-mt-0.5 -mr-0.5 flex size-7 shrink-0 items-center justify-center rounded-lg"
                aria-label={t(($) => $['operation.close'], { ns: 'common' })}
              >
                <span className="i-ri-close-line size-4 text-text-tertiary" aria-hidden="true" />
              </PopoverClose>
            </div>
            {needWarningNodes.length > 0 && (
              <PopoverDescription className="px-1 text-xs/4 text-text-tertiary">
                {t(($) => $['panel.checklistDescription'], { ns: 'workflow' })}
              </PopoverDescription>
            )}
          </div>

          {needWarningNodes.length > 0 ? (
            <div className="flex flex-col gap-1 px-4 pt-1 pb-4">
              {pluginItems.length > 0 && <ChecklistPluginGroup items={pluginItems} />}
              {nodeItems.map((item) => (
                <ChecklistNodeGroup
                  key={item.id}
                  item={item}
                  showGoTo={showGoTo}
                  onItemClick={handleItemClick}
                />
              ))}
              {difyBuilderAvailable && fixableChecklistErrors.length > 0 && (
                <div className="mt-2 border-t border-divider-subtle pt-3">
                  <DifyBuilderEntry
                    label={t(($) => $['difyBuilder.fixWithAppBuilder'], { ns: 'workflow' })}
                    description={t(($) => $['difyBuilder.checklistFixScopeDescription'], {
                      ns: 'workflow',
                    })}
                    disabled={disabled || !canStartFix}
                    onClick={() => {
                      setOpen(false)
                      void startChecklistFix(fixableChecklistErrors)
                    }}
                  />
                </div>
              )}
            </div>
          ) : (
            <div className="mx-4 mb-3 rounded-lg py-4 text-center text-xs text-text-tertiary">
              <span className="mx-auto mb-1.25 i-custom-vender-line-general-checklist-square block h-8 w-8 text-text-quaternary" />
              {t(($) => $['panel.checklistResolved'], { ns: 'workflow' })}
            </div>
          )}
        </div>
      </PopoverContent>
    </Popover>
  )
}

export default memo(WorkflowChecklist)
