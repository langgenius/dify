import { useCallback, useState } from 'react'
import { useTranslation } from 'react-i18next'
import {
  PortalToFollowElem,
  PortalToFollowElemContent,
  PortalToFollowElemTrigger,
} from '@/app/components/base/portal-to-follow-elem'
import VariableTag from '@/app/components/workflow/nodes/_base/components/variable-tag'
import VarReferenceVars from '@/app/components/workflow/nodes/_base/components/variable/var-reference-vars'
import type {
  Node,
  NodeOutPutVar,
  ValueSelector,
  Var,
} from '@/app/components/workflow/types'
import { VarType } from '@/app/components/workflow/types'
import { Variable02 } from '@/app/components/base/icons/src/vender/solid/development'

type ConditionVariableSelectorProps = {
  valueSelector?: ValueSelector
  varType?: VarType
  availableNodes?: Node[]
  nodesOutputVars?: NodeOutPutVar[]
  onChange: (valueSelector: ValueSelector, varItem: Var) => void
}

const ConditionVariableSelector = ({
  valueSelector = [],
  varType = VarType.string,
  availableNodes = [],
  nodesOutputVars = [],
  onChange,
}: ConditionVariableSelectorProps) => {
  const { t } = useTranslation()
  const [open, setOpen] = useState(false)

  const handleChange = useCallback((valueSelector: ValueSelector, varItem: Var) => {
    onChange(valueSelector, varItem)
    setOpen(false)
  }, [onChange])

  return (
    <PortalToFollowElem
      open={open}
      onOpenChange={setOpen}
      placement='bottom-start'
      offset={{
        mainAxis: 4,
        crossAxis: 0,
      }}
    >
      <PortalToFollowElemTrigger asChild onClick={() => setOpen(!open)}>
        <div className="flex h-6 grow cursor-pointer items-center">
          {
            !!valueSelector.length && (
              <VariableTag
                valueSelector={valueSelector}
                varType={varType}
                availableNodes={availableNodes}
                isShort
              />
            )
          }
          {
            !valueSelector.length && (
              <>
                <div className='system-sm-regular flex grow items-center text-components-input-text-placeholder'>
                  <Variable02 className='mr-1 h-4 w-4' />
                  {t('workflow.nodes.knowledgeRetrieval.metadata.panel.select')}
                </div>
                <div className='system-2xs-medium flex h-5 shrink-0 items-center rounded-[5px] border border-divider-deep px-[5px] text-text-tertiary'>
                  {varType}
                </div>
              </>
            )
          }
        </div>
      </PortalToFollowElemTrigger>
      <PortalToFollowElemContent className='z-[1000]'>
        <div className='w-[296px] rounded-lg border-[0.5px] border-components-panel-border bg-components-panel-bg-blur shadow-lg'>
          <VarReferenceVars
            vars={nodesOutputVars}
            isSupportFileVar
            onChange={handleChange}
          />
        </div>
      </PortalToFollowElemContent>
    </PortalToFollowElem>
  )
}

export default ConditionVariableSelector
