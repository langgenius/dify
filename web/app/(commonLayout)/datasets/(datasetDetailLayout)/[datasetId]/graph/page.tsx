import * as React from 'react'
import KnowledgeGraph from '@/app/components/datasets/graph'

type Props = Readonly<{
  params: Promise<{ datasetId: string }>
}>

const GraphPage = async (props: Props) => {
  const params = await props.params

  const { datasetId } = params

  return <KnowledgeGraph datasetId={datasetId} />
}

export default GraphPage
