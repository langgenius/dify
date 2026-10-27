import type { ClientPromiseResult } from '@orpc/client'
import type { ErrorFromErrorMap, ErrorMap } from '@orpc/contract'
import type { GeneralUtils, ProcedureUtils } from '@orpc/tanstack-query'
import type { HttpClient } from './client.js'
import type { MediaType } from './media-type.js'

declare const schemaTypeMap: unique symbol
export type SchemaDocument<Document, Types> = Document & { readonly [schemaTypeMap]: Types }
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
/** Apply required after composition so referenced properties keep their inferred types. */
export type RequireSchemaKeys<T, Keys extends PropertyKey> = [Keys] extends [never]
  ? T
  : T extends readonly unknown[]
    ? T
    : T extends object
      ? T & {
          [K in Keys]-?: (K extends keyof T ? T[K] : unknown) & (NonNullable<unknown> | null)
        }
      : T
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
    : [keyof Properties<S, Root, D, Json>] extends [never]
      ? Record<string, unknown>
      : unknown) &
  (S extends { readonly additionalProperties: false }
    ? [keyof Properties<S, Root, D, Json>] extends [never]
      ? Record<string, never>
      : unknown
    : unknown)
type ItemValues<T> = T[keyof T]
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
type ApplyAllOf<T, Schemas, D extends unknown[]> = D['length'] extends 24
  ? T
  : [Schemas] extends [never]
    ? T
    : Schemas extends readonly [infer H, ...infer Rest]
      ? ApplyAllOf<ApplySchemaComposition<T, H, Next<D>>, Rest, Next<D>>
      : T
type AllOfBase<Schemas, D extends unknown[]> = D['length'] extends 24
  ? unknown
  : [Schemas] extends [never]
    ? unknown
    : Schemas extends readonly [infer H, ...infer Rest]
      ? ApplySchemaComposition<unknown, H, Next<D>> & AllOfBase<Rest, Next<D>>
      : unknown
type NamedProperties<T> = {
  [
    K in keyof T as string extends K
      ? never
      : number extends K
        ? never
        : symbol extends K
          ? never
          : K
  ]: T[K]
}
type RequiredObjectKeys<T, Named = NamedProperties<T>> = {
  [K in keyof Named]-?: Record<never, never> extends Pick<Named, K> ? never : K
}[keyof Named] &
  keyof T
type ExcludeObjectMatch<T, Other> = {
  [K in RequiredObjectKeys<Other>]: T & {
    [P in K]?: P extends keyof T ? Exclude<T[P], Other[P]> : never
  }
}[RequiredObjectKeys<Other>]
type ExcludeSingleBranch<T, Other> = T extends Other
  ? never
  : T extends readonly unknown[]
    ? T
    : T extends object
      ? Other extends readonly unknown[]
        ? T
        : Other extends object
          ? [RequiredObjectKeys<Other>] extends [never]
            ? T
            : ExcludeObjectMatch<T, Other>
          : T
      : T
type ExcludeBranch<T, Other> = [Other] extends [never]
  ? T
  : (Other extends unknown ? (value: ExcludeSingleBranch<T, Other>) => void : never) extends (
        value: infer Remaining,
      ) => void
    ? Remaining
    : never
type ExcludeOtherBranches<
  T,
  Branches,
  Index extends number,
  D extends unknown[] = [],
> = D['length'] extends 24
  ? T
  : Branches extends readonly [infer H, ...infer Rest]
    ? ExcludeOtherBranches<
        D['length'] extends Index ? T : ExcludeBranch<T, H>,
        Rest,
        Index,
        Next<D>
      >
    : T
/** Subtract overlapping scalar values and required object shapes from each branch. */
export type ExclusiveUnion<
  Branches,
  All = Branches,
  D extends unknown[] = [],
> = D['length'] extends 24
  ? Item<Branches>
  : Branches extends readonly [infer H, ...infer Rest]
    ? ExcludeOtherBranches<H, All, D['length']> | ExclusiveUnion<Rest, All, Next<D>>
    : never
type ApplyAlternatives<T, Schemas, D extends unknown[]> = [Schemas] extends [never]
  ? T
  : Schemas extends readonly unknown[]
    ? ApplySchemaComposition<T, Schemas[number], Next<D>>
    : T
type ApplyOneOf<T, Schemas, D extends unknown[]> = [Schemas] extends [never]
  ? T
  : Schemas extends readonly unknown[]
    ? ExclusiveUnion<{ [I in keyof Schemas]: ApplySchemaComposition<T, Schemas[I], Next<D>> }>
    : T
type ApplyReference<T, C, D extends unknown[]> = C extends { ref: infer R }
  ? ApplySchemaComposition<T, R, Next<D>>
  : T
