import React, { useCallback } from 'react'
import { withForm } from '@/app/components/base/form'
import InputField from '@/app/components/base/form/form-scenarios/input-field/field'
import { useConfigurations } from './hooks'

type InitialFieldsProps = {
  initialData?: Record<string, any>
  supportFile: boolean
}

const InitialFields = ({
  initialData,
  supportFile,
}: InitialFieldsProps) => withForm({
  defaultValues: initialData,
  render: function Render({
    form,
  }) {
    const getFieldValue = useCallback((fieldName: string) => {
      return form.getFieldValue(fieldName)
    }, [form])

    const setFieldValue = useCallback((fieldName: string, value: any) => {
      form.setFieldValue(fieldName, value)
    }, [form])

    const initialConfigurations = useConfigurations({
      getFieldValue,
      setFieldValue,
      supportFile,
    })

    return (
      <>
        {initialConfigurations.map((config, index) => {
          const FieldComponent = InputField({
            initialData,
            config,
          })
          return <FieldComponent key={index} form={form} />
        })}
      </>
    )
  },
})

export default InitialFields
