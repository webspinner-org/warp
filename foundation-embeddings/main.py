"""Foundation embeddings service — BGE-M3 on Kepler.

The first leg of the v2 retrieval chain: patron sentences in,
1024-dimensional embeddings out. Used by loom/src/lib/server/
precedent-retrieval.ts to score sentence-vs-precedent similarity
without leaving Kepler.

Per loom-design.md §5.3.1: ~500 MB model, sub-100 ms per query on
Apple Silicon (Metal Performance Shaders via PyTorch's MPS
backend). Per WARP-CANON: BGE-M3 is the canonical embedding model.

Endpoints:
  POST /embed   {texts: string[]} -> {embeddings: number[][], dim: int}
  GET  /healthz                   -> {ok: bool, model: str, dim: int, device: str}

Model is loaded at startup; if startup fails (model not downloaded,
torch missing, etc.) the service exits non-zero so launchd's
KeepAlive surfaces the failure honestly.
"""
from __future__ import annotations

import logging
import os
import sys
import time
from typing import Iterable

from fastapi import FastAPI, HTTPException
from pydantic import BaseModel

logging.basicConfig(level=logging.INFO, format='%(asctime)s [embeddings] %(message)s')
log = logging.getLogger('foundation-embeddings')

# Lazy-load: keep startup fast for debugging, eager-load on first
# request. In production with KeepAlive=true this means the first
# request after a restart pays the load cost (~2-5s on M-series).
# To eager-load instead, set WARP_EMBEDDINGS_EAGER=1.
_MODEL = None
_MODEL_NAME = 'BAAI/bge-m3'
_DEVICE = None


def get_model():
    global _MODEL, _DEVICE
    if _MODEL is not None:
        return _MODEL
    log.info(f'loading {_MODEL_NAME} (first call; subsequent calls are warm)')
    try:
        import torch
        from FlagEmbedding import BGEM3FlagModel
    except ImportError as e:
        log.error(f'missing dependency: {e}. pip install FlagEmbedding torch')
        raise

    if torch.backends.mps.is_available():
        _DEVICE = 'mps'
    elif torch.cuda.is_available():
        _DEVICE = 'cuda'
    else:
        _DEVICE = 'cpu'

    t0 = time.time()
    # BGE-M3 supports FP16; on MPS we use it because half-precision
    # is the practical Apple-Silicon default. FlagEmbedding handles
    # the device move internally via use_fp16=True + device kwarg.
    _MODEL = BGEM3FlagModel(_MODEL_NAME, use_fp16=(_DEVICE != 'cpu'), device=_DEVICE)
    log.info(f'model loaded in {time.time()-t0:.1f}s on {_DEVICE}')
    return _MODEL


def embed_texts(texts: list[str]) -> list[list[float]]:
    m = get_model()
    out = m.encode(texts, batch_size=8, max_length=2048)
    # BGE-M3 returns a dict with multiple representations; we use
    # the dense vector (1024-dim) for nearest-neighbour search.
    dense = out['dense_vecs']
    # numpy array → list of lists for JSON serialisation.
    return [v.tolist() for v in dense]


# ── HTTP surface ──────────────────────────────────────────────────────

app = FastAPI(title='Foundation Embeddings', version='1.0.0')


class EmbedRequest(BaseModel):
    texts: list[str]


class EmbedResponse(BaseModel):
    embeddings: list[list[float]]
    dim: int
    model: str
    device: str


@app.post('/embed', response_model=EmbedResponse)
def post_embed(req: EmbedRequest):
    if not req.texts:
        raise HTTPException(400, 'texts must be non-empty')
    if len(req.texts) > 64:
        raise HTTPException(400, 'max 64 texts per call')
    for t in req.texts:
        if not isinstance(t, str) or len(t) == 0:
            raise HTTPException(400, 'every text must be a non-empty string')
    t0 = time.time()
    vecs = embed_texts(req.texts)
    dt = (time.time() - t0) * 1000
    log.info(f'embed n={len(req.texts)} dt={dt:.0f}ms')
    return EmbedResponse(
        embeddings=vecs,
        dim=len(vecs[0]) if vecs else 0,
        model=_MODEL_NAME,
        device=_DEVICE or 'unknown',
    )


@app.get('/healthz')
def get_healthz():
    return {
        'ok': True,
        'model': _MODEL_NAME,
        'loaded': _MODEL is not None,
        'device': _DEVICE or 'unloaded',
    }


# Optional eager-load on startup (set WARP_EMBEDDINGS_EAGER=1 in plist).
if os.environ.get('WARP_EMBEDDINGS_EAGER') == '1':
    log.info('eager-load requested')
    try:
        get_model()
    except Exception as e:
        log.error(f'eager-load failed: {e}')
        sys.exit(1)
