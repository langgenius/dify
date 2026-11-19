import { Button } from '@langgenius/dify-ui/button'
import {
  Menu,
  MenuContent,
  MenuRadioGroup,
  MenuRadioItem,
  MenuRadioItemIndicator,
  MenuTrigger,
} from '@langgenius/dify-ui/menu'
import { RiArrowDownSLine } from '@remixicon/react'
import { useTranslation } from 'react-i18next'
import { ErrorHandleTypeEnum } from './types'

type ErrorHandleTypeSelectorProps = {
  value: ErrorHandleTypeEnum
  allowDefaultValue?: boolean
  onSelected: (value: ErrorHandleTypeEnum) => void
}
const ErrorHandleTypeSelector = ({
  value,
  onSelected,
  allowDefaultValue = true,
}: ErrorHandleTypeSelectorProps) => {
  const { t } = useTranslation(['workflow'])
  const options = [
    {
      value: ErrorHandleTypeEnum.none,
      label: t(($) => $['nodes.common.errorHandle.none.title'], { ns: 'workflow' }),
      description: t(($) => $['nodes.common.errorHandle.none.desc'], { ns: 'workflow' }),
    },
    {
      value: ErrorHandleTypeEnum.defaultValue,
      label: t(($) => $['nodes.common.errorHandle.defaultValue.title'], { ns: 'workflow' }),
      description: t(($) => $['nodes.common.errorHandle.defaultValue.desc'], { ns: 'workflow' }),
    },
    {
      value: ErrorHandleTypeEnum.failBranch,
      label: t(($) => $['nodes.common.errorHandle.failBranch.title'], { ns: 'workflow' }),
      description: t(($) => $['nodes.common.errorHandle.failBranch.desc'], { ns: 'workflow' }),
    },
  ]
  const availableOptions = options.filter(
    (option) => allowDefaultValue || option.value !== ErrorHandleTypeEnum.defaultValue,
  )
  const selectedOption = options.find((option) => option.value === value)

  return (
    <Menu>
      <MenuTrigger
        render={
          <Button
            size="small"
            onClick={(e) => {
              e.stopPropagation()
            }}
          />
        }
      >
        {selectedOption?.label}
        <RiArrowDownSLine className="size-3.5" />
      </MenuTrigger>
      <MenuContent className="w-70">
        <MenuRadioGroup value={value} onValueChange={onSelected}>
          {availableOptions.map((option) => (
            <MenuRadioItem
              key={option.value}
              value={option.value}
              closeOnClick
              className="h-auto items-start p-2 pr-3"
              onClick={(e) => {
                e.stopPropagation()
              }}
            >
              <div className="mr-1 w-4 shrink-0">
                <MenuRadioItemIndicator />
              </div>
              <div className="grow">
                <div className="mb-0.5 system-sm-semibold text-text-secondary">{option.label}</div>
                <div className="system-xs-regular text-text-tertiary">{option.description}</div>
              </div>
            </MenuRadioItem>
          ))}
        </MenuRadioGroup>
      </MenuContent>
    </Menu>
  )
}

export default ErrorHandleTypeSelector
