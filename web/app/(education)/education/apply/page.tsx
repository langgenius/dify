import EducationApplyRoute from '@/app/education/apply/application-entry'
import { redirect } from '@/next/navigation'

export default async function Page({
  searchParams,
}: {
  searchParams: Promise<{ token?: string | string[] }>
}) {
  const { token } = await searchParams

  if (typeof token !== 'string' || token.length === 0) redirect('/education/verify')

  return <EducationApplyRoute token={token} />
}
