import { type FC, useCallback } from 'react'
import { useTranslation } from 'react-i18next'
import cn from 'classnames'
import VarReferencePicker from '../_base/components/variable/var-reference-picker'
import useConfig from './use-config'
import { mockData } from './mock'
import { EndVarType } from './types'
import VarList from '@/app/components/workflow/nodes/_base/components/variable/var-list'
import Field from '@/app/components/workflow/nodes/_base/components/field'
import AddButton from '@/app/components/base/button/add-button'
const i18nPrefix = 'workflow.nodes.end'

const TypeItem = ({ type, current, onClick }: { type: EndVarType; current: EndVarType; onClick: (type: EndVarType) => void }) => {
  const { t } = useTranslation()

  const handleOnClick = useCallback(() => {
    if (type === current)
      return
    onClick(type)
  }, [type, current, onClick])
  return (
    <div
      onClick={handleOnClick}
      className={cn(
        'grow flex items-center h-8 justify-center cursor-pointer rounded-lg bg-gray-25 text-[13px] font-normal text-gray-900',
        type === current ? 'border-[1.5px] border-primary-400' : 'border border-gray-100',
      )}
    >
      {t(`${i18nPrefix}.type.${type}`)}
    </div>
  )
}

const allTypes = [EndVarType.plainText, EndVarType.structured, EndVarType.none]

const Panel: FC = () => {
  const { t } = useTranslation()
  const readOnly = false

  const {
    inputs,
    handleOutputTypeChange,
    handleVarListChange,
    handelPlainTextSelectorChange,
    handleAddVariable,
  } = useConfig(mockData)

  const outputs = inputs.outputs
  return (
    <div className='mt-2'>
      <div className='px-4 pb-4 space-y-4'>
        <Field
          title={t(`${i18nPrefix}.output.type`)}
        >
          <div className='flex space-x-2'>
            {allTypes.map(type => (
              <TypeItem
                key={type}
                type={type}
                current={outputs.type}
                onClick={handleOutputTypeChange}
              />
            ))}
          </div>
        </Field>
        {outputs.type !== EndVarType.none && (
          <Field
            title={t(`${i18nPrefix}.output.variable`)}
            operations={
              outputs.type === EndVarType.structured ? <AddButton onClick={handleAddVariable} /> : undefined
            }
          >
            {outputs.type
              === EndVarType.structured
              ? (
                <VarList
                  readonly={readOnly}
                  list={outputs.structured_variables!}
                  onChange={handleVarListChange}
                />
              )
              : (
                <VarReferencePicker
                  isShowNodeName
                  readonly={readOnly}
                  value={outputs.plain_text_selector!}
                  onChange={handelPlainTextSelectorChange}
                />
              )}

          </Field>
        )}
      </div>
    </div>
  )
}

export default Panel
