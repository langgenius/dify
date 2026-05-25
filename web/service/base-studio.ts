/**
 * Studio API base client — functions with the same signatures as ./base but
 * auto-inject isStudioAPI: true so requests go to /studio/api instead of
 * the default /console/api.
 *
 * Studio-dedicated services import from here instead of ./base.
 */
import type { IOtherOptions } from './base'
import { del as _del, get as _get, patch as _patch, post as _post, put as _put, sseGet as _sseGet, ssePost as _ssePost } from './base'

const _s = { isStudioAPI: true as const }

const _opt = (o?: IOtherOptions): IOtherOptions => ({ ..._s, ...o })

export const get = <T>(url: string, options = {}, otherOptions?: IOtherOptions) =>
  _get<T>(url, options, _opt(otherOptions))

export const post = <T>(url: string, options = {}, otherOptions?: IOtherOptions) =>
  _post<T>(url, options, _opt(otherOptions))

export const put = <T>(url: string, options = {}, otherOptions?: IOtherOptions) =>
  _put<T>(url, options, _opt(otherOptions))

export const del = <T>(url: string, options = {}, otherOptions?: IOtherOptions) =>
  _del<T>(url, options, _opt(otherOptions))

export const patch = <T>(url: string, options = {}, otherOptions?: IOtherOptions) =>
  _patch<T>(url, options, _opt(otherOptions))

export const ssePost = async (url: string, fetchOptions: Parameters<typeof _ssePost>[1], otherOptions: IOtherOptions) =>
  _ssePost(url, fetchOptions, _opt(otherOptions))

export const sseGet = async (url: string, fetchOptions: Parameters<typeof _sseGet>[1], otherOptions: IOtherOptions) =>
  _sseGet(url, fetchOptions, _opt(otherOptions))
