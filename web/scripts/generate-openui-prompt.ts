import type { PromptOptions } from '@openuidev/lang-core'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { createLibrary } from '@openuidev/lang-core'
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
} from '../features/generative-ui/registry/definitions.ts'

export const schemaLibrary = createLibrary({
  id: GENERATIVE_UI_LIBRARY_VERSION,
  root: 'Stack',
  components: [
    TextDefinition,
    HeadingDefinition,
    StatusDefinition,
    TableDefinition,
    LineChartDefinition,
    BarChartDefinition,
    MetricCardDefinition,
    ActionButtonDefinition,
    TextFieldDefinition,
    SelectFieldDefinition,
    FormDefinition,
    CardDefinition,
    StackDefinition,
  ],
})

export const readOnlySchemaLibrary = createLibrary({
  id: GENERATIVE_UI_LIBRARY_VERSION,
  root: 'Stack',
  components: [
    TextDefinition,
    HeadingDefinition,
    StatusDefinition,
    TableDefinition,
    LineChartDefinition,
    BarChartDefinition,
    MetricCardDefinition,
    CardDefinition,
    StackDefinition,
  ],
})

export const promptOptions: PromptOptions = {
  preamble:
    'The Dify component library is available for optional UI blocks. The syntax, examples, and verification rules below apply only inside an OpenUI block. A plain-text-only answer requires no OpenUI program.',
  toolCalls: false,
  bindings: false,
  builtinFunctions: false,
  editMode: false,
  inlineMode: false,
  additionalRules: [
    'Do not add a UI block merely to repeat the prose answer. Text and Card should support useful UI content, not duplicate a greeting, capability description, or simple explanation.',
    'Use only the listed components. Write plain text in text properties, not HTML or Markdown.',
    'Use a complete root = Stack(...) program. Define referenced children on separate lines.',
    'Never nest forms. TextField and SelectField belong only inside Form.fields.',
    'Form names are unique within a response. Field names are unique within their form.',
    'Buttons and forms only send a new conversation turn; their message must describe the visible action.',
    'Use only facts and data provided by the conversation or tools. Do not invent table values.',
    'Use LineChart for time trends, BarChart for category comparisons, and MetricCard for period changes. Supply numeric values, never formatted strings or invented data. Use the same unit for every point and both metric values.',
    'MetricCard calculates the change. Pass original current and previous values, not a percentage-point difference or a precomputed change. For percentages, pass values such as 1.5 for 1.5% and use "%" as the unit.',
  ],
  examples: [
    'root = Stack([overview, filter])\noverview = Card("Sales", [table])\ntable = Table("Sales by region", ["Region", "Sales"], [["East", "80"], ["West", "40"]])\nfilter = ActionButton("Show East", "Show sales for the East region")',
    'root = Stack([filters])\nfilters = Form("filters", "Filter results", "Apply", "Apply these filters", [region, keyword])\nregion = SelectField("region", "Region", ["East", "West"], "East", true)\nkeyword = TextField("keyword", "Keyword", "", false)',
    'root = Stack([metric, trend, comparison])\nmetric = MetricCard("Revenue", 144, 120, "USD", "vs. previous month", true)\ntrend = LineChart("Monthly revenue", [{label: "May", value: 120}, {label: "June", value: 144}], "USD")\ncomparison = BarChart("Revenue by region", [{label: "East", value: 80}, {label: "West", value: 64}], "USD")',
  ],
}

export const readOnlyPromptOptions: PromptOptions = {
  preamble:
    'The Dify read-only visualization component library is available for optional UI blocks. The syntax, examples, and verification rules below apply only inside an OpenUI block. A plain-text-only answer requires no OpenUI program.',
  toolCalls: false,
  bindings: false,
  builtinFunctions: false,
  editMode: false,
  inlineMode: false,
  additionalRules: [
    'Do not add a UI block merely to repeat the prose answer. Text and Card should support useful visual content, not duplicate a greeting, capability description, or simple explanation.',
    'Use only the listed read-only display components. Never emit ActionButton, Form, TextField, or SelectField in read-only mode.',
    'Write plain text in text properties, not HTML or Markdown.',
    'Use a complete root = Stack(...) program. Define referenced children on separate lines.',
    'Use only facts and data provided by the workflow inputs or upstream nodes. Do not invent table or chart values.',
    'Use LineChart for time trends, BarChart for category comparisons, and MetricCard for period changes. Supply numeric values, never formatted strings or invented data. Use the same unit for every point and both metric values.',
    'MetricCard calculates the change. Pass original current and previous values, not a percentage-point difference or a precomputed change. For percentages, pass values such as 1.5 for 1.5% and use "%" as the unit.',
  ],
  examples: [
    'root = Stack([overview])\noverview = Card("Sales", [table])\ntable = Table("Sales by region", ["Region", "Sales"], [["East", "80"], ["West", "40"]])',
    'root = Stack([metric, trend, comparison])\nmetric = MetricCard("Revenue", 144, 120, "USD", "vs. previous month", true)\ntrend = LineChart("Monthly revenue", [{label: "May", value: 120}, {label: "June", value: 144}], "USD")\ncomparison = BarChart("Revenue by region", [{label: "East", value: 80}, {label: "West", value: 64}], "USD")',
  ],
}

const outputDirectory = new URL('../../api/resources/generative_ui/', import.meta.url)
const outputTargets = [
  {
    file: new URL(`${GENERATIVE_UI_LIBRARY_VERSION}.txt`, outputDirectory),
    prompt: `${schemaLibrary.prompt(promptOptions)}\n`,
  },
  {
    file: new URL(`${GENERATIVE_UI_LIBRARY_VERSION}-readonly.txt`, outputDirectory),
    prompt: `${readOnlySchemaLibrary.prompt(readOnlyPromptOptions)}\n`,
  },
]

async function main() {
  if (process.argv.includes('--check')) {
    for (const target of outputTargets) {
      const current = await readFile(target.file, 'utf8')
      if (current !== target.prompt) {
        throw new Error(
          `Regenerate ${fileURLToPath(target.file)} with the generative-ui prompt script.`,
        )
      }
    }
  } else {
    await mkdir(outputDirectory, { recursive: true })
    for (const target of outputTargets) await writeFile(target.file, target.prompt, 'utf8')
  }
}

if (import.meta.main || process.argv[1] === fileURLToPath(import.meta.url)) void main()
