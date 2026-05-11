import { useStore } from '@tanstack/react-form'
import * as React from 'react'
import { withForm } from '@/app/components/base/form'
import InputField from '@/app/components/base/form/form-scenarios/input-field/field'
import { useHiddenConfigurations } from './hooks'

type HiddenFieldsProps = {
  initialData?: Record<string, any>
}

const HiddenFields = ({
  initialData,
}: HiddenFieldsProps) => withForm({
  defaultValues: initialData,
  render: function Render({
    form,
  }) {
    const options = useStore(form.store, state => state.values.options)

    const hiddenConfigurations = useHiddenConfigurations({
      options,
    })

    return (
      <>
        {hiddenConfigurations.map((config, index) => {
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

export default HiddenFields
