import Main from './layout-main'

const DatasetDetailLayout = async ({
  children,
  params,
}: {
  children: React.ReactNode
  params: Promise<{ datasetId: string }>
}) => {
  return <Main params={(await params)}>{children}</Main>
}
export default DatasetDetailLayout
