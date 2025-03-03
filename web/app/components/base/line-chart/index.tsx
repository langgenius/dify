import React, { memo, useEffect, useRef, useState } from 'react'
import ReactECharts from 'echarts-for-react'
import { useTranslation } from 'react-i18next'
import dayjs from 'dayjs'
export const adjustAlpha = (color: string, alpha: number) => {
  const rgba = color.match(/\d+/g)
  return `rgba(${rgba[0]}, ${rgba[1]}, ${rgba[2]}, ${alpha})`
}

const formatTimeUTC = (value: number) => {
  return dayjs(value * 1000).format('HH:mm:ss')
}
const formatDay = (value: number) => {
  return dayjs(value).format('YYYY-MM-DD HH:mm:ss')
}
type LineChartData = {
  [key: string]: number;
}
type LineChartType = 'cpu' | 'network' | 'memory'
type LineChartProps = {
  data: LineChartData
  type: LineChartType
}
const DelayLineChartTitleMap: Record<LineChartType, string> = {
  cpu: 'cpu指标',
  network: '网络时延',
  memory: '内存占用',
}
const MetricsLineChartColor = {
  network: 'rgba(212, 164, 235, 1)',
  memory: 'rgba(212, 164, 235, 1)',
  cpu: 'rgba(55, 162,235, 1)',
}

export const YValueMinInterval = {
  network: 0.01,
  memory: 0.01,
  cpu: 0.01,
}
const LineChart = ({ type, data }: LineChartProps) => {
  const { t } = useTranslation()
  const chartRef = useRef(null)
  const convertYValue = (value: number) => {
    switch (type) {
      case 'network':
        if (value > 0 && value < 0.01)
          return '< 0.01 s'
        return `${value}s`
      case 'memory':
        if (value > 0 && value < 0.01)
          return '< 0.01 bytes'
        return `${value}bytes`
      case 'cpu':
        if (value > 0 && value < 0.0001)
          return '< 0.01%'
        return `${Number.parseFloat((value * 100).toFixed(2))}%`
        //   case 'tps':
        //     if (value > 0 && value < 0.01)
        //       return `< 0.01${t('units.timesPerMinute')}`
        // return Number.parseFloat((Math.floor(value * 100) / 100).toString()) + t('units.timesPerMinute')
    }
  }
  const [option, setOption] = useState<any>({
    title: {},
    tooltip: {
      trigger: 'item',
      confine: true,
      enterable: true,
      // alwaysShowContent: true,
      axisPointer: {
        type: 'cross',
        label: {
          formatter(params) {
            // 自定义格式化函数，params.value 是轴上指示的值
            const { axisDimension, value } = params
            if (axisDimension === 'y')
              return convertYValue(value)
            else
              return formatDay(value * 1000)

            // return `自定义格式: ${params.value}`;
          },
        },
      },
      formatter: (params) => {
        let result = `<div class="rgb(102, 102, 102)">${formatDay(params.data[0] * 1000)}<br/></div>
        <div class="overflow-hidden w-full " >`
        result += `<div class="flex flex-row items-center justify-between">
                      <div class="flex flex-row items-center flex-nowrap flex-shrink flex-1 whitespace-normal break-words">
                        <div class=" my-2 mr-2 rounded-full w-3 h-3 flex-grow-0 flex-shrink-0" style="background:${params.color}"></div>
                        <div class="flex-1">${params.seriesName}</div>
                      </div>
                      <span class="font-bold flex-shrink-0 ml-2">${convertYValue(params.data[1])}</span>
                      </div>`
        // params.forEach((param) => {
        //   result += `<div class="flex flex-row items-center justify-between">
        //               <div class="flex flex-row items-center flex-nowrap flex-shrink w-0 flex-1 whitespace-normal break-words">
        //                 <div class=" my-2 mr-2 rounded-full w-3 h-3 flex-grow-0 flex-shrink-0" style="background:${param.color}"></div>
        //                 <div class="flex-1 w-0">${param.seriesName}</div>
        //               </div>
        //               <span class="font-bold flex-shrink-0 ">${convertTime(param.data[1], 'ms', 2)} ms</span>
        //               </div>`
        // })
        // result+="</div>"
        return result
      },
    },
    backgroundColor: 'rgba(0,0,0,0)',
    legend: {
      type: 'scroll',
      data: [],
    },
    grid: {
      left: '3%',
      right: '4%',
      bottom: '3%',
      top: '4%',
      containLabel: true,
    },
    // toolbox: {
    //   feature: {
    //     saveAsImage: {},
    //   },
    // },
    xAxis: {
      type: 'time',
      boundaryGap: false,
      axisPointer: {
        type: 'line',
        // snap: true
        interval: 1,
      },
      axisLabel: {
        hideOverlap: true,
        formatter(value) {
          return formatTimeUTC(value)
        },
      },
      // axisLine: {
      //   lineStyle: {
      //     color: '#000000', // 设置 x 轴刻度线颜色
      //   },
      // },
      // axisTick: {
      //   lineStyle: {
      //     color: '#000000', // 设置 x 轴刻度线颜色
      //   },
      // },
    },
    yAxis: {
      type: 'value',
      minInterval: YValueMinInterval[type],
      min: 0,
      axisLabel: {
        formatter(value: number) {
          if(type === 'cpu')
            return Number.parseFloat((value * 100).toFixed(2))

          return value
        },
      },
    },
    series: [],
    toolbox: {
      show: false, // 隐藏 toolbox
    },
    brush: {
      toolbox: ['lineX'],
      brushStyle: {
        borderWidth: 1,
        color: 'rgba(120,140,180,0.3)',
        borderColor: 'rgba(0,0,0,0.5)',
      },
    },
  })

  //   // 处理缺少数据的时间点并补0
  //   const fillMissingData = () => {
  //     const filledData = []
  //     const { startTime, endTime } = timeRange
  //     const step = getStep(startTime, endTime)

  //     for (let time = startTime; time <= endTime; time += step) {
  //       filledData.push({
  //         timestamp: time, // 用于显示在图例中
  //         value: data[time] || 0,
  //       })
  //     }
  //     return filledData
  //   }

  useEffect(() => {
    if (data) {
    //   const filledData = fillMissingData()

      setOption({
        ...option,
        xAxis: {
          type: 'time',
          boundaryGap: false,
          axisPointer: {
            type: 'line',
            interval: 0,
          },
          axisLabel: {
            formatter(value) {
              return formatTimeUTC(value)
            },
            hideOverlap: true,
          },
        //   min: timeRange.startTime / 1000,
        //   max: timeRange.endTime / 1000,
        },
        series: [
          {
            data: Object.entries(data).map(([key, value]) => [Number(key) / 1000, value]),
            type: 'line',
            smooth: true,
            name: DelayLineChartTitleMap[type],
            color: MetricsLineChartColor[type],
            areaStyle: {
              color: adjustAlpha(MetricsLineChartColor[type], 0.3), // 设置区域填充颜色
            },
          },
        ],
      })
    }
  }, [data])

  return (
    <ReactECharts
      ref={chartRef}
      option={option}
      style={{ height: '200px', width: '100%' }}
    />
  )
}

export default memo(LineChart)
