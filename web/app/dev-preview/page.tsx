'use client'
import BaseForm from '../components/base/form/form-scenarios/base'
import { BaseVarType } from '../components/base/form/form-scenarios/base/types'

export default function Page() {
  return (
    <div className='flex h-screen w-full items-center justify-center p-20'>
      <div className='w-[400px] rounded-lg border border-components-panel-border bg-components-panel-bg'>
        <BaseForm
          initialData={{
            type: 'option_1',
            variable: 'test',
            label: 'Test',
            maxLength: 48,
            required: true,
          }}
          configurations={[
            {
              type: BaseVarType.textInput,
              variable: 'variable',
              label: 'Variable',
              required: true,
              showConditions: [],
            },
            {
              type: BaseVarType.textInput,
              variable: 'label',
              label: 'Label',
              required: true,
              showConditions: [],
            },
            {
              type: BaseVarType.numberInput,
              variable: 'maxLength',
              label: 'Max Length',
              required: true,
              showConditions: [],
              max: 100,
              min: 1,
            },
            {
              type: BaseVarType.checkbox,
              variable: 'required',
              label: 'Required',
              required: true,
              showConditions: [],
            },
            {
              type: BaseVarType.select,
              variable: 'type',
              label: 'Type',
              required: true,
              showConditions: [],
              options: [
                { label: 'Option 1', value: 'option_1' },
                { label: 'Option 2', value: 'option_2' },
                { label: 'Option 3', value: 'option_3' },
              ],
            },
          ]}
          onSubmit={(value) => {
            console.log('onSubmit', value)
          }}
        />
      </div>
    </div>
  )
}
