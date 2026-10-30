'use client'

import type { ChannelSummary } from '@dify/contracts/api/console/workspaces/types.gen'
import type { SaveContactImCredentialsCommand, TestContactImConnectionCommand } from './types'
import { ORPCError } from '@orpc/client'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useRef } from 'react'
import { consoleQuery } from '@/service/console'
import {
  createCredentialsFor,
  emailSettingsFor,
  toDetailView,
  updateCredentialsFor,
  updateEmailSettingsFor,
} from './credentials'
import { ContactImRepositoryError, ContactImRepositoryErrorCode } from './types'

export const CONTACT_IM_SYNC_POLL_INTERVAL_MS = 2_000

export function channelError(error: unknown) {
  if (error instanceof ContactImRepositoryError) return error
  if (error instanceof ORPCError) {
    if (error.status === 403)
      return new ContactImRepositoryError(ContactImRepositoryErrorCode.NoPermission)
    if (error.status === 409) {
      const data = error.data
      return new ContactImRepositoryError(
        typeof data === 'object' &&
          data !== null &&
          'code' in data &&
          data.code === 'replacement_required'
          ? ContactImRepositoryErrorCode.ReplacementRequired
          : ContactImRepositoryErrorCode.ConfigurationUpdated,
      )
    }
    return new ContactImRepositoryError(ContactImRepositoryErrorCode.MutationFailed, error.message)
  }
  return new ContactImRepositoryError(ContactImRepositoryErrorCode.MutationFailed)
}

export function useSaveContactImCredentials() {
  const queryClient = useQueryClient()
  const channels = consoleQuery.workspaces.current.humanInput.v2.channels
  const createEmail = useMutation(
    channels.email.post.mutationOptions({ context: { silent: true }, gcTime: 0 }),
  )
  const updateEmail = useMutation(
    channels.email.byChannelId.put.mutationOptions({ context: { silent: true }, gcTime: 0 }),
  )
  const createIM = useMutation(
    channels.im.post.mutationOptions({ context: { silent: true }, gcTime: 0 }),
  )
  const updateIM = useMutation(
    channels.im.byChannelId.put.mutationOptions({ context: { silent: true }, gcTime: 0 }),
  )
  const replaceIM = useMutation(
    channels.im.byChannelId.replacement.post.mutationOptions({
      context: { silent: true },
      gcTime: 0,
    }),
  )
  const mutations = [createEmail, updateEmail, createIM, updateIM, replaceIM]
  const commandRef = useRef<Omit<SaveContactImCredentialsCommand, 'organizationId'> | null>(null)
  const operation = useMutation({
    mutationKey: channels.key(),
    gcTime: 0,
    retry: false,
    mutationFn: async () => {
      const command = commandRef.current
      commandRef.current = null
      if (!command) throw new ContactImRepositoryError(ContactImRepositoryErrorCode.InvalidCommand)

      const params = command.channelId ? { channel_id: command.channelId } : null
      const version = command.expectedConfigVersion
      if (params && !version)
        throw new ContactImRepositoryError(ContactImRepositoryErrorCode.ConfigurationUpdated)
      let summary: ChannelSummary
      try {
        if (params && version && !command.replaceActiveProvider) {
          const credentials = updateCredentialsFor(command)
          const body = { credentials, expected_config_version: version }
          summary =
            credentials.provider === 'resend'
              ? (
                  await updateEmail.mutateAsync({
                    params,
                    body: { ...body, ...updateEmailSettingsFor(command), credentials },
                  })
                ).summary
              : (await updateIM.mutateAsync({ params, body: { ...body, credentials } })).summary
        } else {
          const credentials = createCredentialsFor(command)
          summary =
            credentials.provider === 'resend'
              ? (
                  await createEmail.mutateAsync({
                    body: { ...emailSettingsFor(command), credentials },
                  })
                ).summary
              : params && version
                ? (
                    await replaceIM.mutateAsync({
                      params,
                      body: { credentials, expected_config_version: version },
                    })
                  ).summary
                : (await createIM.mutateAsync({ body: { credentials } })).summary
        }
        try {
          const input = { params: { channel_id: summary.id } }
          const detail =
            summary.kind === 'email'
              ? await queryClient.query(
                  channels.email.byChannelId.get.queryOptions({
                    input,
                    context: { silent: true },
                    staleTime: 0,
                  }),
                )
              : await queryClient.query(
                  channels.im.byChannelId.get.queryOptions({
                    input,
                    context: { silent: true },
                    staleTime: 0,
                  }),
                )
          return toDetailView(detail)
        } catch {
          throw new ContactImRepositoryError(ContactImRepositoryErrorCode.SavedDetailsUnavailable)
        }
      } catch (error) {
        const safeError = channelError(error)
        throw safeError
      } finally {
        mutations.forEach((mutation) => mutation.reset())
      }
    },
  })
  return {
    ...operation,
    saveCredentials: (input: Omit<SaveContactImCredentialsCommand, 'organizationId'>) => {
      commandRef.current = input
      return operation.mutateAsync()
    },
  }
}

export function useTestContactImConnection() {
  const channels = consoleQuery.workspaces.current.humanInput.v2.channels
  const createEmail = useMutation(
    channels.email.test.post.mutationOptions({ context: { silent: true }, gcTime: 0 }),
  )
  const updateEmail = useMutation(
    channels.email.byChannelId.test.post.mutationOptions({ context: { silent: true }, gcTime: 0 }),
  )
  const createIM = useMutation(
    channels.im.test.post.mutationOptions({ context: { silent: true }, gcTime: 0 }),
  )
  const updateIM = useMutation(
    channels.im.byChannelId.test.post.mutationOptions({ context: { silent: true }, gcTime: 0 }),
  )
  const mutations = [createEmail, updateEmail, createIM, updateIM]
  const commandRef = useRef<Omit<TestContactImConnectionCommand, 'organizationId'> | null>(null)
  const operation = useMutation({
    mutationKey: channels.key(),
    gcTime: 0,
    retry: false,
    mutationFn: async () => {
      const command = commandRef.current
      commandRef.current = null
      if (!command) throw new ContactImRepositoryError(ContactImRepositoryErrorCode.InvalidCommand)

      const params = command.channelId ? { channel_id: command.channelId } : null
      const version = command.expectedConfigVersion
      if (params && !version)
        throw new ContactImRepositoryError(ContactImRepositoryErrorCode.ConfigurationUpdated)
      try {
        let response
        if (params && version) {
          const credentials = updateCredentialsFor(command)
          const body = { credentials, expected_config_version: version }
          response =
            credentials.provider === 'resend'
              ? await updateEmail.mutateAsync({
                  params,
                  body: { ...body, ...updateEmailSettingsFor(command), credentials },
                })
              : await updateIM.mutateAsync({ params, body: { ...body, credentials } })
        } else {
          const credentials = createCredentialsFor(command)
          response =
            credentials.provider === 'resend'
              ? await createEmail.mutateAsync({
                  body: { ...emailSettingsFor(command), credentials },
                })
              : await createIM.mutateAsync({ body: { credentials } })
        }
        if (response.status !== 'connected')
          throw new ContactImRepositoryError(
            ContactImRepositoryErrorCode.MutationFailed,
            response.status_description,
          )
        return response
      } catch (error) {
        const safeError = channelError(error)
        throw safeError
      } finally {
        mutations.forEach((mutation) => mutation.reset())
      }
    },
  })
  return {
    ...operation,
    testConnection: (input: Omit<TestContactImConnectionCommand, 'organizationId'>) => {
      commandRef.current = input
      return operation.mutateAsync()
    },
  }
}
