import { Input } from '@langgenius/dify-ui/input'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectItemIndicator,
  SelectItemText,
  SelectTrigger,
} from '@langgenius/dify-ui/select'
import { Textarea } from '@langgenius/dify-ui/textarea'
import { useCallback, useId } from 'react'
import { useTranslation } from 'react-i18next'
import { FileUploaderInAttachmentWrapper } from '@/app/components/base/file-uploader'
import { InputVarType } from '@/app/components/workflow/types'

type Props = Readonly<{
  inputsForms: any[]
  inputs: Record<string, any>
  inputsRef: any
  onFormChange: (value: Record<string, any>) => void
}>
const AppInputsForm = ({ inputsForms, inputs, inputsRef, onFormChange }: Props) => {
  const { t } = useTranslation()
  const baseId = useId()

  const handleFormChange = useCallback(
    (variable: string, value: any) => {
      onFormChange({
        ...inputsRef.current,
        [variable]: value,
      })
    },
    [onFormChange, inputsRef],
  )

  const renderField = (form: any, labelId: string) => {
    const { label, variable, options } = form
    if (form.type === InputVarType.textInput) {
      return (
        <Input
          aria-labelledby={labelId}
          value={inputs[variable] || ''}
          onValueChange={(value) => handleFormChange(variable, value)}
          placeholder={label}
        />
      )
    }
    if (form.type === InputVarType.number) {
      return (
        <Input
          aria-labelledby={labelId}
          type="number"
          value={inputs[variable] || ''}
          onValueChange={(value) => handleFormChange(variable, value)}
          placeholder={label}
        />
      )
    }
    if (form.type === InputVarType.paragraph) {
      return (
        <Textarea
          aria-labelledby={labelId}
          value={inputs[variable] || ''}
          onValueChange={(value) => handleFormChange(variable, value)}
          placeholder={label}
        />
      )
    }
    if (form.type === InputVarType.select) {
      const selectOptions: Array<{ value: string; name: string }> = options.map(
        (option: string) => ({ value: option, name: option }),
      )
      const selectedOption =
        selectOptions.find((option) => option.value === (inputs[variable] || '')) ?? null

      return (
        <Select
          value={selectedOption?.value ?? null}
          onValueChange={(value) => value && handleFormChange(variable, value)}
        >
          <SelectTrigger aria-labelledby={labelId} className="w-full">
            {selectedOption?.name ?? label}
          </SelectTrigger>
          <SelectContent>
            {selectOptions.map((option) => (
              <SelectItem key={option.value} value={option.value}>
                <SelectItemText>{option.name}</SelectItemText>
                <SelectItemIndicator />
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      )
    }
    if (form.type === InputVarType.singleFile) {
      return (
        <FileUploaderInAttachmentWrapper
          value={inputs[variable] ? [inputs[variable]] : []}
          onChange={(files) => handleFormChange(variable, files[0])}
          fileConfig={{
            allowed_file_types: form.allowed_file_types,
            allowed_file_extensions: form.allowed_file_extensions,
            allowed_file_upload_methods: form.allowed_file_upload_methods,
            number_limits: 1,
            fileUploadConfig: (form as any).fileUploadConfig,
          }}
        />
      )
    }
    if (form.type === InputVarType.multiFiles) {
      return (
        <FileUploaderInAttachmentWrapper
          value={inputs[variable]}
          onChange={(files) => handleFormChange(variable, files)}
          fileConfig={{
            allowed_file_types: form.allowed_file_types,
            allowed_file_extensions: form.allowed_file_extensions,
            allowed_file_upload_methods: form.allowed_file_upload_methods,
            number_limits: form.max_length,
            fileUploadConfig: (form as any).fileUploadConfig,
          }}
        />
      )
    }
  }

  if (!inputsForms.length) return null

  return (
    <div className="flex flex-col gap-4 px-4 py-2">
      {inputsForms.map((form) => {
        const labelId = `${baseId}-${form.variable}-label`

        return (
          <div key={form.variable}>
            <div className="mb-1 flex h-6 items-center gap-1 system-sm-semibold text-text-secondary">
              <div id={labelId} className="truncate">
                {form.label}
              </div>
              {!form.required && (
                <span className="system-xs-regular text-text-tertiary">
                  {t(($) => $['panel.optional'], { ns: 'workflow' })}
                </span>
              )}
            </div>
            {renderField(form, labelId)}
          </div>
        )
      })}
    </div>
  )
}

export default AppInputsForm
