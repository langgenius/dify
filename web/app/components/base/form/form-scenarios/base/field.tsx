import type { BaseConfiguration } from './types'
import { useStore } from '@tanstack/react-form'
import * as React from 'react'
import { withForm } from '../..'
import { BaseFieldType } from './types'

type BaseFieldProps = {
  initialData?: Record<string, any>
  config: BaseConfiguration
}

const BaseField = ({
  initialData,
  config,
}: BaseFieldProps) => withForm({
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
      allowedFileExtensions,
      allowedFileTypes,
      allowedFileUploadMethods,
      maxLength,
      unit,
    } = config

    const isAllConditionsMet = useStore(form.store, (state) => {
      const fieldValues = state.values
      if (!showConditions.length)
        return true
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

    if (type === BaseFieldType.paragraph) {
      return (
        <form.AppField
          name={variable}
          children={field => (
            <field.TextAreaField
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
              unit={unit}
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

    if (type === BaseFieldType.file) {
      return (
        <form.AppField
          name={variable}
          children={field => (
            <field.FileUploaderField
              label={label}
              labelOptions={{
                tooltip,
                isRequired: required,
                showOptional,
              }}
              fileConfig={{
                allowed_file_extensions: allowedFileExtensions,
                allowed_file_types: allowedFileTypes,
                allowed_file_upload_methods: allowedFileUploadMethods,
                number_limits: 1,
              }}
            />
          )}
        />
      )
    }

    if (type === BaseFieldType.fileList) {
      return (
        <form.AppField
          name={variable}
          children={field => (
            <field.FileUploaderField
              label={label}
              labelOptions={{
                tooltip,
                isRequired: required,
                showOptional,
              }}
              fileConfig={{
                allowed_file_extensions: allowedFileExtensions,
                allowed_file_types: allowedFileTypes,
                allowed_file_upload_methods: allowedFileUploadMethods,
                number_limits: maxLength,
              }}
            />
          )}
        />
      )
    }

    return <></>
  },
})

export default BaseField
