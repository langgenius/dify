'use client'

import { useParams } from '@/next/navigation'
import { SkillDetailPage } from './page'

export default function SkillDetailPageRoute() {
  const { skillId } = useParams<{ skillId: string }>()

  return <SkillDetailPage key={skillId} skillId={skillId} />
}
