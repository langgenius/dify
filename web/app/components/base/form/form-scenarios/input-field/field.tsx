import React, { useMemo } from 'react'
import { type InputFieldConfiguration, InputFieldType } from './types'
import { withForm } from '../..'
import { useStore } from '@tanstack/react-form'

type InputFieldProps<T> = {
  initialData?: T
  config: InputFieldConfiguration<T>
}

const InputField = <T,>({
  initialData,
  config,
}: InputFieldProps<T>) => withForm({
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
      required,
      showOptional,
      supportFile,
      description,
      options,
      listeners,
    } = config

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

    if (type === InputFieldType.textInput) {
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

    if (type === InputFieldType.numberInput) {
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

    if (type === InputFieldType.numberSlider) {
      return (
        <form.AppField
          name={variable}
          children={field => (
            <field.NumberSliderField
              label={label}
              labelOptions={{
                tooltip,
                isRequired: required,
                showOptional,
              }}
              description={description}
              max={max}
              min={min}
            />
          )}
        />
      )
    }

    if (type === InputFieldType.checkbox) {
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

    if (type === InputFieldType.select) {
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

    if (type === InputFieldType.inputTypeSelect) {
      return (
        <form.AppField
          name={variable}
          listeners={listeners}
          children={field => (
            <field.InputTypeSelectField
              label={label}
              labelOptions={{
                tooltip,
                isRequired: required,
                showOptional,
              }}
              supportFile={!!supportFile}
            />
          )}
        />
      )
    }

    if (type === InputFieldType.uploadMethod) {
      return (
        <form.AppField
          name={variable}
          children={field => (
            <field.UploadMethodField
              label={label}
              labelOptions={{
                tooltip,
                isRequired: required,
                showOptional,
              }}
            />
          )}
        />
      )
    }

    if (type === InputFieldType.fileTypes) {
      return (
        <form.AppField
          name={variable}
          children={field => (
            <field.FileTypesField
              label={label}
              labelOptions={{
                tooltip,
                isRequired: required,
                showOptional,
              }}
            />
          )}
        />
      )
    }

    if (type === InputFieldType.options) {
      return (
        <form.AppField
          name={variable}
          children={field => (
            <field.OptionsField
              label={label}
              labelOptions={{
                tooltip,
                isRequired: required,
                showOptional,
              }}
            />
          )}
        />
      )
    }

    return <></>
  },
})

export default InputField
