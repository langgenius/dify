import ExternalKnowledgeBaseConnector from '@/app/components/datasets/external-knowledge-base/connector'
import { getRouteMetadata } from '@/app/route-metadata'

export function generateMetadata() {
  return getRouteMetadata('common', ($) => $['stepByStepTour.guides.knowledge.empty.connect.title'])
}

const ExternalKnowledgeBaseCreation = () => {
  return <ExternalKnowledgeBaseConnector />
}

export default ExternalKnowledgeBaseCreation
