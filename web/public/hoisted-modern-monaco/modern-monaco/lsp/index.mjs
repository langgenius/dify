// src/lsp/index.ts
var builtinLSPProviders = {
  html: {
    import: () => import("./html/setup.mjs")
  },
  css: {
    aliases: ["less", "sass"],
    import: () => import("./css/setup.mjs")
  },
  json: {
    import: () => import("./json/setup.mjs")
  },
  typescript: {
    aliases: ["javascript", "jsx", "tsx"],
    import: () => import("./typescript/setup.mjs")
  }
};
export {
  builtinLSPProviders
};
