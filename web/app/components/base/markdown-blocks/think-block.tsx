import { cn } from '@langgenius/dify-ui/cn'
import * as React from 'react'
import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useChatContext } from '../chat/chat/context'

const hasEndThink = (children: React.ReactNode): boolean => {
  if (typeof children === 'string')
    return children.includes('[ENDTHINKFLAG]')

  if (Array.isArray(children))
    return children.some(child => hasEndThink(child))

  if (React.isValidElement<{ children?: React.ReactNode }>(children) && children.props.children)
    return hasEndThink(children.props.children)

  return false
}

const removeEndThink = (children: React.ReactNode): React.ReactNode => {
  if (typeof children === 'string')
    return children.replace('[ENDTHINKFLAG]', '')

  if (Array.isArray(children))
    return children.map(child => removeEndThink(child))

  if (React.isValidElement<{ children?: React.ReactNode }>(children) && children.props.children) {
    return React.cloneElement(
      children,
      undefined,
      removeEndThink(children.props.children),
    )
  }

  return children
}

const getElapsedSeconds = (startTime: number, endTime: number) => {
  return Math.floor((endTime - startTime) / 100) / 10
}

const useThinkTimer = (children: React.ReactNode) => {
  const { isResponding } = useChatContext()
  const endThinkDetected = hasEndThink(children)
  const [startTime] = useState(() => Date.now())
  const [elapsedTime, setElapsedTime] = useState(0)
  const timerRef = useRef<NodeJS.Timeout | null>(null)
  const finalElapsedTimeRef = useRef<number | null>(null)
  const completionDetected = endThinkDetected || !isResponding

  if (completionDetected && finalElapsedTimeRef.current === null)
    finalElapsedTimeRef.current = getElapsedSeconds(startTime, Date.now())

  const isComplete = finalElapsedTimeRef.current !== null

  useEffect(() => {
    if (isComplete)
      return

    timerRef.current = setInterval(() => {
      setElapsedTime(getElapsedSeconds(startTime, Date.now()))
    }, 100)

    return () => {
      if (timerRef.current)
        clearInterval(timerRef.current)
    }
  }, [startTime, isComplete])

  return {
    elapsedTime: finalElapsedTimeRef.current === null
      ? elapsedTime
      : Math.max(elapsedTime, finalElapsedTimeRef.current),
    isComplete,
  }
}

type ThinkBlockProps = React.ComponentProps<'details'> & {
  'data-think'?: boolean
}

const ThinkBlock = ({ children, ...props }: ThinkBlockProps) => {
  const { elapsedTime, isComplete } = useThinkTimer(children)
  const displayContent = removeEndThink(children)
  const { t } = useTranslation()
  const { 'data-think': isThink = false, className, open, ...rest } = props

  if (!isThink)
    return (<details {...props}>{children}</details>)

  return (
    <details
      {...rest}
      data-think={isThink}
      className={cn('group', className)}
      open={isComplete ? open : true}
    >
      <summary className="flex cursor-pointer list-none items-center pl-2 font-bold whitespace-nowrap text-text-secondary select-none">
        <div className="flex shrink-0 items-center">
          <svg
            className="mr-2 h-3 w-3 transition-transform duration-500 group-open:rotate-90"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M9 5l7 7-7 7"
            />
          </svg>
          {isComplete ? `${t('chat.thought', { ns: 'common' })}(${elapsedTime.toFixed(1)}s)` : `${t('chat.thinking', { ns: 'common' })}(${elapsedTime.toFixed(1)}s)`}
        </div>
      </summary>
      <div className="ml-2 border-l border-components-panel-border bg-components-panel-bg-alt p-3 text-text-secondary">
        {displayContent}
      </div>
    </details>
  )
}

export default ThinkBlock
