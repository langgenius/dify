'use client'

import { StatusDot } from '@langgenius/dify-ui/status-dot'
import { createLibrary, defineComponent } from '@openuidev/react-lang'
import { GeneratedBarChart, GeneratedLineChart } from '../components/charts'
import { ActionButton, GeneratedForm, SelectField, TextField } from '../components/controls'
import { GeneratedMetricCard } from '../components/metric-card'
import { GeneratedStack } from '../components/stack'
import { GeneratedTable } from '../components/table'
import {
  ActionButtonDefinition,
  BarChartDefinition,
  CardDefinition,
  FormDefinition,
  GENERATIVE_UI_LIBRARY_VERSION,
  HeadingDefinition,
  LineChartDefinition,
  MetricCardDefinition,
  SelectFieldDefinition,
  StackDefinition,
  StatusDefinition,
  TableDefinition,
  TextDefinition,
  TextFieldDefinition,
} from './definitions'

export const difyUILibrary = createLibrary({
  id: GENERATIVE_UI_LIBRARY_VERSION,
  root: 'Stack',
  components: [
    defineComponent({
      ...TextDefinition,
      component: ({ props }) => (
        <p className="body-md-regular whitespace-pre-wrap text-text-secondary">{props.content}</p>
      ),
    }),
    defineComponent({
      ...HeadingDefinition,
      component: ({ props }) =>
        props.level === 'subsection' ? (
          <h4 className="system-sm-semibold text-text-primary">{props.text}</h4>
        ) : (
          <h3 className="system-md-semibold text-text-primary">{props.text}</h3>
        ),
    }),
    defineComponent({
      ...StatusDefinition,
      component: ({ props }) => (
        <span className="inline-flex items-center gap-2 system-sm-regular text-text-secondary">
          <StatusDot status={props.tone} />
          {props.label}
        </span>
      ),
    }),
    defineComponent({
      ...TableDefinition,
      component: ({ props }) => <GeneratedTable {...props} />,
    }),
    defineComponent({
      ...LineChartDefinition,
      component: ({ props }) => <GeneratedLineChart {...props} />,
    }),
    defineComponent({
      ...BarChartDefinition,
      component: ({ props }) => <GeneratedBarChart {...props} />,
    }),
    defineComponent({
      ...MetricCardDefinition,
      component: ({ props }) => <GeneratedMetricCard {...props} />,
    }),
    defineComponent({ ...ActionButtonDefinition, component: ActionButton }),
    defineComponent({ ...TextFieldDefinition, component: TextField }),
    defineComponent({ ...SelectFieldDefinition, component: SelectField }),
    defineComponent({ ...FormDefinition, component: GeneratedForm }),
    defineComponent({
      ...CardDefinition,
      component: ({ props, renderNode }) => (
        <div className="flex min-w-0 flex-col gap-3 rounded-xl border border-components-panel-border bg-components-panel-bg p-4">
          <h3 className="system-md-semibold text-text-primary">{props.title}</h3>
          {renderNode(props.children)}
        </div>
      ),
    }),
    defineComponent({
      ...StackDefinition,
      component: GeneratedStack,
    }),
  ],
})
