import { RiDatabase2Line } from '@remixicon/react'
import type { ActionItem } from './types'
import type { DataSet } from '@/models/datasets'

// Mock data for knowledge bases
const mockDatasets: DataSet[] = [
  {
    id: '1',
    name: 'Product Documentation',
    description: 'Complete product documentation and user guides',
    data_source_type: 'upload_file',
    indexing_technique: 'high_quality',
    created_at: '2024-01-15T10:00:00Z',
  },
  {
    id: '2',
    name: 'Customer Code FAQ',
    description: 'Frequently asked questions from customers',
    data_source_type: 'upload_file',
    indexing_technique: 'high_quality',
    created_at: '2024-01-20T14:30:00Z',
  },
  {
    id: '3',
    name: 'Company Policies',
    description: 'Internal company policies and procedures',
    data_source_type: 'upload_file',
    indexing_technique: 'economy',
    created_at: '2024-02-01T09:15:00Z',
  },
  {
    id: '4',
    name: 'Technical Specifications',
    description: 'Technical documentation and API references',
    data_source_type: 'upload_file',
    indexing_technique: 'high_quality',
    created_at: '2024-02-10T16:45:00Z',
  },
  {
    id: '5',
    name: 'Training Materials',
    description: 'Employee training and onboarding materials',
    data_source_type: 'upload_file',
    indexing_technique: 'economy',
    created_at: '2024-02-15T11:20:00Z',
  },
] as unknown as DataSet[]

const parser = (datasets: DataSet[]) => {
  return datasets.map(dataset => ({
    id: dataset.id,
    title: dataset.name,
    description: dataset.description,
    type: 'dataset' as const,
    path: `/datasets/${dataset.id}`,
    icon: <RiDatabase2Line className="h-4 w-4 text-text-secondary" />,
  }))
}

export const knowledgeAction: ActionItem = {
  key: '@knowledge',
  shortcut: '@kb',
  title: 'Search Knowledge Bases',
  description: 'Search and navigate to your knowledge bases',
  // action,
  search: (_, searchTerm = '') => {
    if (!searchTerm) return parser(mockDatasets)

    const filteredDatasets = mockDatasets.filter(dataset =>
      dataset.name.toLowerCase().includes(searchTerm.toLowerCase())
      || dataset.description?.toLowerCase().includes(searchTerm.toLowerCase()),
    )

    return parser(filteredDatasets)
  },
}
