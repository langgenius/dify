import { defineComponent } from '@openuidev/lang-core'
import { z } from 'zod/v4'

export const GENERATIVE_UI_LIBRARY_VERSION = 'dify-ui-v1'

// Property order is part of OpenUI's positional wire format. Changing it requires a new version.
export const TextDefinition = defineComponent({
  name: 'Text',
  description:
    'Supporting text within a useful UI. Do not repeat the prose answer. Use the language of the user.',
  props: z.object({ content: z.string() }),
  component: null,
})

export const HeadingDefinition = defineComponent({
  name: 'Heading',
  description: 'A heading within this response.',
  props: z.object({
    text: z.string(),
    level: z.enum(['section', 'subsection']).optional(),
  }),
  component: null,
})

export const TableDefinition = defineComponent({
  name: 'Table',
  description:
    'Owns exact values and row-by-row comparisons. Use prose for the conclusion, not a second listing of every cell. Has a visible caption and column names. Every row matches the columns.',
  props: z.object({
    caption: z.string(),
    columns: z.array(z.string()),
    rows: z.array(z.array(z.string())),
  }),
  component: null,
})

const chartPoints = z.array(z.object({ label: z.string(), value: z.number() }))

export const LineChartDefinition = defineComponent({
  name: 'LineChart',
  description:
    'Owns one numeric series over time. Keep points chronological. Prose explains the important change rather than listing every point. Values are numbers; put the shared unit in unit.',
  props: z.object({
    title: z.string(),
    points: chartPoints,
    unit: z.string().optional(),
  }),
  component: null,
})

export const BarChartDefinition = defineComponent({
  name: 'BarChart',
  description:
    'Owns numeric category comparisons on a shared zero baseline. Prose interprets the comparison rather than listing every bar. Values are numbers; put the shared unit in unit.',
  props: z.object({
    title: z.string(),
    points: chartPoints,
    unit: z.string().optional(),
  }),
  component: null,
})

export const MetricCardDefinition = defineComponent({
  name: 'MetricCard',
  description:
    'A metric with its previous-period value and calculated percentage change: (value - previousValue) / abs(previousValue) * 100. A zero previous value with a nonzero current value has no percentage comparison. Both values use the same unit. comparisonLabel names the period comparison in the user language. higherIsBetter defaults to true; set false for costs, latency, or error rates.',
  props: z.object({
    title: z.string(),
    value: z.number(),
    previousValue: z.number(),
    unit: z.string().optional(),
    comparisonLabel: z.string().optional(),
    higherIsBetter: z.boolean().optional(),
  }),
  component: null,
})

export const StatusDefinition = defineComponent({
  name: 'Status',
  description: 'A short status label with a decorative status indicator.',
  props: z.object({
    label: z.string(),
    tone: z.enum(['success', 'warning', 'error', 'normal', 'disabled']),
  }),
  component: null,
})

export const ActionButtonDefinition = defineComponent({
  name: 'ActionButton',
  description:
    'A button that sends its message as the next user turn. It cannot call tools or navigate.',
  props: z.object({
    label: z.string(),
    message: z.string(),
  }),
  component: null,
})

export const TextFieldDefinition = defineComponent({
  name: 'TextField',
  description: 'A labeled text input inside a Form. Its name must be unique within that form.',
  props: z.object({
    name: z.string(),
    label: z.string(),
    initialValue: z.string(),
    required: z.boolean().optional(),
  }),
  component: null,
})

export const SelectFieldDefinition = defineComponent({
  name: 'SelectField',
  description:
    'A labeled single-choice field inside a Form. initialValue is an option, or an empty string.',
  props: z.object({
    name: z.string(),
    label: z.string(),
    options: z.array(z.string()),
    initialValue: z.string(),
    required: z.boolean().optional(),
  }),
  component: null,
})

export const FormDefinition = defineComponent({
  name: 'Form',
  description:
    'A standalone form. Submitting sends the message and entered values as the next user turn.',
  props: z.object({
    name: z.string(),
    title: z.string(),
    submitLabel: z.string(),
    message: z.string(),
    fields: z.array(z.union([TextFieldDefinition.ref, SelectFieldDefinition.ref])),
  }),
  component: null,
})

const content = z.union([
  TextDefinition.ref,
  HeadingDefinition.ref,
  TableDefinition.ref,
  LineChartDefinition.ref,
  BarChartDefinition.ref,
  MetricCardDefinition.ref,
  StatusDefinition.ref,
  ActionButtonDefinition.ref,
  FormDefinition.ref,
])

export const CardDefinition = defineComponent({
  name: 'Card',
  description: 'A titled panel grouping related UI content, not a wrapper for a prose-only answer.',
  props: z.object({
    title: z.string(),
    children: z.array(content),
  }),
  component: null,
})

export const StackDefinition = defineComponent({
  name: 'Stack',
  description: 'The response root. Displays its children vertically in reading order.',
  props: z.object({ children: z.array(z.union([CardDefinition.ref, content])) }),
  component: null,
})
