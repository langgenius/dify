import { useCallback, useState } from 'react'
import {
  useBuildTriggerSubscription,
  useCreateTriggerSubscriptionBuilder,
  useUpdateTriggerSubscriptionBuilder,
  useVerifyTriggerSubscriptionBuilder,
} from '@/service/use-triggers'
import type { TriggerWithProvider } from '@/app/components/workflow/block-selector/types'

// Helper function to serialize complex values to strings for backend encryption
const serializeFormValues = (values: Record<string, any>): Record<string, string> => {
  const result: Record<string, string> = {}

  for (const [key, value] of Object.entries(values)) {
    if (value === null || value === undefined)
      result[key] = ''
    else if (typeof value === 'object')
      result[key] = JSON.stringify(value)
    else
      result[key] = String(value)
  }

  return result
}

export type AuthFlowStep = 'auth' | 'params' | 'complete'

export type AuthFlowState = {
  step: AuthFlowStep
  builderId: string
  isLoading: boolean
  error: string | null
}

export type AuthFlowActions = {
  startAuth: () => Promise<void>
  verifyAuth: (credentials: Record<string, any>) => Promise<void>
  completeConfig: (parameters: Record<string, any>, properties?: Record<string, any>, name?: string) => Promise<void>
  reset: () => void
}

export const useTriggerAuthFlow = (provider: TriggerWithProvider): AuthFlowState & AuthFlowActions => {
  const [step, setStep] = useState<AuthFlowStep>('auth')
  const [builderId, setBuilderId] = useState<string>('')
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const createBuilder = useCreateTriggerSubscriptionBuilder()
  const updateBuilder = useUpdateTriggerSubscriptionBuilder()
  const verifyBuilder = useVerifyTriggerSubscriptionBuilder()
  const buildSubscription = useBuildTriggerSubscription()

  const startAuth = useCallback(async () => {
    if (builderId) return // Prevent multiple calls if already started

    setIsLoading(true)
    setError(null)

    try {
      const response = await createBuilder.mutateAsync({
        provider: provider.name,
      })
      setBuilderId(response.subscription_builder.id)
      setStep('auth')
    }
    catch (err: any) {
      setError(err.message || 'Failed to start authentication flow')
      throw err
    }
    finally {
      setIsLoading(false)
    }
  }, [provider.name, createBuilder, builderId])

  const verifyAuth = useCallback(async (credentials: Record<string, any>) => {
    if (!builderId) {
      setError('No builder ID available')
      return
    }

    setIsLoading(true)
    setError(null)

    try {
      await updateBuilder.mutateAsync({
        provider: provider.name,
        subscriptionBuilderId: builderId,
        credentials: serializeFormValues(credentials),
      })

      await verifyBuilder.mutateAsync({
        provider: provider.name,
        subscriptionBuilderId: builderId,
      })

      setStep('params')
    }
    catch (err: any) {
      setError(err.message || 'Authentication verification failed')
      throw err
    }
    finally {
      setIsLoading(false)
    }
  }, [provider.name, builderId, updateBuilder, verifyBuilder])

  const completeConfig = useCallback(async (
    parameters: Record<string, any>,
    properties: Record<string, any> = {},
    name?: string,
  ) => {
    if (!builderId) {
      setError('No builder ID available')
      return
    }

    setIsLoading(true)
    setError(null)

    try {
      await updateBuilder.mutateAsync({
        provider: provider.name,
        subscriptionBuilderId: builderId,
        parameters: serializeFormValues(parameters),
        properties: serializeFormValues(properties),
        name,
      })

      await buildSubscription.mutateAsync({
        provider: provider.name,
        subscriptionBuilderId: builderId,
      })

      setStep('complete')
    }
    catch (err: any) {
      setError(err.message || 'Configuration failed')
      throw err
    }
    finally {
      setIsLoading(false)
    }
  }, [provider.name, builderId, updateBuilder, buildSubscription])

  const reset = useCallback(() => {
    setStep('auth')
    setBuilderId('')
    setIsLoading(false)
    setError(null)
  }, [])

  return {
    step,
    builderId,
    isLoading,
    error,
    startAuth,
    verifyAuth,
    completeConfig,
    reset,
  }
}
