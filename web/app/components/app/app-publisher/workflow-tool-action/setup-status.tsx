type WorkflowToolSetupStatusProps = {
  label: string
}

const WorkflowToolSetupStatus = ({ label }: WorkflowToolSetupStatusProps) => {
  return (
    <span
      role="status"
      aria-label={label}
      className="rounded-[5px] border border-divider-deep bg-components-badge-bg-dimm px-1 py-0.5 system-2xs-medium-uppercase whitespace-nowrap text-text-tertiary"
    >
      {label}
    </span>
  )
}

export default WorkflowToolSetupStatus
