import CreateFromPipeline from '@/app/components/datasets/create-from-pipeline'
import { getRouteMetadata } from '@/app/route-metadata'

export function generateMetadata() {
  return getRouteMetadata(
    'common',
    ($) => $['stepByStepTour.guides.knowledge.empty.pipeline.title'],
  )
}

const DatasetCreation = () => {
  return <CreateFromPipeline />
}

export default DatasetCreation
