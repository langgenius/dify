import React, { type FC, useCallback, useState } from 'react'
import { type SchemaRoot, Type } from '../../types'
import { RiBracesLine, RiCloseLine, RiExternalLinkLine, RiTimelineView } from '@remixicon/react'
import { SegmentedControl } from '../../../../../base/segmented-control'
import JsonSchemaGenerator from './json-schema-generator'
import Divider from '@/app/components/base/divider'
import JsonImporter from './json-importer'
import { useTranslation } from 'react-i18next'
import Button from '@/app/components/base/button'
import VisualEditor from './visual-editor'
import SchemaEditor from './schema-editor'
import {
  checkJsonSchemaDepth,
  convertBooleanToString,
  getValidationErrorMessage,
  jsonToSchema,
  preValidateSchema,
  validateSchemaAgainstDraft7,
} from '../../utils'
import { MittProvider, VisualEditorContextProvider, useMittContext } from './visual-editor/context'
import ErrorMessage from './error-message'
import { useVisualEditorStore } from './visual-editor/store'
import Toast from '@/app/components/base/toast'
import { useGetLanguage } from '@/context/i18n'
import { JSON_SCHEMA_MAX_DEPTH } from '@/config'

type JsonSchemaConfigProps = {
  defaultSchema?: SchemaRoot
  onSave: (schema: SchemaRoot) => void
  onClose: () => void
}

enum SchemaView {
  VisualEditor = 'visualEditor',
  JsonSchema = 'jsonSchema',
}

const VIEW_TABS = [
  { Icon: RiTimelineView, text: 'Visual Editor', value: SchemaView.VisualEditor },
  { Icon: RiBracesLine, text: 'JSON Schema', value: SchemaView.JsonSchema },
]

const DEFAULT_SCHEMA: SchemaRoot = {
  type: Type.object,
  properties: {},
  required: [],
  additionalProperties: false,
}

const HELP_DOC_URL = {
  zh_Hans: 'https://docs.dify.ai/zh-hans/guides/workflow/structured-outputs',
  en_US: 'https://docs.dify.ai/en/guides/workflow/structured-outputs',
  ja_JP: 'https://docs.dify.ai/ja-jp/guides/workflow/structured-outputs',
}

type LocaleKey = keyof typeof HELP_DOC_URL

