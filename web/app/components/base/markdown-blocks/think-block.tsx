import * as React from 'react'
import { useChatContext } from '../chat/chat/context'
import ThinkingDetails from './thinking-details'
import { useElapsedTimer } from './use-elapsed-timer'

const hasEndThink = (children: any): boolean => {
  if (typeof children === 'string')
    return children.includes('[ENDTHINKFLAG]')

  if (Array.isArray(children))
    return children.some(child => hasEndThink(child))

  if (children?.props?.children)
    return hasEndThink(children.props.children)

  return false
}

const removeEndThink = (children: any): any => {
  if (typeof children === 'string')
    return children.replace('[ENDTHINKFLAG]', '')

  if (Array.isArray(children))
    return children.map(child => removeEndThink(child))

  if (children?.props?.children) {
    return React.cloneElement(
      children,
      {
        ...children.props,
        children: removeEndThink(children.props.children),
      },
    )
  }

  return children
}

const useThinkTimer = (children: any) => {
  const { isResponding } = useChatContext()
  const endThinkDetected = hasEndThink(children)
  // Stop when the marker arrives (normal completion) or the response is no longer
  // active (false = user stopped, undefined = historical conversation).
  return useElapsedTimer(endThinkDetected || !isResponding)
}

type ThinkBlockProps = React.ComponentProps<'details'> & {
  'data-think'?: boolean
}

const ThinkBlock = ({ children, ...props }: ThinkBlockProps) => {
  const { elapsedTime, isComplete } = useThinkTimer(children)
  const displayContent = removeEndThink(children)
  const { 'data-think': isThink = false, className, open, ...rest } = props

  if (!isThink)
    return (<details {...props}>{children}</details>)

  return (
    <ThinkingDetails
      {...rest}
      data-think={isThink}
      className={className}
      open={open}
      isComplete={isComplete}
      elapsedTime={elapsedTime}
    >
      {displayContent}
    </ThinkingDetails>
  )
}

export default ThinkBlock
