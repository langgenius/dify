import produce from 'immer'
import type { VisualEditorProps } from '.'
import { useMittContext } from './context'
import { useVisualEditorStore } from './store'
import type { EditData } from './edit-card'
import { ArrayType, type Field, Type } from '../../../types'
import Toast from '@/app/components/base/toast'
import { findPropertyWithPath } from '../../../utils'
import { noop } from 'lodash-es'

type ChangeEventParams = {
  path: string[],
  parentPath: string[],
  oldFields: EditData,
  fields: EditData,
}

type AddEventParams = {
  path: string[]
}

export const useSchemaNodeOperations = (props: VisualEditorProps) => {
  const { schema: jsonSchema, onChange: doOnChange } = props
  const onChange = doOnChange || noop
  const backupSchema = useVisualEditorStore(state => state.backupSchema)
  const setBackupSchema = useVisualEditorStore(state => state.setBackupSchema)
  const isAddingNewField = useVisualEditorStore(state => state.isAddingNewField)
  const setIsAddingNewField = useVisualEditorStore(state => state.setIsAddingNewField)
  const advancedEditing = useVisualEditorStore(state => state.advancedEditing)
  const setAdvancedEditing = useVisualEditorStore(state => state.setAdvancedEditing)
  const setHoveringProperty = useVisualEditorStore(state => state.setHoveringProperty)
  const { emit, useSubscribe } = useMittContext()

  useSubscribe('restoreSchema', () => {
    if (backupSchema) {
      onChange(backupSchema)
      setBackupSchema(null)
    }
  })

  useSubscribe('quitEditing', (params) => {
    const { callback } = params as any
    callback?.(backupSchema)
    if (backupSchema) {
      onChange(backupSchema)
      setBackupSchema(null)
    }
    isAddingNewField && setIsAddingNewField(false)
    advancedEditing && setAdvancedEditing(false)
    setHoveringProperty(null)
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
    onChange(newSchema)
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
          schema.additionalProperties = false
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
        // case ArrayType.boolean:
        //   schema.type = Type.array
        //   schema.items = {
        //     type: Type.boolean,
        //   }
        //   break
        case ArrayType.object:
          schema.type = Type.array
          schema.items = {
            type: Type.object,
            properties: {},
            required: [],
            additionalProperties: false,
          }
          break
        default:
          schema.type = newType as Type
      }
    })
    onChange(newSchema)
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
    onChange(newSchema)
  })

  useSubscribe('propertyOptionsChange', (params) => {
    const { path, fields } = params as ChangeEventParams
    const newSchema = produce(jsonSchema, (draft) => {
      const schema = findPropertyWithPath(draft, path) as Field
      schema.description = fields.description
      schema.enum = fields.enum
    })
    onChange(newSchema)
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
    onChange(newSchema)
  })

  useSubscribe('addField', (params) => {
    advancedEditing && setAdvancedEditing(false)
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
          },
        }
        setHoveringProperty([...path, 'properties', ''].join('.'))
      }
      if (schema.type === Type.array && schema.items && schema.items.type === Type.object) {
        schema.items.properties = {
          ...(schema.items.properties || {}),
          '': {
            type: Type.string,
          },
        }
        setHoveringProperty([...path, 'items', 'properties', ''].join('.'))
      }
    })
    onChange(newSchema)
  })

  useSubscribe('fieldChange', (params) => {
    let samePropertyNameError = false
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
            samePropertyNameError = true
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
              schema.additionalProperties = false
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
            // case ArrayType.boolean:
            //   schema.type = Type.array
            //   schema.items = {
            //     type: Type.boolean,
            //   }
            //   break
            case ArrayType.object:
              schema.type = Type.array
              schema.items = {
                type: Type.object,
                properties: {},
                required: [],
                additionalProperties: false,
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
            samePropertyNameError = true
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
              schema.additionalProperties = false
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
            // case ArrayType.boolean:
            //   schema.type = Type.array
            //   schema.items = {
            //     type: Type.boolean,
            //   }
            //   break
            case ArrayType.object:
              schema.type = Type.array
              schema.items = {
                type: Type.object,
                properties: {},
                required: [],
                additionalProperties: false,
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
    if (samePropertyNameError) return
    onChange(newSchema)
    emit('fieldChangeSuccess')
  })
}
