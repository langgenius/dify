import type { HandleAddCondition } from '../types'
import type {
  NodeOutPutVar,
  ValueSelector,
  Var,
} from '@/app/components/workflow/types'
import { RiAddLine } from '@remixicon/react'
import {
  useCallback,
  useState,
} from 'react'
import { useTranslation } from 'react-i18next'
import Button from '@/app/components/base/button'
import {
  PortalToFollowElem,
  PortalToFollowElemContent,
  PortalToFollowElemTrigger,
} from '@/app/components/base/portal-to-follow-elem'
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
  }, [onSelectVariable, setOpen])

  return (
    <PortalToFollowElem
      open={open}
      onOpenChange={setOpen}
      placement="bottom-start"
      offset={{
        mainAxis: 4,
        crossAxis: 0,
      }}
    >
      <PortalToFollowElemTrigger onClick={() => setOpen(!open)}>
        <Button
          size="small"
          className={className}
          disabled={disabled}
        >
          <RiAddLine className="mr-1 h-3.5 w-3.5" />
          {t('nodes.ifElse.addCondition', { ns: 'workflow' })}
        </Button>
      </PortalToFollowElemTrigger>
      <PortalToFollowElemContent className="z-[1000]">
        <div className="w-[296px] rounded-lg border-[0.5px] border-components-panel-border bg-components-panel-bg-blur shadow-lg">
          <VarReferenceVars
            vars={variables}
            isSupportFileVar
            onChange={handleSelectVariable}
          />
        </div>
      </PortalToFollowElemContent>
    </PortalToFollowElem>
  )
}

export default ConditionAdd
