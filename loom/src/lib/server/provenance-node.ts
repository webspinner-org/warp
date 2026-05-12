/**
 * Node fs wrapper for the SDK's BundleReader + ProvenanceWriter
 * interfaces. The reader resolves files relative to a bundle root and
 * normalizes manifest-style `./` prefixes. The writer ensures the
 * `provenance/` subdirectory exists before any write lands.
 *
 * Two reasons this lives in the Loom rather than the SDK:
 *   1. The SDK stays platform-neutral — fs imports would couple it to
 *      Node.
 *   2. A runner-instance or browser context will hand in a different
 *      backing — the same interface, a different implementation.
 */

import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import type { BundleReader, ProvenanceWriter } from '@webspinner-foundation/sdk';

export function nodeProvenanceIO(bundleRoot: string): {
  reader: BundleReader;
  writer: ProvenanceWriter;
} {
  return {
    reader: {
      async readFile(relativePath: string): Promise<Uint8Array | null> {
        const cleaned = relativePath.replace(/^\.\//, '');
        const full = join(bundleRoot, cleaned);
        try {
          return new Uint8Array(await readFile(full));
        } catch (err) {
          if ((err as NodeJS.ErrnoException).code === 'ENOENT') return null;
          throw err;
        }
      },
    },
    writer: {
      async writeFile(relativePath: string, content: string): Promise<void> {
        const cleaned = relativePath.replace(/^\.\//, '');
        const full = join(bundleRoot, cleaned);
        await mkdir(dirname(full), { recursive: true });
        await writeFile(full, content, 'utf8');
      },
    },
  };
}
