/**
 * Minimal DOM stub so the model modules can be imported under plain Node.
 *
 * `tree.ts` (and `render.ts`) measure text with an off-screen canvas at module
 * load time. The parser/serializer don't care about the numbers — only that
 * measuring works — so a fake canvas with a deterministic `measureText` is
 * enough to unit-test the notation without a browser.
 *
 * Import this **before** any module that pulls in `tree.js`; ESM evaluates
 * imports in order, so a bare `import "./dom-stub.mjs"` first does the job.
 */
const fakeContext = {
  font: "",
  measureText: (text) => ({ width: String(text).length * 8 }),
};

globalThis.document = {
  createElement: () => ({ getContext: () => fakeContext }),
};
