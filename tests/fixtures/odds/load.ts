// @ts-nocheck — test-only helper (node:fs); excluded from the Workers type-check on purpose.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

/** Load a recorded upstream response from tests/fixtures/odds/<name>.json. */
export const fixture = (name: string): any => JSON.parse(readFileSync(fileURLToPath(new URL(`./${name}.json`, import.meta.url)), 'utf8'));
