import type { FC } from 'react'
import React, { useCallback, useRef, useState } from 'react'
import { ArrayType } from '../../../types'
import { type ArrayItems, type Field, Type } from '../../../types'
import type { AdvancedOptionsType } from './edit-card/advanced-options'
import classNames from '@/utils/classnames'
import { RiArrowDropDownLine, RiArrowDropRightLine } from '@remixicon/react'
import { getFieldType, getHasChildren } from '../../../utils'
import Divider from '@/app/components/base/divider'
import EditCard from './edit-card'
import Card from './card'
import produce from 'immer'

type SchemaNodeProps = {
  name: string
  required: boolean
  schema: Field
  depth: number
  onChange: (schema: Field) => void
  onPropertyNameChange?: (name: string) => void
  onRequiredChange?: (name: string) => void
  onNodeDelete?: (name: string) => void
}

// Support 10 levels of indentation
const indentPadding: Record<number, string> = {
  0: 'pl-0',
  1: 'pl-[20px]',
  2: 'pl-[40px]',
  3: 'pl-[60px]',
  4: 'pl-[80px]',
  5: 'pl-[100px]',
  6: 'pl-[120px]',
  7: 'pl-[140px]',
  8: 'pl-[160px]',
  9: 'pl-[180px]',
}

const indentLeft: Record<number, string> = {
  1: 'left-0',
  2: 'left-[20px]',
  3: 'left-[40px]',
  4: 'left-[60px]',
  5: 'left-[80px]',
  6: 'left-[100px]',
  7: 'left-[120px]',
  8: 'left-[140px]',
  9: 'left-[160px]',
}

