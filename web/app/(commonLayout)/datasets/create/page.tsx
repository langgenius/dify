import DatasetUpdateForm from '@/app/components/datasets/create'
import { getRouteMetadata } from '@/app/route-metadata'

export function generateMetadata() {
  return getRouteMetadata('common', ($) => $['stepByStepTour.guides.knowledge.empty.create.title'])
}

const DatasetCreation = () => {
  return <DatasetUpdateForm />
}

export default DatasetCreation
