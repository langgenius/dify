import type { CSSProperties } from 'react'
import { cn } from '@langgenius/dify-ui/cn'
import { memo } from 'react'
import style from './index.module.css'

type SimplePieChartProps = {
  percentage?: number
  fill?: string
  stroke?: string
  size?: number
  animationDuration?: number
  className?: string
}

const SimplePieChart = ({
  percentage = 80,
  fill = '#fdb022',
  stroke = '#f79009',
  size = 12,
  animationDuration,
  className,
}: SimplePieChartProps) => {
  return (
    <div
      className={cn(style.simplePieChart, className)}
      style={
        {
          '--simple-pie-chart-color': fill,
          '--simple-pie-chart-stroke': stroke,
          '--simple-pie-chart-percentage': Math.min(100, Math.max(0, percentage)),
          '--simple-pie-chart-duration': `${animationDuration ?? 600}ms`,
          width: size,
          height: size,
        } as CSSProperties
      }
    />
  )
}

export default memo(SimplePieChart)
