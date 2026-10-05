// TypeScript 6 checks side-effect imports by default (noUncheckedSideEffectImports),
// so `import './Button.css'` needs a module declaration. apps/web gets the same
// declaration from `vite/client`; this covers this package, its tests and Storybook.
declare module '*.css' {}
