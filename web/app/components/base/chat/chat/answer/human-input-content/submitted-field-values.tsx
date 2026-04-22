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
  fields: FormInputItem[]
  values: Record<string, HumanInputFormValue>
}

const SubmittedFieldValues = ({
  fields,
  values,
}: SubmittedFieldValuesProps) => {
  return (
    <div className="flex flex-col gap-3" data-testid="submitted-field-values">
      {fields.map((field) => {
        const value = values[field.output_variable_name]

        if (value == null)
          return null

        if (isFileFormInput(field)) {
          if (typeof value === 'string' || Array.isArray(value))
            return null

          return (
            <div key={field.output_variable_name} data-testid={`submitted-field-${field.output_variable_name}`}>
              <FileList
                files={getProcessedFilesFromResponse([value])}
                showDeleteAction={false}
                showDownloadAction
              />
            </div>
          )
        }

        if (isFileListFormInput(field)) {
          if (typeof value === 'string' || !Array.isArray(value))
            return null

          return (
            <div key={field.output_variable_name} data-testid={`submitted-field-${field.output_variable_name}`}>
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
            key={field.output_variable_name}
            className="body-md-regular break-words text-text-primary"
            data-testid={`submitted-field-${field.output_variable_name}`}
          >
            {String(value)}
          </div>
        )
      })}
    </div>
  )
}

export default React.memo(SubmittedFieldValues)
