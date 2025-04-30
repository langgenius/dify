import type { FC } from 'react'
import { memo } from 'react'
import type { DataSourceNodeType } from './types'
import type { NodePanelProps } from '@/app/components/workflow/types'
import VariableOrConstantInputField from '@/app/components/base/form/components/field/variable-or-constant-input'

const Panel: FC<NodePanelProps<DataSourceNodeType>> = () => {
  return (
    <div className='mb-2 mt-2 space-y-4 px-4'>
      datasource
      <VariableOrConstantInputField
        label='Parent maximum chunk length'
      />
    </div>
  )
}

export default memo(Panel)
