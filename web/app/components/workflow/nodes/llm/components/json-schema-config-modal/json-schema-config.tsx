import type { SchemaRoot } from '../../types'
import { Button } from '@langgenius/dify-ui/button'
import { cn } from '@langgenius/dify-ui/cn'
import { toast } from '@langgenius/dify-ui/toast'
import { ToggleGroup, ToggleGroupItem } from '@langgenius/dify-ui/toggle-group'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import Divider from '@/app/components/base/divider'
import { JSON_SCHEMA_MAX_DEPTH } from '@/config'
import { Type } from '../../types'
import {
  checkJsonSchemaDepth,
  getValidationErrorMessage,
  jsonToSchema,
  preValidateSchema,
  validateSchemaAgainstDraft7,
} from '../../utils'
import ErrorMessage from './error-message'
import JsonImporter from './json-importer'
import JsonSchemaGenerator from './json-schema-generator'
import SchemaEditor from './schema-editor'
import VisualEditor from './visual-editor'
import { MittProvider, useMittContext, VisualEditorContextProvider } from './visual-editor/context'
import { useVisualEditorStore } from './visual-editor/store'

type JsonSchemaConfigProps = {
  defaultSchema?: SchemaRoot
  onSave: (schema: SchemaRoot) => void
  onClose: () => void
}

enum SchemaView {
  VisualEditor = 'visualEditor',
  JsonSchema = 'jsonSchema',
}

type IconProps = {
  className?: string
}

function TimelineViewIcon({ className }: IconProps) {
  return <span className={cn('i-ri-timeline-view', className)} />
}

function BracesIcon({ className }: IconProps) {
  return <span className={cn('i-ri-braces-line', className)} />
}

const VIEW_TABS = [
  { Icon: TimelineViewIcon, text: 'Visual Editor', value: SchemaView.VisualEditor },
  { Icon: BracesIcon, text: 'JSON Schema', value: SchemaView.JsonSchema },
]

const DEFAULT_SCHEMA: SchemaRoot = {
  type: Type.object,
  properties: {},
  required: [],
  additionalProperties: false,
}

