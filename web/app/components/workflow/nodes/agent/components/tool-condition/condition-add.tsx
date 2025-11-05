import { useCallback, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { RiAddLine } from '@remixicon/react'
import type {
  NodeOutPutVar,
  ValueSelector,
  Var,
} from '@/app/components/workflow/types'
import Button from '@/app/components/base/button'
import {
  PortalToFollowElem,
  PortalToFollowElemContent,
  PortalToFollowElemTrigger,
} from '@/app/components/base/portal-to-follow-elem'
import VarReferenceVars from '@/app/components/workflow/nodes/_base/components/variable/var-reference-vars'

type Props = {
  variables: NodeOutPutVar[]
  onSelect: (valueSelector: ValueSelector, varItem: Var) => void
  disabled?: boolean
}

const ConditionAdd = ({
  variables,
  onSelect,
  disabled,
}: Props) => {
  const { t } = useTranslation()
  const [open, setOpen] = useState(false)

  const handleSelect = useCallback((valueSelector: ValueSelector, varItem: Var) => {
    onSelect(valueSelector, varItem)
    setOpen(false)
  }, [onSelect])

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
      <PortalToFollowElemTrigger onClick={() => !disabled && setOpen(!open)}>
        <Button
          size='small'
          disabled={disabled}
        >
          <RiAddLine className='mr-1 h-3.5 w-3.5' />
          {t('workflow.nodes.agent.toolCondition.addCondition')}
        </Button>
      </PortalToFollowElemTrigger>
      <PortalToFollowElemContent className='z-[1000]'>
        <div className='w-[296px] rounded-lg border-[0.5px] border-components-panel-border bg-components-panel-bg-blur shadow-lg'>
          <VarReferenceVars
            vars={variables}
            isSupportFileVar
            onChange={handleSelect}
          />
        </div>
      </PortalToFollowElemContent>
    </PortalToFollowElem>
  )
}

export default ConditionAdd
