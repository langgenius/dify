'use client'

import type { NodeInfo } from '@dify/contracts/api/console/evaluate-target-type/types.gen'
import type { EvaluationMetric, MetricOption } from '../../types'
import type { MetricSelectorProps, MetricSelectorSection } from './types'
import { Button } from '@langgenius/dify-ui/button'
import { cn } from '@langgenius/dify-ui/cn'
import { Infotip, InfotipContent, InfotipTrigger } from '@langgenius/dify-ui/infotip'
import {
  Menu,
  MenuCheckboxItem,
  MenuCheckboxItemIndicator,
  MenuEmpty,
  MenuFilterProvider,
  MenuGroup,
  MenuInput,
  MenuInputGroup,
  MenuItem,
  MenuList,
  MenuPopup,
  MenuPortal,
  MenuPositioner,
  MenuSubmenu,
  MenuSubmenuTrigger,
  MenuTrigger,
} from '@langgenius/dify-ui/menu'
import { useAtomValue } from 'jotai'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { createWorkflowAppHref } from '@/app/components/apps/query-params'
import { LoadingPlaceholder } from '@/app/components/base/loading-placeholder'
import BlockIcon from '@/app/components/workflow/block-icon'
import { workspacePermissionKeysAtom } from '@/context/permission-state'
import { hasPermission } from '@/utils/permission'
import { useEvaluationResource, useEvaluationStore } from '../../store'
import SelectorFooter from './selector-footer'
import { useMetricSelectorData } from './use-metric-selector-data'
import { getEvaluationNodeBlockType, getMetricVisual, getToneClasses } from './utils'

// Never fall back to a side placement: adding a metric moves the trigger, and a side flip makes
// the popup jump across the page.
const METRIC_SELECTOR_COLLISION_AVOIDANCE = { fallbackAxisSide: 'none' } as const

const isNodeAdded = (addedMetric: EvaluationMetric | undefined, nodeId: string) => {
  if (!addedMetric) return false
  // A metric saved without a node list applies to every node.
  if (!addedMetric.nodeInfoList?.length) return true
  return addedMetric.nodeInfoList.some((nodeInfo) => nodeInfo.node_id === nodeId)
}

type MetricLabelProps = {
  metric: MetricOption
}

const MetricLabel = ({ metric }: MetricLabelProps) => {
  const metricVisual = getMetricVisual(metric.id)
  const toneClasses = getToneClasses(metricVisual.tone)

  return (
    <>
      <span
        aria-hidden="true"
        className={cn(
          'flex h-[18px] w-[18px] shrink-0 items-center justify-center rounded-md',
          toneClasses.soft,
        )}
      >
        <span className={cn(metricVisual.icon, 'h-3.5 w-3.5')} />
      </span>
      <span className="min-w-0 flex-1 truncate">{metric.label}</span>
    </>
  )
}

type NodeLabelProps = {
  nodeInfo: NodeInfo
}

const NodeLabel = ({ nodeInfo }: NodeLabelProps) => (
  <>
    <BlockIcon
      type={getEvaluationNodeBlockType(nodeInfo)}
      size="xs"
      className="h-[18px] w-[18px] shrink-0"
    />
    <span className="min-w-0 flex-1 truncate">{nodeInfo.title}</span>
  </>
)

type MetricRowProps = {
  section: MetricSelectorSection
  addedMetric?: EvaluationMetric
  onToggleNode: (metric: MetricOption, nodeInfo: NodeInfo) => void
}

const MetricRow = ({ section, addedMetric, onToggleNode }: MetricRowProps) => {
  const { t } = useTranslation(['evaluation'])
  const { metric, nodes } = section

  if (nodes.length === 0) {
    return (
      <MenuItem label={metric.label} disabled className="gap-2">
        <MetricLabel metric={metric} />
        <span className="shrink-0 system-xs-regular text-text-quaternary">
          {t(($) => $['metrics.noNodesInWorkflow'])}
        </span>
      </MenuItem>
    )
  }

  // With a single evaluable node there is nothing to choose, so the metric toggles directly.
  if (nodes.length === 1) {
    const nodeInfo = nodes[0]!

    return (
      <MenuCheckboxItem
        label={metric.label}
        checked={isNodeAdded(addedMetric, nodeInfo.node_id)}
        closeOnClick={false}
        className="gap-2"
        onCheckedChange={() => onToggleNode(metric, nodeInfo)}
      >
        <MetricLabel metric={metric} />
        <MenuCheckboxItemIndicator />
      </MenuCheckboxItem>
    )
  }

  const addedNodeCount = nodes.filter((nodeInfo) =>
    isNodeAdded(addedMetric, nodeInfo.node_id),
  ).length

  return (
    <MenuSubmenu>
      <MenuSubmenuTrigger label={metric.label} openOnHover delay={0} className="gap-2">
        <MetricLabel metric={metric} />
        {addedNodeCount > 0 && (
          <span className="shrink-0 system-xs-regular text-text-accent">
            {t(($) => $['metrics.nodesSelectedCount'], {
              selected: addedNodeCount,
              total: nodes.length,
            })}
          </span>
        )}
      </MenuSubmenuTrigger>
      <MenuPortal>
        <MenuPositioner sideOffset={4}>
          <MenuPopup className="w-60 rounded-xl border-[0.5px] border-components-panel-border bg-components-panel-bg-blur py-1 shadow-lg backdrop-blur-[5px]">
            <div className="flex items-center gap-1 px-3 pt-1.5 pb-1">
              <span className="min-w-0 flex-1 truncate system-xs-medium text-text-tertiary">
                {t(($) => $['metrics.nodesLabel'])}
              </span>
              {metric.description && (
                <Infotip>
                  <InfotipTrigger aria-label={metric.label} />
                  <InfotipContent className="max-w-[260px]">{metric.description}</InfotipContent>
                </Infotip>
              )}
            </div>
            {nodes.map((nodeInfo) => (
              <MenuCheckboxItem
                key={nodeInfo.node_id}
                data-testid={`evaluation-metric-node-${metric.id}-${nodeInfo.node_id}`}
                checked={isNodeAdded(addedMetric, nodeInfo.node_id)}
                closeOnClick={false}
                className="gap-2"
                onCheckedChange={() => onToggleNode(metric, nodeInfo)}
              >
                <NodeLabel nodeInfo={nodeInfo} />
                <MenuCheckboxItemIndicator />
              </MenuCheckboxItem>
            ))}
          </MenuPopup>
        </MenuPositioner>
      </MenuPortal>
    </MenuSubmenu>
  )
}

