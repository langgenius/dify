import { Button } from '@langgenius/dify-ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from '@langgenius/dify-ui/dropdown-menu'
import {
  RiArrowDownSLine,
  RiCheckLine,
} from '@remixicon/react'
import { useTranslation } from 'react-i18next'
import { ErrorHandleTypeEnum } from './types'

type ErrorHandleTypeSelectorProps = {
  value: ErrorHandleTypeEnum
  onSelected: (value: ErrorHandleTypeEnum) => void
}
const ErrorHandleTypeSelector = ({
  value,
  onSelected,
}: ErrorHandleTypeSelectorProps) => {
  const { t } = useTranslation()
  const options = [
    {
      value: ErrorHandleTypeEnum.none,
      label: t('nodes.common.errorHandle.none.title', { ns: 'workflow' }),
      description: t('nodes.common.errorHandle.none.desc', { ns: 'workflow' }),
    },
    {
      value: ErrorHandleTypeEnum.defaultValue,
      label: t('nodes.common.errorHandle.defaultValue.title', { ns: 'workflow' }),
      description: t('nodes.common.errorHandle.defaultValue.desc', { ns: 'workflow' }),
    },
    {
      value: ErrorHandleTypeEnum.failBranch,
      label: t('nodes.common.errorHandle.failBranch.title', { ns: 'workflow' }),
      description: t('nodes.common.errorHandle.failBranch.desc', { ns: 'workflow' }),
    },
  ]
  const selectedOption = options.find(option => option.value === value)

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={(
          <Button
            size="small"
            onClick={(e) => {
              e.stopPropagation()
            }}
          />
        )}
      >
        {selectedOption?.label}
        <RiArrowDownSLine className="h-3.5 w-3.5" />
      </DropdownMenuTrigger>
      <DropdownMenuContent
        placement="bottom-end"
        sideOffset={4}
        popupClassName="w-[280px] rounded-xl border-[0.5px] bg-components-panel-bg-blur p-1"
      >
        <DropdownMenuRadioGroup
          value={value}
          onValueChange={onSelected}
        >
          {
            options.map(option => (
              <DropdownMenuRadioItem
                key={option.value}
                value={option.value}
                closeOnClick
                className="h-auto items-start rounded-lg p-2 pr-3"
                onClick={(e) => {
                  e.stopPropagation()
                }}
              >
                <div className="mr-1 w-4 shrink-0">
                  {
                    value === option.value && (
                      <RiCheckLine className="h-4 w-4 text-text-accent" />
                    )
                  }
                </div>
                <div className="grow">
                  <div className="mb-0.5 system-sm-semibold text-text-secondary">{option.label}</div>
                  <div className="system-xs-regular text-text-tertiary">{option.description}</div>
                </div>
              </DropdownMenuRadioItem>
            ))
          }
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

export default ErrorHandleTypeSelector
