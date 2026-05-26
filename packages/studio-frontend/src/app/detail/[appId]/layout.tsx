import Main from '@/app/(commonLayout)/app/(appDetailLayout)/[appId]/layout-main'

const AppDetailLayout = async (props: {
  children: React.ReactNode
  params: Promise<{ appId: string }>
}) => {
  const {
    children,
    params,
  } = props

  return <Main appId={(await params).appId}>{children}</Main>
}
export default AppDetailLayout
