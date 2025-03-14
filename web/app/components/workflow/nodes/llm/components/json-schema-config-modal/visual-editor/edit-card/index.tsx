import React, { type FC, useCallback, useMemo, useState } from 'react'
import type { SchemaEnumType } from '../../../../types'
import { ArrayType, Type } from '../../../../types'
import type { TypeItem } from './type-selector'
import TypeSelector from './type-selector'
import RequiredSwitch from './required-switch'
import Divider from '@/app/components/base/divider'
import Actions from './actions'
import AdvancedActions from './advanced-actions'
import AdvancedOptions, { type AdvancedOptionsType } from './advanced-options'
import { useTranslation } from 'react-i18next'
import { useUnmount } from 'ahooks'
import classNames from '@/utils/classnames'

export type EditData = {
  name: string
  type: Type | ArrayType
  required: boolean
  description: string
  enum?: SchemaEnumType
}

type EditCardProps = {
  fields: EditData
  onPropertyNameChange: (name: string) => void
  onTypeChange: (type: Type | ArrayType) => void
  onRequiredChange: (name: string) => void
  onDescriptionChange: (description: string) => void
  onAdvancedOptionsChange: (options: AdvancedOptionsType) => void
  onDelete: (name: string) => void
  onCancel: () => void
}

const TYPE_OPTIONS = [
  { value: Type.string, text: 'string' },
  { value: Type.number, text: 'number' },
  { value: Type.boolean, text: 'boolean' },
  { value: Type.object, text: 'object' },
  { value: ArrayType.string, text: 'array[string]' },
  { value: ArrayType.number, text: 'array[number]' },
  { value: ArrayType.boolean, text: 'array[boolean]' },
  { value: ArrayType.object, text: 'array[object]' },
]

const EditCard: FC<EditCardProps> = ({
  fields,
  onPropertyNameChange,
  onTypeChange,
  onRequiredChange,
  onDescriptionChange,
  onAdvancedOptionsChange,
  onDelete,
  onCancel,
}) => {
  const { t } = useTranslation()
  const [propertyName, setPropertyName] = useState(fields.name)
  const [description, setDescription] = useState(fields.description)
  const [AdvancedEditing, setAdvancedEditing] = useState(!fields)

  const handlePropertyNameChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    setPropertyName(e.target.value)
  }, [])

  const handlePropertyNameBlur = useCallback((e: React.FocusEvent<HTMLInputElement>) => {
    onPropertyNameChange(e.target.value)
  }, [onPropertyNameChange])

  const handleTypeChange = useCallback((item: TypeItem) => {
    onTypeChange(item.value)
  }, [onTypeChange])

  const toggleRequired = useCallback(() => {
    onRequiredChange(propertyName)
  }, [onRequiredChange, propertyName])

  const handleDescriptionChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    setDescription(e.target.value)
  }, [])

  const handleDescriptionBlur = useCallback((e: React.FocusEvent<HTMLInputElement>) => {
    onDescriptionChange(e.target.value)
  }, [onDescriptionChange])

  const advancedOptions = useMemo(() => {
    return { enum: (fields.enum || []).join(', ') }
  }, [fields.enum])

  const handleAdvancedOptionsChange = useCallback((options: AdvancedOptionsType) => {
    onAdvancedOptionsChange(options)
  }, [onAdvancedOptionsChange])

  const handleConfirm = useCallback(() => {
    setAdvancedEditing(false)
  }, [])

  const handleDelete = useCallback(() => {
    onDelete(propertyName)
  }, [onDelete, propertyName])

  const handleEdit = useCallback(() => {
    setAdvancedEditing(true)
  }, [])

  useUnmount(() => {
    onPropertyNameChange(propertyName)
  })

  const disableAddBtn = fields.type !== Type.object && fields.type !== ArrayType.object
  const hasAdvancedOptions = fields.type === Type.string || fields.type === Type.number

  return (
    <div className='flex flex-col py-0.5 rounded-lg bg-components-panel-bg shadow-sm shadow-shadow-shadow-4'>
      <div className='flex items-center pl-1 pr-0.5'>
        <div className='flex items-center gap-x-1 grow'>
          <input
            value={propertyName}
            className='max-w-20 h-5 rounded-[5px] px-1 py-0.5 text-text-primary system-sm-semibold placeholder:text-text-placeholder
            placeholder:system-sm-semibold hover:bg-state-base-hover border border-transparent focus:border-components-input-border-active
            focus:bg-components-input-bg-active focus:shadow-xs shadow-shadow-shadow-3 caret-[#295EFF] outline-none'
            placeholder={t('workflow.nodes.llm.jsonSchema.fieldNamePlaceholder')}
            onChange={handlePropertyNameChange}
            onBlur={handlePropertyNameBlur}
          />
          <TypeSelector
            currentValue={fields.type}
            items={TYPE_OPTIONS}
            onSelect={handleTypeChange}
            popupClassName={'z-[1000]'}
          />
          {
            fields.required && (
              <div className='px-1 py-0.5 text-text-warning system-2xs-medium-uppercase'>
                {t('workflow.nodes.llm.jsonSchema.required')}
              </div>
            )
          }
        </div>
        <RequiredSwitch
          defaultValue={fields.required}
          toggleRequired={toggleRequired}
        />
        <Divider type='vertical' className='h-3' />
        {AdvancedEditing ? (
          <AdvancedActions
            onCancel={() => { }}
            onConfirm={handleConfirm}
          />
        ) : (
          <Actions
            disableAddBtn={disableAddBtn}
            onAddChildField={() => { }}
            onDelete={handleDelete}
            onEdit={handleEdit}/>
        )}
      </div>

      {(description || AdvancedEditing) && (
        <div className={classNames(AdvancedEditing ? 'p-2 pt-1' : 'px-2 pb-1')}>
          <input
            value={description}
            className='w-full h-4 p-0 text-text-tertiary system-xs-regular placeholder:text-text-placeholder placeholder:system-xs-regular caret-[#295EFF] outline-none'
            placeholder={t('workflow.nodes.llm.jsonSchema.descriptionPlaceholder')}
            onChange={handleDescriptionChange}
            onBlur={handleDescriptionBlur}
          />
        </div>
      )}

      {AdvancedEditing && hasAdvancedOptions && (
        <AdvancedOptions
          options={advancedOptions}
          onChange={handleAdvancedOptionsChange}
        />
      )}
    </div>
  )
}

export default EditCard
