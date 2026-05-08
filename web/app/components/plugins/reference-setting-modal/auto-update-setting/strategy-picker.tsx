import { Button } from '@langgenius/dify-ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuRadioItemIndicator,
  DropdownMenuTrigger,
} from '@langgenius/dify-ui/dropdown-menu'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { AUTO_UPDATE_STRATEGY } from './types'

const i18nPrefix = 'autoUpdate.strategy'

type Props = {
  value: AUTO_UPDATE_STRATEGY
  onChange: (value: AUTO_UPDATE_STRATEGY) => void
}
const StrategyPicker = ({
  value,
  onChange,
}: Props) => {
  const { t } = useTranslation()
  const [open, setOpen] = useState(false)
  const options = [
    {
      value: AUTO_UPDATE_STRATEGY.disabled,
      label: t(`${i18nPrefix}.disabled.name`, { ns: 'plugin' }),
      description: t(`${i18nPrefix}.disabled.description`, { ns: 'plugin' }),
    },
    {
      value: AUTO_UPDATE_STRATEGY.fixOnly,
      label: t(`${i18nPrefix}.fixOnly.name`, { ns: 'plugin' }),
      description: t(`${i18nPrefix}.fixOnly.description`, { ns: 'plugin' }),
    },
    {
      value: AUTO_UPDATE_STRATEGY.latest,
      label: t(`${i18nPrefix}.latest.name`, { ns: 'plugin' }),
      description: t(`${i18nPrefix}.latest.description`, { ns: 'plugin' }),
    },
  ]
  const selectedOption = options.find(option => option.value === value)
  const handleValueChange = (nextValue: string) => {
    onChange(nextValue as AUTO_UPDATE_STRATEGY)
    setOpen(false)
  }

  return (
    <DropdownMenu
      open={open}
      onOpenChange={setOpen}
    >
      <DropdownMenuTrigger render={<Button size="small" />}>
        {selectedOption?.label}
        <span aria-hidden className="i-ri-arrow-down-s-line h-3.5 w-3.5" />
      </DropdownMenuTrigger>
      <DropdownMenuContent
        placement="top-end"
        sideOffset={4}
        popupClassName="w-[280px] p-1"
      >
        <DropdownMenuRadioGroup
          value={value}
          onValueChange={handleValueChange}
        >
          {options.map(option => (
            <DropdownMenuRadioItem
              key={option.value}
              value={option.value}
              className="mx-0 h-auto items-start gap-1 p-2 pr-3"
            >
              <div className="mr-1 flex w-4 shrink-0 justify-center pt-0.5">
                <DropdownMenuRadioItemIndicator className="ml-0" />
              </div>
              <div className="grow">
                <div className="mb-0.5 system-sm-semibold text-text-secondary">{option.label}</div>
                <div className="system-xs-regular text-text-tertiary">{option.description}</div>
              </div>
            </DropdownMenuRadioItem>
          ))}
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

export default StrategyPicker
