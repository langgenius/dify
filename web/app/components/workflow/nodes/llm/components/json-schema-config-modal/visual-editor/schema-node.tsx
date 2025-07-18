import type { FC } from 'react'
import React, { useMemo, useState } from 'react'
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
  readOnly?: boolean
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
  10: 'pl-[200px]',
}

const indentLeft: Record<number, string> = {
  0: 'left-0',
  1: 'left-[20px]',
  2: 'left-[40px]',
  3: 'left-[60px]',
  4: 'left-[80px]',
  5: 'left-[100px]',
  6: 'left-[120px]',
  7: 'left-[140px]',
  8: 'left-[160px]',
  9: 'left-[180px]',
  10: 'left-[200px]',
}

const SchemaNode: FC<SchemaNodeProps> = ({
  name,
  required,
  schema,
  path,
  parentPath,
  depth,
  readOnly,
}) => {
  const [isExpanded, setIsExpanded] = useState(true)
  const hoveringProperty = useVisualEditorStore(state => state.hoveringProperty)
  const setHoveringProperty = useVisualEditorStore(state => state.setHoveringProperty)
  const isAddingNewField = useVisualEditorStore(state => state.isAddingNewField)
  const advancedEditing = useVisualEditorStore(state => state.advancedEditing)

  const { run: setHoveringPropertyDebounced } = useDebounceFn((path: string | null) => {
    setHoveringProperty(path)
  }, { wait: 50 })

  const hasChildren = useMemo(() => getHasChildren(schema), [schema])
  const type = useMemo(() => getFieldType(schema), [schema])
  const isHovering = hoveringProperty === path.join('.')

  const handleExpand = () => {
    setIsExpanded(!isExpanded)
  }

  const handleMouseEnter = () => {
    if(readOnly) return
    if (advancedEditing || isAddingNewField) return
    setHoveringPropertyDebounced(path.join('.'))
  }

  const handleMouseLeave = () => {
    if(readOnly) return
    if (advancedEditing || isAddingNewField) return
    setHoveringPropertyDebounced(null)
  }

  return (
    <div className='relative'>
      <div className={classNames('relative z-10', indentPadding[depth])}>
        {depth > 0 && hasChildren && (
          <div className={classNames(
            'absolute top-0 z-10 flex h-7 w-5 items-center bg-background-section-burn px-0.5',
            indentLeft[depth - 1],
          )}>
            <button
              onClick={handleExpand}
              className='py-0.5 text-text-tertiary hover:text-text-accent'
            >
              {
                isExpanded
                  ? <RiArrowDropDownLine className='h-4 w-4' />
                  : <RiArrowDropRightLine className='h-4 w-4' />
              }
            </button>
          </div>
        )}

        <div
          onMouseEnter={handleMouseEnter}
          onMouseLeave={handleMouseLeave}
        >
          {(isHovering && depth > 0) ? (
            <EditCard
              fields={{
                name,
                type,
                required,
                description: schema.description,
                enum: schema.enum,
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
        'absolute z-0 flex w-5 justify-center',
        schema.description ? 'top-12 h-[calc(100%-3rem)]' : 'top-7 h-[calc(100%-1.75rem)]',
        indentLeft[depth],
      )}>
        <Divider
          type='vertical'
          className={classNames('mx-0', isHovering ? 'bg-divider-deep' : 'bg-divider-subtle')}
        />
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
        !readOnly && depth === 0 && !isAddingNewField && (
          <AddField />
        )
      }
    </div>
  )
}

export default React.memo(SchemaNode)
