type WorkflowToolLoadingStatusProps = {
  label: string
}

const WorkflowToolLoadingStatus = ({ label }: WorkflowToolLoadingStatusProps) => {
  return (
    <span
      role="status"
      aria-label={label}
      className="i-ri-loader-2-line size-4 animate-spin motion-reduce:animate-none"
    />
  )
}

export default WorkflowToolLoadingStatus
