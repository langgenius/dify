import { useTranslation } from 'react-i18next'

export function VersionFilterEmpty({
  onReset,
}: {
  onReset: () => void
}) {
  const { t: tWorkflow } = useTranslation('workflow')

  return (
    <div className="rounded-lg border border-components-panel-border bg-components-panel-on-panel-item-bg px-3 py-6 text-center">
      <p className="system-sm-regular text-text-tertiary">
        {tWorkflow('versionHistory.filter.empty')}
      </p>
      <button
        type="button"
        onClick={onReset}
        className="mt-2 rounded-md px-2 py-1 system-xs-medium text-text-accent hover:bg-state-base-hover focus-visible:ring-2 focus-visible:ring-state-accent-solid focus-visible:outline-hidden"
      >
        {tWorkflow('versionHistory.filter.reset')}
      </button>
    </div>
  )
}
