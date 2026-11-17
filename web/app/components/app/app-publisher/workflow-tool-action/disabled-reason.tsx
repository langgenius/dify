type WorkflowToolDisabledReasonProps = {
  id?: string
  message: string
}

const WorkflowToolDisabledReason = ({ id, message }: WorkflowToolDisabledReasonProps) => {
  return (
    <p id={id} className="mt-1 px-2.5 pb-2 system-xs-regular text-text-tertiary opacity-30">
      {message}
    </p>
  )
}

export default WorkflowToolDisabledReason
