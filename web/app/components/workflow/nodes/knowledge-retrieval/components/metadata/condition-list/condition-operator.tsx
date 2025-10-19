import {
  useMemo,
  useState,
} from 'react'
import { useTranslation } from 'react-i18next'
import { RiArrowDownSLine } from '@remixicon/react'
import {
  getOperators,
  isComparisonOperatorNeedTranslate,
} from './utils'
import Button from '@/app/components/base/button'
import {
  PortalToFollowElem,
  PortalToFollowElemContent,
  PortalToFollowElemTrigger,
} from '@/app/components/base/portal-to-follow-elem'
import cn from '@/utils/classnames'
import type {
  ComparisonOperator,
  MetadataFilteringVariableType,
} from '@/app/components/workflow/nodes/knowledge-retrieval/types'

const i18nPrefix = 'workflow.nodes.ifElse'

type ConditionOperatorProps = {
  className?: string
  disabled?: boolean
  variableType: MetadataFilteringVariableType
  value?: string
  onSelect: (value: ComparisonOperator) => void
}
const ConditionOperator = ({
  className,
  disabled,
  variableType,
  value,
  onSelect,
}: ConditionOperatorProps) => {
  const { t } = useTranslation()
  const [open, setOpen] = useState(false)

  const options = useMemo(() => {
    return getOperators(variableType).map((o) => {
      return {
        label: isComparisonOperatorNeedTranslate(o) ? t(`${i18nPrefix}.comparisonOperator.${o}`) : o,
        value: o,
      }
    })
  }, [t, variableType])
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
          <RiArrowDownSLine className='ml-1 h-3.5 w-3.5' />
        </Button>
      </PortalToFollowElemTrigger>
      <PortalToFollowElemContent className='z-10'>
        <div className='rounded-xl border-[0.5px] border-components-panel-border bg-components-panel-bg-blur p-1 shadow-lg'>
          {
            options.map(option => (
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
            ))
          }
        </div>
      </PortalToFollowElemContent>
    </PortalToFollowElem>
  )
}

export default ConditionOperator
