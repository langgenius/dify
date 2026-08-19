'use client'
import type { AppDetailWithSite } from '@dify/contracts/api/console/apps/types.gen'
import { Button } from '@langgenius/dify-ui/button'
import { cn } from '@langgenius/dify-ui/cn'
import { useRef } from 'react'
import { useTranslation } from 'react-i18next'
import Loading from '@/app/components/base/loading'
import AppInputsForm from '@/app/components/plugins/plugin-detail-panel/app-selector/app-inputs-form'
import { useAppInputsFormSchema } from '@/app/components/plugins/plugin-detail-panel/app-selector/hooks/use-app-inputs-form-schema'

type Props = Readonly<{
  value?: {
    app_id: string
    inputs: Record<string, unknown>
  }
  appDetail: Pick<AppDetailWithSite, 'id' | 'mode'>
  onFormChange: (value: Record<string, unknown>) => void
}>

const AppInputsPanel = ({ value, appDetail, onFormChange }: Props) => {
  const { t } = useTranslation()
  const inputsRef = useRef<Record<string, unknown>>(value?.inputs || {})

  const { inputFormSchema, isError, isLoading, retry } = useAppInputsFormSchema({ appDetail })

  const handleFormChange = (newValue: Record<string, unknown>) => {
    inputsRef.current = newValue
    onFormChange(newValue)
  }

  const hasInputs = inputFormSchema.length > 0

  return (
    <div className={cn('flex max-h-60 flex-col rounded-b-2xl border-t border-divider-subtle pb-4')}>
      {isLoading && (
        <div className="pt-3">
          <Loading type="app" />
        </div>
      )}
      {!isLoading && isError && (
        <div
          className="flex h-20 flex-col items-center justify-center gap-2 px-4 system-xs-regular text-text-tertiary"
          role="alert"
        >
          <span>{t(($) => $['errorBoundary.title'], { ns: 'common' })}</span>
          <Button size="small" variant="secondary" onClick={retry}>
            {t(($) => $['operation.retry'], { ns: 'common' })}
          </Button>
        </div>
      )}
      {!isLoading && !isError && (
        <div className="mt-3 mb-2 flex h-6 shrink-0 items-center px-4 system-sm-semibold text-text-secondary">
          {t(($) => $['appSelector.params'], { ns: 'app' })}
        </div>
      )}
      {!isLoading && !isError && !hasInputs && (
        <div className="flex h-16 flex-col items-center justify-center">
          <div className="system-sm-regular text-text-tertiary">
            {t(($) => $['appSelector.noParams'], { ns: 'app' })}
          </div>
        </div>
      )}
      {!isLoading && !isError && hasInputs && (
        <div className="grow overflow-y-auto">
          <AppInputsForm
            inputs={value?.inputs || {}}
            inputsRef={inputsRef}
            inputsForms={inputFormSchema}
            onFormChange={handleFormChange}
          />
        </div>
      )}
    </div>
  )
}

export default AppInputsPanel
