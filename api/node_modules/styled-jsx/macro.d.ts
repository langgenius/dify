declare module 'styled-jsx/macro' {
  import type { JSX } from "react";

  namespace macro {
    function resolve(
      chunks: TemplateStringsArray,
      ...args: any[]
    ): {
      className: string
      styles: JSX.Element
    }
  }

  export = macro
}
