#!/usr/bin/env python3
"""Build the embedding index for the Foundation precedent library.

For each precedent at ~/warp/foundation-precedents/<slug>/:
  - read narrative.md (which carries the patron-style sentence + design rationale)
  - read schema.json (for appName, domain — included in the embedded text)
  - embed the combined text via the local BGE-M3 service
  - record {slug, dim, vector, sentence, appName, domain}

Output: ~/warp/foundation-precedents/.index.json

The index commits to the repo (~150 KB for 15 precedents × 1024 floats).
Other Cells can pull and verify their own embedding service produces the
same vectors (BGE-M3 is deterministic).

Run on Kepler (where the embedding service lives) OR on any host with
WARP_EMBEDDINGS_URL pointing at a reachable service.

Usage:
  python3 tools/precedents-index.py
"""
from __future__ import annotations

import json
import os
import pathlib
import sys
import time
import urllib.request

REPO = pathlib.Path(__file__).resolve().parents[1]
PRECEDENT_DIR = REPO / 'foundation-precedents'
INDEX_PATH = PRECEDENT_DIR / '.index.json'
EMBEDDINGS_URL = os.environ.get('WARP_EMBEDDINGS_URL', 'http://127.0.0.1:8101')


def extract_sentence(narrative_text: str) -> str:
    """Pull the '> sentence' quote out of narrative.md."""
    for line in narrative_text.splitlines():
        line = line.strip()
        if line.startswith('> '):
            return line[2:].strip()
    return ''


def embed_one(text: str) -> list[float]:
    body = json.dumps({'texts': [text]}).encode('utf-8')
    req = urllib.request.Request(
        f'{EMBEDDINGS_URL}/embed',
        data=body,
        headers={'Content-Type': 'application/json'},
        method='POST',
    )
    with urllib.request.urlopen(req, timeout=60) as r:
        resp = json.load(r)
    return resp['embeddings'][0]


def main():
    if not PRECEDENT_DIR.exists():
        print(f'precedent dir missing: {PRECEDENT_DIR}', file=sys.stderr)
        sys.exit(1)

    slugs = sorted(
        d.name for d in PRECEDENT_DIR.iterdir()
        if d.is_dir() and not d.name.startswith('.')
    )
    if not slugs:
        print(f'no precedents in {PRECEDENT_DIR}', file=sys.stderr)
        sys.exit(1)

    index: dict[str, dict] = {}
    t_all = time.time()
    for slug in slugs:
        d = PRECEDENT_DIR / slug
        narrative_text = (d / 'narrative.md').read_text()
        schema = json.loads((d / 'schema.json').read_text())
        sentence = extract_sentence(narrative_text)
        # Embed a composite: sentence + appName + domain + narrative
        # body. The sentence weighs most because patrons' propose
        # queries are sentence-shaped; the rest provides context.
        combined = (
            f'{sentence}\n'
            f'Application: {schema["appName"]}\n'
            f'Domain: {schema["domain"]}\n\n'
            f'{narrative_text}'
        )
        t0 = time.time()
        vec = embed_one(combined)
        dt = (time.time() - t0) * 1000
        index[slug] = {
            'slug': slug,
            'dim': len(vec),
            'vector': vec,
            'sentence': sentence,
            'appName': schema['appName'],
            'domain': schema['domain'],
        }
        print(f'  {slug:<24s} dim={len(vec)} dt={dt:.0f}ms')

    INDEX_PATH.write_text(json.dumps(index, indent=2) + '\n')
    print(f'\nindexed {len(index)} precedents in {time.time()-t_all:.1f}s')
    print(f'wrote {INDEX_PATH}')


if __name__ == '__main__':
    main()
