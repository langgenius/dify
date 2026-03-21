import type { RAGPipelineVariables } from '@/models/pipeline'
import { useAppForm } from '@/app/components/base/form'
import BaseField from '@/app/components/base/form/form-scenarios/base/field'
import { useConfigurations, useInitialData } from '@/app/components/rag-pipeline/hooks/use-input-fields'

type FormProps = {
  variables: RAGPipelineVariables
}

const Form = ({
  variables,
}: FormProps) => {
  const initialData = useInitialData(variables)
  const configurations = useConfigurations(variables)

  const form = useAppForm({
    defaultValues: initialData,
  })

  return (
    <form
      className="w-full"
      onSubmit={(e) => {
        e.preventDefault()
        e.stopPropagation()
      }}
    >
      <div className="flex flex-col gap-y-3 px-4 py-3">
        {configurations.map((config, index) => {
          const FieldComponent = BaseField({
            initialData,
            config,
          })
          return <FieldComponent key={index} form={form} />
        })}
      </div>
    </form>
  )
}

export default Form
