import { createFormHook, createFormHookContexts } from '@tanstack/react-form'
import TextField from './components/text-field'
import CheckboxField from './components/checkbox-field'
import SelectField from './components/select-filed'
import SubmitButton from './components/submit-button'

export const { fieldContext, useFieldContext, formContext, useFormContext }
  = createFormHookContexts()

export const { useAppForm, withForm } = createFormHook({
  fieldComponents: {
    TextField,
    CheckboxField,
    SelectField,
  },
  formComponents: {
    SubmitButton,
  },
  fieldContext,
  formContext,
})
