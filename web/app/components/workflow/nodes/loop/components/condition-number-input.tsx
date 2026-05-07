import type {
  NodeOutPutVar,
  ValueSelector,
} from '@/app/components/workflow/types'
import { Button } from '@langgenius/dify-ui/button'
import { cn } from '@langgenius/dify-ui/cn'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from '@langgenius/dify-ui/dropdown-menu'
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@langgenius/dify-ui/popover'
import { RiArrowDownSLine } from '@remixicon/react'
import { useBoolean } from 'ahooks'
import { capitalize } from 'es-toolkit/string'
import {
  memo,
  useCallback,
  useState,
} from 'react'
import { useTranslation } from 'react-i18next'
import { Variable02 } from '@/app/components/base/icons/src/vender/solid/development'
import VarReferenceVars from '@/app/components/workflow/nodes/_base/components/variable/var-reference-vars'
import { VarType } from '@/app/components/workflow/types'
import { variableTransformer } from '@/app/components/workflow/utils'
import VariableTag from '../../_base/components/variable-tag'
import { VarType as NumberVarType } from '../../tool/types'

const options = [
  NumberVarType.variable,
  NumberVarType.constant,
]

type ConditionNumberInputProps = {
  numberVarType?: NumberVarType
  onNumberVarTypeChange: (v: NumberVarType) => void
  value: string
  onValueChange: (v: string) => void
  variables: NodeOutPutVar[]
  isShort?: boolean
  unit?: string
}
const ConditionNumberInput = ({
  numberVarType = NumberVarType.constant,
  onNumberVarTypeChange,
  value,
  onValueChange,
  variables,
  isShort,
  unit,
}: ConditionNumberInputProps) => {
  const { t } = useTranslation()
  const [numberVarTypeVisible, setNumberVarTypeVisible] = useState(false)
  const [variableSelectorVisible, setVariableSelectorVisible] = useState(false)
  const [isFocus, {
    setTrue: setFocus,
    setFalse: setBlur,
  }] = useBoolean()

  const handleSelectVariable = useCallback((valueSelector: ValueSelector) => {
    onValueChange(variableTransformer(valueSelector) as string)
    setVariableSelectorVisible(false)
  }, [onValueChange])

  return (
    <div className="flex cursor-pointer items-center">
      <DropdownMenu
        open={numberVarTypeVisible}
        onOpenChange={setNumberVarTypeVisible}
      >
        <DropdownMenuTrigger
          render={(
            <Button
              className="shrink-0"
              variant="ghost"
              size="small"
            />
          )}
        >
          {capitalize(numberVarType)}
          <RiArrowDownSLine className="ml-px h-3.5 w-3.5" />
        </DropdownMenuTrigger>
        <DropdownMenuContent
          placement="bottom-start"
          sideOffset={2}
          popupClassName="w-[112px] rounded-xl border-[0.5px] bg-components-panel-bg-blur p-1"
        >
          <DropdownMenuRadioGroup
            value={numberVarType}
            onValueChange={onNumberVarTypeChange}
          >
            {
              options.map(option => (
                <DropdownMenuRadioItem
                  key={option}
                  value={option}
                  closeOnClick
                  className={cn(
                    'h-7 rounded-md px-3',
                    'text-[13px] font-medium text-text-secondary',
                    numberVarType === option && 'bg-state-base-hover',
                  )}
                >
                  {capitalize(option)}
                </DropdownMenuRadioItem>
              ))
            }
          </DropdownMenuRadioGroup>
        </DropdownMenuContent>
      </DropdownMenu>
      <div className="mx-1 h-4 w-px bg-divider-regular"></div>
      <div className="ml-0.5 w-0 grow">
        {
          numberVarType === NumberVarType.variable && (
            <Popover
              open={variableSelectorVisible}
              onOpenChange={setVariableSelectorVisible}
            >
              <PopoverTrigger
                nativeButton={false}
                render={<div className="w-full" />}
              >
                {
                  value && (
                    <VariableTag
                      valueSelector={variableTransformer(value) as string[]}
                      varType={VarType.number}
                      isShort={isShort}
                    />
                  )
                }
                {
                  !value && (
                    <div className="flex h-6 items-center p-1 text-[13px] text-components-input-text-placeholder">
                      <Variable02 className="mr-1 h-4 w-4 shrink-0" />
                      <div className="w-0 grow truncate">{t('nodes.ifElse.selectVariable', { ns: 'workflow' })}</div>
                    </div>
                  )
                }
              </PopoverTrigger>
              <PopoverContent
                placement="bottom-start"
                sideOffset={2}
                popupClassName="border-none bg-transparent shadow-none"
              >
                <div className={cn('w-[296px] rounded-lg border-[0.5px] border-components-panel-border bg-components-panel-bg-blur pt-1 shadow-lg', isShort && 'w-[200px]')}>
                  <VarReferenceVars
                    vars={variables}
                    onChange={handleSelectVariable}
                  />
                </div>
              </PopoverContent>
            </Popover>
          )
        }
        {
          numberVarType === NumberVarType.constant && (
            <div className="relative">
              <input
                className={cn('block w-full appearance-none bg-transparent px-2 text-[13px] text-components-input-text-filled outline-hidden placeholder:text-components-input-text-placeholder', unit && 'pr-6')}
                type="number"
                value={value}
                onChange={e => onValueChange(e.target.value)}
                placeholder={t('nodes.ifElse.enterValue', { ns: 'workflow' }) || ''}
                onFocus={setFocus}
                onBlur={setBlur}
              />
              {!isFocus && unit && <div className="absolute top-[50%] right-2 translate-y-[-50%] system-sm-regular text-text-tertiary">{unit}</div>}
            </div>
          )
        }
      </div>
    </div>
  )
}

export default memo(ConditionNumberInput)
