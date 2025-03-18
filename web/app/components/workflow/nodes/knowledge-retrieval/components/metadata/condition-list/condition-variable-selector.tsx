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
        <div className="grow flex items-center cursor-pointer h-6">
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
                <div className='grow flex items-center text-components-input-text-placeholder system-sm-regular'>
                  <Variable02 className='mr-1 w-4 h-4' />
                  {t('workflow.nodes.knowledgeRetrieval.metadata.panel.select')}
                </div>
                <div className='shrink-0 flex items-center px-[5px] h-5 border border-divider-deep rounded-[5px] system-2xs-medium text-text-tertiary'>
                  {varType}
                </div>
              </>
            )
          }
        </div>
      </PortalToFollowElemTrigger>
      <PortalToFollowElemContent className='z-[1000]'>
        <div className='w-[296px] bg-components-panel-bg-blur rounded-lg border-[0.5px] border-components-panel-border shadow-lg'>
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
