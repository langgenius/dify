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
  className?: string
  disabled?: boolean
  varType: VarType
  file?: { key: string }
  value?: string
  onSelect: (value: ComparisonOperator) => void
}
const ConditionOperator = ({
  className,
  disabled,
  varType,
  file,
  value,
  onSelect,
}: ConditionOperatorProps) => {
  const { t } = useTranslation()
  const [open, setOpen] = useState(false)

  const options = useMemo(() => {
    return getOperators(varType, file).map((o) => {
      return {
        label: isComparisonOperatorNeedTranslate(o) ? t(`${i18nPrefix}.comparisonOperator.${o}`) : o,
        value: o,
      }
    })
  }, [t, varType, file])
  const selectedOption = options.find(o => Array.isArray(value) ? o.value === value[0] : o.value === value)
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
          className={cn('shrink-0', !selectedOption && 'opacity-50', className)}
          size='small'
          variant='ghost'
          disabled={disabled}
        >
          {
            selectedOption
              ? selectedOption.label
              : t(`${i18nPrefix}.select`)
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
