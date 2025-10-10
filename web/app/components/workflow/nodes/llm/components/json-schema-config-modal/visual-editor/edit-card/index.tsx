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
import { useVisualEditorStore } from '../store'
import { useMittContext } from '../context'
import { useUnmount } from 'ahooks'
import { JSON_SCHEMA_MAX_DEPTH } from '@/config'
import AutoWidthInput from './auto-width-input'

export type EditData = {
  name: string
  type: Type | ArrayType
  required: boolean
  description?: string
  enum?: SchemaEnumType
}

type Options = {
  description?: string
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
  { value: ArrayType.object, text: 'array[object]' },
]

const MAXIMUM_DEPTH_TYPE_OPTIONS = [
  { value: Type.string, text: 'string' },
  { value: Type.number, text: 'number' },
  { value: Type.boolean, text: 'boolean' },
  { value: ArrayType.string, text: 'array[string]' },
  { value: ArrayType.number, text: 'array[number]' },
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
  const isAddingNewField = useVisualEditorStore(state => state.isAddingNewField)
  const setIsAddingNewField = useVisualEditorStore(state => state.setIsAddingNewField)
  const advancedEditing = useVisualEditorStore(state => state.advancedEditing)
  const setAdvancedEditing = useVisualEditorStore(state => state.setAdvancedEditing)
  const { emit, useSubscribe } = useMittContext()
  const blurWithActions = useRef(false)

  const maximumDepthReached = depth === JSON_SCHEMA_MAX_DEPTH
  const disableAddBtn = maximumDepthReached || (currentFields.type !== Type.object && currentFields.type !== ArrayType.object)
  const hasAdvancedOptions = currentFields.type === Type.string || currentFields.type === Type.number
  const isAdvancedEditing = advancedEditing || isAddingNewField

  const advancedOptions = useMemo(() => {
    let enumValue = ''
    if (currentFields.type === Type.string || currentFields.type === Type.number)
      enumValue = (currentFields.enum || []).join(', ')
    return { enum: enumValue }
  }, [currentFields.type, currentFields.enum])

  useSubscribe('restorePropertyName', () => {
    setCurrentFields(prev => ({ ...prev, name: fields.name }))
  })

  useSubscribe('fieldChangeSuccess', () => {
    if (isAddingNewField)
      setIsAddingNewField(false)
    if (advancedEditing)
      setAdvancedEditing(false)
  })

  const emitPropertyNameChange = useCallback(() => {
    emit('propertyNameChange', { path, parentPath, oldFields: fields, fields: currentFields })
  }, [fields, currentFields, path, parentPath, emit])

  const emitPropertyTypeChange = useCallback((type: Type | ArrayType) => {
    emit('propertyTypeChange', { path, parentPath, oldFields: fields, fields: { ...currentFields, type } })
  }, [fields, currentFields, path, parentPath, emit])

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

  const handlePropertyNameBlur = useCallback(() => {
    if (isAdvancedEditing) return
    emitPropertyNameChange()
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

  const handleDescriptionBlur = useCallback(() => {
    if (isAdvancedEditing) return
    emitPropertyOptionsChange({ description: currentFields.description, enum: currentFields.enum })
  }, [isAdvancedEditing, emitPropertyOptionsChange, currentFields])

  const handleAdvancedOptionsChange = useCallback((options: AdvancedOptionsType) => {
    let enumValue: SchemaEnumType | undefined
    if (options.enum === '') {
      enumValue = undefined
    }
    else {
      const stringArray = options.enum.replace(/\s/g, '').split(',')
      if (currentFields.type === Type.number)
        enumValue = stringArray.map(value => Number(value)).filter(num => !Number.isNaN(num))
      else
        enumValue = stringArray
    }
    setCurrentFields(prev => ({ ...prev, enum: enumValue }))
    if (isAdvancedEditing) return
    emitPropertyOptionsChange({ description: currentFields.description, enum: enumValue })
  }, [isAdvancedEditing, emitPropertyOptionsChange, currentFields])

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
    if (isAdvancedEditing || blurWithActions.current) return
    emitFieldChange()
  })

  return (
    <div className='flex flex-col rounded-lg bg-components-panel-bg py-0.5 shadow-sm shadow-shadow-shadow-4'>
      <div className='flex h-6 items-center pl-1 pr-0.5'>
        <div className='flex grow items-center gap-x-1'>
          <AutoWidthInput
            value={currentFields.name}
            placeholder={t('workflow.nodes.llm.jsonSchema.fieldNamePlaceholder')}
            minWidth={80}
            maxWidth={300}
            onChange={handlePropertyNameChange}
            onBlur={handlePropertyNameBlur}
          />
          <TypeSelector
            currentValue={currentFields.type}
            items={maximumDepthReached ? MAXIMUM_DEPTH_TYPE_OPTIONS : TYPE_OPTIONS}
            onSelect={handleTypeChange}
            popupClassName={'z-[1000]'}
          />
          {
            currentFields.required && (
              <div className='system-2xs-medium-uppercase px-1 py-0.5 text-text-warning'>
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

      {(fields.description || isAdvancedEditing) && (
        <div className={classNames('flex', isAdvancedEditing ? 'p-2 pt-1' : 'px-2 pb-1')}>
          <input
            value={currentFields.description}
            className='system-xs-regular placeholder:system-xs-regular h-4 w-full p-0 text-text-tertiary caret-[#295EFF] outline-none placeholder:text-text-placeholder'
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
