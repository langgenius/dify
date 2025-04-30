import type { FC } from 'react'
import { memo } from 'react'
import type { DataSourceNodeType } from './types'
import type { NodePanelProps } from '@/app/components/workflow/types'
import VariableOrConstantInputField from '@/app/components/base/form/components/field/variable-or-constant-input'
import VariableSelector from '@/app/components/base/form/components/field/variable-selector'

const Panel: FC<NodePanelProps<DataSourceNodeType>> = () => {
  return (
    <div className='mb-2 mt-2 space-y-4 px-4'>
      datasource
      <div className='space-y-1'>
        <VariableSelector
          className='py-1'
          label='Child delimiter'
          labelOptions={{
            isRequired: true,
          }}
        />
        <VariableOrConstantInputField
          className='py-1'
          label='Parent maximum chunk length'
        />
      </div>
    </div>
  )
}

export default memo(Panel)
