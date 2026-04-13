'use client'
import type { FC } from 'react'
import type { StructuredOutput } from '../../../../../llm/types'
import type { ValueSelector } from '@/app/components/workflow/types'
import { useHover } from 'ahooks'
import * as React from 'react'
import { useRef } from 'react'
import { cn } from '@/utils/classnames'
import Field from './field'

type Props = {
  className?: string
  root: { nodeId?: string, nodeName?: string, attrName: string, attrAlias?: string }
  payload: StructuredOutput
  readonly?: boolean
  onSelect?: (valueSelector: ValueSelector) => void
  onHovering?: (value: boolean) => void
}

export const PickerPanelMain: FC<Props> = ({
  className,
  root,
  payload,
  readonly,
  onHovering,
  onSelect,
}) => {
  const ref = useRef<HTMLDivElement>(null)
  useHover(ref, {
    onChange: (hovering) => {
      if (hovering) {
        onHovering?.(true)
      }
      else {
        setTimeout(() => {
          onHovering?.(false)
        }, 100)
      }
    },
  })
  const schema = payload.schema
  const fieldNames = Object.keys(schema.properties)
  return (
    <div className={cn(className)} ref={ref}>
      {/* Root info */}
      <div className="flex items-center justify-between px-2 py-1">
        <div className="flex">
          {root.nodeName && (
            <>
              <div className="system-sm-medium max-w-[100px] truncate text-text-tertiary">{root.nodeName}</div>
              <div className="system-sm-medium text-text-tertiary">.</div>
            </>
          )}
          <div className="system-sm-medium text-text-secondary">{root.attrName}</div>
        </div>
        <div className="system-xs-regular ml-2 truncate text-text-tertiary" title={root.attrAlias || 'object'}>{root.attrAlias || 'object'}</div>
      </div>
      {fieldNames.map(name => (
        <Field
          key={name}
          name={name}
          payload={schema.properties[name]}
          readonly={readonly}
          valueSelector={[root.nodeId!, root.attrName]}
          onSelect={onSelect}
        />
      ))}
    </div>
  )
}

const PickerPanel: FC<Props> = ({
  className,
  ...props
}) => {
  return (
    <div className={cn('w-[296px] rounded-xl border-[0.5px] border-components-panel-border bg-components-panel-bg-blur p-1 shadow-lg backdrop-blur-[5px]', className)}>
      <PickerPanelMain {...props} />
    </div>
  )
}
export default React.memo(PickerPanel)
