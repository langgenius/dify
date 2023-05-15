'use client'

import { useEffect } from 'react'
import useSWR from 'swr'
import { DataSet } from '@/models/datasets';
import NewDatasetCard from './NewDatasetCard'
import DatasetCard from './DatasetCard';
import { fetchDatasets } from '@/service/datasets';

const Datasets = () => {
  // const { datasets, mutateDatasets } = useAppContext()
  const { data: datasetList, mutate: mutateDatasets } = useSWR({ url: '/datasets', params: { page: 1 } }, fetchDatasets)

  useEffect(() => {
    mutateDatasets()
  }, [])

  return (
    <nav className='grid content-start grid-cols-1 gap-4 px-12 pt-8 sm:grid-cols-2 lg:grid-cols-4 grow shrink-0'>
      {datasetList?.data.map(dataset => (<DatasetCard key={dataset.id} dataset={dataset} />))}
      <NewDatasetCard />
    </nav>
  )
}

export default Datasets

