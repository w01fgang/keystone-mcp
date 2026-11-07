import { defineConfig } from 'vitest/config';

export default defineConfig({
  resolve: {
    // Node resolves `graphql` to its CommonJS build, which Keystone loads as `graphql/index.js`. Vite would pick the
    // ES module build from the `module` field, and a schema from one build fails the type checks of the other.
    alias: [{ find: /^graphql$/, replacement: 'graphql/index.js' }],
  },
  test: {
    include: ['test/**/*.test.ts'],
  },
});
