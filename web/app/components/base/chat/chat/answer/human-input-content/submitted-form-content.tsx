import type { FormInputItem } from '@/app/components/workflow/nodes/human-input/types'
import type { HumanInputFormValue } from '@/types/workflow'
import * as React from 'react'
import SubmittedContentItem from './submitted-content-item'
import { splitByOutputVar } from './utils'

type SubmittedFormContentProps = {
  formContent: string
  formInputFields: FormInputItem[]
  values: Record<string, HumanInputFormValue>
}

const SubmittedFormContent = ({
  formContent,
  formInputFields,
  values,
}: SubmittedFormContentProps) => {
  const contentList = splitByOutputVar(formContent)

  return (
    <div data-testid="submitted-form-content">
      {contentList.map((content, index) => (
        <SubmittedContentItem
          key={index}
          content={content}
          formInputFields={formInputFields}
          values={values}
        />
      ))}
    </div>
  )
}

export default React.memo(SubmittedFormContent)
