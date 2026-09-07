#!/usr/bin/env python3
"""Generate small committed STL fixtures: ASCII cube + binary icosphere."""
import math
import struct
from pathlib import Path

OUT = Path(__file__).resolve().parent.parent / "tests" / "fixtures"
OUT.mkdir(parents=True, exist_ok=True)


def cube_facets():
    v = [(-1, -1, -1), (1, -1, -1), (1, 1, -1), (-1, 1, -1),
         (-1, -1, 1), (1, -1, 1), (1, 1, 1), (-1, 1, 1)]
    quads = [(0, 1, 2, 3), (4, 6, 5, 7), (0, 4, 5, 1),
             (2, 6, 7, 3), (0, 3, 7, 4), (1, 5, 6, 2)]
    for a, b, c, d in quads:
        yield (v[a], v[b], v[c])
        yield (v[a], v[c], v[d])


def normal(p1, p2, p3):
    ux, uy, uz = p2[0] - p1[0], p2[1] - p1[1], p2[2] - p1[2]
    vx, vy, vz = p3[0] - p1[0], p3[1] - p1[1], p3[2] - p1[2]
    nx, ny, nz = uy * vz - uz * vy, uz * vx - ux * vz, ux * vy - uy * vx
    n = math.sqrt(nx * nx + ny * ny + nz * nz) or 1.0
    return (nx / n, ny / n, nz / n)


facets = list(cube_facets())

with open(OUT / "cube_ascii.stl", "w") as f:
    f.write("solid cube\n")
    for p1, p2, p3 in facets:
        n = normal(p1, p2, p3)
        f.write(f"  facet normal {n[0]:.6f} {n[1]:.6f} {n[2]:.6f}\n    outer loop\n")
        for p in (p1, p2, p3):
            f.write(f"      vertex {p[0]:.6f} {p[1]:.6f} {p[2]:.6f}\n")
        f.write("    endloop\n  endfacet\n")
    f.write("endsolid cube\n")

# Low-poly binary sphere (subdivided octahedron, one subdivision).
verts = [(1, 0, 0), (-1, 0, 0), (0, 1, 0), (0, -1, 0), (0, 0, 1), (0, 0, -1)]


def norm(p):
    n = math.sqrt(sum(c * c for c in p))
    return tuple(c / n for c in p)


verts = [norm(p) for p in verts]
tris = [(0, 2, 4), (2, 1, 4), (1, 3, 4), (3, 0, 4),
        (2, 0, 5), (1, 2, 5), (3, 1, 5), (0, 3, 5)]


def mid(a, b):
    return norm(((a[0] + b[0]) / 2, (a[1] + b[1]) / 2, (a[2] + b[2]) / 2))


refined = []
for i, j, k in tris:
    a, b, c = verts[i], verts[j], verts[k]
    ab, bc, ca = mid(a, b), mid(b, c), mid(c, a)
    refined += [(a, ab, ca), (b, bc, ab), (c, ca, bc), (ab, bc, ca)]

with open(OUT / "sphere_binary.stl", "wb") as f:
    header = b"nautilus-stl-preview fixture"
    f.write(header + b"\0" * (80 - len(header)))
    f.write(struct.pack("<I", len(refined)))
    for p1, p2, p3 in refined:
        n = normal(p1, p2, p3)
        f.write(struct.pack("<12fH", *n, *p1, *p2, *p3, 0))

print(f"wrote {OUT/'cube_ascii.stl'} and {OUT/'sphere_binary.stl'}")
