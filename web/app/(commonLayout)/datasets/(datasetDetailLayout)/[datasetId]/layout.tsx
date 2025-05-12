import Main from './layout-main'

const DatasetDetailLayout = async (
  props: {
    children: React.ReactNode
    params: Promise<{ datasetId: string }>
  },
) => {
  const params = await props.params

  const {
    children,
  } = props

  return <Main params={(await params)}>{children}</Main>
}
export default DatasetDetailLayout
