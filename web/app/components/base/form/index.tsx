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
import VariableOrConstantInputField from './components/field/variable-selector'
import TextAreaField from './components/field/text-area'
import FileUploaderField from './components/field/file-uploader'

export const { fieldContext, useFieldContext, formContext, useFormContext }
  = createFormHookContexts()

export const { useAppForm, withForm } = createFormHook({
  fieldComponents: {
    TextField,
    TextAreaField,
    NumberInputField,
    CheckboxField,
    SelectField,
    CustomSelectField,
    OptionsField,
    InputTypeSelectField,
    FileTypesField,
    UploadMethodField,
    NumberSliderField,
    VariableOrConstantInputField,
    FileUploaderField,
  },
  formComponents: {
    Actions,
  },
  fieldContext,
  formContext,
})

export type FormType = ReturnType<typeof useFormContext>
