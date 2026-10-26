import type {
  GraphEntityResponse,
  GraphRelationResponse,
} from '@dify/contracts/api/console/datasets/types.gen'
import { render } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vite-plus/test'
import GraphView from '../graph-view'

type Node = { id: string; name: string; itemStyle: { color: string } }
type Link = { source: string; target: string; label: { formatter: () => string } }
type TooltipParams = {
  dataType?: 'node' | 'edge'
  name: string
  data: Record<string, unknown>
}
type ChartProps = {
  option: {
    tooltip: { formatter: (params: TooltipParams) => string }
    series: [{ data: Node[]; links: Link[] }]
  }
  onEvents: { click: (params: TooltipParams) => void }
}

const chart = vi.hoisted(() => ({ props: undefined as unknown }))

vi.mock('echarts-for-react/lib/core', () => ({
  default: (props: unknown) => {
    chart.props = props
    return <div role="img" aria-label="Knowledge graph" />
  },
}))

const lastChart = () => chart.props as ChartProps

const entity = (id: string, name: string, frequency = 1): GraphEntityResponse => ({
  id,
  name,
  display_name: name.charAt(0).toUpperCase() + name.slice(1),
  entity_type: 'ORGANIZATION',
  description: '',
  frequency,
})

const relation = (source: string, target: string, predicate: string): GraphRelationResponse => ({
  id: `${source}-${target}`,
  source_entity_id: source,
  target_entity_id: target,
  predicate,
  description: '',
  weight: 1,
})

describe('GraphView', () => {
  beforeEach(() => {
    chart.props = undefined
  })

  it('draws every entity and only the edges between drawn entities', () => {
    render(
      <GraphView
        entities={[entity('e1', 'acme'), entity('e2', 'globex')]}
        relations={[relation('e1', 'e2', 'acquired'), relation('e1', 'off-screen', 'owns')]}
      />,
    )

    const [series] = lastChart().option.series
    expect(series.data.map((node) => node.name)).toEqual(['Acme', 'Globex'])
    // An edge to an entity outside the subgraph would make ECharts invent a node.
    expect(series.links.map((link) => link.target)).toEqual(['e2'])
  })

  it('highlights the focused entity', () => {
    render(
      <GraphView
        entities={[entity('e1', 'acme'), entity('e2', 'globex')]}
        relations={[]}
        focusedEntityName="acme"
      />,
    )

    const [acme, globex] = lastChart().option.series[0].data
    expect(acme!.itemStyle.color).not.toBe(globex!.itemStyle.color)
  })

  it('renders a predicate as text rather than as an ECharts template', () => {
    render(
      <GraphView
        entities={[entity('e1', 'acme'), entity('e2', 'globex')]}
        relations={[relation('e1', 'e2', 'owns {a} of')]}
      />,
    )

    expect(lastChart().option.series[0].links[0]!.label.formatter()).toBe('owns {a} of')
  })

  it('escapes model-written text in node and edge tooltips', () => {
    render(<GraphView entities={[entity('e1', 'acme')]} relations={[]} />)
    const { formatter } = lastChart().option.tooltip

    const node = formatter({
      dataType: 'node',
      name: '<b>Acme</b>',
      data: { entityType: 'ORGANIZATION', description: 'Makes <script>', frequency: 2 },
    })
    const edge = formatter({
      dataType: 'edge',
      name: '',
      data: { value: 'owns <i>', description: '' },
    })

    expect(node).toContain('&lt;b&gt;Acme&lt;/b&gt;')
    expect(node).toContain('Makes &lt;script&gt;')
    expect(node).not.toContain('<script>')
    expect(edge).toContain('owns &lt;i&gt;')
  })

  it('reports a clicked node but ignores clicked edges', () => {
    const onEntityClick = vi.fn()
    const acme = entity('e1', 'acme')
    render(<GraphView entities={[acme]} relations={[]} onEntityClick={onEntityClick} />)
    const { click } = lastChart().onEvents

    click({ dataType: 'edge', name: '', data: { id: 'e1' } })
    click({ dataType: 'node', name: 'Unknown', data: { id: 'gone' } })
    click({ dataType: 'node', name: 'Acme', data: { id: 'e1' } })

    expect(onEntityClick).toHaveBeenCalledTimes(1)
    expect(onEntityClick).toHaveBeenCalledWith(acme)
  })
})
