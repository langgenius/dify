import { memo } from 'react'
import cn from '@/utils/classnames'

type ProgressCircleProps = {
  className?: string
  percentage?: number
  size?: number
  circleStrokeWidth?: number
  circleStrokeColor?: string
  circleFillColor?: string
  sectorFillColor?: string
}

const ProgressCircle: React.FC<ProgressCircleProps> = ({
  className,
  percentage = 0,
  size = 12,
  circleStrokeWidth = 1,
  circleStrokeColor = 'stroke-components-progress-brand-border',
  circleFillColor = 'fill-components-progress-brand-bg',
  sectorFillColor = 'fill-components-progress-brand-progress',
}) => {
  const radius = size / 2
  const center = size / 2
  const angle = (percentage / 101) * 360
  const radians = (angle * Math.PI) / 180
  const x = center + radius * Math.cos(radians - Math.PI / 2)
  const y = center + radius * Math.sin(radians - Math.PI / 2)
  const largeArcFlag = percentage > 50 ? 1 : 0

  const pathData = `
    M ${center},${center}
    L ${center},${center - radius}
    A ${radius},${radius} 0 ${largeArcFlag} 1 ${x},${y}
    Z
  `

  return (
    <svg
      width={size + circleStrokeWidth}
      height={size + circleStrokeWidth}
      viewBox={`0 0 ${size + circleStrokeWidth} ${size + circleStrokeWidth}`}
      className={className}
    >
      <circle
        className={cn(
          circleFillColor,
          circleStrokeColor,
        )}
        cx={center + circleStrokeWidth / 2}
        cy={center + circleStrokeWidth / 2}
        r={radius}
        strokeWidth={circleStrokeWidth}
      />
      <path
        className={cn(sectorFillColor)}
        d={pathData}
        transform={`translate(${circleStrokeWidth / 2}, ${circleStrokeWidth / 2})`}
      />
    </svg>
  )
}

export default memo(ProgressCircle)
