import {
  useMemo,
  useState,
} from 'react'
import { useTranslation } from 'react-i18next'
import { RiArrowDownSLine } from '@remixicon/react'
import { getOperators, isComparisonOperatorNeedTranslate } from '../../utils'
import type { ComparisonOperator } from '../../types'
import Button from '@/app/components/base/button'
import {
  PortalToFollowElem,
  PortalToFollowElemContent,
  PortalToFollowElemTrigger,
} from '@/app/components/base/portal-to-follow-elem'
import type { VarType } from '@/app/components/workflow/types'
import cn from '@/utils/classnames'
const i18nPrefix = 'workflow.nodes.ifElse'

type ConditionOperatorProps = {
  disabled?: boolean
  varType: VarType
  value?: string
  onSelect: (value: ComparisonOperator) => void
}
const ConditionOperator = ({
  disabled,
  varType,
  value,
  onSelect,
}: ConditionOperatorProps) => {
  const { t } = useTranslation()
  const [open, setOpen] = useState(false)

  const options = useMemo(() => {
    return getOperators(varType).map((o) => {
      return {
        label: isComparisonOperatorNeedTranslate(o) ? t(`${i18nPrefix}.comparisonOperator.${o}`) : o,
        value: o,
      }
    })
  }, [t, varType])
  const selectedOption = options.find(o => o.value === value)

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
      <PortalToFollowElemTrigger onClick={() => setOpen(v => !v)}>
        <Button
          className={cn('shrink-0', !selectedOption && 'opacity-50')}
          size='small'
          variant='ghost'
          disabled={disabled}
        >
          {
            selectedOption
              ? selectedOption.label
              : 'select'
          }
          <RiArrowDownSLine className='ml-1 w-3.5 h-3.5' />
        </Button>
      </PortalToFollowElemTrigger>
      <PortalToFollowElemContent className='z-10'>
        <div className='p-1 bg-components-panel-bg-blur rounded-xl border-[0.5px] border-components-panel-border shadow-lg'>
          {
            options.map(option => (
              <div
                key={option.value}
                className='flex items-center px-3 py-1.5 h-7 text-[13px] font-medium text-text-secondary rounded-lg cursor-pointer hover:bg-state-base-hover'
                onClick={() => {
                  onSelect(option.value)
                  setOpen(false)
                }}
              >
                {option.label}
              </div>
            ))
          }
        </div>
      </PortalToFollowElemContent>
    </PortalToFollowElem>
  )
}

export default ConditionOperator
