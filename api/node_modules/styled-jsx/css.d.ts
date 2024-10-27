// Definitions by: @types/styled-jsx <https://www.npmjs.com/package/@types/styled-jsx>

declare module 'styled-jsx/css' {
  import type { JSX } from "react";

  function css(chunks: TemplateStringsArray, ...args: any[]): JSX.Element
  namespace css {
    export function global(
      chunks: TemplateStringsArray,
      ...args: any[]
    ): JSX.Element
    export function resolve(
      chunks: TemplateStringsArray,
      ...args: any[]
    ): { className: string; styles: JSX.Element }
  }
  export = css
}
