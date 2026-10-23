import type { ClientPromiseResult } from '@orpc/client'
import type { ErrorFromErrorMap, ErrorMap } from '@orpc/contract'
import type { GeneralUtils, ProcedureUtils } from '@orpc/tanstack-query'
import type { HttpClient } from './client.js'

declare const schemaTypeMap: unique symbol
export type SchemaDocument<Document, Types> = Document & { readonly [schemaTypeMap]: Types }
type ReferencedSchema<Root, P extends string, Json extends boolean> = Root extends {
  readonly [schemaTypeMap]: infer Types
}
  ? Value<Value<Types, Json extends true ? 'json' : 'default'>, P>
  : never

/** Type inference is deliberately bounded for recursive / adversarial schemas. */
type Next<D extends unknown[]> = [...D, unknown]
type Value<T, K extends PropertyKey, F = never> = K extends keyof T ? T[K] : F
type Item<T> = T extends readonly (infer I)[] ? I : never
type Decode<T extends string> = T extends `${infer A}~1${infer B}`
  ? Decode<`${A}/${B}`>
  : T extends `${infer A}~0${infer B}`
    ? `${A}~${Decode<B>}`
    : T
type Pointer<T, P extends string> = P extends `${infer H}/${infer R}`
  ? Pointer<Value<T, Decode<H>>, R>
  : Value<T, Decode<P>>
export type Resolve<S, Root, D extends unknown[] = []> = D['length'] extends 24
  ? unknown
  : S extends { readonly $ref: `#/${infer P}` }
    ? Resolve<Pointer<Root, P>, Root, Next<D>>
    : S
type RequiredKeys<S> = Item<Value<S, 'required'>> & PropertyKey
type Properties<S, Root, D extends unknown[], Json extends boolean> =
  Value<S, 'properties', Record<never, never>> extends infer P
    ? {
        -readonly [K in keyof P as K extends RequiredKeys<S> ? K : never]-?: InferSchema<
          P[K],
          Root,
          Next<D>,
          Json
        >
      } & {
        -readonly [K in keyof P as K extends RequiredKeys<S> ? never : K]?: InferSchema<
          P[K],
          Root,
          Next<D>,
          Json
        >
      }
    : never
type ObjectSchema<S, Root, D extends unknown[], Json extends boolean> = Properties<
  S,
  Root,
  D,
  Json
> &
  (S extends { readonly additionalProperties: infer A }
    ? A extends false
      ? unknown
      : A extends true
        ? Record<string, unknown>
        : Record<
            string,
            | InferSchema<A, Root, Next<D>, Json>
            | InferSchema<
                ItemValues<Value<S, 'properties', Record<never, never>>>,
                Root,
                Next<D>,
                Json
              >
          >
    : unknown)
type ItemValues<T> = T[keyof T]
type AllOf<S, Root, D extends unknown[], Json extends boolean> = S extends readonly [
  infer H,
  ...infer T,
]
  ? InferSchema<H, Root, Next<D>, Json> & AllOf<T, Root, Next<D>, Json>
  : unknown
type Primitive<S, T, Root, D extends unknown[], Json extends boolean> = T extends 'string'
  ? S extends { readonly format: 'binary' }
    ? Json extends true
      ? string
      : Blob
    : string
  : T extends 'integer' | 'number'
    ? number
    : T extends 'boolean'
      ? boolean
      : T extends 'null'
        ? null
        : T extends 'array'
          ? InferSchema<Value<S, 'items', true>, Root, Next<D>, Json>[]
          : T extends 'object'
            ? ObjectSchema<S, Root, D, Json>
            : unknown
type BaseSchema<S, Root, D extends unknown[], Json extends boolean> = S extends {
  readonly const: infer C
}
  ? C
  : S extends { readonly enum: readonly (infer E)[] }
    ? E
    : S extends { readonly type: infer T }
      ? Primitive<S, T extends readonly unknown[] ? T[number] : T, Root, D, Json>
      : S extends { readonly properties: unknown }
        ? ObjectSchema<S, Root, D, Json>
        : unknown