const MetricSelector = ({ resourceType, resourceId, triggerClassName }: MetricSelectorProps) => {
  const { t } = useTranslation(['evaluation'])
  const resource = useEvaluationResource(resourceType, resourceId)
  const workspacePermissionKeys = useAtomValue(workspacePermissionKeysAtom)
  const canCreateWorkflowApp = hasPermission(workspacePermissionKeys, 'app.create_and_management')
  const addCustomMetric = useEvaluationStore((state) => state.addCustomMetric)
  const [open, setOpen] = useState(false)
  const hasCustomMetric = resource.metrics.some((metric) => metric.kind === 'custom-workflow')

  const { builtinMetricMap, sections, isRemoteLoading, toggleNodeSelection } =
    useMetricSelectorData({
      open,
      resourceType,
      resourceId,
    })

  return (
    <MenuFilterProvider>
      <Menu open={open} onOpenChange={setOpen}>
        <MenuTrigger
          render={
            <Button
              variant="ghost-accent"
              className={cn('data-popup-open:bg-state-accent-hover', triggerClassName)}
            />
          }
        >
          <span aria-hidden="true" className="me-1 i-ri-add-line h-4 w-4" />
          {t(($) => $['metrics.add'])}
        </MenuTrigger>
        <MenuPortal>
          <MenuPositioner
            side="bottom"
            align="start"
            sideOffset={4}
            collisionAvoidance={METRIC_SELECTOR_COLLISION_AVOIDANCE}
          >
            <MenuPopup className="w-90 max-w-(--available-width) overflow-hidden rounded-xl border-[0.5px] border-components-panel-border bg-components-panel-bg pt-1 shadow-lg">
              <MenuInputGroup>
                <span
                  aria-hidden="true"
                  className="i-ri-search-line size-4 shrink-0 text-components-input-text-placeholder"
                />
                <MenuInput
                  aria-label={t(($) => $['metrics.searchPlaceholder'])}
                  placeholder={t(($) => $['metrics.searchPlaceholder'])}
                />
              </MenuInputGroup>
              {isRemoteLoading ? (
                <LoadingPlaceholder className="h-20 p-1" />
              ) : (
                <MenuEmpty>{t(($) => $['metrics.noResults'])}</MenuEmpty>
              )}
              <MenuList aria-busy={isRemoteLoading || undefined}>
                <MenuGroup>
                  {!isRemoteLoading &&
                    sections.map((section) => (
                      <MetricRow
                        key={section.metric.id}
                        section={section}
                        addedMetric={builtinMetricMap.get(section.metric.id)}
                        onToggleNode={toggleNodeSelection}
                      />
                    ))}
                </MenuGroup>
              </MenuList>
              <div className="mt-1">
                <SelectorFooter
                  title={t(($) => $['metrics.custom.footerTitle'])}
                  infoLabel={t(($) => $['metrics.custom.title'])}
                  infoDescription={t(($) => $['metrics.custom.info'])}
                  createLabel={t(($) => $['metrics.custom.createWorkflow'])}
                  createHref={canCreateWorkflowApp ? createWorkflowAppHref : undefined}
                  description={
                    hasCustomMetric
                      ? t(($) => $['metrics.custom.limitDescription'])
                      : t(($) => $['metrics.custom.footerDescription'])
                  }
                  disabled={hasCustomMetric}
                  onClick={() => {
                    addCustomMetric(resourceType, resourceId)
                    setOpen(false)
                  }}
                />
              </div>
            </MenuPopup>
          </MenuPositioner>
        </MenuPortal>
      </Menu>
    </MenuFilterProvider>
  )
}

export default MetricSelector