function JsonSchemaConfigContent({
  defaultSchema,
  onSave,
  onClose,
}: JsonSchemaConfigProps) {
  const { t } = useTranslation()
  const [currentTab, setCurrentTab] = useState<readonly SchemaView[]>([SchemaView.VisualEditor])
  const [jsonSchema, setJsonSchema] = useState(defaultSchema || DEFAULT_SCHEMA)
  const [json, setJson] = useState(() => JSON.stringify(jsonSchema, null, 2))
  const [btnWidth, setBtnWidth] = useState(0)
  const [parseError, setParseError] = useState<Error | null>(null)
  const [validationError, setValidationError] = useState<string>('')
  const advancedEditing = useVisualEditorStore(state => state.advancedEditing)
  const setAdvancedEditing = useVisualEditorStore(state => state.setAdvancedEditing)
  const isAddingNewField = useVisualEditorStore(state => state.isAddingNewField)
  const setIsAddingNewField = useVisualEditorStore(state => state.setIsAddingNewField)
  const setHoveringProperty = useVisualEditorStore(state => state.setHoveringProperty)
  const { emit } = useMittContext()
  const selectedTab = currentTab[0] ?? SchemaView.VisualEditor

  function updateBtnWidth(width: number) {
    setBtnWidth(width + 32)
  }

  function handleTabChange(value: SchemaView) {
    if (selectedTab === value)
      return
    if (selectedTab === SchemaView.JsonSchema) {
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
    else if (selectedTab === SchemaView.VisualEditor) {
      if (advancedEditing || isAddingNewField)
        emit('quitEditing', { callback: (backup: SchemaRoot) => setJson(JSON.stringify(backup || jsonSchema, null, 2)) })
      else
        setJson(JSON.stringify(jsonSchema, null, 2))
    }

    setCurrentTab([value])
  }

  function handleApplySchema(schema: SchemaRoot) {
    if (selectedTab === SchemaView.VisualEditor)
      setJsonSchema(schema)
    else if (selectedTab === SchemaView.JsonSchema)
      setJson(JSON.stringify(schema, null, 2))
  }

  function handleSubmit(schema: Record<string, unknown>) {
    const jsonSchema = jsonToSchema(schema) as SchemaRoot
    if (selectedTab === SchemaView.VisualEditor)
      setJsonSchema(jsonSchema)
    else if (selectedTab === SchemaView.JsonSchema)
      setJson(JSON.stringify(jsonSchema, null, 2))
  }

  function handleVisualEditorUpdate(schema: SchemaRoot) {
    setJsonSchema(schema)
  }

  function handleSchemaEditorUpdate(schema: string) {
    setJson(schema)
  }

  function handleResetDefaults() {
    if (selectedTab === SchemaView.VisualEditor) {
      setHoveringProperty(null)
      if (advancedEditing)
        setAdvancedEditing(false)
      if (isAddingNewField)
        setIsAddingNewField(false)
    }
    setJsonSchema(DEFAULT_SCHEMA)
    setJson(JSON.stringify(DEFAULT_SCHEMA, null, 2))
  }

  function handleCancel() {
    onClose()
  }

  function handleSave() {
    let schema = jsonSchema
    if (selectedTab === SchemaView.JsonSchema) {
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
    else if (selectedTab === SchemaView.VisualEditor) {
      if (advancedEditing || isAddingNewField) {
        toast.warning(t('nodes.llm.jsonSchema.warningTips.saveSchema', { ns: 'workflow' }))
        return
      }
    }
    onSave(schema)
    onClose()
  }

  return (
    <div className="flex h-full flex-col">
      {/* Header */}
      <div className="relative flex p-6 pr-14 pb-3">
        <div className="grow truncate title-2xl-semi-bold text-text-primary">
          {t('nodes.llm.jsonSchema.title', { ns: 'workflow' })}
        </div>
        <button
          type="button"
          className="absolute top-5 right-5 flex h-8 w-8 items-center justify-center p-1.5"
          aria-label={t('operation.close', { ns: 'common' })}
          onClick={onClose}
        >
          <span className="i-ri-close-line h-[18px] w-[18px] text-text-tertiary" />
        </button>
      </div>
      {/* Content */}
      <div className="flex items-center justify-between px-6 py-2">
        {/* Tab */}
        <ToggleGroup<SchemaView>
          aria-label={t('nodes.llm.jsonSchema.title', { ns: 'workflow' })}
          value={currentTab}
          onValueChange={(nextTab) => {
            const value = nextTab[0]
            if (value)
              handleTabChange(value)
          }}
        >
          {VIEW_TABS.map(({ Icon, text, value }) => (
            <ToggleGroupItem key={value} value={value}>
              <Icon className="size-4 shrink-0" />
              <span className="p-0.5">{text}</span>
            </ToggleGroupItem>
          ))}
        </ToggleGroup>
        <div className="flex items-center gap-x-0.5">
          {/* JSON Schema Generator */}
          <JsonSchemaGenerator
            crossAxisOffset={btnWidth}
            onApply={handleApplySchema}
          />
          <Divider type="vertical" className="h-3" />
          {/* JSON Schema Importer */}
          <JsonImporter
            updateBtnWidth={updateBtnWidth}
            onSubmit={handleSubmit}
          />
        </div>
      </div>
      <div className="flex grow flex-col gap-y-1 overflow-hidden px-6">
        {selectedTab === SchemaView.VisualEditor && (
          <VisualEditor
            schema={jsonSchema}
            onChange={handleVisualEditorUpdate}
          />
        )}
        {selectedTab === SchemaView.JsonSchema && (
          <SchemaEditor
            schema={json}
            onUpdate={handleSchemaEditorUpdate}
          />
        )}
        {parseError && <ErrorMessage message={parseError.message} />}
        {validationError && <ErrorMessage message={validationError} />}
      </div>
      {/* Footer */}
      <div className="flex items-center justify-end gap-x-2 p-6 pt-5">
        <div className="flex items-center gap-x-3">
          <div className="flex items-center gap-x-2">
            <Button variant="secondary" onClick={handleResetDefaults}>
              {t('nodes.llm.jsonSchema.resetDefaults', { ns: 'workflow' })}
            </Button>
            <Divider type="vertical" className="mr-0 ml-1 h-4" />
          </div>
          <div className="flex items-center gap-x-2">
            <Button variant="secondary" onClick={handleCancel}>
              {t('operation.cancel', { ns: 'common' })}
            </Button>
            <Button variant="primary" onClick={handleSave}>
              {t('operation.save', { ns: 'common' })}
            </Button>
          </div>
        </div>
      </div>
    </div>
  )
}

export function JsonSchemaConfig(props: JsonSchemaConfigProps) {
  return (
    <MittProvider>
      <VisualEditorContextProvider>
        <JsonSchemaConfigContent {...props} />
      </VisualEditorContextProvider>
    </MittProvider>
  )
}
