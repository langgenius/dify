import type { Node } from 'reactflow'
import type { ToolValue } from '@/app/components/workflow/block-selector/types'
import type { NodeOutPutVar } from '@/app/components/workflow/types'
import { Button } from '@langgenius/dify-ui/button'
import { cn } from '@langgenius/dify-ui/cn'
import { Collapsible, CollapsiblePanel, CollapsibleTrigger } from '@langgenius/dify-ui/collapsible'
import * as React from 'react'
import { useTranslation } from 'react-i18next'
import Divider from '@/app/components/base/divider'
import { Infotip } from '@/app/components/base/infotip'
import ToolSelector from '@/app/components/plugins/plugin-detail-panel/tool-selector'
import { useMCPToolAvailability } from '@/app/components/workflow/nodes/_base/components/mcp-tool-availability'
import { useAllMCPTools } from '@/service/use-tools'

type Props = Readonly<{
  disabled?: boolean
  value: ToolValue[]
  label: string
  required?: boolean
  tooltip?: React.ReactNode
  supportCollapse?: boolean
  scope?: string
  onChange: (value: ToolValue[]) => void
  nodeOutputVars: NodeOutPutVar[]
  availableNodes: Node[]
  nodeId?: string
}>

const getToolKey = (tool: ToolValue) => `${tool.provider_name}:${tool.tool_name}`

