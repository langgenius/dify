// this file is used to stub compiled imports when skipLibCheck: false is used
// it is not meant to be used with local type checking and is ignored in our
// local tsconfig.json

declare module 'next/dist/compiled/webpack/webpack' {
  export function init(): void
  export let BasicEvaluatedExpression: any
  export let GraphHelpers: any
  export let sources: any
  export let StringXor: any
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  export type LoaderDefinitionFunction<T> = any
  namespace webpack {
    export type Compiler = any
    export type WebpackPluginInstance = any
    export type Compilation = any
    export type Module = any
    export type Stats = any
    export type Template = any
    export type RuntimeModule = any
    export type RuntimeGlobals = any
    export type NormalModule = any
    export type ResolvePluginInstance = any
    export type Configuration = any
    export type ResolveOptions = any
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    export type LoaderContext<T> = any
    export type RuleSetUseItem = any
    export type EntryObject = any
    export type Chunk = any
    export type ChunkGroup = any
    export type DefinePlugin = any
    // eslint-disable-next-line @typescript-eslint/no-shadow
    namespace sources {
      export type RawSource = any
    }
  }
  export var webpack: any
}

declare module 'next/dist/compiled/superstruct' {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  export type Struct<T, S> = any
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  export type Infer<T = any> = any
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  export type Describe<T> = any
}

declare module 'next/dist/compiled/jest-worker' {
  export class Worker {
    constructor(...args: any[])
    end(): any
  }
}

declare module 'next/dist/compiled/amphtml-validator' {
  export type ValidationError = any
}

declare module 'react-server-dom-webpack/server.edge'

declare module 'VAR_MODULE_GLOBAL_ERROR'
declare module 'VAR_USERLAND'
declare module 'VAR_MODULE_DOCUMENT'
declare module 'VAR_MODULE_APP'
