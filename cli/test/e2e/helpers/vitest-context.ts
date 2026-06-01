// This file is intentionally left minimal.
// ProvidedContext augmentation was removed because vite-plus-test already
// exports ProvidedContext from its own module, causing TS2300 duplicate
// identifier errors when the module is augmented.
// Callers of inject() should cast the result: inject('key') as MyType
export {}