const JsonSchemaConfig: FC<JsonSchemaConfigProps> = ({
  defaultSchema,
  onSave,
  onClose,
}) => {
  const { t } = useTranslation()
  const locale = useGetLanguage() as LocaleKey
  const [currentTab, setCurrentTab] = useState(SchemaView.VisualEditor)
  const [jsonSchema, setJsonSchema] = useState(defaultSchema || DEFAULT_SCHEMA)
  const [json, setJson] = useState(JSON.stringify(jsonSchema, null, 2))
  const [btnWidth, setBtnWidth] = useState(0)
  const [parseError, setParseError] = useState<Error | null>(null)
  const [validationError, setValidationError] = useState<string>('')
  const advancedEditing = useVisualEditorStore(state => state.advancedEditing)
  const setAdvancedEditing = useVisualEditorStore(state => state.setAdvancedEditing)
  const isAddingNewField = useVisualEditorStore(state => state.isAddingNewField)
  const setIsAddingNewField = useVisualEditorStore(state => state.setIsAddingNewField)
  const setHoveringProperty = useVisualEditorStore(state => state.setHoveringProperty)
  const { emit } = useMittContext()

  const updateBtnWidth = useCallback((width: number) => {
    setBtnWidth(width + 32)
  }, [])

  const handleTabChange = useCallback((value: SchemaView) => {
    if (currentTab === value) return
    if (currentTab === SchemaView.JsonSchema) {
      try {
        const schema = JSON.parse(json)
        setParseError(null)
        const result = preValidateSchema(schema)
        if (!result.success) {
          setValidationError(result.error.message)
          return
        }
        const schemaDepth = checkJsonSchemaDepth(schema)
        if (schemaDepth > JSON_SCHEMA_MAX_DEPTH) {
          setValidationError(`Schema exceeds maximum depth of ${JSON_SCHEMA_MAX_DEPTH}.`)
          return
        }
        convertBooleanToString(schema)
        const validationErrors = validateSchemaAgainstDraft7(schema)
        if (validationErrors.length > 0) {
          setValidationError(getValidationErrorMessage(validationErrors))
          return
        }
        setJsonSchema(schema)
        setValidationError('')
      }
      catch (error) {
        setValidationError('')
        if (error instanceof Error)
          setParseError(error)
        else
          setParseError(new Error('Invalid JSON'))
        return
      }
    }
    else if (currentTab === SchemaView.VisualEditor) {
      if (advancedEditing || isAddingNewField)
        emit('quitEditing', { callback: (backup: SchemaRoot) => setJson(JSON.stringify(backup || jsonSchema, null, 2)) })
      else
        setJson(JSON.stringify(jsonSchema, null, 2))
    }

    setCurrentTab(value)
  }, [currentTab, jsonSchema, json, advancedEditing, isAddingNewField, emit])

  const handleApplySchema = useCallback((schema: SchemaRoot) => {
    if (currentTab === SchemaView.VisualEditor)
      setJsonSchema(schema)
    else if (currentTab === SchemaView.JsonSchema)
      setJson(JSON.stringify(schema, null, 2))
  }, [currentTab])

  const handleSubmit = useCallback((schema: any) => {
    const jsonSchema = jsonToSchema(schema) as SchemaRoot
    if (currentTab === SchemaView.VisualEditor)
      setJsonSchema(jsonSchema)
    else if (currentTab === SchemaView.JsonSchema)
      setJson(JSON.stringify(jsonSchema, null, 2))
  }, [currentTab])

  const handleVisualEditorUpdate = useCallback((schema: SchemaRoot) => {
    setJsonSchema(schema)
  }, [])

  const handleSchemaEditorUpdate = useCallback((schema: string) => {
    setJson(schema)
  }, [])

  const handleResetDefaults = useCallback(() => {
    if (currentTab === SchemaView.VisualEditor) {
      setHoveringProperty(null)
      advancedEditing && setAdvancedEditing(false)
      isAddingNewField && setIsAddingNewField(false)
    }
    setJsonSchema(DEFAULT_SCHEMA)
    setJson(JSON.stringify(DEFAULT_SCHEMA, null, 2))
  }, [currentTab, advancedEditing, isAddingNewField, setAdvancedEditing, setIsAddingNewField, setHoveringProperty])

  const handleCancel = useCallback(() => {
    onClose()
  }, [onClose])

  const handleSave = useCallback(() => {
    let schema = jsonSchema
    if (currentTab === SchemaView.JsonSchema) {
      try {
        schema = JSON.parse(json)
        setParseError(null)
        const result = preValidateSchema(schema)
        if (!result.success) {
          setValidationError(result.error.message)
          return
        }
        const schemaDepth = checkJsonSchemaDepth(schema)
        if (schemaDepth > JSON_SCHEMA_MAX_DEPTH) {
          setValidationError(`Schema exceeds maximum depth of ${JSON_SCHEMA_MAX_DEPTH}.`)
          return
        }
        convertBooleanToString(schema)
        const validationErrors = validateSchemaAgainstDraft7(schema)
        if (validationErrors.length > 0) {
          setValidationError(getValidationErrorMessage(validationErrors))
          return
        }
        setJsonSchema(schema)
        setValidationError('')
      }
      catch (error) {
        setValidationError('')
        if (error instanceof Error)
          setParseError(error)
        else
          setParseError(new Error('Invalid JSON'))
        return
      }
    }
    else if (currentTab === SchemaView.VisualEditor) {
      if (advancedEditing || isAddingNewField) {
        Toast.notify({
          type: 'warning',
          message: t('workflow.nodes.llm.jsonSchema.warningTips.saveSchema'),
        })
        return
      }
    }
    onSave(schema)
    onClose()
  }, [currentTab, jsonSchema, json, onSave, onClose, advancedEditing, isAddingNewField, t])

  return (
    <div className='flex h-full flex-col'>
      {/* Header */}
      <div className='relative flex p-6 pb-3 pr-14'>
        <div className='title-2xl-semi-bold grow truncate text-text-primary'>
          {t('workflow.nodes.llm.jsonSchema.title')}
        </div>
        <div className='absolute right-5 top-5 flex h-8 w-8 items-center justify-center p-1.5' onClick={onClose}>
          <RiCloseLine className='h-[18px] w-[18px] text-text-tertiary' />
        </div>
      </div>
      {/* Content */}
      <div className='flex items-center justify-between px-6 py-2'>
        {/* Tab */}
        <SegmentedControl<SchemaView>
          options={VIEW_TABS}
          value={currentTab}
          onChange={handleTabChange}
        />
        <div className='flex items-center gap-x-0.5'>
          {/* JSON Schema Generator */}
          <JsonSchemaGenerator
            crossAxisOffset={btnWidth}
            onApply={handleApplySchema}
          />
          <Divider type='vertical' className='h-3' />
          {/* JSON Schema Importer */}
          <JsonImporter
            updateBtnWidth={updateBtnWidth}
            onSubmit={handleSubmit}
          />
        </div>
      </div>
      <div className='flex grow flex-col gap-y-1 overflow-hidden px-6'>
        {currentTab === SchemaView.VisualEditor && (
          <VisualEditor
            schema={jsonSchema}
            onChange={handleVisualEditorUpdate}
          />
        )}
        {currentTab === SchemaView.JsonSchema && (
          <SchemaEditor
            schema={json}
            onUpdate={handleSchemaEditorUpdate}
          />
        )}
        {parseError && <ErrorMessage message={parseError.message} />}
        {validationError && <ErrorMessage message={validationError} />}
      </div>
      {/* Footer */}
      <div className='flex items-center gap-x-2 p-6 pt-5'>
        <a
          className='flex grow items-center gap-x-1 text-text-accent'
          href={HELP_DOC_URL[locale]}
          target='_blank'
          rel='noopener noreferrer'
        >
          <span className='system-xs-regular'>{t('workflow.nodes.llm.jsonSchema.doc')}</span>
          <RiExternalLinkLine className='h-3 w-3' />
        </a>
        <div className='flex items-center gap-x-3'>
          <div className='flex items-center gap-x-2'>
            <Button variant='secondary' onClick={handleResetDefaults}>
              {t('workflow.nodes.llm.jsonSchema.resetDefaults')}
            </Button>
            <Divider type='vertical' className='ml-1 mr-0 h-4' />
          </div>
          <div className='flex items-center gap-x-2'>
            <Button variant='secondary' onClick={handleCancel}>
              {t('common.operation.cancel')}
            </Button>
            <Button variant='primary' onClick={handleSave}>
              {t('common.operation.save')}
            </Button>
          </div>
        </div>
      </div>
    </div>
  )
}

const JsonSchemaConfigWrapper: FC<JsonSchemaConfigProps> = (props) => {
  return (
    <MittProvider>
      <VisualEditorContextProvider>
        <JsonSchemaConfig {...props} />
      </VisualEditorContextProvider>
    </MittProvider>
  )
}

export default JsonSchemaConfigWrapper
