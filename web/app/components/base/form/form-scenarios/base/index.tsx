import React, { useMemo } from 'react'
import { useAppForm } from '../..'
import BaseField from './field'
import type { BaseFormProps } from './types'
import { generateZodSchema } from './utils'

const BaseForm = ({
  initialData,
  configurations,
  onSubmit,
  CustomActions,
}: BaseFormProps) => {
  const schema = useMemo(() => {
    const schema = generateZodSchema(configurations)
    return schema
  }, [configurations])

  const baseForm = useAppForm({
    defaultValues: initialData,
    validators: {
      onChange: ({ value }) => {
        const result = schema.safeParse(value)
        if (!result.success) {
          const issues = result.error.issues
          const firstIssue = issues[0].message
          return firstIssue
        }
        return undefined
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
          const FieldComponent = BaseField({
            initialData,
            config,
          })
          return <FieldComponent key={index} form={baseForm} />
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
