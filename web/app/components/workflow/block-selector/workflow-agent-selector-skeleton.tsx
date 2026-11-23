import { useTranslation } from 'react-i18next'

export function WorkflowAgentSelectorSkeleton() {
  const { t } = useTranslation(['common'])
  return (
    <div role="status" aria-label={t(($) => $.loading)}>
      <div aria-hidden className="space-y-1 p-2">
        {[0, 1, 2].map((item) => (
          <div key={item} className="flex h-8 items-center gap-2 opacity-20">
            <span className="size-6 rounded-md bg-text-quaternary" />
            <span className="h-2 w-32 rounded-xs bg-text-quaternary" />
          </div>
        ))}
      </div>
    </div>
  )
}
