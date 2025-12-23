import type { ZodSchema } from 'zod'
import type { BaseConfiguration } from '@/app/components/base/form/form-scenarios/base/types'
import { useCallback, useImperativeHandle } from 'react'
import { useAppForm } from '@/app/components/base/form'
import BaseField from '@/app/components/base/form/form-scenarios/base/field'
import Toast from '@/app/components/base/toast'
import Header from './header'

type OptionsProps = {
  initialData: Record<string, any>
  configurations: BaseConfiguration[]
  schema: ZodSchema
  onSubmit: (data: Record<string, any>) => void
  onPreview: () => void
  ref: React.RefObject<any>
  isRunning: boolean
}

const Form = ({
  initialData,
  configurations,
  schema,
  onSubmit,
  onPreview,
  ref,
  isRunning,
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
    }
  }, [form])

  const handleReset = useCallback(() => {
    form.reset()
  }, [form])

  return (
    <form
      className="flex w-full flex-col rounded-lg border border-components-panel-border bg-components-panel-bg"
      onSubmit={(e) => {
        e.preventDefault()
        e.stopPropagation()
        form.handleSubmit()
      }}
    >
      <form.Subscribe
        selector={state => state.isDirty}
        children={isDirty => (
          <Header
            onReset={handleReset}
            resetDisabled={!isDirty}
            onPreview={onPreview}
            previewDisabled={isRunning}
          />
        )}
      />
      <div className="flex flex-col gap-3 border-t border-divider-subtle px-4 py-3">
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

export default Form
