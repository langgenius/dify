'use client'
import Button from '@/app/components/base/button'
import { RiEditLine } from '@remixicon/react'
import type { FC } from 'react'
import React, { useCallback } from 'react'
import type { SchemaRoot, StructuredOutput } from '../types'
import ShowPanel from '@/app/components/workflow/nodes/_base/components/variable/object-child-tree-panel/show'
import { useBoolean } from 'ahooks'
import JsonSchemaConfigModal from './json-schema-config-modal'

type Props = {
  value?: StructuredOutput
  onChange: (value: StructuredOutput) => void,
}

const StructureOutput: FC<Props> = ({
  value,
  onChange,
}) => {
  const [showConfig, {
    setTrue: showConfigModal,
    setFalse: hideConfigModal,
  }] = useBoolean(false)

  const handleChange = useCallback((value: SchemaRoot) => {
    onChange({
      schema: value,
    })
  }, [onChange])
  return (
    <div>
      <div className='flex justify-between'>
        <div className='flex leading-[18px] items-center'>
          <div className='code-sm-semibold text-text-secondary'>structured_output</div>
          <div className='ml-2 system-xs-regular text-text-tertiary'>object</div>
        </div>
        <Button className='flex' variant='secondary' onClick={showConfigModal}>
          <RiEditLine className='size-3.5 mr-1' />
          <div className='system-xs-medium text-components-button-secondary-text'>Configure</div>
        </Button>
      </div>
      {value?.schema ? (
        <ShowPanel
          payload={value}
        />) : (
        <div className='flex items-center h-10 justify-center rounded-[10px] bg-background-section system-xs-regular text-text-tertiary'>no data</div>
      )}

      {showConfig && (
        <JsonSchemaConfigModal
          isShow
          defaultSchema={(value?.schema || {}) as any} // wait for types change
          onSave={handleChange as any} // wait for types change
          onClose={hideConfigModal}
        />
      )}
    </div>
  )
}
export default React.memo(StructureOutput)
