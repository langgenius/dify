import { PlanFeatureInfotip } from './infotip'

export function CloudPlanFeature({ label, description }: { label: string; description?: string }) {
  return (
    <div className="flex items-center">
      <span className="grow system-sm-regular text-text-secondary">{label}</span>
      {description && <PlanFeatureInfotip label={label} content={description} />}
    </div>
  )
}
