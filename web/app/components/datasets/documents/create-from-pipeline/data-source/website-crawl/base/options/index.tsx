import type { RAGPipelineVariables } from '@/models/pipeline'
import { RiPlayLargeLine } from '@remixicon/react'
import { useBoolean } from 'ahooks'
import { useEffect, useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import Button from '@/app/components/base/button'
import { useAppForm } from '@/app/components/base/form'
import BaseField from '@/app/components/base/form/form-scenarios/base/field'
import { generateZodSchema } from '@/app/components/base/form/form-scenarios/base/utils'
import { ArrowDownRoundFill } from '@/app/components/base/icons/src/vender/solid/general'
import Toast from '@/app/components/base/toast'
import { useConfigurations, useInitialData } from '@/app/components/rag-pipeline/hooks/use-input-fields'
import { CrawlStep } from '@/models/datasets'
import { cn } from '@/utils/classnames'

const I18N_PREFIX = 'stepOne.website'

type OptionsProps = {
  variables: RAGPipelineVariables
  step: CrawlStep
  runDisabled?: boolean
  onSubmit: (data: Record<string, any>) => void
}

const Options = ({
  variables,
  step,
  runDisabled,
  onSubmit,
}: OptionsProps) => {
  const { t } = useTranslation()
  const initialData = useInitialData(variables)
  const configurations = useConfigurations(variables)
  const schema = useMemo(() => {
    return generateZodSchema(configurations)
  }, [configurations])

  const form = useAppForm({
    defaultValues: initialData,
    validators: {
      onSubmit: ({ value }) => {
        const result = schema.safeParse(value)
        if (!result.success) {
          const issues = result.error.issues
          const firstIssue = issues[0]
          const errorMessage = `"${firstIssue.path.join('.')}" ${firstIssue.message}`
          Toast.notify({
            type: 'error',
            message: errorMessage,
          })
          return errorMessage
        }
        return undefined
      },
    },
    onSubmit: ({ value }) => {
      onSubmit(value)
    },
  })

  const [fold, {
    toggle: foldToggle,
    setTrue: foldHide,
    setFalse: foldShow,
  }] = useBoolean(false)

  useEffect(() => {
    // When the step change
    if (step !== CrawlStep.init)
      foldHide()
    else
      foldShow()
  }, [step])

  const isRunning = useMemo(() => step === CrawlStep.running, [step])

  return (
    <form
      className="w-full"
      onSubmit={(e) => {
        e.preventDefault()
        e.stopPropagation()
        form.handleSubmit()
      }}
    >
      <div className="flex items-center gap-x-1 px-4 py-2">
        <div
          className="flex grow cursor-pointer select-none items-center gap-x-0.5"
          onClick={foldToggle}
        >
          <span className="system-sm-semibold-uppercase text-text-secondary">
            {t(`${I18N_PREFIX}.options`, { ns: 'datasetCreation' })}
          </span>
          <ArrowDownRoundFill className={cn('h-4 w-4 shrink-0 text-text-quaternary', fold && '-rotate-90')} />
        </div>
        <Button
          variant="primary"
          onClick={form.handleSubmit}
          disabled={runDisabled || isRunning}
          loading={isRunning}
          className="shrink-0 gap-x-0.5"
          spinnerClassName="!ml-0"
        >
          <RiPlayLargeLine className="size-4" />
          <span className="px-0.5">{!isRunning ? t(`${I18N_PREFIX}.run`, { ns: 'datasetCreation' }) : t(`${I18N_PREFIX}.running`, { ns: 'datasetCreation' })}</span>
        </Button>
      </div>
      {!fold && (
        <div className="flex flex-col gap-3 border-t border-divider-subtle px-4 py-3">
          {configurations.map((config, index) => {
            const FieldComponent = BaseField({
              initialData,
              config,
            })
            return <FieldComponent key={index} form={form} />
          })}
        </div>
      )}
    </form>
  )
}

export default Options
