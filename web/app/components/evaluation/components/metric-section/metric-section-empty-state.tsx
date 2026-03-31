type MetricSectionEmptyStateProps = {
  description: string
}

const MetricSectionEmptyState = ({ description }: MetricSectionEmptyStateProps) => {
  return (
    <div className="flex items-center gap-5 rounded-xl bg-background-section p-3">
      <div className="flex size-10 shrink-0 items-center justify-center rounded-[10px] border-[0.5px] border-components-card-border bg-components-card-bg p-1 shadow-md">
        <span aria-hidden="true" className="i-ri-bar-chart-horizontal-line h-6 w-6 text-text-primary" />
      </div>
      <div className="min-w-0 flex-1 text-text-tertiary system-xs-regular">
        {description}
      </div>
    </div>
  )
}

export default MetricSectionEmptyState