export type InferSchema<
  S,
  Root = S,
  D extends unknown[] = [],
  Json extends boolean = false,
> = D['length'] extends 24
  ? unknown
  : S extends false
    ? never
    : S extends true
      ? unknown
      : S extends { readonly $ref: `#/${infer P}` }
        ? Root extends { readonly [schemaTypeMap]: unknown }
          ? ReferencedSchema<Root, `#/${P}`, Json>
          : InferSchema<Pointer<Root, P>, Root, Next<D>, Json>
        :
            | (BaseSchema<S, Root, D, Json> &
                (S extends { readonly oneOf: readonly (infer O)[] }
                  ? InferSchema<O, Root, Next<D>, Json>
                  : unknown) &
                (S extends { readonly anyOf: readonly (infer O)[] }
                  ? InferSchema<O, Root, Next<D>, Json>
                  : unknown) &
                (S extends { readonly allOf: infer A } ? AllOf<A, Root, D, Json> : unknown))
            | (S extends { readonly nullable: true } ? null : never)

export type Method = 'get' | 'post' | 'put' | 'patch' | 'delete' | 'head' | 'options' | 'trace'
export type OpenApiDocument = { readonly openapi: string; readonly paths: object }
type Paths<S> = Value<S, 'paths'>
type PathItem<S, P extends keyof Paths<S>> = Resolve<Paths<S>[P], S>
type Operation<S, P extends keyof Paths<S>, M extends Method> = Resolve<Value<PathItem<S, P>, M>, S>
type Params<T, S> = Resolve<Item<Value<T, 'parameters'>>, S>
type Overrides<P, O> = P extends { name: infer N; in: infer L }
  ? Extract<O, { name: N; in: L }> extends never
    ? P
    : never
  : never
type Parameters<S, P extends keyof Paths<S>, M extends Method> =
  | Params<Operation<S, P, M>, S>
  | Overrides<Params<PathItem<S, P>, S>, Params<Operation<S, P, M>, S>>
type RequiredParameter<P> = P extends { in: 'path' } | { required: true } ? P : never
type ParameterMap<P, S> = {
  [K in Value<RequiredParameter<P>, 'name'> & string]: InferSchema<
    Value<Extract<P, { name: K }>, 'schema'>,
    S
  >
} & {
  [K in Exclude<Value<P, 'name'>, Value<RequiredParameter<P>, 'name'>> & string]?: InferSchema<
    Value<Extract<P, { name: K }>, 'schema'>,
    S
  >
}
type Group<P, S, L extends string> =
  Extract<P, { in: L }> extends infer G
    ? [G] extends [never]
      ? { [K in L]?: never }
      : [RequiredParameter<G>] extends [never]
        ? { [K in L]?: ParameterMap<G, S> }
        : { [K in L]: ParameterMap<G, S> }
    : never
// Binary-formatted fields are strings in JSON and Blob/File in multipart requests.
type MediaSchema<C, K, S> = InferSchema<
  Value<C, 'schema'>,
  S,
  [],
  K extends 'application/json' | `${string}+json` ? true : false
>
type RequestMedia<C, S, B> =
  | {
      [K in keyof C]: (B extends { required: true }
        ? { body: MediaSchema<C[K], K, S> }
        : { body?: MediaSchema<C[K], K, S> }) &
        // application/json is the default; a single declared media type is unambiguous.
        (K extends 'application/json'
          ? { contentType?: K }
          : [Exclude<keyof C, K>] extends [never]
            ? { contentType?: K }
            : { contentType: K })
    }[keyof C]
  | (B extends { required: true } ? never : { body?: never; contentType?: keyof C })
type RequestBody<S, O> =
  Resolve<Value<O, 'requestBody'>, S> extends infer B
    ? [B] extends [never]
      ? { body?: never; contentType?: never }
      : RequestMedia<Value<B, 'content'>, S, B>
    : never
export type RequestOptions<S, P extends keyof Paths<S>, M extends Method> = Group<
  Parameters<S, P, M>,
  S,
  'path'
