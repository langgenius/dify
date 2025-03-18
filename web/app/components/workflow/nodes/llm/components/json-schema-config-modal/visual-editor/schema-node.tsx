import type { FC } from 'react'
import React, { useState } from 'react'
import { type Field, Type } from '../../../types'
import classNames from '@/utils/classnames'
import { RiArrowDropDownLine, RiArrowDropRightLine } from '@remixicon/react'
import { getFieldType, getHasChildren } from '../../../utils'
import Divider from '@/app/components/base/divider'
import EditCard from './edit-card'
import Card from './card'
import { useVisualEditorStore } from './store'
import { useDebounceFn } from 'ahooks'
import AddField from './add-field'
import { JSON_SCHEMA_MAX_DEPTH } from '@/config'

type SchemaNodeProps = {
  name: string
  required: boolean
  schema: Field
  path: string[]
  parentPath?: string[]
  depth: number
}

// Support 10 levels of indentation
const indentPadding: Record<number, string> = {
  1: 'pl-0',
  2: 'pl-[20px]',
  3: 'pl-[40px]',
  4: 'pl-[60px]',
  5: 'pl-[80px]',
  6: 'pl-[100px]',
  7: 'pl-[120px]',
  8: 'pl-[140px]',
  9: 'pl-[160px]',
  10: 'pl-[180px]',
}

const indentLeft: Record<number, string> = {
  2: 'left-0',
  3: 'left-[20px]',
  4: 'left-[40px]',
  5: 'left-[60px]',
  6: 'left-[80px]',
  7: 'left-[100px]',
  8: 'left-[120px]',
  9: 'left-[140px]',
  10: 'left-[160px]',
}

const SchemaNode: FC<SchemaNodeProps> = ({
  name,
  required,
  schema,
  path,
  parentPath,
  depth,
}) => {
  const [isExpanded, setIsExpanded] = useState(true)
  const hoveringProperty = useVisualEditorStore(state => state.hoveringProperty)
  const setHoveringProperty = useVisualEditorStore(state => state.setHoveringProperty)
  const isAddingNewField = useVisualEditorStore(state => state.isAddingNewField)
  const advancedEditing = useVisualEditorStore(state => state.advancedEditing)

  const { run: setHoveringPropertyDebounced } = useDebounceFn((path: string) => {
    setHoveringProperty(path)
  }, { wait: 50 })

  const hasChildren = getHasChildren(schema)
  const type = getFieldType(schema)
  const isHovering = hoveringProperty === path.join('.') && depth > 1

  const handleExpand = () => {
    setIsExpanded(!isExpanded)
  }

  const handleMouseEnter = () => {
    if (advancedEditing || isAddingNewField) return
    setHoveringPropertyDebounced(path.join('.'))
  }

  const handleMouseLeave = () => {
    if (advancedEditing || isAddingNewField) return
    setHoveringPropertyDebounced('')
  }

  return (
    <div className='relative'>
      <div className={classNames('relative z-10', indentPadding[depth])}>
        {depth > 1 && hasChildren && (
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
          {isHovering ? (
            <EditCard
              fields={{
                name,
                type,
                required,
                description: schema.description || '',
                enum: schema.enum || [],
              }}
              path={path}
              parentPath={parentPath!}
              depth={depth}
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
        'flex justify-center w-5 absolute top-7 z-0',
        schema.description ? 'h-[calc(100%-3rem)]' : 'h-[calc(100%-1.75rem)]',
        indentLeft[depth + 1],
      )}>
        <Divider type='vertical' className='bg-divider-subtle mx-0' />
      </div>

      {isExpanded && hasChildren && depth < JSON_SCHEMA_MAX_DEPTH && (
        <>
          {schema.type === Type.object && schema.properties && (
            Object.entries(schema.properties).map(([key, childSchema]) => (
              <SchemaNode
                key={key}
                name={key}
                required={!!schema.required?.includes(key)}
                schema={childSchema}
                path={[...path, 'properties', key]}
                parentPath={path}
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
                  path={[...path, 'items', 'properties', key]}
                  parentPath={path}
                  depth={depth + 1}
                />
              ))
            )}
        </>
      )}

      {
        depth === 1 && !isAddingNewField && (
          <AddField />
        )
      }
    </div>
  )
}

export default React.memo(SchemaNode)
