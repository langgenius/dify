type WorkflowToolDisabledReasonProps = {
  message: string
}

const WorkflowToolDisabledReason = ({ message }: WorkflowToolDisabledReasonProps) => {
  return (
    <p className="mt-1 px-2.5 pb-2 system-xs-regular text-text-tertiary opacity-30">{message}</p>
  )
}

export default WorkflowToolDisabledReason
