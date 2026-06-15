import * as React from 'react'
import { useCallback } from 'react'

type MoreProps = {
  count: number
  onClick?: () => void
}

const More = ({ count, onClick }: MoreProps) => {
  const formatNumber = (num: number) => {
    if (num === 0)
      return '0'
    if (num < 1000)
      return num.toString()
    if (num < 1000000)
      return `${(num / 1000).toFixed(1)}k`
    return `${(num / 1000000).toFixed(1)}M`
  }

  const handleClick = useCallback((e: React.MouseEvent<HTMLButtonElement>) => {
    e.stopPropagation()
    e.preventDefault()
    onClick?.()
  }, [onClick])

  const label = `+${formatNumber(count)}`

  return (
    <button
      type="button"
      className="relative block size-8 cursor-pointer border-none bg-transparent p-[0.5px] text-center"
      onClick={handleClick}
    >
      <div className="relative z-10 size-full rounded-md border-[1.5px] border-components-panel-bg bg-divider-regular">
        <div className="flex size-full items-center justify-center">
          <span className="system-xs-regular text-text-tertiary">
            {label}
          </span>
        </div>
      </div>
      <div className="absolute top-1 -right-0.5 z-0 h-6 w-1 rounded-r-md bg-divider-regular" />
    </button>
  )
}

export default React.memo(More)
