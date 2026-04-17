import type { FC } from 'react'
import type { WriteMode } from '../types'
import type { Item } from '../utils'
import type { VarType } from '@/app/components/workflow/types'
import { cn } from '@langgenius/dify-ui/cn'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/app/components/base/ui/dropdown-menu'
import { getOperationItems, isOperationItem } from '../utils'

type OperationSelectorProps = {
  value: string | number
  onSelect: (value: Item) => void
  placeholder?: string
  disabled?: boolean
  className?: string
  popupClassName?: string
  assignedVarType?: VarType
  writeModeTypes?: WriteMode[]
  writeModeTypesArr?: WriteMode[]
  writeModeTypesNum?: WriteMode[]
}

const OperationSelector: FC<OperationSelectorProps> = ({
  value,
  onSelect,
  disabled = false,
  className,
  popupClassName,
  assignedVarType,
  writeModeTypes,
  writeModeTypesArr,
  writeModeTypesNum,
}) => {
  const { t } = useTranslation()
  const [open, setOpen] = useState(false)

  const items = getOperationItems(assignedVarType, writeModeTypes, writeModeTypesArr, writeModeTypesNum)

  const selectedItem = items.find(item => item.value === value)

  return (
    <DropdownMenu
      open={open}
      onOpenChange={setOpen}
    >
      <DropdownMenuTrigger
        disabled={disabled}
        className={cn('flex items-center gap-0.5 rounded-lg bg-components-input-bg-normal px-2 py-1', disabled ? 'cursor-not-allowed bg-components-input-bg-disabled!' : 'cursor-pointer hover:bg-state-base-hover-alt', open && 'bg-state-base-hover-alt', className)}
      >
        <div className="flex items-center p-1">
          <span
            className={`truncate overflow-hidden system-sm-regular text-ellipsis
                ${selectedItem ? 'text-components-input-text-filled' : 'text-components-input-text-disabled'}`}
          >
            {selectedItem && isOperationItem(selectedItem) ? t(`nodes.assigner.operations.${selectedItem.name}`, { ns: 'workflow' }) : t('nodes.assigner.operations.title', { ns: 'workflow' })}
          </span>
        </div>
        <span aria-hidden className={cn('i-ri-arrow-down-s-line h-4 w-4 text-text-quaternary', disabled && 'text-components-input-text-placeholder', open && 'text-text-secondary')} />
      </DropdownMenuTrigger>

      <DropdownMenuContent
        placement="bottom-start"
        sideOffset={4}
        popupClassName={cn('w-[140px]', popupClassName)}
      >
        <DropdownMenuGroup>
          <DropdownMenuLabel>{t('nodes.assigner.operations.title', { ns: 'workflow' })}</DropdownMenuLabel>
          {items.map(item => (
            !isOperationItem(item)
              ? (
                  <DropdownMenuSeparator key="divider" />
                )
              : (
                  <DropdownMenuItem
                    key={item.value}
                    className="gap-1 px-2 py-1"
                    onClick={() => onSelect(item)}
                  >
                    <div className="flex min-h-5 grow items-center gap-1 px-1">
                      <span className="flex grow system-sm-medium text-text-secondary">{t(`nodes.assigner.operations.${item.name}`, { ns: 'workflow' })}</span>
                    </div>
                    {item.value === value && (
                      <div className="flex items-center justify-center">
                        <span aria-hidden className="i-ri-check-line h-4 w-4 text-text-accent" />
                      </div>
                    )}
                  </DropdownMenuItem>
                )
          ))}
        </DropdownMenuGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

export default OperationSelector
