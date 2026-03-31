type MetricSectionEmptyStateProps = {
  description: string
}

const MetricSectionEmptyState = ({ description }: MetricSectionEmptyStateProps) => {
  return (
    <div className="flex items-center gap-5 rounded-xl bg-background-section px-3 py-3">
      <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-[10px] border-[0.5px] border-components-card-border bg-components-card-bg shadow-md">
        <span aria-hidden="true" className="i-ri-bar-chart-horizontal-line h-6 w-6 text-text-primary" />
      </div>
      <div className="text-text-tertiary system-xs-regular">
        {description}
      </div>
    </div>
  )
}

export default MetricSectionEmptyState
