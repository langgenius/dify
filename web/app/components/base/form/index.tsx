import { createFormHook, createFormHookContexts } from '@tanstack/react-form'
import CheckboxField from './components/field/checkbox'
import CustomSelectField from './components/field/custom-select'
import FileTypesField from './components/field/file-types'
import FileUploaderField from './components/field/file-uploader'
import InputTypeSelectField from './components/field/input-type-select'
import NumberInputField from './components/field/number-input'
import NumberSliderField from './components/field/number-slider'
import OptionsField from './components/field/options'
import SelectField from './components/field/select'
import TextField from './components/field/text'
import TextAreaField from './components/field/text-area'
import UploadMethodField from './components/field/upload-method'
import VariableOrConstantInputField from './components/field/variable-selector'
import Actions from './components/form/actions'

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
