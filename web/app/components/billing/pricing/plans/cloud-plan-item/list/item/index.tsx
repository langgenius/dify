import { PlanFeatureInfotip } from './infotip'

export function CloudPlanFeature({ label, description }: { label: string; description?: string }) {
  return (
    <div className="flex min-h-4.5 items-center">
      <span className="min-w-0 grow system-sm-regular wrap-anywhere text-text-secondary">
        {label}
      </span>
      {description && <PlanFeatureInfotip label={label} content={description} />}
    </div>
  )
}
