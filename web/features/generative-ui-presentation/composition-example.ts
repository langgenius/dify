export function createCompositionExample(labels: {
  sales: string
  trend: string
  feedback: string
  submit: string
  confirm: string
}) {
  const feedback = JSON.stringify(labels.feedback)
  const confirm = JSON.stringify(labels.confirm)

  return [
    ['root', 'Stack([sales,chart,form,action])'],
    ['sales', `MetricCard(${JSON.stringify(labels.sales)},144,120)`],
    ['chart', `LineChart(${JSON.stringify(labels.trend)},points)`],
    ['points', '[previous,current]'],
    ['previous', '{label:"01",value:120}'],
    ['current', '{label:"02",value:144}'],
    ['form', `Form("f",${feedback},${JSON.stringify(labels.submit)},${feedback},[field])`],
    ['field', `TextField("note",${feedback},"",true)`],
    ['action', `ActionButton(${confirm},${confirm})`],
  ] as const
}
