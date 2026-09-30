import { getRouteMetadata } from '@/app/route-metadata'
import SkillsPage from '@/features/skills/page'

export function generateMetadata() {
  return getRouteMetadata('skill', ($) => $['skillManagement.title'])
}

export default function Page() {
  return <SkillsPage />
}
