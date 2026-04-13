import type { RefObject } from 'react'
import type { FormRefObject } from '@/app/components/base/form/types'
import type { TriggerSubscriptionBuilder } from '@/app/components/workflow/block-selector/types'
import { renderHook, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { SupportedCreationMethods } from '@/app/components/plugins/types'
import {
  buildSubscriptionPayload,
  DEFAULT_FORM_VALUES,
  getConfirmButtonText,
  getFirstFieldName,
  getFormValues,
  toSchemaWithTooltip,
  useInitializeSubscriptionBuilder,
  useSyncSubscriptionEndpoint,
} from '../use-common-modal-state.helpers'

type BuilderResponse = {
  subscription_builder: TriggerSubscriptionBuilder
}

const {
  mockToastError,
  mockIsPrivateOrLocalAddress,
} = vi.hoisted(() => ({
  mockToastError: vi.fn(),
  mockIsPrivateOrLocalAddress: vi.fn(),
}))

vi.mock('@/app/components/base/ui/toast', () => ({
  toast: {
    error: mockToastError,
  },
}))

vi.mock('@/utils/urlValidation', () => ({
  isPrivateOrLocalAddress: (value: string) => mockIsPrivateOrLocalAddress(value),
}))

describe('use-common-modal-state helpers', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockIsPrivateOrLocalAddress.mockReturnValue(false)
  })

  it('returns default form values when the form ref is empty', () => {
    expect(getFormValues({ current: null })).toEqual(DEFAULT_FORM_VALUES)
  })

  it('returns form values from the form ref when available', () => {
    expect(getFormValues({
      current: {
        getFormValues: () => ({ values: { subscription_name: 'Sub' }, isCheckValidated: true }),
      },
    } as unknown as React.RefObject<FormRefObject | null>)).toEqual({
      values: { subscription_name: 'Sub' },
      isCheckValidated: true,
    })
  })

  it('derives the first field name from values or schema fallback', () => {
    expect(getFirstFieldName({ callback_url: 'https://example.com' }, [{ name: 'fallback' }])).toBe('callback_url')
    expect(getFirstFieldName({}, [{ name: 'fallback' }])).toBe('fallback')
    expect(getFirstFieldName({}, [])).toBe('')
  })

  it('copies schema help into tooltip fields', () => {
    expect(toSchemaWithTooltip([{ name: 'field', help: 'Help text' }])).toEqual([
      {
        name: 'field',
        help: 'Help text',
        tooltip: 'Help text',
      },
    ])
  })

  it('builds subscription payloads for automatic and manual creation', () => {
    expect(buildSubscriptionPayload({
      provider: 'provider-a',
      subscriptionBuilderId: 'builder-a',
      createType: SupportedCreationMethods.APIKEY,
      subscriptionFormValues: { values: { subscription_name: 'My Sub' }, isCheckValidated: true },
      autoCommonParametersSchemaLength: 1,
      autoCommonParametersFormValues: { values: { api_key: '123' }, isCheckValidated: true },
      manualPropertiesSchemaLength: 0,
      manualPropertiesFormValues: undefined,
    })).toEqual({
      provider: 'provider-a',
      subscriptionBuilderId: 'builder-a',
      name: 'My Sub',
      parameters: { api_key: '123' },
    })

    expect(buildSubscriptionPayload({
      provider: 'provider-a',
      subscriptionBuilderId: 'builder-a',
      createType: SupportedCreationMethods.MANUAL,
      subscriptionFormValues: { values: { subscription_name: 'Manual Sub' }, isCheckValidated: true },
      autoCommonParametersSchemaLength: 0,
      autoCommonParametersFormValues: undefined,
      manualPropertiesSchemaLength: 1,
      manualPropertiesFormValues: { values: { custom: 'value' }, isCheckValidated: true },
    })).toEqual({
      provider: 'provider-a',
      subscriptionBuilderId: 'builder-a',
      name: 'Manual Sub',
    })
  })

  it('returns null when required validation is missing', () => {
    expect(buildSubscriptionPayload({
      provider: 'provider-a',
      subscriptionBuilderId: 'builder-a',
      createType: SupportedCreationMethods.APIKEY,
      subscriptionFormValues: { values: {}, isCheckValidated: false },
      autoCommonParametersSchemaLength: 1,
      autoCommonParametersFormValues: { values: {}, isCheckValidated: true },
      manualPropertiesSchemaLength: 0,
      manualPropertiesFormValues: undefined,
    })).toBeNull()
  })

  it('builds confirm button text for verify and create states', () => {
    const t = (key: string, options?: Record<string, unknown>) => `${options?.ns}.${key}`

    expect(getConfirmButtonText({
      isVerifyStep: true,
      isVerifyingCredentials: false,
      isBuilding: false,
      t,
    })).toBe('pluginTrigger.modal.common.verify')

    expect(getConfirmButtonText({
      isVerifyStep: false,
      isVerifyingCredentials: false,
      isBuilding: true,
      t,
    })).toBe('pluginTrigger.modal.common.creating')
  })

  it('initializes the subscription builder once when provider is available', async () => {
    const createBuilder = vi.fn(async () => ({
      subscription_builder: { id: 'builder-1' },
    })) as unknown as (params: {
      provider: string
      credential_type: string
    }) => Promise<BuilderResponse>
    const setSubscriptionBuilder = vi.fn()

    renderHook(() => useInitializeSubscriptionBuilder({
      createBuilder,
      credentialType: 'oauth',
      provider: 'provider-a',
      subscriptionBuilder: undefined,
      setSubscriptionBuilder,
      t: (key: string, options?: Record<string, unknown>) => `${options?.ns}.${key}`,
    }))

    await waitFor(() => {
      expect(createBuilder).toHaveBeenCalledWith({
        provider: 'provider-a',
        credential_type: 'oauth',
      })
      expect(setSubscriptionBuilder).toHaveBeenCalledWith({ id: 'builder-1' })
    })
  })

  it('syncs callback endpoint and warnings into the subscription form', async () => {
    mockIsPrivateOrLocalAddress.mockReturnValue(true)
    const setFieldValue = vi.fn()
    const setFields = vi.fn()
    const subscriptionFormRef = {
      current: {
        getForm: () => ({
          setFieldValue,
        }),
        setFields,
      },
    } as unknown as RefObject<FormRefObject | null>

    renderHook(() => useSyncSubscriptionEndpoint({
      endpoint: 'http://127.0.0.1/callback',
      isConfigurationStep: true,
      subscriptionFormRef,
      t: (key: string, options?: Record<string, unknown>) => `${options?.ns}.${key}`,
    }))

    await waitFor(() => {
      expect(setFieldValue).toHaveBeenCalledWith('callback_url', 'http://127.0.0.1/callback')
      expect(setFields).toHaveBeenCalledWith([{
        name: 'callback_url',
        warnings: ['pluginTrigger.modal.form.callbackUrl.privateAddressWarning'],
      }])
    })
  })
})
