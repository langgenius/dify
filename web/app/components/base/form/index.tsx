import { createFormHook, createFormHookContexts } from '@tanstack/react-form'
import TextField from './components/field/text'
import NumberInputField from './components/field/number-input'
import CheckboxField from './components/field/checkbox'
import SelectField from './components/field/select'
import OptionsField from './components/field/options'
import SubmitButton from './components/form/submit-button'

export const { fieldContext, useFieldContext, formContext, useFormContext }
  = createFormHookContexts()

export const { useAppForm, withForm } = createFormHook({
  fieldComponents: {
    TextField,
    NumberInputField,
    CheckboxField,
    SelectField,
    OptionsField,
  },
  formComponents: {
    SubmitButton,
  },
  fieldContext,
  formContext,
})
