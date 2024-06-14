import type { CSSProperties } from 'react'
import { memo, useMemo } from 'react'
import ReactECharts from 'echarts-for-react'
import type { EChartsOption } from 'echarts'
import classNames from 'classnames'
import style from './index.module.css'

export type SimplePieChartProps = {
  percentage?: number
  fill?: string
  stroke?: string
  size?: number
  className?: string
}

const SimplePieChart = ({ percentage = 80, fill = '#fdb022', stroke = '#f79009', size = 12, className }: SimplePieChartProps) => {
  const option: EChartsOption = useMemo(() => ({
    series: [
      {
        type: 'pie',
        radius: ['83%', '100%'],
        animation: false,
        data: [
          { value: 100, itemStyle: { color: stroke } },
        ],
        emphasis: {
          disabled: true,
        },
        labelLine: {
          show: false,
        },
        cursor: 'default',
      },
      {
        type: 'pie',
        radius: '83%',
        animationDuration: 600,
        data: [
          { value: percentage, itemStyle: { color: fill } },
          { value: 100 - percentage, itemStyle: { color: '#fff' } },
        ],
        emphasis: {
          disabled: true,
        },
        labelLine: {
          show: false,
        },
        cursor: 'default',
      },
    ],
  }), [stroke, fill, percentage])

  return (
    <ReactECharts
      option={option}
      className={classNames(style.simplePieChart, className)}
      style={{
        '--simple-pie-chart-color': fill,
        'width': size,
        'height': size,
      } as CSSProperties}
    />
  )
}

export default memo(SimplePieChart)
