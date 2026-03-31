type MetricSectionEmptyStateProps = {
  description: string
}

const MetricSectionEmptyState = ({ description }: MetricSectionEmptyStateProps) => {
  return (
    <div className="rounded-xl bg-background-section px-4 py-4 text-text-tertiary system-xs-regular">
      {description}
    </div>
  )
}

export default MetricSectionEmptyState
