import { generateZodSchema } from '@/app/components/base/form/form-scenarios/base/utils'
import { useConfigurations } from './hooks'
import Options from './options'
import Actions from './actions'
import type { FormType } from '@/app/components/base/form'
import { useCallback } from 'react'

type DocumentProcessingProps = {
  payload: any
  onProcess: (data: any) => void
  onBack: () => void
}

const DEFAULT_SEGMENT_IDENTIFIER = '\\n\\n'
const DEFAULT_MAXIMUM_CHUNK_LENGTH = 1024
const DEFAULT_OVERLAP = 50

const DocumentProcessing = ({
  payload,
  onProcess,
  onBack,
}: DocumentProcessingProps) => {
  const configurations = useConfigurations()
  const schema = generateZodSchema(configurations)

  const renderCustomActions = useCallback((form: FormType) => (
    <Actions form={form} onBack={onBack} />
  ), [onBack])

  return (
    <div>
      <Options
        initialData={{
          separator: DEFAULT_SEGMENT_IDENTIFIER,
          max_tokens: DEFAULT_MAXIMUM_CHUNK_LENGTH,
          chunk_overlap: DEFAULT_OVERLAP,
          remove_extra_spaces: true,
          remove_urls_emails: false,
        }}
        configurations={configurations}
        schema={schema}
        onSubmit={(data) => {
          onProcess(data)
        }}
        CustomActions={renderCustomActions}
      />
    </div>
  )
}

export default DocumentProcessing
