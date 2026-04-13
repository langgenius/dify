import type { InputFieldConfiguration } from './types'
import { useStore } from '@tanstack/react-form'
import * as React from 'react'
import { withForm } from '../..'
import { InputFieldType } from './types'

type InputFieldProps = {
  initialData?: Record<string, any>
  config: InputFieldConfiguration
}

const NodePanelField = ({
  initialData,
  config,
}: InputFieldProps) => withForm({
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
      popupProps,
    } = config

    const isAllConditionsMet = useStore(form.store, (state) => {
      const fieldValues = state.values
      return showConditions.every((condition) => {
        const { variable, value } = condition
        const fieldValue = fieldValues[variable as keyof typeof fieldValues]
        return fieldValue === value
      })
    })

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
              popupProps={popupProps}
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

    if (type === InputFieldType.variableOrConstant) {
      return (
        <form.AppField
          name={variable}
          children={field => (
            <field.VariableOrConstantInputField
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

export default NodePanelField
