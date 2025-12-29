import type { VarType } from '@/app/components/workflow/types'
import { RiArrowDownSLine } from '@remixicon/react'
import {
  useMemo,
  useState,
} from 'react'
import { useTranslation } from 'react-i18next'
import Button from '@/app/components/base/button'
import {
  PortalToFollowElem,
  PortalToFollowElemContent,
  PortalToFollowElemTrigger,
} from '@/app/components/base/portal-to-follow-elem'
import { cn } from '@/utils/classnames'
import { getConditionOperators } from '../../utils'

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
  const { t } = useTranslation('workflow')
  const [open, setOpen] = useState(false)
  const placeholder = t('nodes.agent.toolCondition.operatorPlaceholder', { ns: 'workflow' }) as string

  const options = useMemo(() => {
    return getConditionOperators(varType).map((option) => {
      const key = `nodes.ifElse.comparisonOperator.${option}`
      // eslint-disable-next-line dify-i18n/no-as-any-in-t
      const translated = t(key as any, { ns: 'workflow' }) as string
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
      placement="bottom-end"
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
          size="small"
          variant="ghost"
          disabled={disabled}
        >
          {selectedOption?.label ?? placeholder}
          <RiArrowDownSLine className="ml-1 h-3.5 w-3.5" />
        </Button>
      </PortalToFollowElemTrigger>
      <PortalToFollowElemContent className="z-10">
        <div className="rounded-xl border-[0.5px] border-components-panel-border bg-components-panel-bg-blur p-1 shadow-lg">
          {options.map(option => (
            <div
              key={option.value}
              className="flex h-7 cursor-pointer items-center rounded-lg px-3 py-1.5 text-[13px] font-medium text-text-secondary hover:bg-state-base-hover"
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
