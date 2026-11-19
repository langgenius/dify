import { LineChart } from 'echarts/charts'
import { GridComponent, LegendComponent, TooltipComponent } from 'echarts/components'
import * as echarts from 'echarts/core'
import { SVGRenderer } from 'echarts/renderers'

echarts.use([LineChart, GridComponent, LegendComponent, TooltipComponent, SVGRenderer])

// oxlint-disable-next-line no-barrel-files/no-barrel-files -- The overview needs the runtime configured with its chart, components and SVG renderer.
export { echarts }
