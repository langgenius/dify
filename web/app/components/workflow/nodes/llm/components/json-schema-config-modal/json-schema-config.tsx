import type { SchemaRoot } from '../../types'
import { Button } from '@langgenius/dify-ui/button'
import { cn } from '@langgenius/dify-ui/cn'
import { Tabs, TabsList, TabsPanel, TabsTab } from '@langgenius/dify-ui/tabs'
import { toast } from '@langgenius/dify-ui/toast'
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

type SchemaView = 'visualEditor' | 'jsonSchema'

type IconProps = {
  className?: string
}

function TimelineViewIcon({ className }: IconProps) {
  return <span className={cn('i-ri-timeline-view', className)} />
}

function BracesIcon({ className }: IconProps) {
  return <span className={cn('i-ri-braces-line', className)} />
}

const SCHEMA_VIEW_OPTIONS = [
  { Icon: TimelineViewIcon, text: 'Visual Editor', value: 'visualEditor' },
  { Icon: BracesIcon, text: 'JSON Schema', value: 'jsonSchema' },
] satisfies Array<{ Icon: typeof TimelineViewIcon; text: string; value: SchemaView }>

function isSchemaView(value: unknown): value is SchemaView {
  return value === 'visualEditor' || value === 'jsonSchema'
}

const DEFAULT_SCHEMA: SchemaRoot = {
  type: Type.object,
  properties: {},
  required: [],
  additionalProperties: false,
}

