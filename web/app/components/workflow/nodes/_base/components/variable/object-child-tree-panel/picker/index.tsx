'use client'
import type { FC } from 'react'
import React, { useRef } from 'react'
import type { StructuredOutput } from '../../../../../llm/types'
import Field from './field'
import cn from '@/utils/classnames'
import { useHover } from 'ahooks'
import type { ValueSelector } from '@/app/components/workflow/types'

type Props = {
  className?: string
  root: { nodeId?: string, nodeName?: string, attrName: string }
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
      <div className='px-2 py-1 flex justify-between items-center'>
        <div className='flex'>
          {root.nodeName && (
            <>
              <div className='max-w-[100px] truncate system-sm-medium text-text-tertiary'>{root.nodeName}</div>
              <div className='system-sm-medium text-text-tertiary'>.</div>
            </>
          )}
          <div className='system-sm-medium text-text-secondary'>{root.attrName}</div>
        </div>
        {/* It must be object */}
        <div className='shrink-0 ml-2 system-xs-regular text-text-tertiary'>object</div>
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
    <div className={cn('w-[296px] p-1 pb-0 rounded-xl border-[0.5px] border-components-panel-border bg-components-panel-bg-blur shadow-lg backdrop-blur-[5px]', className)}>
      <PickerPanelMain {...props} />
    </div>
  )
}
export default React.memo(PickerPanel)