const MultipleToolSelector = ({
  disabled,
  value = [],
  label,
  required,
  tooltip,
  supportCollapse,
  scope,
  onChange,
  nodeOutputVars,
  availableNodes,
  nodeId,
}: Props) => {
  const { t } = useTranslation()
  const { allowed: isMCPToolAllowed } = useMCPToolAvailability()
  const { data: mcpTools } = useAllMCPTools()
  const addToolButtonRef = React.useRef<HTMLButtonElement>(null)
  const toolItemTriggerByKeyRef = React.useRef(new Map<string, HTMLButtonElement>())
  const pendingFocusTargetRef = React.useRef<{ toolKey?: string } | null>(null)
  const enabledCount = value.filter((item) => {
    const isMCPTool = mcpTools?.find((tool) => tool.id === item.provider_name)
    if (isMCPTool) return item.enabled && isMCPToolAllowed
    return item.enabled
  }).length
  const [toolsOpen, setToolsOpen] = React.useState(true)

  React.useLayoutEffect(() => {
    const pendingFocusTarget = pendingFocusTargetRef.current
    if (!pendingFocusTarget) return

    const focusTarget = pendingFocusTarget.toolKey
      ? toolItemTriggerByKeyRef.current.get(pendingFocusTarget.toolKey)
      : addToolButtonRef.current
    const resolvedFocusTarget = focusTarget ?? addToolButtonRef.current

    resolvedFocusTarget?.focus()
    pendingFocusTargetRef.current = null
  }, [value])

  // add tool
  const [selectorOpen, setSelectorOpen] = React.useState(false)
  const [panelShowState, setPanelShowState] = React.useState(true)
  const handleAdd = (val: ToolValue) => {
    const newValue = [...value, val]
    // deduplication
    const deduplication = newValue.reduce((acc, cur) => {
      if (
        !acc.find(
          (item) => item.provider_name === cur.provider_name && item.tool_name === cur.tool_name,
        )
      )
        acc.push(cur)
      return acc
    }, [] as ToolValue[])
    // update value
    onChange(deduplication)
    setSelectorOpen(false)
  }

  const handleAddMultiple = (val: ToolValue[]) => {
    const newValue = [...value, ...val]
    // deduplication
    const deduplication = newValue.reduce((acc, cur) => {
      if (
        !acc.find(
          (item) => item.provider_name === cur.provider_name && item.tool_name === cur.tool_name,
        )
      )
        acc.push(cur)
      return acc
    }, [] as ToolValue[])
    // update value
    onChange(deduplication)
    setSelectorOpen(false)
  }

  // delete tool
  const handleDelete = (index: number) => {
    const newValue = [...value]
    newValue.splice(index, 1)
    const nextFocusTool = value[index + 1] ?? value[index - 1]
    pendingFocusTargetRef.current = {
      toolKey: nextFocusTool ? getToolKey(nextFocusTool) : undefined,
    }
    onChange(newValue)
  }

  // configure tool
  const handleConfigure = (val: ToolValue, index: number) => {
    const newValue = [...value]
    newValue[index] = val
    onChange(newValue)
  }

  return (
    <Collapsible open={supportCollapse ? toolsOpen : true} onOpenChange={setToolsOpen}>
      <div className="mb-1 flex items-center">
        <div className="flex grow items-center gap-0.5">
          {supportCollapse ? (
            <CollapsibleTrigger
              aria-label={label}
              className="group/collapse h-6 min-h-0 w-auto min-w-0 justify-start gap-0.5 bg-transparent p-0 hover:not-data-disabled:bg-transparent"
            >
              <span className="truncate system-sm-semibold-uppercase text-text-secondary">
                {label}
              </span>
              {required && <span className="text-red-500">*</span>}
              <span
                aria-hidden
                className={cn(
                  'i-custom-vender-solid-general-arrow-down-round-fill size-4 shrink-0 text-text-quaternary group-hover/collapse:text-text-secondary',
                  !toolsOpen && 'rotate-270',
                )}
              />
            </CollapsibleTrigger>
          ) : (
            <>
              <div className="flex h-6 min-w-0 items-center truncate system-sm-semibold-uppercase text-text-secondary">
                {label}
              </div>
              {required && <div className="text-red-500">*</div>}
            </>
          )}
          {tooltip ? (
            <Infotip
              aria-label={typeof tooltip === 'string' ? tooltip : label}
              className="size-3.5"
            >
              {tooltip}
            </Infotip>
          ) : null}
        </div>
        {value.length > 0 && (
          <>
            <div className="flex items-center gap-1 system-xs-medium text-text-tertiary">
              <span>{`${enabledCount}/${value.length}`}</span>
              <span>{t(($) => $['agent.tools.enabled'], { ns: 'appDebug' })}</span>
            </div>
            <Divider type="vertical" className="mr-1 ml-3 h-3" />
          </>
        )}
        {!disabled && (
          <ToolSelector
            nodeId={nodeId}
            nodeOutputVars={nodeOutputVars}
            availableNodes={availableNodes}
            scope={scope}
            value={undefined}
            selectedTools={value}
            onSelect={handleAdd}
            controlledState={selectorOpen}
            onControlledStateChange={setSelectorOpen}
            trigger={
              <Button
                ref={addToolButtonRef}
                variant="ghost"
                size="small"
                aria-label={t(($) => $['detailPanel.toolSelector.title'], { ns: 'plugin' })}
                className="mx-1 size-6 min-h-0 p-0"
                onClick={() => {
                  setToolsOpen(true)
                  setPanelShowState(true)
                }}
              >
                <span className="i-ri-add-line size-4" aria-hidden />
              </Button>
            }
            panelShowState={panelShowState}
            onPanelShowStateChange={setPanelShowState}
            isEdit={false}
            onSelectMultiple={handleAddMultiple}
          />
        )}
      </div>
      <CollapsiblePanel>
        {value.length === 0 && (
          <div className="flex justify-center rounded-[10px] bg-background-section p-3 system-xs-regular text-text-tertiary">
            {t(($) => $['detailPanel.toolSelector.empty'], { ns: 'plugin' })}
          </div>
        )}
        {value.length > 0 &&
          value.map((item, index) => {
            const toolKey = getToolKey(item)

            return (
              <div className="mb-1" key={toolKey}>
                <ToolSelector
                  nodeId={nodeId}
                  nodeOutputVars={nodeOutputVars}
                  availableNodes={availableNodes}
                  scope={scope}
                  value={item}
                  selectedTools={value}
                  onSelect={(item) => handleConfigure(item, index)}
                  onSelectMultiple={handleAddMultiple}
                  onDelete={() => handleDelete(index)}
                  triggerRef={(element) => {
                    if (element) toolItemTriggerByKeyRef.current.set(toolKey, element)
                    else toolItemTriggerByKeyRef.current.delete(toolKey)
                  }}
                  supportEnableSwitch
                  isEdit
                />
              </div>
            )
          })}
      </CollapsiblePanel>
    </Collapsible>
  )
}

export default MultipleToolSelector
