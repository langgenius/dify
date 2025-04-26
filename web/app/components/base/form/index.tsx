import { createFormHook, createFormHookContexts } from '@tanstack/react-form'
import TextField from './components/field/text'
import NumberInputField from './components/field/number-input'
import CheckboxField from './components/field/checkbox'
import SelectField from './components/field/select'
import CustomSelectField from './components/field/custom-select'
import OptionsField from './components/field/options'
import Actions from './components/form/actions'
import InputTypeSelectField from './components/field/input-type-select'
import FileTypesField from './components/field/file-types'
import UploadMethodField from './components/field/upload-method'
import NumberSliderField from './components/field/number-slider'

export type FormType = ReturnType<typeof useFormContext>

export const { fieldContext, useFieldContext, formContext, useFormContext }
  = createFormHookContexts()

export const { useAppForm, withForm } = createFormHook({
  fieldComponents: {
    TextField,
    NumberInputField,
    CheckboxField,
    SelectField,
    CustomSelectField,
    OptionsField,
    InputTypeSelectField,
    FileTypesField,
    UploadMethodField,
    NumberSliderField,
  },
  formComponents: {
    Actions,
  },
  fieldContext,
  formContext,
})
