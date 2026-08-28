/** CSS Modules type shim: `*.module.css` imports resolve to a class-name map. */
declare module '*.module.css' {
  const classes: Readonly<Record<string, string>>
  export default classes
}
