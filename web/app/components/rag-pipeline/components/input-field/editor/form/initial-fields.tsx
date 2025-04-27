import React, { useCallback } from 'react'
import { withForm } from '@/app/components/base/form'
import type { FormData } from './types'
import InputField from '@/app/components/base/form/form-scenarios/input-field/field'
import type { DeepKeys } from '@tanstack/react-form'
import { useConfigurations } from './hooks'

type InitialFieldsProps = {
  initialData?: FormData
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
    const setFieldValue = useCallback((fieldName: DeepKeys<FormData>, value: any) => {
      form.setFieldValue(fieldName, value)
    }, [form])

    const initialConfigurations = useConfigurations({
      setFieldValue,
      supportFile,
    })

    return (
      <>
        {initialConfigurations.map((config, index) => {
            const FieldComponent = InputField<FormData>({
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
