export function SelfHostedPlanFeature({ label }: { label: string }) {
  return (
    <div className="flex items-center gap-x-1">
      <div className="py-px">
        <span aria-hidden className="i-ri-check-line size-4 shrink-0 text-text-tertiary" />
      </div>
      <span className="grow system-sm-regular text-text-secondary">{label}</span>
    </div>
  )
}
