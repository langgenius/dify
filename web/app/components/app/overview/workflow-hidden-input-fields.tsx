import type { ChangeEvent } from 'react'
import type { WorkflowHiddenStartVariable, WorkflowLaunchInputValue } from './app-card-utils'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@langgenius/dify-ui/select'
import Input from '@/app/components/base/input'
import Textarea from '@/app/components/base/textarea'

import { InputVarType } from '@/app/components/workflow/types'

type WorkflowHiddenInputFieldsProps = {
  hiddenVariables: WorkflowHiddenStartVariable[]
  values: Record<string, WorkflowLaunchInputValue>
  onValueChange: (variable: string, value: WorkflowLaunchInputValue) => void
  fieldIdPrefix?: string
}

const WorkflowHiddenInputFields = ({
  hiddenVariables,
  values,
  onValueChange,
  fieldIdPrefix = 'workflow-launch-hidden-input',
}: WorkflowHiddenInputFieldsProps) => {
  const renderField = (variable: WorkflowHiddenStartVariable) => {
    const fieldId = `${fieldIdPrefix}-${variable.variable}`
    const fieldValue = values[variable.variable]
    const label = typeof variable.label === 'string' ? variable.label : variable.variable

    if (variable.type === InputVarType.select) {
      return (
        <Select
          value={typeof fieldValue === 'string' ? fieldValue : ''}
          onValueChange={value => onValueChange(variable.variable, value ?? '')}
        >
          <SelectTrigger className="w-full" aria-label={label}>
            <SelectValue placeholder={label} />
          </SelectTrigger>
          <SelectContent>
            {(variable.options ?? []).map(option => (
              <SelectItem key={option} value={option}>
                {option}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      )
    }

    if (variable.type === InputVarType.checkbox) {
      return (
        <label className="flex min-h-10 w-full cursor-pointer items-center gap-3 rounded-lg bg-components-input-bg-normal px-3 py-2">
          <input
            id={fieldId}
            type="checkbox"
            checked={Boolean(fieldValue)}
            onChange={(event: ChangeEvent<HTMLInputElement>) => onValueChange(variable.variable, event.target.checked)}
            className="h-4 w-4 rounded border-divider-subtle"
          />
          <span className="system-sm-regular text-text-secondary">{label}</span>
        </label>
      )
    }

    if (
      variable.type === InputVarType.paragraph
      || variable.type === InputVarType.json
      || variable.type === InputVarType.jsonObject
    ) {
      return (
        <Textarea
          id={fieldId}
          value={typeof fieldValue === 'string' ? fieldValue : ''}
          onChange={(event: ChangeEvent<HTMLTextAreaElement>) => onValueChange(variable.variable, event.target.value)}
          placeholder={label}
          maxLength={variable.max_length}
          className="min-h-24"
        />
      )
    }

    return (
      <Input
        id={fieldId}
        type={variable.type === InputVarType.number ? 'number' : 'text'}
        value={typeof fieldValue === 'string' ? fieldValue : ''}
        onChange={(event: ChangeEvent<HTMLInputElement>) => onValueChange(variable.variable, event.target.value)}
        placeholder={label}
        maxLength={variable.max_length}
      />
    )
  }

  return (
    <>
      {hiddenVariables.map(variable => (
        <div key={variable.variable} className="space-y-1.5">
          {variable.type !== InputVarType.checkbox && (
            <label
              htmlFor={`${fieldIdPrefix}-${variable.variable}`}
              className="block system-sm-medium text-text-secondary"
            >
              {typeof variable.label === 'string' ? variable.label : variable.variable}
            </label>
          )}
          {renderField(variable)}
        </div>
      ))}
    </>
  )
}

export default WorkflowHiddenInputFields
