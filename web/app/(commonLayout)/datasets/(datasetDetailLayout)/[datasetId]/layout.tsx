import Main from './layout-main'

const DatasetDetailLayout = async (
  props: {
    children: React.ReactNode
    params: Promise<{ datasetId: string }>
  },
) => {
  const {
    children,
    params,
  } = props

  return <Main datasetId={(await params).datasetId}>{children}</Main>
}
export default DatasetDetailLayout
