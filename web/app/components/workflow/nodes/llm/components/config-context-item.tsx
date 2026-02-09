'use client'
import type { FC } from 'react'
import type { PromptMessageContext, ValueSelector } from '../../../types'
import type { Node, NodeOutPutVar, Var } from '@/app/components/workflow/types'
import { RiArrowDownSLine, RiDeleteBinLine } from '@remixicon/react'
import { memo, useCallback, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import {
  PortalToFollowElem,
  PortalToFollowElemContent,
  PortalToFollowElemTrigger,
} from '@/app/components/base/portal-to-follow-elem'
import VarReferenceVars from '@/app/components/workflow/nodes/_base/components/variable/var-reference-vars'
import VariableLabelInSelect from '@/app/components/workflow/nodes/_base/components/variable/variable-label/variable-label-in-select'
import { BlockEnum } from '@/app/components/workflow/types'
import { cn } from '@/utils/classnames'

type Props = {
  readOnly: boolean
  payload: PromptMessageContext
  contextVars: NodeOutPutVar[]
  availableNodes: Node[]
  onChange: (value: ValueSelector) => void
  onRemove: () => void
}

const ConfigContextItem: FC<Props> = ({
  readOnly,
  payload,
  contextVars,
  availableNodes,
  onChange,
  onRemove,
}) => {
  const { t } = useTranslation()
  const [open, setOpen] = useState(false)

  const selectedNodeId = Array.isArray(payload.$context) ? payload.$context[0] : ''
  const selectedNode = useMemo(() => {
    return availableNodes.find(node => node.id === selectedNodeId)
  }, [availableNodes, selectedNodeId])
  const hasOptions = contextVars.length > 0

  const handleChange = useCallback((value: ValueSelector, _item?: Var) => {
    onChange(value)
    setOpen(false)
  }, [onChange])

  const handleToggle = useCallback(() => {
    if (readOnly)
      return
    setOpen(prev => !prev)
  }, [readOnly])

  const handleRemove = useCallback(() => {
    onRemove()
    setOpen(false)
  }, [onRemove])

  return (
    <PortalToFollowElem
      open={open}
      onOpenChange={setOpen}
      placement="bottom-start"
      offset={6}
      triggerPopupSameWidth
    >
      <PortalToFollowElemTrigger asChild onClick={handleToggle}>
        <button
          type="button"
          disabled={readOnly}
          className={cn(
            'flex w-full items-center justify-between rounded-lg border border-transparent bg-components-input-bg-normal px-3 py-2',
            !readOnly && 'cursor-pointer hover:border-components-input-border-hover hover:bg-components-input-bg-hover',
          )}
        >
          <div className="text-text-secondary system-xs-semibold-uppercase">
            {t('nodes.llm.chatHistorry', { ns: 'workflow' })}
          </div>
          <div className="flex items-center gap-1">
            <VariableLabelInSelect
              nodeType={selectedNode?.data.type || BlockEnum.Agent}
              nodeTitle={selectedNode?.data.title}
              variables={payload.$context}
            />
            <RiArrowDownSLine className="h-4 w-4 text-text-tertiary" />
          </div>
        </button>
      </PortalToFollowElemTrigger>
      <PortalToFollowElemContent className="z-[1000]">
        <div className="w-full rounded-lg border-[0.5px] border-components-panel-border bg-components-panel-bg-blur p-1 shadow-lg">
          {hasOptions
            ? (
                <VarReferenceVars
                  vars={contextVars}
                  onChange={handleChange}
                  hideSearch
                  maxHeightClass="max-h-[34vh]"
                  onClose={() => setOpen(false)}
                  onBlur={() => setOpen(false)}
                  autoFocus={false}
                  preferSchemaType
                />
              )
            : (
                <div className="px-3 py-2 text-center text-text-tertiary system-xs-regular">
                  {t('common.noAgentNodes', { ns: 'workflow' })}
                </div>
              )}
          {!readOnly && (
            <div className="mt-1 border-t border-divider-subtle pt-1">
              <button
                type="button"
                className="flex w-full items-center gap-2 rounded-md px-3 py-2 text-text-secondary hover:bg-state-base-hover"
                onClick={handleRemove}
              >
                <RiDeleteBinLine className="h-4 w-4" />
                <span className="system-sm-regular">
                  {t('nodes.llm.removeContext', { ns: 'workflow' })}
                </span>
              </button>
            </div>
          )}
        </div>
      </PortalToFollowElemContent>
    </PortalToFollowElem>
  )
}

export default memo(ConfigContextItem)
