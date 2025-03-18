import React, { type FC, useCallback, useMemo, useRef, useState } from 'react'
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
import classNames from '@/utils/classnames'
import { useJsonSchemaConfigStore } from '../../store'
import { useMittContext } from '../../context'
import produce from 'immer'
import { useUnmount } from 'ahooks'
import { JSON_SCHEMA_MAX_DEPTH } from '@/config'

export type EditData = {
  name: string
  type: Type | ArrayType
  required: boolean
  description: string
  enum?: SchemaEnumType
}

type Options = {
  description: string
  enum?: SchemaEnumType
}

type EditCardProps = {
  fields: EditData
  depth: number
  path: string[]
  parentPath: string[]
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
  depth,
  path,
  parentPath,
}) => {
  const { t } = useTranslation()
  const [currentFields, setCurrentFields] = useState(fields)
  const [backupFields, setBackupFields] = useState<EditData | null>(null)
  const isAddingNewField = useJsonSchemaConfigStore(state => state.isAddingNewField)
  const setIsAddingNewField = useJsonSchemaConfigStore(state => state.setIsAddingNewField)
  const advancedEditing = useJsonSchemaConfigStore(state => state.advancedEditing)
  const setAdvancedEditing = useJsonSchemaConfigStore(state => state.setAdvancedEditing)
  const { emit, useSubscribe } = useMittContext()
  const blurWithActions = useRef(false)

  const disableAddBtn = depth >= JSON_SCHEMA_MAX_DEPTH || (fields.type !== Type.object && fields.type !== ArrayType.object)
  const hasAdvancedOptions = fields.type === Type.string || fields.type === Type.number
  const isAdvancedEditing = advancedEditing || isAddingNewField

  const advancedOptions = useMemo(() => {
    return { enum: (currentFields.enum || []).join(', ') }
  }, [currentFields.enum])

  useSubscribe('restorePropertyName', () => {
    setCurrentFields(prev => ({ ...prev, name: fields.name }))
  })

  useSubscribe('fieldChangeSuccess', () => {
    if (isAddingNewField) {
      setIsAddingNewField(false)
      return
    }
    setAdvancedEditing(false)
  })

  const emitPropertyNameChange = useCallback((name: string) => {
    const newFields = produce(fields, (draft) => {
      draft.name = name
    })
    emit('propertyNameChange', { path, parentPath, oldFields: fields, fields: newFields })
  }, [fields, path, parentPath, emit])

  const emitPropertyTypeChange = useCallback((type: Type | ArrayType) => {
    const newFields = produce(fields, (draft) => {
      draft.type = type
    })
    emit('propertyTypeChange', { path, parentPath, oldFields: fields, fields: newFields })
  }, [fields, path, parentPath, emit])

  const emitPropertyRequiredToggle = useCallback(() => {
    emit('propertyRequiredToggle', { path, parentPath, oldFields: fields, fields: currentFields })
  }, [emit, path, parentPath, fields, currentFields])

  const emitPropertyOptionsChange = useCallback((options: Options) => {
    emit('propertyOptionsChange', { path, parentPath, oldFields: fields, fields: { ...currentFields, ...options } })
  }, [emit, path, parentPath, fields, currentFields])

  const emitPropertyDelete = useCallback(() => {
    emit('propertyDelete', { path, parentPath, oldFields: fields, fields: currentFields })
  }, [emit, path, parentPath, fields, currentFields])

  const emitPropertyAdd = useCallback(() => {
    emit('addField', { path })
  }, [emit, path])

  const emitFieldChange = useCallback(() => {
    emit('fieldChange', { path, parentPath, oldFields: fields, fields: currentFields })
  }, [emit, path, parentPath, fields, currentFields])

  const handlePropertyNameChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    setCurrentFields(prev => ({ ...prev, name: e.target.value }))
  }, [])

  const handlePropertyNameBlur = useCallback((e: React.FocusEvent<HTMLInputElement>) => {
    if (isAdvancedEditing) return
    emitPropertyNameChange(e.target.value)
  }, [isAdvancedEditing, emitPropertyNameChange])

  const handleTypeChange = useCallback((item: TypeItem) => {
    setCurrentFields(prev => ({ ...prev, type: item.value }))
    if (isAdvancedEditing) return
    emitPropertyTypeChange(item.value)
  }, [isAdvancedEditing, emitPropertyTypeChange])

  const toggleRequired = useCallback(() => {
    setCurrentFields(prev => ({ ...prev, required: !prev.required }))
    if (isAdvancedEditing) return
    emitPropertyRequiredToggle()
  }, [isAdvancedEditing, emitPropertyRequiredToggle])

  const handleDescriptionChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    setCurrentFields(prev => ({ ...prev, description: e.target.value }))
  }, [])

  const handleDescriptionBlur = useCallback((e: React.FocusEvent<HTMLInputElement>) => {
    if (isAdvancedEditing) return
    emitPropertyOptionsChange({ description: e.target.value, enum: fields.enum })
  }, [isAdvancedEditing, emitPropertyOptionsChange, fields])

  const handleAdvancedOptionsChange = useCallback((options: AdvancedOptionsType) => {
    if (isAdvancedEditing) return
    const enumValue = options.enum.replace(' ', '').split(',')
    emitPropertyOptionsChange({ description: fields.description, enum: enumValue })
  }, [isAdvancedEditing, emitPropertyOptionsChange, fields])

  const handleDelete = useCallback(() => {
    blurWithActions.current = true
    emitPropertyDelete()
  }, [emitPropertyDelete])

  const handleAdvancedEdit = useCallback(() => {
    setBackupFields({ ...currentFields })
    setAdvancedEditing(true)
  }, [currentFields, setAdvancedEditing])

  const handleAddChildField = useCallback(() => {
    blurWithActions.current = true
    emitPropertyAdd()
  }, [emitPropertyAdd])

  const handleConfirm = useCallback(() => {
    emitFieldChange()
  }, [emitFieldChange])

  const handleCancel = useCallback(() => {
    if (isAddingNewField) {
      blurWithActions.current = true
      emit('restoreSchema')
      setIsAddingNewField(false)
      return
    }
    if (backupFields) {
      setCurrentFields(backupFields)
      setBackupFields(null)
    }
    setAdvancedEditing(false)
  }, [isAddingNewField, emit, setIsAddingNewField, setAdvancedEditing, backupFields])

  useUnmount(() => {
    if (isAdvancedEditing || isAddingNewField || blurWithActions.current) return
    emitFieldChange()
  })

  return (
    <div className='flex flex-col py-0.5 rounded-lg bg-components-panel-bg shadow-sm shadow-shadow-shadow-4'>
      <div className='flex items-center pl-1 pr-0.5'>
        <div className='flex items-center gap-x-1 grow'>
          <input
            value={currentFields.name}
            className='max-w-20 h-5 rounded-[5px] px-1 py-0.5 text-text-primary system-sm-semibold placeholder:text-text-placeholder
              placeholder:system-sm-semibold hover:bg-state-base-hover border border-transparent focus:border-components-input-border-active
              focus:bg-components-input-bg-active focus:shadow-xs shadow-shadow-shadow-3 caret-[#295EFF] outline-none'
            placeholder={t('workflow.nodes.llm.jsonSchema.fieldNamePlaceholder')}
            onChange={handlePropertyNameChange}
            onBlur={handlePropertyNameBlur}
            onKeyUp={e => e.key === 'Enter' && e.currentTarget.blur()}
          />
          <TypeSelector
            currentValue={currentFields.type}
            items={TYPE_OPTIONS}
            onSelect={handleTypeChange}
            popupClassName={'z-[1000]'}
          />
          {
            currentFields.required && (
              <div className='px-1 py-0.5 text-text-warning system-2xs-medium-uppercase'>
                {t('workflow.nodes.llm.jsonSchema.required')}
              </div>
            )
          }
        </div>
        <RequiredSwitch
          defaultValue={currentFields.required}
          toggleRequired={toggleRequired}
        />
        <Divider type='vertical' className='h-3' />
        {isAdvancedEditing ? (
          <AdvancedActions
            isConfirmDisabled={currentFields.name === ''}
            onCancel={handleCancel}
            onConfirm={handleConfirm}
          />
        ) : (
          <Actions
            disableAddBtn={disableAddBtn}
            onAddChildField={handleAddChildField}
            onDelete={handleDelete}
            onEdit={handleAdvancedEdit}
          />
        )}
      </div>

      {(currentFields.description || isAdvancedEditing) && (
        <div className={classNames('flex', isAdvancedEditing ? 'p-2 pt-1' : 'px-2 pb-1')}>
          <input
            value={currentFields.description}
            className='w-full h-4 p-0 text-text-tertiary system-xs-regular placeholder:text-text-placeholder placeholder:system-xs-regular caret-[#295EFF] outline-none'
            placeholder={t('workflow.nodes.llm.jsonSchema.descriptionPlaceholder')}
            onChange={handleDescriptionChange}
            onBlur={handleDescriptionBlur}
            onKeyUp={e => e.key === 'Enter' && e.currentTarget.blur()}
          />
        </div>
      )}

      {isAdvancedEditing && hasAdvancedOptions && (
        <AdvancedOptions
          options={advancedOptions}
          onChange={handleAdvancedOptionsChange}
        />
      )}
    </div>
  )
}

export default EditCard
