import React from 'react'
import { useAppForm } from '../..'
import Field from './field'
import type { BaseFormProps } from './types'

const BaseForm = <T,>({
  initialData,
  configurations,
  onSubmit,
  CustomActions,
}: BaseFormProps<T>) => {
  const baseForm = useAppForm({
    defaultValues: initialData,
    validators: {
      onSubmit: ({ value }) => {
        console.log('onSubmit', value)
      },
    },
    onSubmit: ({ value }) => {
      onSubmit(value)
    },
  })

  return (
    <form
      className='w-full'
      onSubmit={(e) => {
        e.preventDefault()
        e.stopPropagation()
        baseForm.handleSubmit()
      }}
    >
      <div className='flex flex-col gap-4 px-4 py-2'>
        {configurations.map((config, index) => {
          const FieldComponent = Field<T>({
            initialData,
            config,
          })
          return <FieldComponent key={index} form={baseForm} config={config} />
        })}
      </div>
      <baseForm.AppForm>
        <baseForm.Actions
          CustomActions={CustomActions}
        />
      </baseForm.AppForm>
    </form>
  )
}

export default React.memo(BaseForm)
