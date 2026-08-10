import type { ComponentType } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { renderWithConsoleQuery } from '@/test/console/query-data'
import ConnectPage from '../connect/page'
import CreateFromPipelinePage from '../create-from-pipeline/page'
import CreatePage from '../create/page'
import CreateKnowledgePage from '../new/create/page'

vi.mock('@/app/components/datasets/external-knowledge-base/connector', () => ({
  default: () => <div />,
}))

vi.mock('@/app/components/datasets/create', () => ({
  default: () => <div />,
}))

vi.mock('@/app/components/datasets/create-from-pipeline', () => ({
  default: () => <div />,
}))

vi.mock('@/features/new-rag/create-knowledge-page', () => ({
  CreateKnowledgePage: () => <div />,
}))

describe('dataset creation document titles', () => {
  beforeEach(() => {
    document.title = ''
  })

  it.each<[ComponentType, string]>([
    [ConnectPage, 'common.stepByStepTour.guides.knowledge.empty.connect.title - Dify'],
    [CreatePage, 'common.stepByStepTour.guides.knowledge.empty.create.title - Dify'],
    [CreateFromPipelinePage, 'common.stepByStepTour.guides.knowledge.empty.pipeline.title - Dify'],
    [CreateKnowledgePage, 'dataset.newKnowledge.createTitle - Dify'],
  ])('sets a semantic title for the route', (Page, expectedTitle) => {
    renderWithConsoleQuery(<Page />)

    expect(document.title).toBe(expectedTitle)
  })
})
