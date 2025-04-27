import React from 'react'
import { type BaseConfiguration, BaseFieldType } from './types'
import { withForm } from '../..'
import { useStore } from '@tanstack/react-form'

type BaseFieldProps<T> = {
  initialData?: T
  config: BaseConfiguration<T>
}

const BaseField = <T,>({
  initialData,
  config,
}: BaseFieldProps<T>) => withForm({
  defaultValues: initialData,
  render: function Render({
    form,
  }) {
    const {
      type,
      label,
      placeholder,
      variable,
      tooltip,
      showConditions,
      max,
      min,
      options,
      required,
      showOptional,
      popupProps,
    } = config

    const isAllConditionsMet = useStore(form.store, (state) => {
      const fieldValues = state.values
      if (!showConditions.length) return true
      return showConditions.every((condition) => {
        const { variable, value } = condition
        const fieldValue = fieldValues[variable as keyof typeof fieldValues]
        return fieldValue === value
      })
    })

    if (!isAllConditionsMet)
      return <></>

    if (type === BaseFieldType.textInput) {
      return (
        <form.AppField
          name={variable}
          children={field => (
            <field.TextField
              label={label}
              labelOptions={{
                tooltip,
                isRequired: required,
                showOptional,
              }}
              placeholder={placeholder}
            />
          )}
        />
      )
    }

    if (type === BaseFieldType.numberInput) {
      return (
        <form.AppField
          name={variable}
          children={field => (
            <field.NumberInputField
              label={label}
              labelOptions={{
                tooltip,
                isRequired: required,
                showOptional,
              }}
              placeholder={placeholder}
              max={max}
              min={min}
            />
          )}
        />
      )
    }

    if (type === BaseFieldType.checkbox) {
      return (
        <form.AppField
          name={variable}
          children={field => (
            <field.CheckboxField
              label={label}
            />
          )}
        />
      )
    }

    if (type === BaseFieldType.select) {
      return (
        <form.AppField
          name={variable}
          children={field => (
            <field.SelectField
              label={label}
              labelOptions={{
                tooltip,
                isRequired: required,
                showOptional,
              }}
              options={options!}
              popupProps={popupProps}
            />
          )}
        />
      )
    }

    return <></>
  },
})

export default BaseField