const SchemaNode: FC<SchemaNodeProps> = ({
  name,
  required,
  schema,
  onChange,
  onPropertyNameChange,
  onRequiredChange,
  onNodeDelete,
  depth,
}) => {
  const [isExpanded, setIsExpanded] = useState(true)
  const [isHovering, setIsHovering] = useState(false)
  const hoverTimer = useRef<any>(null)

  const hasChildren = getHasChildren(schema)
  const isEditing = isHovering && depth > 0
  const type = getFieldType(schema)

  const handleExpand = () => {
    setIsExpanded(!isExpanded)
  }

  const handleMouseEnter = () => {
    hoverTimer.current = setTimeout(() => {
      setIsHovering(true)
    }, 100)
  }

  const handleMouseLeave = () => {
    clearTimeout(hoverTimer.current)
    setIsHovering(false)
  }

  const handlePropertyNameChange = useCallback((oldName: string, newName: string) => {
    if (oldName === newName) return

    if (schema.type === Type.object) {
      const properties = schema.properties || {}
      if (properties[newName]) {
        // TODO: Show error message
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

      onChange({
        ...schema,
        properties: newProperties,
        required: newRequired,
      })
      return
    }

    if (schema.type === Type.array && schema.items && schema.items.type === Type.object) {
      const properties = schema.items.properties || {}
      if (properties[newName]) {
        // TODO: Show error message
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
      onChange({
        ...schema,
        items: {
          ...schema.items,
          properties: newProperties,
          required: newRequired,
        },
      })
    }
  }, [onChange, schema])

  const handleTypeChange = useCallback((newType: Type | ArrayType) => {
    if (schema.type === newType) return
    const newSchema = produce(schema, (draft) => {
      if (draft.type === Type.object) {
        delete draft.properties
        delete draft.required
      }
      if (draft.type === Type.array)
        delete draft.items
      switch (newType) {
        case Type.object:
          draft.type = Type.object
          draft.properties = {}
          draft.required = []
          break
        case ArrayType.string:
          draft.type = Type.array
          draft.items = {
            type: Type.string,
          }
          break
        case ArrayType.number:
          draft.type = Type.array
          draft.items = {
            type: Type.number,
          }
          break
        case ArrayType.boolean:
          draft.type = Type.array
          draft.items = {
            type: Type.boolean,
          }
          break
        case ArrayType.object:
          draft.type = Type.array
          draft.items = {
            type: Type.object,
            properties: {},
            required: [],
          }
          break
        default:
          draft.type = newType as Type
      }
    })
    onChange(newSchema)
  }, [onChange, schema])

  const toggleRequired = useCallback((name: string) => {
    if (schema.type === Type.object) {
      const required = schema.required || []
      const newRequired = required.includes(name)
        ? required.filter(item => item !== name)
        : [...required, name]
      onChange({
        ...schema,
        required: newRequired,
      })
      return
    }
    if (schema.type === Type.array && schema.items && schema.items.type === Type.object) {
      const required = schema.items.required || []
      const newRequired = required.includes(name)
        ? required.filter(item => item !== name)
        : [...required, name]
      onChange({
        ...schema,
        items: {
          ...schema.items,
          required: newRequired,
        },
      })
    }
  }, [onChange, schema])

  const handleDescriptionChange = useCallback((description: string) => {
    onChange({
      ...schema,
      description,
    })
  }, [onChange, schema])

  const handleAdvancedOptionsChange = useCallback((advancedOptions: AdvancedOptionsType) => {
    const newAdvancedOptions = {
      enum: advancedOptions.enum.replace(' ', '').split(','),
    }
    onChange({
      ...schema,
      ...newAdvancedOptions,
    })
  }, [onChange, schema])

  const handleNodeDelete = useCallback((name: string) => {
    const newSchema = produce(schema, (draft) => {
      if (draft.type === Type.object && draft.properties) {
        delete draft.properties[name]
        draft.required = draft.required?.filter(item => item !== name)
      }
      if (draft.type === Type.array && draft.items?.properties && draft.items?.type === Type.object) {
        delete draft.items.properties[name]
        draft.items.required = draft.items.required?.filter(item => item !== name)
      }
    })
    onChange(newSchema)
  }, [onChange, schema])

  const handlePropertyChange = useCallback((name: string, propertySchema: Field) => {
    onChange({
      ...schema,
      properties: {
        ...(schema.properties || {}),
        [name]: propertySchema,
      },
    })
  }, [onChange, schema])

  const handleItemsPropertyChange = useCallback((name: string, itemsSchema: Field) => {
    onChange({
      ...schema,
      items: {
        ...schema.items,
        properties: {
          ...(schema.items?.properties || {}),
          [name]: itemsSchema as ArrayItems,
        },
      } as ArrayItems,
    })
  }, [onChange, schema])

  return (
    <div className='relative'>
      <div className={classNames('relative z-10', indentPadding[depth])}>
        {depth > 0 && hasChildren && (
          <div className={classNames(
            'flex items-center absolute top-0 w-5 h-7 px-0.5 z-10 bg-background-section-burn',
            indentLeft[depth],
          )}>
            <button
              onClick={handleExpand}
              className='py-0.5 text-text-tertiary hover:text-text-accent'
            >
              {
                isExpanded
                  ? <RiArrowDropDownLine className='w-4 h-4' />
                  : <RiArrowDropRightLine className='w-4 h-4' />
              }
            </button>
          </div>
        )}

        <div
          onMouseEnter={handleMouseEnter}
          onMouseLeave={handleMouseLeave}
        >
          {isEditing ? (
            <EditCard
              fields={{
                name,
                type,
                required,
                description: schema.description || '',
                enum: schema.enum || [],
              }}
              onPropertyNameChange={onPropertyNameChange!}
              onTypeChange={handleTypeChange}
              onRequiredChange={onRequiredChange!}
              onDescriptionChange={handleDescriptionChange}
              onAdvancedOptionsChange={handleAdvancedOptionsChange}
              onDelete={onNodeDelete!}
              onCancel={() => {}}
            />
          ) : (
            <Card
              name={name}
              type={type}
              required={required}
              description={schema.description}
            />
          )}
        </div>

      </div>

      <div className={classNames(
        'flex justify-center w-5 h-[calc(100%-1.75rem)] absolute top-7 z-0',
        indentLeft[depth + 1],
      )}>
        <Divider type='vertical' className='bg-divider-subtle mx-0' />
      </div>

      {isExpanded && hasChildren && (
        <>
          {schema.type === Type.object && schema.properties && (
            Object.entries(schema.properties).map(([key, childSchema]) => (
              <SchemaNode
                key={key}
                name={key}
                required={!!schema.required?.includes(key)}
                schema={childSchema}
                onChange={handlePropertyChange.bind(null, key)}
                onPropertyNameChange={handlePropertyNameChange.bind(null, key)}
                onRequiredChange={toggleRequired}
                onNodeDelete={handleNodeDelete}
                depth={depth + 1}
              />
            ))
          )}

          {schema.type === Type.array
            && schema.items
            && schema.items.type === Type.object
            && schema.items.properties
            && (
              Object.entries(schema.items.properties).map(([key, childSchema]) => (
                <SchemaNode
                  key={key}
                  name={key}
                  required={!!schema.items?.required?.includes(key)}
                  schema={childSchema}
                  onChange={handleItemsPropertyChange.bind(null, key)}
                  onPropertyNameChange={handlePropertyNameChange.bind(null, key)}
                  onRequiredChange={toggleRequired}
                  onNodeDelete={handleNodeDelete}
                  depth={depth + 1}
                />
              ))
            )}
        </>
      )}
    </div>
  )
}

export default React.memo(SchemaNode)
