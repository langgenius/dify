import CreateWorkspace from '@/app/components/workspace/create-workspace'
import { getRouteMetadata } from '@/app/route-metadata'

export function generateMetadata() {
  return getRouteMetadata('common', ($) => $['workspace.create.title'])
}

export default function CreateWorkspacePage() {
  return <CreateWorkspace />
}
