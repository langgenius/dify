import {
  useMemo,
  useState,
} from 'react'
import { useTranslation } from 'react-i18next'
import { RiArrowDownSLine } from '@remixicon/react'
import type { VarType } from '@/app/components/workflow/types'
import { getConditionOperators } from '../../utils'
import Button from '@/app/components/base/button'
import {
  PortalToFollowElem,
  PortalToFollowElemContent,
  PortalToFollowElemTrigger,
} from '@/app/components/base/portal-to-follow-elem'
import cn from '@/utils/classnames'

type Props = {
  varType?: VarType
  value?: string
  onSelect: (operator: string) => void
  disabled?: boolean
}

const ConditionOperator = ({
  varType,
  value,
  onSelect,
  disabled,
}: Props) => {
  const { t } = useTranslation()
  const [open, setOpen] = useState(false)

  const options = useMemo(() => {
    return getConditionOperators(varType).map((option) => {
      const key = `workflow.nodes.ifElse.comparisonOperator.${option}`
      const translated = t(key)
      return {
        value: option,
        label: translated === key ? option : translated,
      }
    })
  }, [t, varType])

  const selectedOption = options.find(option => option.value === value)

  return (
    <PortalToFollowElem
      open={open}
      onOpenChange={setOpen}
      placement='bottom-end'
      offset={{
        mainAxis: 4,
        crossAxis: 0,
      }}
    >
      <PortalToFollowElemTrigger
        onClick={() => {
          if (!disabled)
            setOpen(v => !v)
        }}
      >
        <Button
          className={cn('h-7 shrink-0 px-2', !selectedOption && 'opacity-50')}
          size='small'
          variant='ghost'
          disabled={disabled}
        >
          {selectedOption?.label ?? t('workflow.nodes.agent.toolCondition.operatorPlaceholder')}
          <RiArrowDownSLine className='ml-1 h-3.5 w-3.5' />
        </Button>
      </PortalToFollowElemTrigger>
      <PortalToFollowElemContent className='z-10'>
        <div className='rounded-xl border-[0.5px] border-components-panel-border bg-components-panel-bg-blur p-1 shadow-lg'>
          {options.map(option => (
            <div
              key={option.value}
              className='flex h-7 cursor-pointer items-center rounded-lg px-3 py-1.5 text-[13px] font-medium text-text-secondary hover:bg-state-base-hover'
              onClick={() => {
                onSelect(option.value)
                setOpen(false)
              }}
            >
              {option.label}
            </div>
          ))}
        </div>
      </PortalToFollowElemContent>
    </PortalToFollowElem>
  )
}

export default ConditionOperator
