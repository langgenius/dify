'use client'
import type { App } from '@/types/app'
import { useRef } from 'react'
import { useTranslation } from 'react-i18next'
import Loading from '@/app/components/base/loading'
import AppInputsForm from '@/app/components/plugins/plugin-detail-panel/app-selector/app-inputs-form'
import { useAppInputsFormSchema } from '@/app/components/plugins/plugin-detail-panel/app-selector/hooks/use-app-inputs-form-schema'
import { cn } from '@/utils/classnames'

type Props = {
  value?: {
    app_id: string
    inputs: Record<string, unknown>
  }
  appDetail: App
  onFormChange: (value: Record<string, unknown>) => void
}

const AppInputsPanel = ({
  value,
  appDetail,
  onFormChange,
}: Props) => {
  const { t } = useTranslation()
  const inputsRef = useRef<Record<string, unknown>>(value?.inputs || {})

  const { inputFormSchema, isLoading } = useAppInputsFormSchema({ appDetail })

  const handleFormChange = (newValue: Record<string, unknown>) => {
    inputsRef.current = newValue
    onFormChange(newValue)
  }

  const hasInputs = inputFormSchema.length > 0

  return (
    <div className={cn('flex max-h-[240px] flex-col rounded-b-2xl border-t border-divider-subtle pb-4')}>
      {isLoading && <div className="pt-3"><Loading type="app" /></div>}
      {!isLoading && (
        <div className="system-sm-semibold mb-2 mt-3 flex h-6 shrink-0 items-center px-4 text-text-secondary">
          {t('appSelector.params', { ns: 'app' })}
        </div>
      )}
      {!isLoading && !hasInputs && (
        <div className="flex h-16 flex-col items-center justify-center">
          <div className="system-sm-regular text-text-tertiary">
            {t('appSelector.noParams', { ns: 'app' })}
          </div>
        </div>
      )}
      {!isLoading && hasInputs && (
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
