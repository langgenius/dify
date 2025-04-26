import React, { useMemo } from 'react'
import { type BaseConfiguration, BaseVarType } from './types'
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
  props: {
    config,
  },
  render: function Render({
    form,
    config,
  }) {
    const { type, label, placeholder, variable, tooltip, showConditions, max, min, options, required, showOptional } = config

    const fieldValues = useStore(form.store, state => state.values)

    const isAllConditionsMet = useMemo(() => {
      if (!showConditions.length) return true
      return showConditions.every((condition) => {
        const { variable, value } = condition
        const fieldValue = fieldValues[variable as keyof typeof fieldValues]
        return fieldValue === value
      })
    }, [fieldValues, showConditions])

    if (!isAllConditionsMet)
      return <></>

    if (type === BaseVarType.textInput) {
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

    if (type === BaseVarType.numberInput) {
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

    if (type === BaseVarType.checkbox) {
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

    if (type === BaseVarType.select) {
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
            />
          )}
        />
      )
    }

    return <></>
  },
})

export default BaseField
