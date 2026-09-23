import { LineChart } from 'echarts/charts'
import { DatasetComponent, GridComponent, TooltipComponent } from 'echarts/components'
import * as echarts from 'echarts/core'
import { LegacyGridContainLabel } from 'echarts/features'
import { CanvasRenderer, SVGRenderer } from 'echarts/renderers'

// Overview uses SVG; Agent monitoring retains its canvas renderer.
echarts.use([
  LineChart,
  DatasetComponent,
  GridComponent,
  TooltipComponent,
  LegacyGridContainLabel,
  CanvasRenderer,
  SVGRenderer,
])

// oxlint-disable-next-line no-barrel-files/no-barrel-files -- Consumers need the runtime configured by this module's chart and renderer registrations.
export { echarts }
