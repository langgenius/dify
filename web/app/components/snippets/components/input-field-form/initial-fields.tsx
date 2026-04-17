import * as React from 'react'
import { useCallback } from 'react'
import { withForm } from '@/app/components/base/form'
import InputField from '@/app/components/base/form/form-scenarios/input-field/field'
import { useSnippetInputFieldConfigurations } from './hooks'

type InitialFieldsProps = {
  initialData?: Record<string, unknown>
  supportFile: boolean
}

const InitialFields = ({
  initialData,
  supportFile,
}: InitialFieldsProps) => withForm({
  defaultValues: initialData,
  // eslint-disable-next-line react/component-hook-factories
  render: function Render({
    form,
  }) {
    const getFieldValue = useCallback((fieldName: string) => {
      return form.getFieldValue(fieldName)
    }, [form])

    const setFieldValue = useCallback((fieldName: string, value: unknown) => {
      form.setFieldValue(fieldName, value)
    }, [form])

    const initialConfigurations = useSnippetInputFieldConfigurations({
      getFieldValue,
      setFieldValue,
      supportFile,
    })

    return (
      <>
        {initialConfigurations.map((config) => {
          const FieldComponent = InputField({
            initialData,
            config,
          })
          const key = `${config.variable}-${config.label}-${config.showConditions.map(condition => String(condition.value)).join('-') || 'default'}`
          return <FieldComponent key={key} form={form} />
        })}
      </>
    )
  },
})

export default InitialFields
