import type { AnyFieldApi } from '@tanstack/react-form'
import type { FormItemValidateStatusEnum, FormSchema } from '@/app/components/base/form/types'
import { useForm } from '@tanstack/react-form'
import { render } from 'vitest-browser-react'
import { createConsoleQueryClient } from '@/test/console/query-data'
import { QueryClientTestProvider } from '@/test/console/query-provider'
import BaseField from '../base-field'

type RenderBaseFieldOptions = {
  formSchema: FormSchema
  defaultValues?: Record<string, unknown>
  fieldState?: {
    validateStatus?: FormItemValidateStatusEnum
    errors?: string[]
    warnings?: string[]
  }
  showCurrentValue?: boolean
}

export function renderBaseField({
  formSchema,
  defaultValues,
  fieldState,
  showCurrentValue = false,
}: RenderBaseFieldOptions) {
  const queryClient = createConsoleQueryClient()
  const TestComponent = () => {
    const form = useForm({
      defaultValues: defaultValues ?? { [formSchema.name]: '' },
      onSubmit: async () => {},
    })

    return (
      <>
        <form.Field name={formSchema.name}>
          {(field) => (
            <BaseField
              field={field as AnyFieldApi}
              formSchema={formSchema}
              fieldState={fieldState}
            />
          )}
        </form.Field>
        {showCurrentValue && (
          <form.Subscribe selector={(state) => state.values[formSchema.name]}>
            {(value) => <output aria-label="Field value">{String(value)}</output>}
          </form.Subscribe>
        )}
      </>
    )
  }

  return render(
    <QueryClientTestProvider queryClient={queryClient}>
      <TestComponent />
    </QueryClientTestProvider>,
  )
}
