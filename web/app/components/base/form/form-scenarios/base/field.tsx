import React, { useMemo } from 'react'
import { type BaseConfiguration, BaseVarType } from './types'
import { withForm } from '../..'
import { useStore } from '@tanstack/react-form'

type FieldProps<T> = {
  initialData?: T
  config: BaseConfiguration<T>
}

const Field = <T,>({
  initialData,
  config,
}: FieldProps<T>) => withForm({
  defaultValues: initialData,
  props: {
    config,
  },
  render: function Render({
    form,
    config,
  }) {
    const { type, label, placeholder, variable, tooltip, showConditions, max, min, options } = config

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

    if ([BaseVarType.textInput].includes(type)) {
      return (
        <form.AppField
          name={variable}
          children={field => (
            <field.TextField
              label={label}
              tooltip={tooltip}
              placeholder={placeholder}
            />
          )}
        />
      )
    }

    if ([BaseVarType.numberInput].includes(type)) {
      return (
        <form.AppField
          name={variable}
          children={field => (
            <field.NumberInputField
              label={label}
              tooltip={tooltip}
              placeholder={placeholder}
              max={max}
              min={min}
            />
          )}
        />
      )
    }

    if ([BaseVarType.checkbox].includes(type)) {
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

    if ([BaseVarType.select].includes(type)) {
      return (
        <form.AppField
          name={variable}
          children={field => (
            <field.SelectField
              options={options!}
              label={label}
            />
          )}
        />
      )
    }

    return <></>
  },
})

export default Field
