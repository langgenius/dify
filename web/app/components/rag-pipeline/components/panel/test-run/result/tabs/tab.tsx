import React, { useCallback } from 'react'
import cn from '@/utils/classnames'
import type { WorkflowRunningData } from '@/app/components/workflow/types'

type TabProps = {
  isActive: boolean
  label: string
  value: string
  workflowRunningData?: WorkflowRunningData
  onClick: (value: string) => void
}

const Tab = ({ isActive, label, value, workflowRunningData, onClick }: TabProps) => {
  const handleClick = useCallback(() => {
    onClick(value)
  }, [value, onClick])

  return (
    <button
      type='button'
      className={cn(
        'system-sm-semibold-uppercase cursor-pointer border-b-2 border-transparent py-3 text-text-tertiary',
        isActive && 'border-util-colors-blue-brand-blue-brand-600 text-text-primary',
        !workflowRunningData && '!cursor-not-allowed opacity-30',
      )}
      onClick={handleClick}
      disabled={!workflowRunningData}
    >
      {label}
    </button>
  )
}

export default React.memo(Tab)