> &
  Group<Parameters<S, P, M>, S, 'query'> &
  Group<Parameters<S, P, M>, S, 'header'> &
  Group<Parameters<S, P, M>, S, 'cookie'> &
  RequestBody<S, Operation<S, P, M>> & {
    client?: HttpClient
    headers?: HeadersInit
    signal?: AbortSignal
    credentials?: RequestCredentials
  }
type ResponseContent<C, S> = {
  [K in keyof C]: K extends 'application/json' | `${string}+json`
    ? MediaSchema<C[K], K, S>
    : K extends 'text/event-stream'
      ? ReadableStream<Uint8Array>
      : K extends `text/${string}`
        ? string
        : Blob
}[keyof C]
type Response<R, S> =
  Resolve<R, S> extends infer B
    ? B extends { content: infer C }
      ? ResponseContent<C, S>
      : unknown
    : never
type SuccessResponses<R> = {
  [K in keyof R]: `${K & (string | number)}` extends `2${string}` ? K : never
}[keyof R]
export type ResponseFor<S, P extends keyof Paths<S>, M extends Method> =
  Value<Operation<S, P, M>, 'responses'> extends infer R
    ? M extends 'head'
      ? undefined
      : [SuccessResponses<R>] extends [never]
        ? unknown
        : {
            [K in keyof R]: `${K & (string | number)}` extends '204' | '205'
              ? undefined
              : `${K & (string | number)}` extends `2${string}`
                ? Response<R[K], S>
                : never
          }[keyof R]
    : never
export type CallOptions<Context extends object = object> = {
  client?: HttpClient
  signal?: AbortSignal
  headers?: HeadersInit
  credentials?: RequestCredentials
  context?: Context
}
type RpcInput<O> = O extends unknown
  ? Omit<O, 'path' | 'header' | 'client' | 'signal' | 'headers' | 'credentials'> &
      (O extends { header: infer H }
        ? { headers: H }
        : O extends { header?: infer H }
          ? { headers?: H }
          : unknown) &
      (O extends { path: infer P }
        ? { params: P }
        : O extends { path?: infer P }
          ? { params?: P }
          : unknown)
  : never
type RpcResponse<T> = T extends undefined ? void : T
/** Resolve operation signatures only when a consumer accesses their route. */
export type RpcRouter<S, Routes, Context extends object = object, Errors = object> = {
  [K in keyof Routes]: Routes[K] extends readonly [
    infer P extends keyof Paths<S>,
    infer M extends Method,
  ]
    ? RpcOperation<S, P, M, Context, Errors>
    : RpcRouter<S, Routes[K], Context, Errors>
}
type RpcQueryOperation<Operation, Context extends object> = Operation extends (
  ...args: infer Args
) => ClientPromiseResult<infer Output, infer Error>
  ? ProcedureUtils<Context, Args[0], Output, Error> & GeneralUtils<Args[0]>
  : never

/** Preserve optional input when adapting the public call signature to oRPC's helpers. */
export type RpcQueryRouter<S, Routes, Context extends object = object, Errors = object> = {
  [K in keyof Routes]: Routes[K] extends readonly [
    infer P extends keyof Paths<S>,
    infer M extends Method,
  ]
    ? RpcQueryOperation<RpcOperation<S, P, M, Context, Errors>, Context>
    : RpcQueryRouter<S, Routes[K], Context, Errors>
} & GeneralUtils<unknown>
export type RpcOperation<
  S,
  P extends keyof Paths<S>,
  M extends Method,
  Context extends object = object,
  Errors = object,
> =
  RpcInput<RequestOptions<S, P, M>> extends infer Input
    ? (
        ...args: Record<never, never> extends Input
          ? [input?: Input, options?: CallOptions<Context>]
          : [input: Input, options?: CallOptions<Context>]
      ) => ClientPromiseResult<
        RpcResponse<ResponseFor<S, P, M>>,
        Value<
          Errors,
          `${Uppercase<M>} ${P & string}`,
          Record<never, never>
        > extends infer Map extends ErrorMap
          ? ErrorFromErrorMap<Map>
          : Error
      >
    : never
