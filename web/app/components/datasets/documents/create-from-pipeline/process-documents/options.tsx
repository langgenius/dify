import { useAppForm } from '@/app/components/base/form'
import BaseField from '@/app/components/base/form/form-scenarios/base/field'
import type { BaseConfiguration } from '@/app/components/base/form/form-scenarios/base/types'
import Toast from '@/app/components/base/toast'
import { useImperativeHandle } from 'react'
import type { ZodSchema } from 'zod'

type OptionsProps = {
  initialData: Record<string, any>
  configurations: BaseConfiguration[]
  schema: ZodSchema
  onSubmit: (data: Record<string, any>) => void
  ref: React.RefObject<any>
}

const Options = ({
  initialData,
  configurations,
  schema,
  onSubmit,
  ref,
}: OptionsProps) => {
  const form = useAppForm({
    defaultValues: initialData,
    validators: {
      onSubmit: ({ value }) => {
        const result = schema.safeParse(value)
        if (!result.success) {
          const issues = result.error.issues
          const firstIssue = issues[0]
          const errorMessage = `"${firstIssue.path.join('.')}" ${firstIssue.message}`
          Toast.notify({
            type: 'error',
            message: errorMessage,
          })
          return errorMessage
        }
        return undefined
      },
    },
    onSubmit: ({ value }) => {
      onSubmit(value)
    },
  })

  useImperativeHandle(ref, () => {
    return {
      submit: () => {
        form.handleSubmit()
      },
      reset: () => {
        form.reset()
      },
      isDirty: () => {
        return form.state.isDirty
      },
    }
  }, [form])

  return (
    <form
      className='w-full'
      onSubmit={(e) => {
        e.preventDefault()
        e.stopPropagation()
        form.handleSubmit()
      }}
    >
      <div className='flex flex-col gap-3 px-4 py-3'>
        {configurations.map((config, index) => {
          const FieldComponent = BaseField({
            initialData,
            config,
          })
          return <FieldComponent key={index} form={form} />
        })}
      </div>
    </form>
  )
}

export default Options
