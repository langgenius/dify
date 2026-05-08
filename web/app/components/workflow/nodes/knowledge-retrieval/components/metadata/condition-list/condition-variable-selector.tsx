import type {
  Node,
  NodeOutPutVar,
  ValueSelector,
  Var,
} from '@/app/components/workflow/types'
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@langgenius/dify-ui/popover'
import { useCallback, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Variable02 } from '@/app/components/base/icons/src/vender/solid/development'
import VariableTag from '@/app/components/workflow/nodes/_base/components/variable-tag'
import VarReferenceVars from '@/app/components/workflow/nodes/_base/components/variable/var-reference-vars'
import { VarType } from '@/app/components/workflow/types'

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

  const handleChange = useCallback((nextValueSelector: ValueSelector, varItem: Var) => {
    onChange(nextValueSelector, varItem)
    setOpen(false)
  }, [onChange])

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger
        render={(
          <div className="flex h-6 grow cursor-pointer items-center">
            {!!valueSelector.length && (
              <VariableTag
                valueSelector={valueSelector}
                varType={varType}
                availableNodes={availableNodes}
                isShort
              />
            )}
            {!valueSelector.length && (
              <>
                <div className="flex grow items-center system-sm-regular text-components-input-text-placeholder">
                  <Variable02 className="mr-1 h-4 w-4" />
                  {t('nodes.knowledgeRetrieval.metadata.panel.select', { ns: 'workflow' })}
                </div>
                <div className="flex h-5 shrink-0 items-center rounded-[5px] border border-divider-deep px-[5px] system-2xs-medium text-text-tertiary">
                  {varType}
                </div>
              </>
            )}
          </div>
        )}
      />
      <PopoverContent
        placement="bottom-start"
        sideOffset={4}
        popupClassName="border-none bg-transparent p-0 shadow-none backdrop-blur-none"
      >
        <div className="w-[296px] rounded-lg border-[0.5px] border-components-panel-border bg-components-panel-bg-blur shadow-lg">
          <VarReferenceVars
            vars={nodesOutputVars}
            isSupportFileVar
            onChange={handleChange}
          />
        </div>
      </PopoverContent>
    </Popover>
  )
}

export default ConditionVariableSelector
