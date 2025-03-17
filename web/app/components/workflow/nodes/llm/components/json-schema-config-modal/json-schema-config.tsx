import React, { type FC, useCallback, useState } from 'react'
import { ArrayType, type Field, type SchemaRoot, Type } from '../../types'
import { RiBracesLine, RiCloseLine, RiExternalLinkLine, RiTimelineView } from '@remixicon/react'
import { SegmentedControl } from '../../../../../base/segmented-control'
import JsonSchemaGenerator from './json-schema-generator'
import Divider from '@/app/components/base/divider'
import JsonImporter from './json-importer'
import { useTranslation } from 'react-i18next'
import Button from '@/app/components/base/button'
import VisualEditor from './visual-editor'
import SchemaEditor from './schema-editor'
import { useJsonSchemaConfigStore } from './store'
import { useMittContext } from './context'
import type { EditData } from './visual-editor/edit-card'
import produce from 'immer'
import Toast from '@/app/components/base/toast'

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

type ChangeEventParams = {
  path: string[],
  parentPath: string[],
  oldFields: EditData,
  fields: EditData,
}

type AddEventParams = {
  path: string[]
}

const findPropertyWithPath = (target: any, path: string[]) => {
  let current = target
  for (const key of path)
    current = current[key]
  return current
}

const JsonSchemaConfig: FC<JsonSchemaConfigProps> = ({
  defaultSchema,
  onSave,
  onClose,
}) => {
  const { t } = useTranslation()
  const backupSchema = useJsonSchemaConfigStore(state => state.backupSchema)
  const setBackupSchema = useJsonSchemaConfigStore(state => state.setBackupSchema)
  const setIsAddingNewField = useJsonSchemaConfigStore(state => state.setIsAddingNewField)
  const setHoveringProperty = useJsonSchemaConfigStore(state => state.setHoveringProperty)
  const { emit, useSubscribe } = useMittContext()
  const [currentTab, setCurrentTab] = useState(SchemaView.VisualEditor)
  const [jsonSchema, setJsonSchema] = useState(defaultSchema || DEFAULT_SCHEMA)
  const [json, setJson] = useState(JSON.stringify(jsonSchema, null, 2))
  const [btnWidth, setBtnWidth] = useState(0)

  useSubscribe('restoreSchema', () => {
    if (backupSchema) {
      setJsonSchema(backupSchema)
      setBackupSchema(null)
    }
  })

  useSubscribe('propertyNameChange', (params) => {
    const { parentPath, oldFields, fields } = params as ChangeEventParams
    const { name: oldName } = oldFields
    const { name: newName } = fields
    const newSchema = produce(jsonSchema, (draft) => {
      if (oldName === newName) return
      const schema = findPropertyWithPath(draft, parentPath) as Field

      if (schema.type === Type.object) {
        const properties = schema.properties || {}
        if (properties[newName]) {
          Toast.notify({
            type: 'error',
            message: 'Property name already exists',
          })
          emit('restorePropertyName')
          return
        }

        const newProperties = Object.entries(properties).reduce((acc, [key, value]) => {
          acc[key === oldName ? newName : key] = value
          return acc
        }, {} as Record<string, Field>)

        const required = schema.required || []
        const newRequired = produce(required, (draft) => {
          const index = draft.indexOf(oldName)
          if (index !== -1)
            draft.splice(index, 1, newName)
        })

        schema.properties = newProperties
        schema.required = newRequired
      }

      if (schema.type === Type.array && schema.items && schema.items.type === Type.object) {
        const properties = schema.items.properties || {}
        if (properties[newName]) {
          Toast.notify({
            type: 'error',
            message: 'Property name already exists',
          })
          emit('restorePropertyName')
          return
        }

        const newProperties = Object.entries(properties).reduce((acc, [key, value]) => {
          acc[key === oldName ? newName : key] = value
          return acc
        }, {} as Record<string, Field>)
        const required = schema.items.required || []
        const newRequired = produce(required, (draft) => {
          const index = draft.indexOf(oldName)
          if (index !== -1)
            draft.splice(index, 1, newName)
        })

        schema.items.properties = newProperties
        schema.items.required = newRequired
      }
    })
    setJsonSchema(newSchema)
  })

  useSubscribe('propertyTypeChange', (params) => {
    const { path, oldFields, fields } = params as ChangeEventParams
    const { type: oldType } = oldFields
    const { type: newType } = fields
    if (oldType === newType) return
    const newSchema = produce(jsonSchema, (draft) => {
      const schema = findPropertyWithPath(draft, path) as Field

      if (schema.type === Type.object) {
        delete schema.properties
        delete schema.required
      }
      if (schema.type === Type.array)
        delete schema.items
      switch (newType) {
        case Type.object:
          schema.type = Type.object
          schema.properties = {}
          schema.required = []
          break
        case ArrayType.string:
          schema.type = Type.array
          schema.items = {
            type: Type.string,
          }
          break
        case ArrayType.number:
          schema.type = Type.array
          schema.items = {
            type: Type.number,
          }
          break
        case ArrayType.boolean:
          schema.type = Type.array
          schema.items = {
            type: Type.boolean,
          }
          break
        case ArrayType.object:
          schema.type = Type.array
          schema.items = {
            type: Type.object,
            properties: {},
            required: [],
          }
          break
        default:
          schema.type = newType as Type
      }
    })
    setJsonSchema(newSchema)
  })

  useSubscribe('propertyRequiredToggle', (params) => {
    const { parentPath, fields } = params as ChangeEventParams
    const { name } = fields
    const newSchema = produce(jsonSchema, (draft) => {
      const schema = findPropertyWithPath(draft, parentPath) as Field

      if (schema.type === Type.object) {
        const required = schema.required || []
        const newRequired = required.includes(name)
          ? required.filter(item => item !== name)
          : [...required, name]
        schema.required = newRequired
      }
      if (schema.type === Type.array && schema.items && schema.items.type === Type.object) {
        const required = schema.items.required || []
        const newRequired = required.includes(name)
          ? required.filter(item => item !== name)
          : [...required, name]
        schema.items.required = newRequired
      }
    })
    setJsonSchema(newSchema)
  })

  useSubscribe('propertyOptionsChange', (params) => {
    const { path, fields } = params as ChangeEventParams
    const newSchema = produce(jsonSchema, (draft) => {
      const schema = findPropertyWithPath(draft, path) as Field
      schema.description = fields.description
      schema.enum = fields.enum
    })
    setJsonSchema(newSchema)
  })

  useSubscribe('propertyDelete', (params) => {
    const { parentPath, fields } = params as ChangeEventParams
    const { name } = fields
    const newSchema = produce(jsonSchema, (draft) => {
      const schema = findPropertyWithPath(draft, parentPath) as Field
      if (schema.type === Type.object && schema.properties) {
        delete schema.properties[name]
        schema.required = schema.required?.filter(item => item !== name)
      }
      if (schema.type === Type.array && schema.items?.properties && schema.items?.type === Type.object) {
        delete schema.items.properties[name]
        schema.items.required = schema.items.required?.filter(item => item !== name)
      }
    })
    setJsonSchema(newSchema)
  })

  useSubscribe('addField', (params) => {
    setBackupSchema(jsonSchema)
    const { path } = params as AddEventParams
    setIsAddingNewField(true)
    const newSchema = produce(jsonSchema, (draft) => {
      const schema = findPropertyWithPath(draft, path) as Field
      if (schema.type === Type.object) {
        schema.properties = {
          ...(schema.properties || {}),
          '': {
            type: Type.string,
            description: '',
            enum: [],
          },
        }
        setHoveringProperty([...path, 'properties', ''].join('.'))
      }
      if (schema.type === Type.array && schema.items && schema.items.type === Type.object) {
        schema.items.properties = {
          ...(schema.items.properties || {}),
          '': {
            type: Type.string,
            description: '',
            enum: [],
          },
        }
        setHoveringProperty([...path, 'items', 'properties', ''].join('.'))
      }
    })
    setJsonSchema(newSchema)
  })

  useSubscribe('fieldChange', (params) => {
    const { parentPath, oldFields, fields } = params as ChangeEventParams
    const newSchema = produce(jsonSchema, (draft) => {
      const parentSchema = findPropertyWithPath(draft, parentPath) as Field
      const { name: oldName, type: oldType, required: oldRequired } = oldFields
      const { name: newName, type: newType, required: newRequired } = fields
      if (parentSchema.type === Type.object && parentSchema.properties) {
        // name change
        if (oldName !== newName) {
          const properties = parentSchema.properties
          if (properties[newName]) {
            Toast.notify({
              type: 'error',
              message: 'Property name already exists',
            })
            return
          }

          const newProperties = Object.entries(properties).reduce((acc, [key, value]) => {
            acc[key === oldName ? newName : key] = value
            return acc
          }, {} as Record<string, Field>)

          const requiredProperties = parentSchema.required || []
          const newRequiredProperties = produce(requiredProperties, (draft) => {
            const index = draft.indexOf(oldName)
            if (index !== -1)
              draft.splice(index, 1, newName)
          })

          parentSchema.properties = newProperties
          parentSchema.required = newRequiredProperties
        }

        // required change
        if (oldRequired !== newRequired) {
          const required = parentSchema.required || []
          const newRequired = required.includes(newName)
            ? required.filter(item => item !== newName)
            : [...required, newName]
          parentSchema.required = newRequired
        }

        const schema = parentSchema.properties[newName]

        // type change
        if (oldType !== newType) {
          if (schema.type === Type.object) {
            delete schema.properties
            delete schema.required
          }
          if (schema.type === Type.array)
            delete schema.items
          switch (newType) {
            case Type.object:
              schema.type = Type.object
              schema.properties = {}
              schema.required = []
              break
            case ArrayType.string:
              schema.type = Type.array
              schema.items = {
                type: Type.string,
              }
              break
            case ArrayType.number:
              schema.type = Type.array
              schema.items = {
                type: Type.number,
              }
              break
            case ArrayType.boolean:
              schema.type = Type.array
              schema.items = {
                type: Type.boolean,
              }
              break
            case ArrayType.object:
              schema.type = Type.array
              schema.items = {
                type: Type.object,
                properties: {},
                required: [],
              }
              break
            default:
              schema.type = newType as Type
          }
        }

        // other options change
        schema.description = fields.description
        schema.enum = fields.enum
      }

      if (parentSchema.type === Type.array && parentSchema.items && parentSchema.items.type === Type.object && parentSchema.items.properties) {
        // name change
        if (oldName !== newName) {
          const properties = parentSchema.items.properties || {}
          if (properties[newName]) {
            Toast.notify({
              type: 'error',
              message: 'Property name already exists',
            })
            emit('restorePropertyName')
            return
          }

          const newProperties = Object.entries(properties).reduce((acc, [key, value]) => {
            acc[key === oldName ? newName : key] = value
            return acc
          }, {} as Record<string, Field>)
          const required = parentSchema.items.required || []
          const newRequired = produce(required, (draft) => {
            const index = draft.indexOf(oldName)
            if (index !== -1)
              draft.splice(index, 1, newName)
          })

          parentSchema.items.properties = newProperties
          parentSchema.items.required = newRequired
        }

        // required change
        if (oldRequired !== newRequired) {
          const required = parentSchema.items.required || []
          const newRequired = required.includes(newName)
            ? required.filter(item => item !== newName)
            : [...required, newName]
          parentSchema.items.required = newRequired
        }

        const schema = parentSchema.items.properties[newName]
        // type change
        if (oldType !== newType) {
          if (schema.type === Type.object) {
            delete schema.properties
            delete schema.required
          }
          if (schema.type === Type.array)
            delete schema.items
          switch (newType) {
            case Type.object:
              schema.type = Type.object
              schema.properties = {}
              schema.required = []
              break
            case ArrayType.string:
              schema.type = Type.array
              schema.items = {
                type: Type.string,
              }
              break
            case ArrayType.number:
              schema.type = Type.array
              schema.items = {
                type: Type.number,
              }
              break
            case ArrayType.boolean:
              schema.type = Type.array
              schema.items = {
                type: Type.boolean,
              }
              break
            case ArrayType.object:
              schema.type = Type.array
              schema.items = {
                type: Type.object,
                properties: {},
                required: [],
              }
              break
            default:
              schema.type = newType as Type
          }
        }

        // other options change
        schema.description = fields.description
        schema.enum = fields.enum
      }
    })
    setJsonSchema(newSchema)
    emit('fieldChangeSuccess')
  })

  const updateBtnWidth = useCallback((width: number) => {
    setBtnWidth(width + 32)
  }, [])

  const handleApplySchema = useCallback(() => {}, [])

  const handleSubmit = useCallback(() => {}, [])

  const handleSchemaEditorUpdate = useCallback((schema: string) => {
    setJson(schema)
  }, [])

  const handleResetDefaults = useCallback(() => {
    setJsonSchema(defaultSchema || DEFAULT_SCHEMA)
  }, [defaultSchema])

  const handleCancel = useCallback(() => {
    onClose()
  }, [onClose])

  const handleSave = useCallback(() => {
    onSave(jsonSchema)
    onClose()
  }, [jsonSchema, onSave, onClose])

  return (
    <div className='flex flex-col h-full'>
      {/* Header */}
      <div className='relative flex p-6 pr-14 pb-3'>
        <div className='text-text-primary title-2xl-semi-bold grow truncate'>
          {t('workflow.nodes.llm.jsonSchema.title')}
        </div>
        <div className='absolute right-5 top-5 w-8 h-8 flex justify-center items-center p-1.5' onClick={onClose}>
          <RiCloseLine className='w-[18px] h-[18px] text-text-tertiary' />
        </div>
      </div>
      {/* Content */}
      <div className='flex items-center justify-between px-6 py-2'>
        {/* Tab */}
        <SegmentedControl<SchemaView>
          options={VIEW_TABS}
          value={currentTab}
          onChange={(value: SchemaView) => {
            setCurrentTab(value)
          }}
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
      <div className='px-6 grow overflow-hidden'>
        {currentTab === SchemaView.VisualEditor && (
          <VisualEditor schema={jsonSchema} />
        )}
        {currentTab === SchemaView.JsonSchema && (
          <SchemaEditor
            schema={json}
            onUpdate={handleSchemaEditorUpdate}
          />
        )}
      </div>
      {/* Footer */}
      <div className='flex items-center p-6 pt-5 gap-x-2'>
        <a
          className='flex items-center gap-x-1 grow text-text-accent'
          href='https://json-schema.org/'
          target='_blank'
          rel='noopener noreferrer'
        >
          <span className='system-xs-regular'>{t('workflow.nodes.llm.jsonSchema.doc')}</span>
          <RiExternalLinkLine className='w-3 h-3' />
        </a>
        <div className='flex items-center gap-x-3'>
          <div className='flex items-center gap-x-2'>
            <Button variant='secondary' onClick={handleResetDefaults}>
              {t('workflow.nodes.llm.jsonSchema.resetDefaults')}
            </Button>
            <Divider type='vertical' className='h-4 ml-1 mr-0' />
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

export default JsonSchemaConfig
