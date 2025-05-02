import React from 'react'
import { useTranslation } from 'react-i18next'
import {
  RiAddLine,
  RiArrowDropDownLine,
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
}: Props) => {
  const { t } = useTranslation()
  const enabledCount = value.filter(item => item.enabled).length
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
      <div className='flex items-center mb-1'>
        <div
          className={cn('relative grow flex items-center gap-0.5', supportCollapse && 'cursor-pointer')}
          onClick={handleCollapse}
        >
          <div className='h-6 flex items-center text-text-secondary system-sm-semibold-uppercase'>{label}</div>
          {required && <div className='text-red-500'>*</div>}
          {tooltip && (
            <Tooltip
              popupContent={tooltip}
              needsDelay
            >
              <div><RiQuestionLine className='w-3.5 h-3.5 text-text-quaternary hover:text-text-tertiary' /></div>
            </Tooltip>
          )}
          {supportCollapse && (
            <div className='absolute -left-4 top-1'>
              <RiArrowDropDownLine
                className={cn(
                  'w-4 h-4 text-text-tertiary',
                  collapse && 'transform -rotate-90',
                )}
              />
            </div>
          )}
        </div>
        {value.length > 0 && (
          <>
            <div className='flex items-center gap-1 text-text-tertiary system-xs-medium'>
              <span>{`${enabledCount}/${value.length}`}</span>
              <span>{t('appDebug.agent.tools.enabled')}</span>
            </div>
            <Divider type='vertical' className='ml-3 mr-1 h-3' />
          </>
        )}
        {!disabled && (
          <ActionButton className='mx-1' onClick={() => {
            setOpen(!open)
            setPanelShowState(true)
          }}>
            <RiAddLine className='w-4 h-4' />
          </ActionButton>
        )}
      </div>
      {!collapse && (
        <>
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

          />
          {value.length === 0 && (
            <div className='p-3 flex justify-center rounded-[10px] bg-background-section text-text-tertiary system-xs-regular'>{t('plugin.detailPanel.toolSelector.empty')}</div>
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
                onDelete={() => handleDelete(index)}
                supportEnableSwitch
              />
            </div>
          ))}
        </>
      )}
    </>
  )
}

export default MultipleToolSelector
