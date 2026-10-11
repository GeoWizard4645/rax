import { describe, expect, it } from 'vitest';
import { isChunkError } from '../../src/lib/recover';

describe('stale-chunk detection', () => {
  it.each([
    'Failed to fetch dynamically imported module: https://rax.vivaanshahani.com/assets/EdgeTab-abc.js',
    'error loading dynamically imported module',
    'Importing a module script failed.',
    'Loading chunk 12 failed.',
    "Failed to load module script: Expected a JavaScript module script but the server responded with a MIME type of \"text/html\"",
  ])('treats %s as a chunk error', (m) => expect(isChunkError(new Error(m))).toBe(true));
  it('does not treat ordinary render errors as chunk errors', () => {
    expect(isChunkError(new TypeError("Cannot read properties of undefined (reading 'map')"))).toBe(false);
    expect(isChunkError(undefined)).toBe(false);
  });
});
