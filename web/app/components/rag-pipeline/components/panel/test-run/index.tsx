import { useStore } from '@/app/components/workflow/store'
import DataSourceProvider from '@/app/components/datasets/documents/create-from-pipeline/data-source/store/provider'
import Preparation from './preparation'
import Result from './result'
import Header from './header'

const TestRunPanel = () => {
  const isPreparingDataSource = useStore(state => state.isPreparingDataSource)

  return (
    <div
      className='relative flex h-full w-[480px] flex-col rounded-l-2xl border-y-[0.5px] border-l-[0.5px] border-components-panel-border bg-components-panel-bg shadow-xl shadow-shadow-shadow-1'
    >
      <Header />
      {isPreparingDataSource ? (
        <DataSourceProvider>
          <Preparation />
        </DataSourceProvider>
      ) : (
        <Result />
      )}
    </div>
  )
}

export default TestRunPanel
