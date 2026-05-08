import type { HandleAddCondition } from '../types'
import type {
  NodeOutPutVar,
  ValueSelector,
  Var,
} from '@/app/components/workflow/types'
import { Button } from '@langgenius/dify-ui/button'
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@langgenius/dify-ui/popover'
import { RiAddLine } from '@remixicon/react'
import {
  useCallback,
  useState,
} from 'react'
import { useTranslation } from 'react-i18next'
import VarReferenceVars from '@/app/components/workflow/nodes/_base/components/variable/var-reference-vars'

type ConditionAddProps = {
  className?: string
  variables: NodeOutPutVar[]
  onSelectVariable: HandleAddCondition
  disabled?: boolean
}

const ConditionAdd = ({
  className,
  variables,
  onSelectVariable,
  disabled,
}: ConditionAddProps) => {
  const { t } = useTranslation()
  const [open, setOpen] = useState(false)

  const handleSelectVariable = useCallback((valueSelector: ValueSelector, varItem: Var) => {
    onSelectVariable(valueSelector, varItem)
    setOpen(false)
  }, [onSelectVariable])

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger
        render={(
          <Button
            size="small"
            className={className}
            disabled={disabled}
          >
            <RiAddLine className="mr-1 h-3.5 w-3.5" />
            {t('nodes.ifElse.addCondition', { ns: 'workflow' })}
          </Button>
        )}
        onClick={(e) => {
          if (disabled)
            e.preventDefault()
        }}
      />
      <PopoverContent
        placement="bottom-start"
        sideOffset={4}
        popupClassName="border-none bg-transparent p-0 shadow-none backdrop-blur-none"
      >
        <div className="w-[296px] rounded-lg border-[0.5px] border-components-panel-border bg-components-panel-bg-blur shadow-lg">
          <VarReferenceVars
            vars={variables}
            isSupportFileVar
            onChange={handleSelectVariable}
          />
        </div>
      </PopoverContent>
    </Popover>
  )
}

export default ConditionAdd
