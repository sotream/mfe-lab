declare module '*.css';
// Imported as text and injected into the shadow root (never into document.head).
declare module '*.css?raw' {
  const css: string;
  export default css;
}
