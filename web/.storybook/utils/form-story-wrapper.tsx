import type { ReactNode } from 'react'
import { useStore } from '@tanstack/react-form'
import { useState } from 'react'
import { useAppForm } from '@/app/components/base/form'

type UseAppFormOptions = Parameters<typeof useAppForm>[0]
type AppFormInstance = ReturnType<typeof useAppForm>

type FormStoryWrapperProps = {
  options?: UseAppFormOptions
  children: (form: AppFormInstance) => ReactNode
  title?: string
  subtitle?: string
}

export const FormStoryWrapper = ({
  options,
  children,
  title,
  subtitle,
}: FormStoryWrapperProps) => {
  const [lastSubmitted, setLastSubmitted] = useState<unknown>(null)
  const [submitCount, setSubmitCount] = useState(0)

  const form = useAppForm({
    ...options,
    onSubmit: (context) => {
      setSubmitCount(count => count + 1)
      setLastSubmitted(context.value)
      options?.onSubmit?.(context)
    },
  })

  const values = useStore(form.store, state => state.values)
  const isSubmitting = useStore(form.store, state => state.isSubmitting)
  const canSubmit = useStore(form.store, state => state.canSubmit)

  return (
    <div className="flex flex-col gap-6 px-6 md:flex-row md:px-10">
      <div className="flex-1 space-y-4">
        {(title || subtitle) && (
          <header className="space-y-1">
            {title && <h3 className="text-lg font-semibold text-text-primary">{title}</h3>}
            {subtitle && <p className="text-sm text-text-tertiary">{subtitle}</p>}
          </header>
        )}
        {children(form)}
      </div>
      <aside className="w-full max-w-sm rounded-xl border border-divider-subtle bg-components-panel-bg p-4 text-xs text-text-secondary shadow-sm">
        <div className="flex items-center justify-between text-[11px] uppercase tracking-wide text-text-tertiary">
          <span>Form State</span>
          <span>
            {submitCount}
            {' '}
            submit
            {submitCount === 1 ? '' : 's'}
          </span>
        </div>
        <dl className="mt-2 space-y-1">
          <div className="flex items-center justify-between rounded-md bg-components-button-tertiary-bg px-2 py-1">
            <dt className="font-medium text-text-secondary">isSubmitting</dt>
            <dd className="font-mono text-[11px] text-text-primary">{String(isSubmitting)}</dd>
          </div>
          <div className="flex items-center justify-between rounded-md bg-components-button-tertiary-bg px-2 py-1">
            <dt className="font-medium text-text-secondary">canSubmit</dt>
            <dd className="font-mono text-[11px] text-text-primary">{String(canSubmit)}</dd>
          </div>
        </dl>
        <div className="mt-3 space-y-2">
          <div>
            <div className="mb-1 font-medium text-text-secondary">Current Values</div>
            <pre className="max-h-48 overflow-auto rounded-md bg-background-default-subtle p-3 font-mono text-[11px] leading-tight text-text-primary">
              {JSON.stringify(values, null, 2)}
            </pre>
          </div>
          <div>
            <div className="mb-1 font-medium text-text-secondary">Last Submission</div>
            <pre className="max-h-40 overflow-auto rounded-md bg-background-default-subtle p-3 font-mono text-[11px] leading-tight text-text-primary">
              {lastSubmitted ? JSON.stringify(lastSubmitted, null, 2) : '—'}
            </pre>
          </div>
        </div>
      </aside>
    </div>
  )
}

export type FormStoryRender = (form: AppFormInstance) => ReactNode
