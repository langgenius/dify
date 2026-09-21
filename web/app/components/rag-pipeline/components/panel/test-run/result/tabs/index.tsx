import type { WorkflowRunningData } from '@/app/components/workflow/types'
import { TabsList, TabsTab } from '@langgenius/dify-ui/tabs'
import { useTranslation } from 'react-i18next'

type TabsProps = {
  workflowRunningData?: WorkflowRunningData
}

const Tabs = ({ workflowRunningData }: TabsProps) => {
  const { t } = useTranslation()
  const tabs = [
    { value: 'RESULT', label: t(($) => $.result, { ns: 'runLog' }) },
    { value: 'DETAIL', label: t(($) => $.detail, { ns: 'runLog' }) },
    { value: 'TRACING', label: t(($) => $.tracing, { ns: 'runLog' }) },
  ]
  return (
    <TabsList
      aria-label={t(($) => $['testRun.title'], { ns: 'datasetPipeline' })}
      className="shrink-0 items-center gap-x-6 border-b-[0.5px] border-divider-subtle px-4"
    >
      {tabs.map((tab) => (
        <TabsTab
          key={tab.value}
          value={tab.value}
          disabled={!workflowRunningData}
          className="py-3 system-sm-semibold-uppercase!"
        >
          {tab.label}
        </TabsTab>
      ))}
    </TabsList>
  )
}

export default Tabs
