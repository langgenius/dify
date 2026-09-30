import Main from '@/app/components/app/log-annotation'
import { PageType } from '@/app/components/base/features/new-feature-panel/annotation-reply/type'

export default async function Page({ params }: { params: Promise<{ appId: string }> }) {
  const { appId } = await params
  return <Main appId={appId} pageType={PageType.annotation} />
}
