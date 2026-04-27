# manifold-preview archive

The tracked files `manifold_preview.png` and `manifold_2d.npy` were removed from
the live Origins tree on 2026-04-27 during appendage-first consolidation.

Original provenance:
- commit `97f8b37` — `manifold preview: 3092-chunk corpus, PCA→TSNE, colored by repo`
- `manifold_preview.png`: static PNG preview, 1389x1390 RGBA, ~275 KB
- `manifold_2d.npy`: NumPy float32 array, shape `(3092, 2)`, PCA→TSNE coordinates

Reason for removal:
- no tracked references by path, basename, or stem;
- live public corpus terrain is now represented by `somewhere.html` and
  `assets/somewhere/*`;
- static preview artifacts are appendages, not source-of-truth organs.

Restore path:
```bash
git checkout 97f8b37 -- manifold_preview.png manifold_2d.npy
```
