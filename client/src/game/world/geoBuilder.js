import {
  BoxGeometry,
  BufferAttribute,
  Color,
  ConeGeometry,
  CylinderGeometry,
  DodecahedronGeometry,
  IcosahedronGeometry,
  Object3D,
  OctahedronGeometry,
  SphereGeometry,
  TetrahedronGeometry,
} from 'three'
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js'

/**
 * Builds one merged, vertex-coloured geometry out of many primitives.
 *
 * Static scenery (fences, stalls, statues...) is hundreds of parts but only one
 * draw call this way: each part is transformed into place, painted via a `color`
 * attribute and concatenated. Used at build time only, never per frame.
 */

const _dummy = new Object3D()
const _color = new Color()

export class GeoBuilder {
  parts = []

  /**
   * @param {import('three').BufferGeometry} geometry consumed (disposed after build)
   * @param {object} o position/rotation/scale + colour (hex) + optional jitter (0..1)
   */
  add(geometry, { x = 0, y = 0, z = 0, rx = 0, ry = 0, rz = 0, sx = 1, sy = 1, sz = 1, color = '#ffffff', jitter = 0, seed = 0 }) {
    let geo = geometry.index ? geometry.toNonIndexed() : geometry
    if (geo !== geometry) geometry.dispose()
    geo.deleteAttribute('uv')

    _dummy.position.set(x, y, z)
    _dummy.rotation.set(rx, ry, rz)
    _dummy.scale.set(sx, sy, sz)
    _dummy.updateMatrix()
    geo.applyMatrix4(_dummy.matrix)

    const count = geo.getAttribute('position').count
    const colors = new Float32Array(count * 3)
    _color.set(color)
    let s = seed * 9301 + 49297
    // Jitter per face (3 vertices), which reads as faceted low-poly shading.
    for (let i = 0; i < count; i += 3) {
      let k = 1
      if (jitter) {
        s = (s * 9301 + 49297) % 233280
        k = 1 - jitter + (s / 233280) * jitter * 2
      }
      for (let v = i; v < i + 3 && v < count; v += 1) {
        colors[v * 3] = _color.r * k
        colors[v * 3 + 1] = _color.g * k
        colors[v * 3 + 2] = _color.b * k
      }
    }
    geo.setAttribute('color', new BufferAttribute(colors, 3))
    if (!geo.getAttribute('normal')) geo.computeVertexNormals()
    this.parts.push(geo)
    return this
  }

  box(x, y, z, w, h, d, color, o = {}) {
    return this.add(new BoxGeometry(w, h, d), { x, y, z, color, ...o })
  }

  cyl(x, y, z, rTop, rBot, h, color, o = {}) {
    return this.add(new CylinderGeometry(rTop, rBot, h, o.seg ?? 8), { x, y, z, color, ...o })
  }

  cone(x, y, z, r, h, color, o = {}) {
    return this.add(new ConeGeometry(r, h, o.seg ?? 6), { x, y, z, color, ...o })
  }

  sphere(x, y, z, r, color, o = {}) {
    return this.add(new SphereGeometry(r, o.seg ?? 8, o.rings ?? 6), { x, y, z, color, ...o })
  }

  ico(x, y, z, r, color, o = {}) {
    return this.add(new IcosahedronGeometry(r, o.detail ?? 0), { x, y, z, color, ...o })
  }

  dodeca(x, y, z, r, color, o = {}) {
    return this.add(new DodecahedronGeometry(r, 0), { x, y, z, color, ...o })
  }

  octa(x, y, z, r, color, o = {}) {
    return this.add(new OctahedronGeometry(r, 0), { x, y, z, color, ...o })
  }

  tetra(x, y, z, r, color, o = {}) {
    return this.add(new TetrahedronGeometry(r, 0), { x, y, z, color, ...o })
  }

  /** A hexagonal crystal: prism body with a pointed tip, base at (x, y, z). */
  crystal(x, y, z, r, h, color, o = {}) {
    const { rx = 0, rz = 0, ry = 0 } = o
    const bodyH = h * 0.78
    const tipH = h - bodyH
    // Build upright around the origin, then tilt the pair as one.
    const body = new CylinderGeometry(r, r * 0.92, bodyH, 6)
    body.translate(0, bodyH / 2, 0)
    const tip = new ConeGeometry(r, tipH, 6)
    tip.translate(0, bodyH + tipH / 2, 0)
    const merged = mergeGeometries([body.toNonIndexed(), tip.toNonIndexed()])
    body.dispose()
    tip.dispose()
    return this.add(merged, { x, y, z, rx, ry, rz, color, jitter: o.jitter ?? 0.12, seed: o.seed ?? x + z })
  }

  build() {
    const geo = mergeGeometries(this.parts)
    for (const p of this.parts) p.dispose()
    this.parts = []
    geo.computeBoundingSphere()
    return geo
  }
}