function JsonSchemaConfigContent({ defaultSchema, onSave, onClose }: JsonSchemaConfigProps) {
  const { t } = useTranslation()
  const [selectedSchemaView, setSelectedSchemaView] = useState<SchemaView>('visualEditor')
  const [jsonSchema, setJsonSchema] = useState(defaultSchema || DEFAULT_SCHEMA)
  const [json, setJson] = useState(() => JSON.stringify(jsonSchema, null, 2))
  const [btnWidth, setBtnWidth] = useState(0)
  const [parseError, setParseError] = useState<Error | null>(null)
  const [validationError, setValidationError] = useState<string>('')
  const advancedEditing = useVisualEditorStore((state) => state.advancedEditing)
  const setAdvancedEditing = useVisualEditorStore((state) => state.setAdvancedEditing)
  const isAddingNewField = useVisualEditorStore((state) => state.isAddingNewField)
  const setIsAddingNewField = useVisualEditorStore((state) => state.setIsAddingNewField)
  const setHoveringProperty = useVisualEditorStore((state) => state.setHoveringProperty)
  const { emit } = useMittContext()

  function updateBtnWidth(width: number) {
    setBtnWidth(width + 32)
  }

  function handleSchemaViewChange(value: SchemaView) {
    if (selectedSchemaView === value) return true
    if (selectedSchemaView === 'jsonSchema') {
      try {
        const schema = JSON.parse(json)
        setParseError(null)
        const result = preValidateSchema(schema)
        if (!result.success) {
          setValidationError(result.error.message)
          return false
        }
        const schemaDepth = checkJsonSchemaDepth(schema)
        if (schemaDepth > JSON_SCHEMA_MAX_DEPTH) {
          setValidationError(`Schema exceeds maximum depth of ${JSON_SCHEMA_MAX_DEPTH}.`)
          return false
        }
        const validationErrors = validateSchemaAgainstDraft7(schema)
        if (validationErrors.length > 0) {
          setValidationError(getValidationErrorMessage(validationErrors))
          return false
        }
        setJsonSchema(schema)
        setValidationError('')
      } catch (error) {
        setValidationError('')
        if (error instanceof Error) setParseError(error)
        else setParseError(new Error('Invalid JSON'))
        return false
      }
    } else if (selectedSchemaView === 'visualEditor') {
      if (advancedEditing || isAddingNewField)
        emit('quitEditing', {
          callback: (backup: SchemaRoot) => setJson(JSON.stringify(backup || jsonSchema, null, 2)),
        })
      else setJson(JSON.stringify(jsonSchema, null, 2))
    }

    setSelectedSchemaView(value)
    return true
  }

  function handleApplySchema(schema: SchemaRoot) {
    if (selectedSchemaView === 'visualEditor') setJsonSchema(schema)
    else if (selectedSchemaView === 'jsonSchema') setJson(JSON.stringify(schema, null, 2))
  }

  function handleSubmit(schema: Record<string, unknown>) {
    const jsonSchema = jsonToSchema(schema) as SchemaRoot
    if (selectedSchemaView === 'visualEditor') setJsonSchema(jsonSchema)
    else if (selectedSchemaView === 'jsonSchema') setJson(JSON.stringify(jsonSchema, null, 2))
  }

  function handleVisualEditorUpdate(schema: SchemaRoot) {
    setJsonSchema(schema)
  }

  function handleSchemaEditorUpdate(schema: string) {
    setJson(schema)
  }

  function handleResetDefaults() {
    if (selectedSchemaView === 'visualEditor') {
      setHoveringProperty(null)
      if (advancedEditing) setAdvancedEditing(false)
      if (isAddingNewField) setIsAddingNewField(false)
    }
    setJsonSchema(DEFAULT_SCHEMA)
    setJson(JSON.stringify(DEFAULT_SCHEMA, null, 2))
  }

  function handleCancel() {
    onClose()
  }

  function handleSave() {
    let schema = jsonSchema
    if (selectedSchemaView === 'jsonSchema') {
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
      } catch (error) {
        setValidationError('')
        if (error instanceof Error) setParseError(error)
        else setParseError(new Error('Invalid JSON'))
        return
      }
    } else if (selectedSchemaView === 'visualEditor') {
      if (advancedEditing || isAddingNewField) {
        toast.warning(
          t(($) => $['nodes.llm.jsonSchema.warningTips.saveSchema'], { ns: 'workflow' }),
        )
        return
      }
    }
    onSave(schema)
    onClose()
  }

  return (
    <Tabs
      value={selectedSchemaView}
      onValueChange={(value, eventDetails) => {
        if (!isSchemaView(value) || !handleSchemaViewChange(value)) eventDetails.cancel()
      }}
      className="flex h-full flex-col"
    >
      {/* Header */}
      <div className="relative flex p-6 pr-14 pb-3">
        <div className="grow truncate title-2xl-semi-bold text-text-primary">
          {t(($) => $['nodes.llm.jsonSchema.title'], { ns: 'workflow' })}
        </div>
        <button
          type="button"
          className="absolute top-5 right-5 flex size-8 items-center justify-center p-1.5"
          aria-label={t(($) => $['operation.close'], { ns: 'common' })}
          onClick={onClose}
        >
          <span className="i-ri-close-line h-4.5 w-4.5 text-text-tertiary" />
        </button>
      </div>
      <div className="flex items-center justify-between px-6 py-2">
        <TabsList
          aria-label={t(($) => $['nodes.llm.jsonSchema.title'], { ns: 'workflow' })}
          className="inline-flex items-center gap-px rounded-[10px] bg-components-segmented-control-bg-normal p-0.5"
        >
          {SCHEMA_VIEW_OPTIONS.map(({ Icon, text, value }) => (
            <TabsTab
              key={value}
              value={value}
              className="h-7 min-w-0 cursor-default justify-center gap-0.5 overflow-hidden rounded-lg border-[0.5px] border-b-[0.5px] border-transparent px-2 py-1 whitespace-nowrap text-text-secondary transition-colors duration-150 hover:bg-state-base-hover hover:text-text-secondary focus-visible:ring-0 focus-visible:inset-ring-2 focus-visible:inset-ring-state-accent-solid data-active:border-components-segmented-control-item-active-border data-active:bg-components-segmented-control-item-active-bg data-active:text-text-accent-light-mode-only data-active:shadow-xs data-active:shadow-shadow-shadow-3 data-disabled:bg-transparent data-disabled:text-text-disabled data-disabled:shadow-none data-disabled:hover:bg-transparent data-disabled:hover:text-text-disabled motion-reduce:transition-none [&&]:system-sm-medium"
            >
              <Icon className="size-4 shrink-0" />
              <span className="p-0.5">{text}</span>
            </TabsTab>
          ))}
        </TabsList>
        <div className="flex items-center gap-x-0.5">
          {/* JSON Schema Generator */}
          <JsonSchemaGenerator crossAxisOffset={btnWidth} onApply={handleApplySchema} />
          <Divider type="vertical" className="h-3" />
          {/* JSON Schema Importer */}
          <JsonImporter updateBtnWidth={updateBtnWidth} onSubmit={handleSubmit} />
        </div>
      </div>
      <div className="flex grow flex-col overflow-hidden">
        <TabsPanel value="visualEditor" className="flex grow flex-col gap-y-1 overflow-hidden px-6">
          <VisualEditor schema={jsonSchema} onChange={handleVisualEditorUpdate} />
        </TabsPanel>
        <TabsPanel value="jsonSchema" className="flex grow flex-col gap-y-1 overflow-hidden px-6">
          <SchemaEditor schema={json} onUpdate={handleSchemaEditorUpdate} />
          {parseError && <ErrorMessage message={parseError.message} />}
          {validationError && <ErrorMessage message={validationError} />}
        </TabsPanel>
      </div>
      {/* Footer */}
      <div className="flex items-center justify-end gap-x-2 p-6 pt-5">
        <div className="flex items-center gap-x-3">
          <div className="flex items-center gap-x-2">
            <Button variant="secondary" onClick={handleResetDefaults}>
              {t(($) => $['nodes.llm.jsonSchema.resetDefaults'], { ns: 'workflow' })}
            </Button>
            <Divider type="vertical" className="mr-0 ml-1 h-4" />
          </div>
          <div className="flex items-center gap-x-2">
            <Button variant="secondary" onClick={handleCancel}>
              {t(($) => $['operation.cancel'], { ns: 'common' })}
            </Button>
            <Button variant="primary" onClick={handleSave}>
              {t(($) => $['operation.save'], { ns: 'common' })}
            </Button>
          </div>
        </div>
      </div>
    </Tabs>
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
