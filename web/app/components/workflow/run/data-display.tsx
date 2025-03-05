import { memo } from 'react'
import LineChart from '../../base/line-chart'
import { useTranslation } from 'react-i18next'
import Topology from '../../base/topology'
import { usePrepareTopologyData } from '../../base/topology/hook'
import AlertList from '../../base/alert'
import LogContent from '../../base/log/LogContent'

type DataDisplayProps = {
  data?: string;
  dataObj?: any
}
const TopologyCom = ({ data }) => {
  const topologyData = usePrepareTopologyData(data)

  return <div className=' w-full h-[400px] relative'><Topology data={topologyData} /></div>
}
const DataDisplay = ({ data, dataObj }: DataDisplayProps) => {
  // const [chartData,setChartData] = useState<any>(null)
  const { t } = useTranslation()
  let chartData: any = null
  if(data) {
    try {
      chartData = JSON.parse(data)
      if(chartData.data?.message) chartData = { type: 'error', data: chartData.data?.message }
    }
    catch (error) {
      console.error('JSON 解析失败:', error)
      chartData = {} // 返回一个空对象或其他默认值
    }
  }
  else{
    chartData = dataObj
  }

  return (
    <div className="relative w-full">
      {
        chartData?.type
        && <>
          <div className="h-6 py-1 text-text-tertiary system-xs-medium-uppercase">
            {t('apo.chart.chartTitle')}
          </div>
          <div className='px-1'>
            {chartData?.type === 'metric' && (
              <LineChart data={chartData?.data?.timeseries || []} unit={chartData?.unit} />
            )}
            {chartData?.type === 'topology' && (
              <TopologyCom data={chartData?.data} />
            )}
            {chartData?.type === 'alert' && (
              <AlertList {...chartData?.data} />
            )}
            {chartData?.type === 'log' && (
              <LogContent {...chartData?.data} />
            )}
            {
              chartData?.type === 'error' && <span>{chartData?.data}</span>
            }
            {/* {
          !chartData?.type && <>获取数据失败</>
        } */}
          </div></>
      }

    </div>
  )
}
export default memo(DataDisplay)
