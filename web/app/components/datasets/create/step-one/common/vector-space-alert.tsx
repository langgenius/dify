'use client'
import VectorSpaceFull from '@/app/components/billing/vector-space-full'

type VectorSpaceAlertProps = {
  show: boolean
}

/**
 * Conditional vector space full alert component
 */
const VectorSpaceAlert = ({ show }: VectorSpaceAlertProps) => {
  if (!show)
    return null

  return (
    <div className="mb-4 max-w-[640px]">
      <VectorSpaceFull />
    </div>
  )
}

export default VectorSpaceAlert
