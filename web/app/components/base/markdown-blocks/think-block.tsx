import * as React from 'react'
import { useChatContext } from '../chat/chat/context'
import ThinkingDetails from './thinking-details'
import { useElapsedTimer } from './use-elapsed-timer'

const hasEndThink = (children: React.ReactNode): boolean => {
  if (typeof children === 'string') return children.includes('[ENDTHINKFLAG]')

  if (Array.isArray(children)) return children.some((child) => hasEndThink(child))

  if (React.isValidElement<{ children?: React.ReactNode }>(children))
    return hasEndThink(children.props.children)

  return false
}

const removeEndThink = (children: React.ReactNode): React.ReactNode => {
  if (typeof children === 'string') return children.replace('[ENDTHINKFLAG]', '')

  if (Array.isArray(children)) return children.map((child) => removeEndThink(child))

  if (React.isValidElement<{ children?: React.ReactNode }>(children))
    return React.cloneElement(children, undefined, removeEndThink(children.props.children))

  return children
}

const useThinkTimer = (children: React.ReactNode, responseState?: 'active' | 'complete') => {
  const { isResponding } = useChatContext()
  const endThinkDetected = hasEndThink(children)
  const responseActive = responseState ? responseState === 'active' : isResponding === true
  // Stop when the marker arrives (normal completion) or the response is no longer
  // active (false = user stopped, undefined = historical conversation).
  return useElapsedTimer(endThinkDetected || !responseActive)
}

type ThinkBlockProps = React.ComponentProps<'details'> & {
  'data-think'?: boolean
  responseState?: 'active' | 'complete'
}

const ThinkBlock = ({ children, responseState, ...props }: ThinkBlockProps) => {
  const { elapsedTime, hasStarted, isComplete } = useThinkTimer(children, responseState)
  const displayContent = removeEndThink(children)
  const { 'data-think': isThink = false, className, open, ...rest } = props

  if (!isThink) return <details {...props}>{children}</details>

  return (
    <ThinkingDetails
      {...rest}
      data-think={isThink}
      className={className}
      open={open}
      isComplete={isComplete}
      elapsedTime={hasStarted ? elapsedTime : undefined}
    >
      {displayContent}
    </ThinkingDetails>
  )
}

export default ThinkBlock
