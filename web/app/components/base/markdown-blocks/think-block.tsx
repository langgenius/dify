import React, { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'

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
  const [startTime] = useState(Date.now())
  const [elapsedTime, setElapsedTime] = useState(0)
  const [isComplete, setIsComplete] = useState(false)
  const timerRef = useRef<NodeJS.Timeout>()

  useEffect(() => {
    timerRef.current = setInterval(() => {
      if (!isComplete)
        setElapsedTime(Math.floor((Date.now() - startTime) / 100) / 10)
    }, 100)

    return () => {
      if (timerRef.current)
        clearInterval(timerRef.current)
    }
  }, [startTime, isComplete])

  useEffect(() => {
    if (hasEndThink(children)) {
      setIsComplete(true)
      if (timerRef.current)
        clearInterval(timerRef.current)
    }
  }, [children])

  return { elapsedTime, isComplete }
}

export const ThinkBlock = ({ children, ...props }: any) => {
  const { elapsedTime, isComplete } = useThinkTimer(children)
  const displayContent = removeEndThink(children)
  const { t } = useTranslation()

  if (!(props['data-think'] ?? false))
    return (<details {...props}>{children}</details>)

  return (
    <details {...(!isComplete && { open: true })} className="group">
      <summary className="flex cursor-pointer select-none list-none items-center whitespace-nowrap pl-2 font-bold text-gray-500">
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
      <div className="ml-2 border-l border-gray-300 bg-gray-50 p-3 text-gray-500">
        {displayContent}
      </div>
    </details>
  )
}

export default ThinkBlock
