import React, { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useChatContext } from '../chat/chat/context'
import cn from '@/utils/classnames'

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
  const [startTime] = useState(() => Date.now())
  const [elapsedTime, setElapsedTime] = useState(0)
  const [isComplete, setIsComplete] = useState(false)
  const timerRef = useRef<NodeJS.Timeout | null>(null)

  useEffect(() => {
    if (isComplete) return

    timerRef.current = setInterval(() => {
      setElapsedTime(Math.floor((Date.now() - startTime) / 100) / 10)
    }, 100)

    return () => {
      if (timerRef.current)
        clearInterval(timerRef.current)
    }
  }, [startTime, isComplete])

  useEffect(() => {
    if (hasEndThink(children) || !isResponding)
      setIsComplete(true)
  }, [children, isResponding])

  return { elapsedTime, isComplete }
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
      <summary className="flex cursor-pointer select-none list-none items-center whitespace-nowrap pl-2 font-bold text-text-secondary">
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
          {isComplete ? `${t('common.chat.thought')}(${elapsedTime.toFixed(1)}s)` : `${t('common.chat.thinking')}(${elapsedTime.toFixed(1)}s)`}
        </div>
      </summary>
      <div className="ml-2 border-l border-components-panel-border bg-components-panel-bg-alt p-3 text-text-secondary">
        {displayContent}
      </div>
    </details>
  )
}

export default ThinkBlock
