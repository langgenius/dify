export type AnalyticsDemoCase = {
  id: string
  title: string
  prompt: string
  source: string
  fallbackText: string
}

const monthlySales = [
  { label: 'January', value: 80 },
  { label: 'February', value: 96 },
  { label: 'March', value: 90 },
  { label: 'April', value: 108 },
  { label: 'May', value: 120 },
  { label: 'June', value: 144 },
]

const regionalSales = [
  { label: 'East', value: 120 },
  { label: 'South', value: 80 },
  { label: 'North', value: 60 },
]

const juneRegionalSales = [
  { label: 'East', value: 72 },
  { label: 'South', value: 48 },
  { label: 'North', value: 24 },
]

export const ANALYTICS_DEMO_CASES = [
  {
    id: 'trend',
    title: 'Six-month sales trend',
    prompt: `I am reviewing first-half sales and want to understand whether growth is steady and what changed in the latest month.
Actual sales, in units of CNY 10,000:
January 80, February 96, March 90, April 108, May 120, June 144.
Analyze these figures without adding months or forecasts, and do not attribute fluctuations to unknown business causes.`,
    source: `root = Stack([trend])
trend = LineChart("Monthly sales trend", ${JSON.stringify(monthlySales)}, "CNY 10k")`,
    fallbackText:
      'June sales were CNY 1,440,000, up 20% from CNY 1,200,000 in May. The six monthly values, in units of CNY 10,000, were 80, 96, 90, 108, 120, and 144.',
  },
  {
    id: 'comparison',
    title: 'Regional sales comparison',
    prompt: `I am preparing to discuss regional priorities and want to understand the sales gap between three regions and their shares of total sales.
Actual sales for this period, in units of CNY 10,000:
East 120, South 80, North 60.
Analyze the figures and identify the information still needed for resource decisions. Regional investment, profit, and market size are unknown; do not infer efficiency or return on investment from sales alone.`,
    source: `root = Stack([comparison])
comparison = BarChart("Regional sales comparison", ${JSON.stringify(regionalSales)}, "CNY 10k")`,
    fallbackText:
      'Total regional sales were CNY 2,600,000. East led with CNY 1,200,000, followed by South with CNY 800,000 and North with CNY 600,000.',
  },
  {
    id: 'metrics',
    title: 'Monthly sales and error-rate changes',
    prompt: `I want to understand whether sales and service quality improved from May to June and by how much.
Known figures:
Monthly sales: June 144 and May 120, in units of CNY 10,000; higher is better.
Error rate: June 1.5% and May 2.0%; lower is better.
Explain both changes. No other business data is available; do not infer profit, customer satisfaction, or causes.`,
    source: `root = Stack([sales, errors])
sales = MetricCard("Monthly sales", 144, 120, "CNY 10k", "vs. May", true)
errors = MetricCard("Error rate", 1.5, 2, "%", "vs. May", false)`,
    fallbackText:
      'June sales were CNY 1,440,000, up 20% from May. The error rate fell from 2.0% to 1.5%, a relative decrease of 25%. Both metrics improved.',
  },
  {
    id: 'dashboard',
    title: 'Combined business analysis',
    prompt: `I am preparing a June business review focused on sales changes, regional performance, and service quality. Identify the changes worth discussing and the information we should collect next.

Actual monthly sales, in units of CNY 10,000: January 80, February 96, March 90, April 108, May 120, June 144.
Actual June regional sales, in units of CNY 10,000: East 72, South 48, North 24.
Error rate: May 2.0%, June 1.5%.

Higher sales and lower error rates are better. Use only the supplied data; do not invent regional history, profit, or business causes.`,
    source: `root = Stack([heading, sales, errors, trend, comparison])
heading = Heading("Business analysis")
sales = MetricCard("Monthly sales", 144, 120, "CNY 10k", "vs. May", true)
errors = MetricCard("Error rate", 1.5, 2, "%", "vs. May", false)
trend = LineChart("Monthly sales trend", ${JSON.stringify(monthlySales)}, "CNY 10k")
comparison = BarChart("June regional sales comparison", ${JSON.stringify(juneRegionalSales)}, "CNY 10k")`,
    fallbackText:
      'June sales were CNY 1,440,000, up 20% month over month. The error rate was 1.5%, a relative decrease of 25%. East, South, and North sales were CNY 720,000, CNY 480,000, and CNY 240,000 respectively.',
  },
] as const satisfies readonly AnalyticsDemoCase[]
