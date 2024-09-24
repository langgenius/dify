import {
  memo,
  useCallback,
  useState,
} from 'react'
import { useTranslation } from 'react-i18next'
import { RiArrowDownSLine } from '@remixicon/react'
import { capitalize } from 'lodash-es'
import { useBoolean } from 'ahooks'
import { VarType as NumberVarType } from '../../tool/types'
import VariableTag from '../../_base/components/variable-tag'
import {
  PortalToFollowElem,
  PortalToFollowElemContent,
  PortalToFollowElemTrigger,
} from '@/app/components/base/portal-to-follow-elem'
import Button from '@/app/components/base/button'
import cn from '@/utils/classnames'
import VarReferenceVars from '@/app/components/workflow/nodes/_base/components/variable/var-reference-vars'
import type {
  NodeOutPutVar,
  ValueSelector,
} from '@/app/components/workflow/types'
import { VarType } from '@/app/components/workflow/types'
import { variableTransformer } from '@/app/components/workflow/utils'
import { Variable02 } from '@/app/components/base/icons/src/vender/solid/development'

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
    <div className='flex items-center cursor-pointer'>
      <PortalToFollowElem
        open={numberVarTypeVisible}
        onOpenChange={setNumberVarTypeVisible}
        placement='bottom-start'
        offset={{ mainAxis: 2, crossAxis: 0 }}
      >
        <PortalToFollowElemTrigger onClick={() => setNumberVarTypeVisible(v => !v)}>
          <Button
            className='shrink-0'
            variant='ghost'
            size='small'
          >
            {capitalize(numberVarType)}
            <RiArrowDownSLine className='ml-[1px] w-3.5 h-3.5' />
          </Button>
        </PortalToFollowElemTrigger>
        <PortalToFollowElemContent className='z-[1000]'>
          <div className='p-1 w-[112px] rounded-xl border-[0.5px] border-components-panel-border bg-components-panel-bg-blur shadow-lg'>
            {
              options.map(option => (
                <div
                  key={option}
                  className={cn(
                    'flex items-center px-3 h-7 rounded-md hover:bg-state-base-hover cursor-pointer',
                    'text-[13px] font-medium text-text-secondary',
                    numberVarType === option && 'bg-state-base-hover',
                  )}
                  onClick={() => {
                    onNumberVarTypeChange(option)
                    setNumberVarTypeVisible(false)
                  }}
                >
                  {capitalize(option)}
                </div>
              ))
            }
          </div>
        </PortalToFollowElemContent>
      </PortalToFollowElem>
      <div className='mx-1 w-[1px] h-4 bg-divider-regular'></div>
      <div className='grow w-0 ml-0.5'>
        {
          numberVarType === NumberVarType.variable && (
            <PortalToFollowElem
              open={variableSelectorVisible}
              onOpenChange={setVariableSelectorVisible}
              placement='bottom-start'
              offset={{ mainAxis: 2, crossAxis: 0 }}
            >
              <PortalToFollowElemTrigger
                className='w-full'
                onClick={() => setVariableSelectorVisible(v => !v)}>
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
                    <div className='flex items-center p-1 h-6 text-components-input-text-placeholder text-[13px]'>
                      <Variable02 className='shrink-0 mr-1 w-4 h-4' />
                      <div className='w-0 grow truncate'>{t('workflow.nodes.ifElse.selectVariable')}</div>
                    </div>
                  )
                }
              </PortalToFollowElemTrigger>
              <PortalToFollowElemContent className='z-[1000]'>
                <div className={cn('w-[296px] pt-1 bg-components-panel-bg-blur rounded-lg border-[0.5px] border-components-panel-border shadow-lg', isShort && 'w-[200px]')}>
                  <VarReferenceVars
                    vars={variables}
                    onChange={handleSelectVariable}
                  />
                </div>
              </PortalToFollowElemContent>
            </PortalToFollowElem>
          )
        }
        {
          numberVarType === NumberVarType.constant && (
            <div className=' relative'>
              <input
                className={cn('block w-full px-2 text-[13px] text-components-input-text-filled placeholder:text-components-input-text-placeholder outline-none appearance-none bg-transparent', unit && 'pr-6')}
                type='number'
                value={value}
                onChange={e => onValueChange(e.target.value)}
                placeholder={t('workflow.nodes.ifElse.enterValue') || ''}
                onFocus={setFocus}
                onBlur={setBlur}
              />
              {!isFocus && unit && <div className='absolute right-2 top-[50%] translate-y-[-50%] text-text-tertiary system-sm-regular'>{unit}</div>}
            </div>
          )
        }
      </div>
    </div>
  )
}

export default memo(ConditionNumberInput)