/** Compose each alternative with the surrounding type before enforcing required. */
export type ApplySchemaComposition<T, C, D extends unknown[] = []> = D['length'] extends 24
  ? T
  : C extends object
    ? ApplyReference<unknown, C, D> &
        T &
        Value<C, 'base', unknown> &
        AllOfBase<Value<C, 'allOf'>, D> extends infer Base
      ?
          | RequireSchemaKeys<
              ApplyOneOf<
                ApplyAlternatives<
                  ApplyAllOf<ApplyReference<Base, C, D>, Value<C, 'allOf'>, D>,
                  Value<C, 'anyOf'>,
                  D
                >,
                Value<C, 'oneOf'>,
                D
              >,
              Item<Value<C, 'required'>> & PropertyKey
            >
          | (C extends { nullable: true } ? T & null : never)
      : never
    : T

type CompositionList<S, K extends PropertyKey, Root, D extends unknown[], Json extends boolean> =
  Value<S, K> extends infer List extends readonly unknown[]
    ? { [I in keyof List]: SchemaComposition<List[I], Root, Next<D>, Json> }
    : never
type ReferenceComposition<
  Ref extends string,
  Root,
  D extends unknown[],
  Json extends boolean,
> = Root extends { readonly [schemaTypeMap]: infer Types }
  ? Value<Value<Types, Json extends true ? 'jsonCompositions' : 'compositions'>, Ref>
  : SchemaComposition<Ref extends `#/${infer P}` ? Pointer<Root, P> : unknown, Root, Next<D>, Json>
type SchemaComposition<S, Root, D extends unknown[], Json extends boolean> = D['length'] extends 24
  ? { base: unknown }
  : S extends false
    ? { base: never }
    : S extends { readonly $ref: infer Ref extends string }
      ? Root extends { readonly openapi: `3.0.${string}` }
        ? { ref: ReferenceComposition<Ref, Root, D, Json> }
        : OwnComposition<S, Root, D, Json> & { ref: ReferenceComposition<Ref, Root, D, Json> }
      : OwnComposition<S, Root, D, Json>
type OwnComposition<S, Root, D extends unknown[], Json extends boolean> = {
  base: BaseSchema<S, Root, D, Json>
  required: Value<S, 'required', []>
  allOf: CompositionList<S, 'allOf', Root, D, Json>
  anyOf: CompositionList<S, 'anyOf', Root, D, Json>
  oneOf: CompositionList<S, 'oneOf', Root, D, Json>
  nullable: Value<S, 'nullable', false>
}
export type InferSchema<
  S,
  Root = S,
  D extends unknown[] = [],
  Json extends boolean = false,
> = D['length'] extends 24
  ? unknown
  : ApplySchemaComposition<unknown, SchemaComposition<S, Root, D, Json>>

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
type JsonPart<T> = T extends Blob
  ? string
  : T extends object
    ? { [K in keyof T]: JsonPart<T[K]> }
    : T
type MultipartBody<Body, Encodings> = {
  [K in keyof Body]: MediaType<
    Value<Value<Encodings, K, object>, 'contentType', ''> & string
  > extends 'application/json'
    ? JsonPart<Body[K]>
    : Body[K]
}
type MediaSchema<C, K, S> =
  MediaType<K & string> extends 'application/octet-stream'
    ? Blob
    : MediaType<K & string> extends 'multipart/form-data'
      ? MultipartBody<InferSchema<Value<C, 'schema', true>, S>, Value<C, 'encoding', object>>
      : InferSchema<
          Value<C, 'schema', true>,
          S,
          [],
          MediaType<K & string> extends 'application/json' | `${string}+json` ? true : false
        >
type JsonMediaKeys<C> = {
  [K in keyof C]: MediaType<K & string> extends 'application/json' ? K : never
}[keyof C]
type DefaultMedia<C, K> = [Exclude<keyof C, K>] extends [never]
  ? true
  : K extends JsonMediaKeys<C>
    ? [Exclude<JsonMediaKeys<C>, K>] extends [never]
      ? true
      : false
    : false
type RequestMedia<C, S, B> =
  | {
      [K in keyof C]: (B extends { required: true }
        ? { body: MediaSchema<C[K], K, S> }
        : { body?: MediaSchema<C[K], K, S> }) &
        // A default is safe only when the media type or JSON candidate is unique.
        (DefaultMedia<C, K> extends true ? { contentType?: K } : { contentType: K })
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
  [K in keyof C]: MediaType<K & string> extends 'application/json' | `${string}+json`
    ? MediaSchema<C[K], K, S>
    : MediaType<K & string> extends 'text/event-stream'
      ? ReadableStream<Uint8Array>
      : MediaType<K & string> extends `text/${string}`
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
