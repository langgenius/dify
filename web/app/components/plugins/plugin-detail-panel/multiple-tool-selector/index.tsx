import React from 'react'
import { useTranslation } from 'react-i18next'
import {
  RiAddLine,
  RiQuestionLine,
} from '@remixicon/react'
import ToolSelector from '@/app/components/plugins/plugin-detail-panel/tool-selector'
import ActionButton from '@/app/components/base/action-button'
import Tooltip from '@/app/components/base/tooltip'
import Divider from '@/app/components/base/divider'
import type { ToolValue } from '@/app/components/workflow/block-selector/types'
import type { Node } from 'reactflow'
import type { NodeOutPutVar } from '@/app/components/workflow/types'
import cn from '@/utils/classnames'
import { ArrowDownRoundFill } from '@/app/components/base/icons/src/vender/solid/general'
import { useAllMCPTools } from '@/service/use-tools'

type Props = {
  disabled?: boolean
  value: ToolValue[]
  label: string
  required?: boolean
  tooltip?: any
  supportCollapse?: boolean
  scope?: string
  onChange: (value: ToolValue[]) => void
  nodeOutputVars: NodeOutPutVar[],
  availableNodes: Node[],
  nodeId?: string
  canChooseMCPTool?: boolean
}

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
  canChooseMCPTool,
}: Props) => {
  const { t } = useTranslation()
  const { data: mcpTools } = useAllMCPTools()
  const enabledCount = value.filter((item) => {
    const isMCPTool = mcpTools?.find(tool => tool.id === item.provider_name)
    if(isMCPTool)
      return item.enabled && canChooseMCPTool
    return item.enabled
  }).length
  // collapse control
  const [collapse, setCollapse] = React.useState(false)
  const handleCollapse = () => {
    if (supportCollapse)
      setCollapse(!collapse)
  }

  // add tool
  const [open, setOpen] = React.useState(false)
  const [panelShowState, setPanelShowState] = React.useState(true)
  const handleAdd = (val: ToolValue) => {
    const newValue = [...value, val]
    // deduplication
    const deduplication = newValue.reduce((acc, cur) => {
      if (!acc.find(item => item.provider_name === cur.provider_name && item.tool_name === cur.tool_name))
        acc.push(cur)
      return acc
    }, [] as ToolValue[])
    // update value
    onChange(deduplication)
    setOpen(false)
  }

  const handleAddMultiple = (val: ToolValue[]) => {
    const newValue = [...value, ...val]
    // deduplication
    const deduplication = newValue.reduce((acc, cur) => {
      if (!acc.find(item => item.provider_name === cur.provider_name && item.tool_name === cur.tool_name))
        acc.push(cur)
      return acc
    }, [] as ToolValue[])
    // update value
    onChange(deduplication)
    setOpen(false)
  }

  // delete tool
  const handleDelete = (index: number) => {
    const newValue = [...value]
    newValue.splice(index, 1)
    onChange(newValue)
  }

  // configure tool
  const handleConfigure = (val: ToolValue, index: number) => {
    const newValue = [...value]
    newValue[index] = val
    onChange(newValue)
  }

  return (
    <>
      <div className='mb-1 flex items-center'>
        <div
          className={cn('relative flex grow items-center gap-0.5', supportCollapse && 'cursor-pointer')}
          onClick={handleCollapse}
        >
          <div className='system-sm-semibold-uppercase flex h-6 items-center text-text-secondary'>{label}</div>
          {required && <div className='text-red-500'>*</div>}
          {tooltip && (
            <Tooltip
              popupContent={tooltip}
            >
              <div><RiQuestionLine className='h-3.5 w-3.5 text-text-quaternary hover:text-text-tertiary' /></div>
            </Tooltip>
          )}
          {supportCollapse && (
            <ArrowDownRoundFill
              className={cn(
                'h-4 w-4 cursor-pointer text-text-quaternary group-hover/collapse:text-text-secondary',
                collapse && 'rotate-[270deg]',
              )}
            />
          )}
        </div>
        {value.length > 0 && (
          <>
            <div className='system-xs-medium flex items-center gap-1 text-text-tertiary'>
              <span>{`${enabledCount}/${value.length}`}</span>
              <span>{t('appDebug.agent.tools.enabled')}</span>
            </div>
            <Divider type='vertical' className='ml-3 mr-1 h-3' />
          </>
        )}
        {!disabled && (
          <ActionButton className='mx-1' onClick={() => {
            setCollapse(false)
            setOpen(!open)
            setPanelShowState(true)
          }}>
            <RiAddLine className='h-4 w-4' />
          </ActionButton>
        )}
      </div>
      {!collapse && (
        <>
          {value.length === 0 && (
            <div className='system-xs-regular flex justify-center rounded-[10px] bg-background-section p-3 text-text-tertiary'>{t('plugin.detailPanel.toolSelector.empty')}</div>
          )}
          {value.length > 0 && value.map((item, index) => (
            <div className='mb-1' key={index}>
              <ToolSelector
                nodeId={nodeId}
                nodeOutputVars={nodeOutputVars}
                availableNodes={availableNodes}
                scope={scope}
                value={item}
                selectedTools={value}
                onSelect={item => handleConfigure(item, index)}
                onSelectMultiple={handleAddMultiple}
                onDelete={() => handleDelete(index)}
                supportEnableSwitch
                canChooseMCPTool={canChooseMCPTool}
                isEdit
              />
            </div>
          ))}
        </>
      )}
      <ToolSelector
        nodeId={nodeId}
        nodeOutputVars={nodeOutputVars}
        availableNodes={availableNodes}
        scope={scope}
        value={undefined}
        selectedTools={value}
        onSelect={handleAdd}
        controlledState={open}
        onControlledStateChange={setOpen}
        trigger={
          <div className=''></div>
        }
        panelShowState={panelShowState}
        onPanelShowStateChange={setPanelShowState}
        isEdit={false}
        canChooseMCPTool={canChooseMCPTool}
        onSelectMultiple={handleAddMultiple}
      />
    </>
  )
}

export default MultipleToolSelector
