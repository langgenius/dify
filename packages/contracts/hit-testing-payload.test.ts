import type {
  ExternalHitTestingPayload,
  HitTestingPayload as ConsoleHitTestingPayload,
} from './generated/api/console/datasets/types.gen.ts'
import type { HitTestingPayload as ServiceHitTestingPayload } from './generated/api/service/types.gen.ts'
import { describe, expect, it } from 'vite-plus/test'
import {
  zExternalHitTestingPayload,
  zHitTestingPayload as zConsoleHitTestingPayload,
} from './generated/api/console/datasets/zod.gen.ts'
import { zHitTestingPayload as zServiceHitTestingPayload } from './generated/api/service/zod.gen.ts'

type HasExternalRetrievalModel<T> = 'external_retrieval_model' extends keyof T ? true : false

const consoleGenericHasExternalModel: HasExternalRetrievalModel<ConsoleHitTestingPayload> = true
const serviceGenericHasExternalModel: HasExternalRetrievalModel<ServiceHitTestingPayload> = true
const dedicatedExternalHasExternalModel: HasExternalRetrievalModel<ExternalHitTestingPayload> = true

describe('generated hit-testing request contracts', () => {
  it('retains external settings on generic Console and Service API types', () => {
    expect(consoleGenericHasExternalModel).toBe(true)
    expect(serviceGenericHasExternalModel).toBe(true)
  })

  it('preserves empty overrides so the server inherits dataset settings', () => {
    const payload = { query: 'query', external_retrieval_model: {} }
    for (const schema of [
      zConsoleHitTestingPayload,
      zServiceHitTestingPayload,
      zExternalHitTestingPayload,
    ])
      expect(schema.parse(payload)).toEqual(payload)
  })

  it('retains external settings when parsing generic payloads', () => {
    const payload = {
      external_retrieval_model: {
        score_threshold: 0.7,
        score_threshold_enabled: true,
        top_k: 3,
      },
      query: 'query',
    }

    for (const schema of [zConsoleHitTestingPayload, zServiceHitTestingPayload])
      expect(schema.parse(payload)).toEqual(payload)
  })

  it('retains external settings on the dedicated external hit-testing contract', () => {
    const payload = {
      external_retrieval_model: {
        score_threshold: 0.7,
        score_threshold_enabled: true,
        top_k: 3,
      },
      query: 'query',
    }

    expect(dedicatedExternalHasExternalModel).toBe(true)
    expect(zExternalHitTestingPayload.parse(payload)).toEqual(payload)
  })
})
