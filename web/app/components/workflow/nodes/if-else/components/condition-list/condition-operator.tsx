import type { ComparisonOperator } from '../../types'
import type { VarType } from '@/app/components/workflow/types'
import { Button } from '@langgenius/dify-ui/button'
import { cn } from '@langgenius/dify-ui/cn'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from '@langgenius/dify-ui/dropdown-menu'
import { RiArrowDownSLine } from '@remixicon/react'
import {
  useMemo,
} from 'react'
import { useTranslation } from 'react-i18next'
import { getOperators, isComparisonOperatorNeedTranslate } from '../../utils'

const i18nPrefix = 'nodes.ifElse'

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

  const options = useMemo(() => {
    return getOperators(varType, file).map((o) => {
      return {
        label: isComparisonOperatorNeedTranslate(o) ? t(`${i18nPrefix}.comparisonOperator.${o}`, { ns: 'workflow' }) : o,
        value: o,
      }
    })
  }, [t, varType, file])
  const selectedOption = options.find(o => Array.isArray(value) ? o.value === value[0] : o.value === value)
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={(
          <Button
            className={cn('shrink-0', !selectedOption && 'opacity-50', className)}
            size="small"
            variant="ghost"
            disabled={disabled}
          />
        )}
      >
        {
          selectedOption
            ? selectedOption.label
            : t(`${i18nPrefix}.select`, { ns: 'workflow' })
        }
        <RiArrowDownSLine className="ml-1 h-3.5 w-3.5" />
      </DropdownMenuTrigger>
      <DropdownMenuContent
        placement="bottom-end"
        sideOffset={4}
        popupClassName="rounded-xl border-[0.5px] bg-components-panel-bg-blur p-1"
      >
        <DropdownMenuRadioGroup
          value={selectedOption?.value}
          onValueChange={onSelect}
        >
          {
            options.map(option => (
              <DropdownMenuRadioItem
                key={option.value}
                value={option.value}
                closeOnClick
                className="h-7 rounded-lg px-3 py-1.5 text-[13px] font-medium text-text-secondary"
              >
                {option.label}
              </DropdownMenuRadioItem>
            ))
          }
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

export default ConditionOperator
