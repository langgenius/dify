import type { FormInputItem } from '@/app/components/workflow/nodes/human-input/types'
import type { HumanInputFormValue } from '@/types/workflow'
import * as React from 'react'
import { FileList } from '@/app/components/base/file-uploader'
import { getProcessedFilesFromResponse } from '@/app/components/base/file-uploader/utils'
import {
  isFileFormInput,
  isFileListFormInput,
} from '@/app/components/workflow/nodes/human-input/types'

type SubmittedFieldValuesProps = {
  fields?: FormInputItem[]
  values: Record<string, HumanInputFormValue>
}

const SubmittedFieldValues = ({
  fields,
  values,
}: SubmittedFieldValuesProps) => {
  const fieldNames = fields?.map(field => field.output_variable_name) ?? Object.keys(values)
  const fieldMap = new Map(fields?.map(field => [field.output_variable_name, field]) ?? [])

  return (
    <div className="flex flex-col gap-3" data-testid="submitted-field-values">
      {fieldNames.map((fieldName) => {
        const field = fieldMap.get(fieldName)
        const value = values[fieldName]

        if (value == null)
          return null

        let valueKind: 'text' | 'file' | 'file-list' = 'text'
        if (field && isFileFormInput(field))
          valueKind = 'file'
        else if (field && isFileListFormInput(field))
          valueKind = 'file-list'
        else if (typeof value === 'string')
          valueKind = 'text'
        else if (Array.isArray(value))
          valueKind = 'file-list'
        else
          valueKind = 'file'

        if (valueKind === 'file') {
          if (typeof value === 'string' || Array.isArray(value))
            return null

          return (
            <div key={fieldName} data-testid={`submitted-field-${fieldName}`}>
              <FileList
                files={getProcessedFilesFromResponse([value])}
                showDeleteAction={false}
                showDownloadAction
              />
            </div>
          )
        }

        if (valueKind === 'file-list') {
          if (typeof value === 'string' || !Array.isArray(value))
            return null

          return (
            <div key={fieldName} data-testid={`submitted-field-${fieldName}`}>
              <FileList
                files={getProcessedFilesFromResponse(value)}
                showDeleteAction={false}
                showDownloadAction
              />
            </div>
          )
        }

        return (
          <div
            key={fieldName}
            className="body-md-regular break-words text-text-primary"
            data-testid={`submitted-field-${fieldName}`}
          >
            {String(value)}
          </div>
        )
      })}
    </div>
  )
}

export default React.memo(SubmittedFieldValues)
