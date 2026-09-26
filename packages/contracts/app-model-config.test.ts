import type { InferContractRouterInputs } from '@orpc/contract'
import type { z } from 'zod'
import type { apps } from './generated/api/console/apps/orpc.gen.ts'
import type { AppModelConfigPayload } from './generated/api/console/apps/types.gen.ts'
import { describe, expect, it } from 'vite-plus/test'
import {
  zAppConfigJsonValueWritable,
  zAppModelConfigPayload,
} from './generated/api/console/apps/zod.gen.ts'

const model = {
  provider: 'langgenius/openai/openai',
  name: 'gpt-4o-mini',
  completion_params: {
    temperature: 0,
    stop: [],
    provider_options: { cache: false, fallback: null },
  },
} satisfies AppModelConfigPayload['model']

describe('generated app model-config write contract', () => {
  it('keeps recursive JSON strict in the generated writable schema', () => {
    const value = { nested: [null, false, { count: 2 }] }
    expect(zAppConfigJsonValueWritable.parse(value)).toEqual(value)

    // @ts-expect-error The derived writable schema must reject non-JSON values at any depth.
    const invalid: z.infer<typeof zAppConfigJsonValueWritable> = {
      nested: { callback: () => true },
    }
    expect(zAppConfigJsonValueWritable.safeParse(invalid).success).toBe(false)
  })

  it('preserves dynamic JSON parameters without synthesizing omitted configuration', () => {
    const body = {
      model: { ...model, provider_metadata: { cached: false } },
      speech_to_text: { enabled: false, extension: { locale: 'en' } },
    } satisfies AppModelConfigPayload

    expect(zAppModelConfigPayload.parse(body)).toEqual(body)
  })

  it('requires one supported form field per input item', () => {
    const field = { label: 'Topic', variable: 'topic' }
    for (const item of [{}, { 'text-input': field, select: field }]) {
      expect(zAppModelConfigPayload.safeParse({ model, user_input_form: [item] }).success).toBe(
        false,
      )
    }
  })

  it('types and validates the fixed configuration fields', () => {
    const body = {
      model,
      file_upload: { enabled: false, number_limits: 3 },
      dataset_configs: { retrieval_model: 'multiple', top_k: 4 },
      chat_prompt_config: { prompt: [{ role: 'system', text: 'Answer {{topic}}' }] },
      user_input_form: [{ 'text-input': { label: 'Topic', variable: 'topic', required: false } }],
    } satisfies AppModelConfigPayload

    expect(zAppModelConfigPayload.parse(body)).toEqual(body)

    const invalidUpload: AppModelConfigPayload = {
      model,
      // @ts-expect-error Upload enablement is a boolean in the generated write contract.
      file_upload: { enabled: 'false' },
    }
    const invalidDataset: AppModelConfigPayload = {
      model,
      // @ts-expect-error The retrieval limit is numeric in the generated write contract.
      dataset_configs: { top_k: '4' },
    }
    const invalidPrompt: AppModelConfigPayload = {
      model,
      // @ts-expect-error Prompt text is a string in the generated write contract.
      chat_prompt_config: { prompt: [{ role: 'system', text: 1 }] },
    }
    const invalidParameters: AppModelConfigPayload = {
      model: {
        ...model,
        // @ts-expect-error Provider parameters remain JSON values, not arbitrary JavaScript values.
        completion_params: { callback: () => 'not JSON' },
      },
    }
    const invalidClientParameters: InferContractRouterInputs<
      typeof apps
    >['byAppId']['modelConfig']['post'] = {
      params: { app_id: 'app-1' },
      body: {
        model: {
          ...model,
          // @ts-expect-error Recursive JSON stays typed in the Zod-backed client input too.
          completion_params: { nested: { callback: () => 'not JSON' } },
        },
      },
    }

    for (const invalidBody of [
      invalidUpload,
      invalidDataset,
      invalidPrompt,
      invalidParameters,
      invalidClientParameters.body,
    ]) {
      expect(zAppModelConfigPayload.safeParse(invalidBody).success).toBe(false)
    }
  })
})
