// @ts-nocheck
// Moteur de l'araignée : la toile (graphe Graphify ou arborescence), la démarche
// de l'araignée, et la fabrication de « clips » SVG animés (SMIL) que le panneau joue.

const DEG = Math.PI / 180, TILT = .5
const lerp = (a, b, t) => a + (b - a) * t
const clamp = (v, a, b) => Math.max(a, Math.min(b, v))
const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y)
const ease = t => t < .5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2
const sm = (a, b, x) => { const t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t) }
const wrap = a => { while (a > Math.PI) a -= 2 * Math.PI; while (a < -Math.PI) a += 2 * Math.PI; return a }
const lerp2 = (a, b, t) => ({ x: lerp(a.x, b.x, t), y: lerp(a.y, b.y, t) })
const lerp3 = (a, b, t) => ({ x: lerp(a.x, b.x, t), y: lerp(a.y, b.y, t), z: lerp(a.z, b.z, t) })
const P3 = p => ({ x: p.x, y: p.y - p.z * TILT })
const f1 = v => (Math.round(v * 10) / 10).toString()
const esc = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
function rng(seed) { return () => { seed |= 0; seed = seed + 0x6D2B79F5 | 0; let t = Math.imul(seed ^ seed >>> 15, 1 | seed); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296 } }
function hash(s) { let h = 2166136261; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619) } return h >>> 0 }

export const TOOL_COLOR = { Read: '#7df9ff', Edit: '#ff6be6', Write: '#ff6be6', MultiEdit: '#ff6be6', NotebookEdit: '#ff6be6', Grep: '#ffd36b', Glob: '#ffd36b', Bash: '#9dff8a', WebSearch: '#a8b4ff', WebFetch: '#a8b4ff' }
const PALETTE = ['#ff6b8a', '#ffb347', '#c77dff', '#7df9ff', '#9dff8a', '#ff6be6', '#ffd36b', '#a8b4ff', '#e8e4ff', '#5ef0c8', '#ff8a5c', '#8fb3ff']

/* ---------------- la toile ---------------- */
export function graphFromGraphify(json, maxNodes = 650) {
  const rawN = json.nodes || [], rawE = json.links || json.edges || []
  const deg = {}
  const eid = v => String(typeof v === 'object' && v ? v.id : v)
  rawE.forEach(e => { const a = eid(e.source ?? e.from), b = eid(e.target ?? e.to); deg[a] = (deg[a] || 0) + 1; deg[b] = (deg[b] || 0) + 1 })
  const keep = rawN.map(n => ({ n, id: String(n.id), d: deg[String(n.id)] || 0 })).sort((a, b) => b.d - a.d).slice(0, maxNodes)
  const commKey = {}, comms = []
  const nodes = keep.map(({ n, id }) => {
    const ck = String(n.community ?? n.group ?? n.cluster ?? n.community_id ?? 'x')
    if (!(ck in commKey)) { commKey[ck] = comms.length; comms.push({ name: n.community_name || n.community_label || (ck === 'x' ? 'Projet' : 'Communauté ' + ck) }) }
    const type = String(n.type || n.file_type || n.kind || '').toLowerCase(), path = n.source_file || n.file || n.path || (/[./\\]/.test(id) && /\.[a-z0-9]+$/i.test(id) ? id : undefined)
    const isFile = type.includes('file') || type.includes('module') || (!type && path && path === id)
    const kind = isFile ? 'file' : /concept|doc|idea|topic/.test(type) ? 'concept' : 'sym'
    return { id, label: String(n.label || n.name || id).split(/[\\/]/).pop().slice(0, 40), kind, comm: commKey[ck], path: path ? String(path).replace(/\\/g, '/') : undefined }
  })
  const ids = new Set(nodes.map(n => n.id))
  const edges = []
  rawE.forEach(e => { const a = eid(e.source ?? e.from), b = eid(e.target ?? e.to); if (ids.has(a) && ids.has(b) && a !== b) edges.push({ a, b, kind: /contain|define|has|member/.test(String(e.relation || e.type || '')) ? 'tree' : 'dep' }) })
  return finishGraph(nodes, edges, comms)
}
export function graphFromTree(paths, projectName) {
  const nodes = [], edges = [], comms = [], seen = new Set(), commOf = {}
  const add = n => { if (!seen.has(n.id)) { seen.add(n.id); nodes.push(n) } }
  add({ id: '.', label: projectName || 'projet', kind: 'dir', comm: 0 }); comms.push({ name: projectName || 'Projet' })
  paths.slice(0, 400).forEach(p => {
    const parts = p.split('/'), top = parts.length > 1 ? parts[0] : '.'
    if (!(top in commOf)) { commOf[top] = top === '.' ? 0 : comms.length; if (top !== '.') comms.push({ name: top + '/' }) }
    const c = commOf[top]
    let parent = '.'
    for (let i = 0; i < parts.length - 1; i++) { const id = parts.slice(0, i + 1).join('/') + '/'; add({ id, label: parts[i] + '/', kind: 'dir', comm: c }); edges.push({ a: parent, b: id, kind: 'tree' }); parent = id }
    add({ id: p, label: parts[parts.length - 1], kind: 'file', comm: c, path: p }); edges.push({ a: parent, b: p, kind: 'tree' })
  })
  const uniq = new Set(), E = edges.filter(e => { const k = e.a + '|' + e.b; if (uniq.has(k)) return false; uniq.add(k); return true })
  return finishGraph(nodes, E, comms)
}
function finishGraph(nodes, edges, comms) {
  const g = { nodes, edges, comms, byId: {}, adj: {}, edgeIdx: {} }
  nodes.forEach(n => { g.byId[n.id] = n; g.adj[n.id] = []; n.visited = false; n.mod = false; n.wrap = 0 })
  edges.forEach(e => { g.adj[e.a].push(e.b); g.adj[e.b].push(e.a) })
  comms.forEach((c, i) => c.col = PALETTE[i % PALETTE.length])
  // terminal : un nœud de plus, relié aux fichiers les plus connectés
  const term = { id: '::terminal', label: '>_ terminal', kind: 'term', comm: 0 }
  nodes.push(term); g.byId[term.id] = term; g.adj[term.id] = []
  nodes.filter(n => n.kind === 'file' || n.kind === 'dir').sort((a, b) => g.adj[b.id].length - g.adj[a.id].length).slice(0, 3).forEach(n => { edges.push({ a: term.id, b: n.id, kind: 'tree' }); g.adj[term.id].push(n.id); g.adj[n.id].push(term.id) })
  connectIslands(g)
  layout(g)
  edges.forEach((e, i) => { g.edgeIdx[e.a + '|' + e.b] = i; g.edgeIdx[e.b + '|' + e.a] = i })
  buildGeometry(g)
  return g
}
function connectIslands(g) {
  const seen = new Set(), groups = []
  g.nodes.forEach(n => { if (seen.has(n.id)) return; const q = [n.id], grp = []; seen.add(n.id); while (q.length) { const u = q.pop(); grp.push(u); g.adj[u].forEach(v => { if (!seen.has(v)) { seen.add(v); q.push(v) } }) } groups.push(grp) })
  groups.sort((a, b) => b.length - a.length)
  for (let i = 1; i < groups.length; i++) { const a = groups[0][i % groups[0].length], b = groups[i][0]; g.edges.push({ a, b, kind: 'dep' }); g.adj[a].push(b); g.adj[b].push(a) }
}
function layout(g) {
  const R = rng(42), N = g.nodes.length, C = Math.max(1, g.comms.length)
  g.nodes.forEach(n => { const a = n.comm / C * Math.PI * 2, r = 40 * Math.sqrt(N); n.x = Math.cos(a) * r + (R() - .5) * 160; n.y = Math.sin(a) * r * .75 + (R() - .5) * 160; n.vx = 0; n.vy = 0 })
  const len = e => { const a = g.byId[e.a], b = g.byId[e.b]; return a.kind === 'term' || b.kind === 'term' ? 90 : a.comm !== b.comm ? 150 : e.kind === 'tree' ? 55 : 70 }
  const CELL = 200
  const iters = N > 400 ? 220 : 320
  for (let it = 0; it < iters; it++) {
    const cool = 1 - it / iters, grid = new Map()
    g.nodes.forEach((n, i) => { const k = Math.floor(n.x / CELL) + ',' + Math.floor(n.y / CELL); (grid.get(k) || grid.set(k, []).get(k)).push(i) })
    g.nodes.forEach((a, i) => {
      const cx = Math.floor(a.x / CELL), cy = Math.floor(a.y / CELL)
      for (let dx = -1; dx <= 1; dx++) for (let dy = -1; dy <= 1; dy++) { const arr = grid.get((cx + dx) + ',' + (cy + dy)); if (!arr) continue; for (const j of arr) { if (j <= i) continue; const b = g.nodes[j]; let ex = a.x - b.x, ey = a.y - b.y; const d2 = ex * ex + ey * ey + .01; if (d2 > 40000) continue; const f = 2600 / d2, d = Math.sqrt(d2); ex /= d; ey /= d; a.vx += ex * f; a.vy += ey * f; b.vx -= ex * f; b.vy -= ey * f } }
    })
    g.edges.forEach(e => { const a = g.byId[e.a], b = g.byId[e.b]; let ex = b.x - a.x, ey = b.y - a.y; const d = Math.hypot(ex, ey) || .01, f = (d - len(e)) * .06; ex /= d; ey /= d; a.vx += ex * f; a.vy += ey * f; b.vx -= ex * f; b.vy -= ey * f })
    g.nodes.forEach(n => { n.vx -= n.x * .0016; n.vy -= n.y * .0022; const sp = Math.hypot(n.vx, n.vy), mx = 30 * cool + 1; if (sp > mx) { n.vx *= mx / sp; n.vy *= mx / sp } n.x += n.vx * .5; n.y += n.vy * .5; n.vx *= .6; n.vy *= .6 })
  }
  g.comms.forEach((c, i) => { const ns = g.nodes.filter(n => n.comm === i); c.cx = ns.reduce((s, n) => s + n.x, 0) / Math.max(1, ns.length); c.cy = ns.reduce((s, n) => s + n.y, 0) / Math.max(1, ns.length) })
  g.nodes.forEach(n => { const c = g.comms[n.comm]; n.ang = Math.atan2(n.y - c.cy, n.x - c.cx) })
}
const SEGC = 24
function buildGeometry(g) {
  g.grid = new Map()
  g.edges.forEach(e => {
    const a = g.byId[e.a], b = g.byId[e.b], dx = b.x - a.x, dy = b.y - a.y, L = Math.hypot(dx, dy) || 1, nx = -dy / L, ny = dx / L
    const sag = L * (e.kind === 'dep' ? .1 : .045) * (hash(e.a + e.b) % 2 ? 1 : -1)
    e.c = { x: (a.x + b.x) / 2 + nx * sag * 2, y: (a.y + b.y) / 2 + ny * sag * 2 }
    e.pts = []; const N = Math.max(6, Math.round(L / 6))
    for (let i = 0; i <= N; i++) { const u = i / N; e.pts.push({ x: (1 - u) * (1 - u) * a.x + 2 * u * (1 - u) * e.c.x + u * u * b.x, y: (1 - u) * (1 - u) * a.y + 2 * u * (1 - u) * e.c.y + u * u * b.y }) }
    for (let i = 1; i < e.pts.length; i++) addSeg(g, e.pts[i - 1], e.pts[i], e.kind === 'tree' ? .75 : .85)
  })
}
function addSeg(g, a, b, w) { const s = [a.x, a.y, b.x, b.y, w]; for (let cx = Math.floor(Math.min(a.x, b.x) / SEGC); cx <= Math.floor(Math.max(a.x, b.x) / SEGC); cx++) for (let cy = Math.floor(Math.min(a.y, b.y) / SEGC); cy <= Math.floor(Math.max(a.y, b.y) / SEGC); cy++) { const k = cx + ',' + cy; let arr = g.grid.get(k); if (!arr) g.grid.set(k, arr = []); arr.push(s) } }
function snapOn(g, p, r) {
  let best = null, bs = r
  for (let cx = Math.floor((p.x - r) / SEGC); cx <= Math.floor((p.x + r) / SEGC); cx++) for (let cy = Math.floor((p.y - r) / SEGC); cy <= Math.floor((p.y + r) / SEGC); cy++) {
    const arr = g.grid.get(cx + ',' + cy); if (!arr) continue
    for (const s of arr) { const dx = s[2] - s[0], dy = s[3] - s[1], l2 = dx * dx + dy * dy || 1e-6, t = clamp(((p.x - s[0]) * dx + (p.y - s[1]) * dy) / l2, 0, 1), q = { x: s[0] + dx * t, y: s[1] + dy * t }, d = Math.hypot(q.x - p.x, q.y - p.y) * s[4]; if (d < bs) { bs = d; best = q } }
  }
  return best
}
function bfs(g, from, to) {
  if (from === to) return [from]
  const prev = { [from]: null }, q = [from]
  while (q.length) { const u = q.shift(); for (const v of g.adj[u]) if (!(v in prev)) { prev[v] = u; if (v === to) { const p = [v]; let w = u; while (w !== null) { p.unshift(w); w = prev[w] } return p } q.push(v) } }
  return [from]
}
function route(g, path) {
  const pts = [{ x: g.byId[path[0]].x, y: g.byId[path[0]].y }], edgesUsed = []
  for (let k = 0; k < path.length - 1; k++) { const i = g.edgeIdx[path[k] + '|' + path[k + 1]], e = g.edges[i]; let ep = e.pts; if (e.a !== path[k]) ep = [...ep].reverse(); for (let j = 1; j < ep.length; j++) pts.push(ep[j]); edgesUsed.push(i) }
  let total = 0; const cum = [0]; for (let k = 1; k < pts.length; k++) { total += dist(pts[k - 1], pts[k]); cum.push(total) }
  return { pts, cum, total, edgesUsed }
}
function along(r, d) { d = clamp(d, 0, r.total); let i = 1; while (i < r.cum.length - 1 && r.cum[i] < d) i++; const a = r.pts[i - 1], b = r.pts[i], s = (r.cum[i] - r.cum[i - 1]) || 1; return lerp2(a, b, (d - r.cum[i - 1]) / s) }
// trouve (ou ajoute) le nœud d'un fichier touché par Claude
export function nodeForPath(g, rel) {
  if (!rel) return null
  rel = rel.replace(/\\/g, '/').replace(/^\.\//, '')
  const base = rel.split('/').pop()
  let n = g.nodes.find(x => x.path === rel) || g.nodes.find(x => x.path && (x.path.endsWith('/' + rel) || rel.endsWith('/' + x.path))) || g.nodes.find(x => x.kind === 'file' && x.label === base)
  if (n) return n
  // fichier inconnu : un nouveau cocon, accroché au nœud le plus proche par le nom de dossier
  const dir = rel.split('/').slice(0, -1).join('/')
  const anchor = g.nodes.find(x => x.path && dir && x.path.startsWith(dir + '/')) || g.nodes.filter(x => x.kind === 'file')[hash(rel) % Math.max(1, g.nodes.filter(x => x.kind === 'file').length)] || g.nodes[0]
  const a = hash(rel) % 360 * DEG
  n = { id: rel, label: base, kind: 'file', comm: anchor.comm, path: rel, x: anchor.x + Math.cos(a) * 55, y: anchor.y + Math.sin(a) * 55, ang: a, visited: false, mod: false, wrap: 0 }
  g.nodes.push(n); g.byId[n.id] = n; g.adj[n.id] = []
  const e = { a: anchor.id, b: n.id, kind: 'tree' }; g.edges.push(e); const i = g.edges.length - 1; g.edgeIdx[e.a + '|' + e.b] = i; g.edgeIdx[e.b + '|' + e.a] = i; g.adj[anchor.id].push(n.id); g.adj[n.id].push(anchor.id)
  const dx = n.x - anchor.x, dy = n.y - anchor.y; e.c = { x: (anchor.x + n.x) / 2 - dy * .05, y: (anchor.y + n.y) / 2 + dx * .05 }; e.pts = []
  for (let k = 0; k <= 8; k++) { const u = k / 8; e.pts.push({ x: (1 - u) * (1 - u) * anchor.x + 2 * u * (1 - u) * e.c.x + u * u * n.x, y: (1 - u) * (1 - u) * anchor.y + 2 * u * (1 - u) * e.c.y + u * u * n.y }) }
  for (let k = 1; k < e.pts.length; k++) addSeg(g, e.pts[k - 1], e.pts[k], .75)
  n.isNew = true
  return n
}

/* ---------------- l'araignée ---------------- */
const HIPX = [.3, .12, -.08, -.26]
function ik3(H, F, f, t, mt) {
  const dx = F.x - H.x, dy = F.y - H.y, D = Math.hypot(dx, dy) || 1e-3, ux = dx / D, uy = dy / D
  const tot = f + t + mt, dn = clamp((D / tot - .3) / .45, 0, 1), phi = lerp(78, 42, dn) * DEG
  const mh = mt * Math.cos(phi), mv = mt * Math.sin(phi)
  const A0 = { x: F.x - ux * mh, y: F.y - uy * mh, z: F.z + mv }
  const u = D - mh, v = A0.z - H.z, r = clamp(Math.hypot(u, v), Math.abs(f - t) + .01, f + t - .01)
  const ka = Math.atan2(v, u) + Math.acos(clamp((f * f + r * r - t * t) / (2 * f * r), -1, 1))
  const K = { x: H.x + ux * f * Math.cos(ka), y: H.y + uy * f * Math.cos(ka), z: H.z + f * Math.sin(ka) }
  const kx = A0.x - K.x, ky = A0.y - K.y, kz = A0.z - K.z, kl = Math.hypot(kx, ky, kz) || 1e-3
  return { K, A: { x: K.x + kx / kl * t, y: K.y + ky / kl * t, z: K.z + kz / kl * t } }
}
export function prepMorph(m) {
  const span = Math.max(...m.legs) * m.reachF * 2 + m.al, k = clamp(100 / span, .8, 1.8), o = { ...m }
  ;['cl', 'cw', 'al', 'aw', 'bodyZ', 'legW', 'palp'].forEach(key => o[key] = m[key] * k)
  o.legs = m.legs.map(v => v * k); o.R = Math.max(...o.legs) * o.reachF + o.al + o.cl; return o
}
function depthFrom(loads, x, y, now) {
  let z = 0
  for (const L of loads) {
    const dx = x - L.x, dy = y - L.y, d2 = dx * dx + dy * dy
    if (L.ring) { const age = now - L.t0, d = Math.sqrt(d2), r = age * L.v; z -= L.w * Math.exp(-((d - r) ** 2) / L.s2) * Math.exp(-age / L.tau) * Math.sin(d * .35 - age * 14); continue }
    if (d2 > L.s2 * 9) continue
    let w = L.w; if (L.t0 !== undefined) { const age = now - L.t0; w *= Math.exp(-age / L.tau) * Math.cos(age * L.f) }
    z -= w * Math.exp(-d2 / L.s2)
  }
  return z
}
class Spider {
  constructor(m, x, y, h, env) { this.x = x; this.y = y; this.h = h; this.abd = h; this.vx = 0; this.vy = 0; this.still = 1; this.time = 0; this.hTarget = null; this.env = env; this.setMorph(m) }
  setMorph(m) { this.m = m; this.legs = []; for (const s of [-1, 1]) for (let i = 0; i < 4; i++) { const L = { s, i, g: (i + (s > 0 ? 1 : 0)) % 2, p: -1 }; const f = this.ideal(L), q = this.snapPt(f, L); L.foot = { x: q.x, y: q.y, z: 0 }; L.placed = f; this.legs.push(L) } }
  local(lx, ly) { const c = Math.cos(this.h), s = Math.sin(this.h); return { x: this.x + lx * c - ly * s, y: this.y + lx * s + ly * c } }
  hipL(L) { return { x: this.m.cl * HIPX[L.i], y: L.s * this.m.cw * .34 } }
  reach(L) { return this.m.legs[L.i] * this.m.reachF }
  ideal(L) { const h = this.hipL(L), a = this.m.ang[L.i] * DEG, r = this.reach(L); return this.local(h.x + Math.cos(a) * r, h.y + L.s * Math.sin(a) * r) }
  snapPt(p, L) { return this.env.snap(p, this.reach(L) * .95) || p }
  update(dt) {
    const m = this.m, sp = Math.hypot(this.vx, this.vy)
    this.time += dt; this.still = sp > 3 ? 0 : this.still + dt
    if (this.hTarget !== null && sp <= 3) this.h += wrap(this.hTarget - this.h) * Math.min(1, dt * 3.5)
    this.abd += wrap(this.h - this.abd) * Math.min(1, dt * 5)
    for (const L of this.legs) if (L.p >= 0) {
      L.p += dt / m.stepDur; const e = ease(Math.min(1, L.p))
      L.foot = { x: lerp(L.from.x, L.to.x, e), y: lerp(L.from.y, L.to.y, e), z: Math.sin(Math.min(1, L.p) * Math.PI) * m.legs[L.i] * .14 }
      if (L.p >= 1) { L.p = -1; L.foot.z = 0; this.env.onPlant(L.foot, m) }
    }
    const stepping = this.legs.filter(l => l.p >= 0)
    const cand = this.legs.filter(l => l.p < 0).map(L => { const id = this.ideal(L); return { L, id, d: dist(L.placed, id), far: dist(L.foot, id) } }).sort((a, b) => b.d - a.d)
    for (const { L, id, d, far } of cand) {
      const r = this.reach(L)
      if (far > r * 2.5) { const q = this.snapPt(id, L); L.foot = { x: q.x, y: q.y, z: 0 }; L.placed = id; continue }
      const settle = this.still > .12 && d > 1
      if ((d > r * .28 || settle || far > r * 1.05) && !stepping.some(o => o.g !== L.g) && stepping.length < 4) {
        const lead = { x: id.x + this.vx * m.stepDur * 1.1, y: id.y + this.vy * m.stepDur * 1.1 }, q = this.snapPt(lead, L)
        L.from = { ...L.foot }; L.to = { x: q.x, y: q.y }; L.placed = lead; L.p = 0; stepping.push(L)
      }
    }
  }
  pose(t, o = {}) {
    const m = this.m, dep = this.env.depth
    const lifting = this.legs.reduce((a, L) => a + (L.p >= 0 ? Math.sin(Math.min(1, L.p) * Math.PI) : 0), 0) / 4
    const bz = m.bodyZ * (1 + lifting * .08) - .15 + (o.lift || 0) + dep(this.x, this.y)
    const legs = this.legs.map(L => {
      const hl = this.hipL(L), hw = this.local(hl.x, hl.y), H = { x: hw.x, y: hw.y, z: bz }
      let F = { x: L.foot.x, y: L.foot.y, z: L.foot.z + dep(L.foot.x, L.foot.y) }
      for (const ov of (o.over || [])) if (ov.w > .001 && ov.i === L.i && (!ov.s || ov.s === L.s)) F = lerp3(F, ov.p(L.s), ov.w)
      const len = m.legs[L.i], { K, A } = ik3(H, F, len * m.seg[0], len * m.seg[1], len * m.seg[2])
      return { H, K, A, F, s: L.s, i: L.i, stepping: L.p >= 0 }
    })
    const palps = [-1, 1].map(s => {
      const b = this.local(m.cl * .4, s * m.cw * .17), w = Math.sin(t * 3.1 + s * 1.3) * m.cw * .05
      const tip = this.local(m.cl * .5 + m.palp * .78, s * (m.cw * .22 + w))
      const B = { x: b.x, y: b.y, z: bz }; let T = { x: tip.x, y: tip.y, z: bz * .4 }
      if (o.palp && o.palp.w > .001) T = lerp3(T, { x: o.palp.x - Math.sin(this.h) * s * 1.2, y: o.palp.y + Math.cos(this.h) * s * 1.2, z: o.palp.z }, o.palp.w)
      return { B, K: { x: (B.x + T.x) / 2, y: (B.y + T.y) / 2, z: Math.max(B.z, T.z) + m.palp * .32 }, T }
    })
    return { x: this.x, y: this.y, h: this.h, abd: this.abd, bz, legs, palps, m, abdUp: o.abdUp || 0 }
  }
}
const locP = (P, lx, ly) => { const c = Math.cos(P.h), s = Math.sin(P.h); return { x: P.x + lx * c - ly * s, y: P.y + lx * s + ly * c } }
function abdC(P) { const m = P.m, up = P.abdUp || 0, ped = locP(P, -m.cl * .48, 0), d = m.al * .47 * (1 - .35 * up); return { x: ped.x - Math.cos(P.abd) * d, y: ped.y - Math.sin(P.abd) * d } }
function spinneret(P) { const m = P.m, up = P.abdUp || 0, ped = locP(P, -m.cl * .48, 0), d = m.al * .96 * (1 - .55 * up); return { x: ped.x - Math.cos(P.abd) * d, y: ped.y - Math.sin(P.abd) * d, z: P.bz + up * m.al * .85 } }

/* ---------------- les skins (SVG) ---------------- */
const NEON_MORPH = { cl: 10, cw: 9, al: 15, aw: 13, legs: [46, 42, 31, 40], ang: [36, 70, 112, 150], reachF: .6, bodyZ: 6, legW: 1.2, seg: [.36, .36, .28], palp: 4, stepDur: .14 }
const HUNTSMAN = { cl: 11, cw: 11, al: 13, aw: 10, legs: [56, 60, 54, 48], ang: [52, 82, 108, 136], reachF: .58, bodyZ: 4, legW: .95, seg: [.36, .36, .28], palp: 4.5, stepDur: .13 }
const NEPHILA = { cl: 9, cw: 7.5, al: 22, aw: 9.5, legs: [62, 54, 35, 54], ang: [32, 62, 112, 156], reachF: .62, bodyZ: 6, legW: .85, seg: [.36, .36, .28], palp: 3.5, stepDur: .15 }
// chaque skin : morphologie, couleurs des pattes, options (verre, maillage, organes, photophores, os, feuille néon)
export const SKINS = {
  fusion: { name: 'Néon translucide', morph: NEON_MORPH, leg: ['#3a1f6e', '#9b6bff', '#f0d9ff'], stripe: '#f5d7ff', ring: '#ff7ae9', mesh: '#7df9ff', photo: ['#7df9ff', '#ff6be6'], body: { glass: true, organs: true, folium: '#ff7ae9', wire: '#7df9ff', rim: '#c89bff', eyes: '#7df9ff' }, glow: '#b46cff' },
  holov: { name: 'Hologramme vivant', morph: NEON_MORPH, wire: true, leg: ['#cdb4ff'], stripe: '#ff78eb', mesh: '#cdb4ff', body: { wireOnly: true, organs: true, rim: '#cdb4ff', eyes: '#7df9ff', scan: true }, glow: '#9d6bff' },
  abysse: { name: 'Abysse néon', morph: { ...NEON_MORPH, legW: 1.05 }, leg: ['#0a0418', '#2a1458', '#9673e6'], stripe: '#d9b8ff', photo: ['#ff6be6', '#7df9ff', '#c98bff'], body: { dark: true, organs: true, folium: '#ff6ee6', rim: '#7df9ff', eyes: '#7df9ff' }, glow: '#6a4bff' },
  xray: { name: 'Rayons X', morph: NEON_MORPH, xray: true, leg: ['#ffffff'], body: { xray: true, organs: true, rim: '#f0ebff', eyes: '#7df9ff', scan: true }, glow: '#bfe8ff' },
  neon: { name: 'Néon violet', morph: NEON_MORPH, leg: ['#05030a', '#1d1131', '#7a56b0'], stripe: '#f0d2ff', ring: '#ff7ae9', body: { solid: ['#4d3274', '#170c28', '#040208'], folium: '#ff7ae9', cross: true, rim: '#be82ff', eyes: '#7df9ff' }, glow: '#b46cff' },
  wire: { name: 'Filaire', morph: HUNTSMAN, wire: true, leg: ['#96f0ff'], mesh: '#96f0ff', body: { wireOnly: true, rim: '#96f0ff', eyes: '#eaffff', scan: true }, glow: '#2fd8ff' },
  bio: { name: 'Abyssale', morph: NEPHILA, leg: ['#02090d', '#0b2a33', '#3a8b90'], photo: ['#7dffe0', '#c98bff'], body: { dark: true, organs: true, teal: true, rim: '#5ef0c8', eyes: '#7dffe0' }, glow: '#3ff5d0' },
}
Object.values(SKINS).forEach(s => s.m = prepMorph(s.morph))

function skinDefs(id, S) {
  return `<radialGradient id="${id}g" cx="35%" cy="30%" r="75%"><stop offset="0" stop-color="${S.leg[2] || S.leg[0]}"/><stop offset=".55" stop-color="${S.leg[1] || S.leg[0]}"/><stop offset="1" stop-color="${S.leg[0]}"/></radialGradient>`
}
// abdomen dessiné dans son repère (x vers l'avant), rx/ry ses demi-axes
function abdomenSVG(S, rx, ry) {
  const B = S.body, o = []
  const ell = (fill, stroke, sw, extra = '') => `<ellipse rx="${f1(rx)}" ry="${f1(ry)}" fill="${fill}"${stroke ? ` stroke="${stroke}" stroke-width="${sw}"` : ''} ${extra}/>`
  if (B.solid) o.push(`<radialGradient id="abG" cx="38%" cy="32%" r="70%"><stop offset="0" stop-color="${B.solid[0]}"/><stop offset=".5" stop-color="${B.solid[1]}"/><stop offset="1" stop-color="${B.solid[2]}"/></radialGradient>`, ell('url(#abG)'))
  else if (B.glass) o.push(`<radialGradient id="abG" cx="38%" cy="32%" r="70%"><stop offset="0" stop-color="rgba(95,50,170,.6)"/><stop offset=".7" stop-color="rgba(30,12,60,.82)"/><stop offset="1" stop-color="rgba(12,5,28,.92)"/></radialGradient>`, ell('url(#abG)'))
  else if (B.dark) o.push(ell(B.teal ? 'rgba(6,30,40,.88)' : 'rgba(16,6,36,.9)'))
  else if (B.xray) o.push(ell('rgba(200,180,255,.08)'))
  else if (B.wireOnly) o.push(ell('rgba(120,80,255,.08)'))
  if (B.organs) {
    const gut = B.teal ? 'rgba(120,230,210,.4)' : B.xray ? 'rgba(230,220,255,.45)' : 'rgba(200,160,255,.38)', heart = B.teal ? '#c98bff' : B.xray ? '#e6f7ff' : '#ff6be6'
    let d = ''; for (let k = 0; k < 7; k++) { const x = rx * (.6 - k * .2); for (const s of [-1, 1]) d += `M${f1(x)} 0Q${f1(x - rx * .08)} ${f1(s * ry * .28)} ${f1(x - rx * .17)} ${f1(s * ry * .58)}` }
    o.push(`<path d="${d}" fill="none" stroke="${gut}" stroke-width=".26"/>`)
    o.push(`<line x1="${f1(rx * .78)}" y1="0" x2="${f1(-rx * .7)}" y2="0" stroke="${heart}" stroke-opacity=".6" stroke-width=".6"/>`)
    o.push(`<ellipse cy="0" rx="${f1(rx * .07)}" ry="${f1(ry * .12)}" fill="#fff" filter="url(#glow)"><animate attributeName="cx" values="${f1(-rx * .7)};${f1(rx * .78)}" dur="1.1s" repeatCount="indefinite"/></ellipse>`)
  }
  if (S.photo) { for (const s of [-1, 1]) for (let k = 0; k < 7; k++) { const x = lerp(rx * .6, -rx * .78, k / 6), y = s * ry * .62 * Math.sqrt(Math.max(0, 1 - (x / rx) ** 2)), col = S.photo[(k + (s > 0 ? 1 : 0)) % S.photo.length]; o.push(`<circle cx="${f1(x)}" cy="${f1(y)}" r=".45" fill="${col}" filter="url(#glow)"><animate attributeName="opacity" values=".25;1;.25" dur="1.6s" begin="${(k * .18).toFixed(2)}s" repeatCount="indefinite"/></circle>`) } }
  if (B.folium) {
    let d = ''; const N = 22
    for (let k = 0; k <= N; k++) { const u = k / N, x = lerp(rx * .6, -rx * .92, u), y = -ry * .52 * Math.pow(Math.sin(Math.PI * u), .8) * (1 + .14 * Math.sin(u * Math.PI * 9)); d += (k ? 'L' : 'M') + f1(x) + ' ' + f1(y) }
    for (let k = N; k >= 0; k--) { const u = k / N, x = lerp(rx * .6, -rx * .92, u), y = ry * .52 * Math.pow(Math.sin(Math.PI * u), .8) * (1 + .14 * Math.sin(u * Math.PI * 9)); d += 'L' + f1(x) + ' ' + f1(y) }
    o.push(`<path d="${d}Z" fill="rgba(70,30,110,.3)" stroke="${B.folium}" stroke-width=".4" filter="url(#glow)"/>`)
    const dots = [[.42, 0, .065], [.3, 0, .055], [.18, 0, .065], [.06, 0, .05], [.25, -.17, .045], [.25, .17, .045]]
    o.push(dots.map(([x, y, r]) => `<circle cx="${f1(x * rx)}" cy="${f1(y * ry * 1.6)}" r="${f1(r * rx)}" fill="#f6e6ff"/>`).join(''))
  }
  if (B.wire || B.wireOnly) { const c = B.wire || B.rim, sw = B.wireOnly ? .18 : .12, op = B.wireOnly ? .85 : .25; let s = `<g fill="none" stroke="${c}" stroke-opacity="${op}" stroke-width="${sw}">`; s += `<ellipse rx="${f1(rx)}" ry="${f1(ry * .66)}"/><ellipse rx="${f1(rx)}" ry="${f1(ry * .33)}"/>`; for (const f of [-.7, -.35, 0, .35, .7]) { const r = ry * Math.sqrt(1 - f * f); s += `<ellipse cx="${f1(f * rx)}" rx="${f1(r * .28)}" ry="${f1(r)}"/>` } o.push(s + '</g>') }
  if (B.scan) o.push(`<line y1="${f1(-ry)}" y2="${f1(ry)}" stroke="#f2fdff" stroke-width=".4" filter="url(#glow)"><animate attributeName="x1" values="${f1(-rx * .9)};${f1(rx * .9)};${f1(-rx * .9)}" dur="2.8s" repeatCount="indefinite"/><animate attributeName="x2" values="${f1(-rx * .9)};${f1(rx * .9)};${f1(-rx * .9)}" dur="2.8s" repeatCount="indefinite"/></line>`)
  if (!B.wireOnly && !B.xray) o.push(`<ellipse cx="${f1(-rx * .2)}" cy="${f1(-ry * .32)}" rx="${f1(rx * .38)}" ry="${f1(ry * .22)}" fill="#fff" opacity=".18"/>`)
  o.push(ell('none', B.rim, B.wireOnly ? .2 : .26, 'filter="url(#glow)"'))
  return o.join('')
}
function carapaceSVG(S, cl, cw) {
  const B = S.body, a = cl * .5, b = cw * .5, o = []
  const path = `M${f1(a)} 0C${f1(a)} ${f1(-b * .62)} ${f1(a * .35)} ${f1(-b)} ${f1(-a * .15)} ${f1(-b)}C${f1(-a * .75)} ${f1(-b)} ${f1(-a * 1.02)} ${f1(-b * .5)} ${f1(-a)} 0C${f1(-a * 1.02)} ${f1(b * .5)} ${f1(-a * .75)} ${f1(b)} ${f1(-a * .15)} ${f1(b)}C${f1(a * .35)} ${f1(b)} ${f1(a)} ${f1(b * .62)} ${f1(a)} 0Z`
  // chélicères
  if (!B.wireOnly && !B.xray) for (const s of [-1, 1]) o.push(`<ellipse cx="${f1(cl * .5)}" cy="${f1(s * cw * .12)}" rx="${f1(cl * .15)}" ry="${f1(cw * .12)}" fill="${B.solid ? '#1c1030' : 'rgba(40,18,80,.9)'}"/>`)
  const fill = B.solid ? 'url(#cpG)' : B.glass ? 'rgba(60,28,110,.75)' : B.dark ? (B.teal ? 'rgba(8,36,46,.92)' : 'rgba(18,8,40,.92)') : B.xray ? 'rgba(200,180,255,.08)' : 'rgba(120,80,255,.08)'
  if (B.solid) o.push(`<radialGradient id="cpG" cx="38%" cy="32%" r="70%"><stop offset="0" stop-color="#5a3f85"/><stop offset=".55" stop-color="#1b102c"/><stop offset="1" stop-color="#05020a"/></radialGradient>`)
  o.push(`<path d="${path}" fill="${fill}"/>`)
  let st = ''; const fx = -cl * .1; for (let k = 0; k < 10; k++) { const an = k / 10 * Math.PI * 2 + .3; st += `M${f1(fx + Math.cos(an) * cl * .07)} ${f1(Math.sin(an) * cw * .07)}L${f1(fx + Math.cos(an) * cl * .36)} ${f1(Math.sin(an) * cw * .36)}` }
  o.push(`<path d="${st}" stroke="${B.xray ? '#f2f6ff' : B.rim}" stroke-opacity="${B.xray ? .8 : .35}" stroke-width=".2" fill="none"/>`)
  o.push(`<path d="${path}" fill="none" stroke="${B.rim}" stroke-width=".28" filter="url(#glow)"/>`)
  for (const [px, py, pr] of [[.8, .075, .07], [.66, .085, .062], [.74, .21, .055], [.6, .23, .05]]) for (const s of [-1, 1]) o.push(`<circle cx="${f1(a * px)}" cy="${f1(s * cw * py)}" r="${f1(cl * pr)}" fill="${B.xray || B.wireOnly ? 'none' : '#1d4250'}" stroke="${B.eyes}" stroke-width=".18" filter="url(#glow)"/><circle cx="${f1(a * px - .15)}" cy="${f1(s * cw * py - .15)}" r="${f1(cl * pr * .3)}" fill="#fff"/>`)
  return o.join('')
}

/* ---------------- le monde : état qui survit d'un clip à l'autre ---------------- */
export function createWorld(graph, skinId) {
  const W = { g: graph, skin: SKINS[skinId] ? skinId : 'fusion', t: 0, loads: [], vib: [], waves: [] }
  const env = { snap: (p, r) => snapOn(graph, p, r), depth: (x, y) => depthFrom(W.loads, x, y, W.t), onPlant: (f, m) => W.vib.push({ x: f.x, y: f.y, t0: W.t, w: 1.3, f: 2 * Math.PI * 8, tau: .22, s2: 50 }) }
  W.env = env
  const start = graph.nodes.filter(n => n.kind === 'file' || n.kind === 'dir').sort((a, b) => graph.adj[b.id].length - graph.adj[a.id].length)[0] || graph.nodes[0]
  W.cur = start.id
  W.sp = new Spider(SKINS[W.skin].m, start.x, start.y, -Math.PI / 2, env)
  W.cam = { x: start.x, y: start.y }
  return W
}
export function setSkin(W, id) { if (!SKINS[id]) return; W.skin = id; W.sp.setMorph(SKINS[id].m) }

function stepPhysics(W, dt, opts) {
  const sp = W.sp
  W.t += dt
  W.vib = W.vib.filter(v => W.t - v.t0 < 1.2); W.waves = W.waves.filter(v => W.t - v.t0 < 2.5)
  const L = [{ x: sp.x, y: sp.y, w: 4.2, s2: 420 }]
  sp.legs.forEach(l => { if (l.p < 0) L.push({ x: l.foot.x, y: l.foot.y, w: 1.15, s2: 30 }) })
  W.loads = L.concat(W.vib, W.waves)
  sp.update(dt)
}
function actionOpts(act, t, sp, dep) {
  const o = { over: [] }; if (!act) return o
  const m = sp.m, fwd = { x: Math.cos(sp.h), y: Math.sin(sp.h) }, side = { x: -fwd.y, y: fwd.x }
  const n = act.n
  if (act.tool === 'Read') {
    const w = sm(0, .35, t) * (1 - sm(act.dur - .4, act.dur, t)), c = { x: n.x, y: n.y, z: dep(n.x, n.y) + w * 3.5 }
    o.over.push({ i: 0, w, p: s => ({ x: c.x + side.x * s * 3.3 - fwd.x, y: c.y + side.y * s * 3.3 - fwd.y, z: c.z + 1 + Math.sin(t * 9 + s * 1.7) * .8 }) })
    o.over.push({ i: 1, w: w * .35, p: s => ({ x: c.x + side.x * s * 7 - fwd.x * 4, y: c.y + side.y * s * 7 - fwd.y * 4, z: dep(c.x, c.y) + 1.5 }) })
    o.palp = { x: c.x, y: c.y, z: c.z + .8, w }; o.held = { ...c, w }
  } else if (act.tool === 'Edit' || act.tool === 'Write') {
    const w = sm(.9, 1.3, t) * (1 - sm(act.dur - .4, act.dur, t)), cz = dep(n.x, n.y) + 1.5, s0 = sp.local(-(m.cl * .48 + m.al * .7), 0)
    o.over.push({ i: 3, w, p: s => { const k = Math.max(0, Math.sin(t * 9 + (s > 0 ? Math.PI : 0))); return { x: lerp(n.x, s0.x, .3) + side.x * s * 3, y: lerp(n.y, s0.y, .3) + side.y * s * 3, z: cz + k * 4.5 } } })
    o.lift = -w * m.bodyZ * .15
  } else if (act.tool === 'Grep') {
    const w = sm(0, .2, t) * (1 - sm(1.55, 1.8, t)), ph = (((t - .05) % .5) + .5) % .5 / .5, up = t < 1.55 ? (ph < .78 ? Math.sin(ph / .78 * Math.PI / 2) : 1 - (ph - .78) / .22) : 0, tip = pluckTip(sp)
    o.over.push({ i: 0, s: 1, w, p: () => ({ x: tip.x, y: tip.y, z: dep(tip.x, tip.y) + up * m.legs[0] * .38 }) })
  } else if (act.tool === 'Bash') {
    const w = sm(0, .3, t) * (1 - sm(act.dur - .3, act.dur, t)), c = { x: n.x, y: n.y - 2, z: dep(n.x, n.y) + 2.5 }
    o.over.push({ i: 0, w, p: s => ({ x: c.x + side.x * s * 4.5 - fwd.x * 2, y: c.y + side.y * s * 4.5 - fwd.y * 2, z: c.z + Math.max(0, Math.sin(t * 13 + (s > 0 ? Math.PI : 0))) * 3.2 }) })
    o.palp = { ...c, w: w * .7 }
  } else if (act.tool === 'Web') {
    const w = sm(0, .6, t) * (1 - sm(act.dur - .5, act.dur, t)); o.lift = m.bodyZ * .9 * w; o.abdUp = w
  }
  return o
}
function pluckTip(sp) { const L = sp.legs.find(l => l.i === 0 && l.s === 1), b = sp.ideal(L), f = { x: Math.cos(sp.h), y: Math.sin(sp.h) }; return { x: b.x + f.x * 3, y: b.y + f.y * 3 } }

/* ---------------- fabrication d'un clip ---------------- */
// ev : { tool: 'Read'|'Edit'|'Write'|'Grep'|'Bash'|'Web', path?, targets?: string[], label, lines?: string[] }
const FPS = 12, VIEW_W = 300, VIEW_H = 190, MAX_CHARS = 125000
export function makeClip(W, ev) {
  const g = W.g, sp = W.sp, S = SKINS[W.skin], m = sp.m
  let target = null, targets = []
  if (ev.tool === 'Bash') target = g.byId['::terminal']
  else if (ev.path) target = nodeForPath(g, ev.path)
  if (ev.tool === 'Grep') targets = (ev.targets || []).map(p => nodeForPath(g, p)).filter(Boolean).slice(0, 5)
  const walkTo = ev.tool === 'Grep' || ev.tool === 'Web' ? null : target
  // marche
  let rt = null, stop = 0
  if (walkTo && walkTo.id !== W.cur) {
    const path = bfs(g, W.cur, walkTo.id)
    if (path.length > 1) { rt = route(g, path); stop = ev.tool === 'Edit' || ev.tool === 'Write' ? m.cl * .48 + m.al * .9 : ev.tool === 'Bash' ? m.cl * .5 + m.palp * .8 + 9 : m.cl * .5 + m.palp * .85 }
  }
  const walkLen = rt ? Math.max(0, rt.total - stop) : 0, speed = Math.max(130, walkLen / 2.4), walkDur = walkLen / speed + (rt ? .25 : 0)
  const actDur = { Read: 2.6, Edit: 3.3, Write: 3.3, Grep: 1.9, Bash: 2.6, Web: 3.4 }[ev.tool] || 1.5
  const total = walkDur + actDur
  const act = { tool: ev.tool, n: target, dur: actDur }
  if (ev.tool === 'Grep') targets.forEach(n => n.visited = true)
  // simulation
  const frames = [], DT = 1 / 60, rec = Math.round(60 / FPS)
  let d = 0, wspd = 0, step = 0
  const edgeNear = new Set()
  const recFrame = (tAct) => {
    const o = tAct >= 0 ? actionOpts(act, tAct, sp, W.env.depth) : {}
    const P = sp.pose(W.t, o)
    // caméra qui suit en douceur
    W.cam.x += (sp.x - W.cam.x) * .25; W.cam.y += (sp.y - 8 - W.cam.y) * .25
    frames.push({ P, cam: { ...W.cam }, o, tAct, deps: null })
    g.edges.forEach((e, i) => { if (dist(e.c, sp) < 70) edgeNear.add(i) })
  }
  const physics = (o) => { stepPhysics(W, DT, o) }
  // phase marche
  if (rt) {
    if (ev.tool === 'Edit' || ev.tool === 'Write') sp.hTarget = null
    while (d < walkLen - .01) {
      const remain = walkLen - d, tgt = speed * clamp(remain / 28, .2, 1); wspd += (tgt - wspd) * Math.min(1, DT * 5)
      const px = sp.x, py = sp.y; d = Math.min(walkLen, d + wspd * DT); const p = along(rt, d); sp.x = p.x; sp.y = p.y
      sp.vx = (sp.x - px) / DT; sp.vy = (sp.y - py) / DT; if (Math.hypot(sp.vx, sp.vy) > 4) sp.h += wrap(Math.atan2(sp.vy, sp.vx) - sp.h) * Math.min(1, DT * 7)
      physics({}); if (step++ % rec === 0) recFrame(-1)
      if (step > 60 * 6) break
    }
    rt.edgesUsed.forEach(i => g.edges[i].trail = 1)
    W.cur = walkTo.id
    sp.vx = sp.vy = 0
    for (let k = 0; k < 15; k++) { physics({}); if (step++ % rec === 0) recFrame(-1) }
  }
  // phase action
  const t0 = W.t
  if (ev.tool === 'Edit' || ev.tool === 'Write') sp.hTarget = sp.h + Math.PI
  let k = 0
  const plucks = []
  while (W.t - t0 < actDur) {
    const ta = W.t - t0
    if (ev.tool === 'Grep') { const kk = Math.floor((ta - .05) / .5); if (ta > .05 && kk < 3 && kk >= k) { k = kk + 1; const tip = pluckTip(sp); W.waves.push({ ring: true, x: tip.x, y: tip.y, t0: W.t, v: 120, w: 1.6, s2: 60, tau: .7 }); plucks.push({ x: tip.x, y: tip.y, t: walkDur + ta }) } }
    sp.vx = sp.vy = 0
    const o = actionOpts(act, ta, sp, W.env.depth)
    stepPhysics(W, DT, o)
    if (step++ % rec === 0) recFrame(ta)
  }
  sp.hTarget = null
  if (target && (ev.tool === 'Edit' || ev.tool === 'Write')) { target.mod = true; target.wrap = Math.min(3, (target.wrap || 0) + 1) }
  if (target) target.visited = true
  return renderClip(W, ev, frames, { total, walkDur, act, target, targets, plucks, edgeNear: [...edgeNear].slice(0, 10), S })
}

/* ---------------- rendu SVG d'un clip ---------------- */
function vals(arr) { return arr.join(';') }
export function renderClip(W, ev, frames, X) {
  const g = W.g, S = X.S, n = frames.length, dur = Math.max(.1, X.total).toFixed(2) + 's'
  const anim = (attr, values) => `<animate attributeName="${attr}" values="${vals(values)}" dur="${dur}" fill="freeze" calcMode="linear"/>`
  // zone visible pendant le clip
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity
  frames.forEach(f => { x0 = Math.min(x0, f.cam.x); x1 = Math.max(x1, f.cam.x); y0 = Math.min(y0, f.cam.y); y1 = Math.max(y1, f.cam.y) })
  if (!frames.length) { x0 = x1 = W.cam.x; y0 = y1 = W.cam.y }
  const pad = 30, bx0 = x0 - VIEW_W / 2 - pad, bx1 = x1 + VIEW_W / 2 + pad, by0 = y0 - VIEW_H / 2 - pad, by1 = y1 + VIEW_H / 2 + pad
  const inBox = p => p.x > bx0 && p.x < bx1 && p.y > by0 && p.y < by1
  const out = []
  const f0 = frames[0] ? frames[0].cam : W.cam
  out.push(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="${f1(f0.x - VIEW_W / 2)} ${f1(f0.y - VIEW_H / 2)} ${VIEW_W} ${VIEW_H}" width="640" height="405" preserveAspectRatio="xMidYMid slice" style="background:#06040c">`)
  if (n > 1) out.push(anim('viewBox', frames.map(f => `${f1(f.cam.x - VIEW_W / 2)} ${f1(f.cam.y - VIEW_H / 2)} ${VIEW_W} ${VIEW_H}`)))
  out.push(`<defs><filter id="glow" x="-50%" y="-50%" width="200%" height="200%"><feGaussianBlur stdDeviation=".8" result="b"/><feMerge><feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge></filter><filter id="soft" x="-50%" y="-50%" width="200%" height="200%"><feGaussianBlur stdDeviation="1.6"/></filter>${skinDefs('sk', S)}</defs>`)
  out.push(`<rect x="${f1(bx0 - 400)}" y="${f1(by0 - 400)}" width="${f1(bx1 - bx0 + 800)}" height="${f1(by1 - by0 + 800)}" fill="#06040c"/>`)
  // nébuleuses des communautés
  g.comms.forEach((c, i) => { if (c.cx > bx0 - 250 && c.cx < bx1 + 250 && c.cy > by0 - 250 && c.cy < by1 + 250) out.push(`<circle cx="${f1(c.cx)}" cy="${f1(c.cy)}" r="160" fill="${c.col}" opacity=".035" filter="url(#soft)"/>`) })
  // fils de soie (statiques), ceux près de l'araignée sont animés
  const near = new Set(X.edgeNear)
  let thin = '', strong = '', trail = ''
  g.edges.forEach((e, i) => {
    if (near.has(i)) return
    const a = g.byId[e.a], b = g.byId[e.b]; if (!inBox(a) && !inBox(b) && !inBox(e.c)) return
    const dd = `M${f1(a.x)} ${f1(a.y)}Q${f1(e.c.x)} ${f1(e.c.y)} ${f1(b.x)} ${f1(b.y)}`
    if (e.trail) trail += dd; else if (e.kind === 'tree') strong += dd; else thin += dd
  })
  out.push(`<path d="${thin}" fill="none" stroke="#fff" stroke-opacity=".38" stroke-width=".32"/>`)
  out.push(`<path d="${strong}" fill="none" stroke="#fff" stroke-opacity=".75" stroke-width=".5"/><path d="${strong}" fill="none" stroke="#fff" stroke-opacity=".5" stroke-width=".9" stroke-dasharray="1.4 1.1"/>`)
  out.push(`<path d="${trail}" fill="none" stroke="#fff" stroke-opacity=".95" stroke-width=".7" filter="url(#glow)"/>`)
  // fils qui plient sous le poids
  X.edgeNear.forEach(i => {
    const e = g.edges[i], a = g.byId[e.a], b = g.byId[e.b], pts = e.pts.filter((_, j) => j % Math.max(1, Math.floor(e.pts.length / 8)) === 0 || j === e.pts.length - 1)
    const ds = frames.map(f => pts.map((p, j) => (j ? 'L' : 'M') + f1(p.x) + ' ' + f1(p.y - (f.dep ? 0 : 0) - depthAtFrame(W, f, p) * TILT)).join(''))
    const sw = e.trail ? .7 : e.kind === 'tree' ? .55 : .35, op = e.trail ? .95 : e.kind === 'tree' ? .8 : .45
    out.push(`<path d="${ds[0] || ''}" fill="none" stroke="#fff" stroke-opacity="${op}" stroke-width="${sw}"${e.trail ? ' filter="url(#glow)"' : ''}>${n > 1 ? anim('d', ds) : ''}</path>`)
  })
  // nœuds
  const nodesOut = []
  g.nodes.forEach(nd => {
    if (!inBox(nd)) return
    const col = g.comms[nd.comm].col
    if (nd.kind === 'file') {
      const held = X.act.tool === 'Read' && X.target === nd
      const rot = (nd.ang / DEG).toFixed(0), sc = X.act.tool === 'Write' && X.target === nd && nd.isNew ? true : false
      let s = `<g transform="translate(${f1(nd.x)} ${f1(nd.y)})"><circle r="6" fill="${col}" opacity=".18"/><g transform="rotate(${rot})">`
      if (held) { const ys = frames.map(f => f1(-(f.o.held ? (f.o.held.z) * TILT : 0))); s = `<g transform="translate(${f1(nd.x)} ${f1(nd.y)})"><circle r="6" fill="${col}" opacity=".18"/><g><animateTransform attributeName="transform" type="translate" values="${frames.map(f => '0 ' + f1(-(f.o.held ? f.o.held.z * TILT : 0))).join(';')}" dur="${dur}" fill="freeze"/><g transform="rotate(${rot})">` }
      const fill = nd.mod ? '#ff8ae8' : nd.visited ? '#ffffff' : '#c9c2e6'
      s += `<ellipse rx="3.6" ry="2.3" fill="${fill}" filter="url(#glow)"/>`
      const cnt = 5 + Math.min(6, (nd.wrap || 0) * 2)
      let wraps = ''; for (let k = 0; k < cnt; k++) { const x = -3 + k * 6 / cnt + .6, h = 2.3 * Math.sqrt(Math.max(0, 1 - (x / 3.6) ** 2)); wraps += `M${f1(x - .5)} ${f1(-h)}Q${f1(x + .5)} 0 ${f1(x - .5)} ${f1(h)}` }
      s += `<path d="${wraps}" fill="none" stroke="${nd.mod ? '#ffb3f3' : '#5a4f86'}" stroke-width=".22"/>`
      if (held) s += `<ellipse rx="2.4" ry="1.2" fill="#c8faff" opacity="0" filter="url(#glow)"><animate attributeName="opacity" values="0;0;.9;.9;0" keyTimes="0;${(X.walkDur / X.total).toFixed(3)};${((X.walkDur + .5) / X.total).toFixed(3)};${((X.total - .5) / X.total).toFixed(3)};1" dur="${dur}" fill="freeze"/></ellipse>`
      s += held ? '</g></g></g>' : '</g></g>'
      nodesOut.push(s)
    } else if (nd.kind === 'term') {
      nodesOut.push(`<g transform="translate(${f1(nd.x)} ${f1(nd.y)})"><rect x="-10" y="-6.5" width="20" height="13" rx="3" fill="#0b1a0e" stroke="#9dff8a" stroke-width=".6" filter="url(#glow)"/><text y="1.8" text-anchor="middle" font-family="monospace" font-size="5.5" fill="#9dff8a">&gt;_</text></g>`)
    } else if (nd.kind === 'dir') {
      nodesOut.push(`<circle cx="${f1(nd.x)}" cy="${f1(nd.y)}" r="2.6" fill="#fff" filter="url(#glow)"/><circle cx="${f1(nd.x)}" cy="${f1(nd.y)}" r="5" fill="none" stroke="${col}" stroke-opacity=".7" stroke-width=".35"/>`)
    } else {
      const r = nd.kind === 'concept' ? 2.4 : 1.3 + Math.min(1.5, g.adj[nd.id].length * .16)
      nodesOut.push(`<circle cx="${f1(nd.x)}" cy="${f1(nd.y)}" r="${f1(r * 2.3)}" fill="${col}" opacity=".2"/><circle cx="${f1(nd.x)}" cy="${f1(nd.y)}" r="${f1(r)}" fill="${col}"/>`)
    }
  })
  out.push(nodesOut.join(''))
  // étiquettes des nœuds visibles
  let labels = ''
  g.nodes.forEach(nd => { if (!inBox(nd) || nd.kind === 'leaf' || !nd.label) return; const isT = nd === X.target || X.targets.includes(nd); if (nd.kind === 'sym' && !isT && g.adj[nd.id].length < 4) return; labels += `<text x="${f1(nd.x + 6)}" y="${f1(nd.y + 1.4)}" fill="${isT ? '#fff' : nd.kind === 'file' || nd.kind === 'dir' ? 'rgba(240,236,255,.8)' : g.comms[nd.comm].col}" font-size="${isT ? 4.6 : 3.8}" ${isT ? 'font-weight="700"' : ''}>${esc(nd.label)}</text>` })
  out.push(`<g font-family="monospace">${labels}</g>`)
  // effets de l'action
  out.push(effectsSVG(W, ev, frames, X, dur))
  // l'araignée
  out.push(spiderSVG(frames, S, dur, n))
  // carte de texte
  out.push(cardSVG(ev, X, dur))
  out.push('</svg>')
  let svg = out.join('')
  if (svg.length > MAX_CHARS) { // trop long : on garde une image sur deux
    const half = frames.filter((_, i) => i % 2 === 0 || i === frames.length - 1)
    if (half.length < frames.length && frames.length > 6) return renderClip(W, ev, half, { ...X, edgeNear: X.edgeNear.slice(0, 4) })
  }
  return { svg, dur: X.total }
}
function depthAtFrame(W, f, p) {
  // profondeur approchée à partir de la pose enregistrée (corps et pieds posés)
  const P = f.P; let z = 0
  const add = (x, y, w, s2) => { const dx = p.x - x, dy = p.y - y, d2 = dx * dx + dy * dy; if (d2 < s2 * 9) z -= w * Math.exp(-d2 / s2) }
  add(P.x, P.y, 4.2, 420); P.legs.forEach(L => { if (!L.stepping) add(L.F.x, L.F.y, 1.15, 30) })
  return z
}
function spiderSVG(frames, S, dur, n) {
  if (!frames.length) return ''
  const anim = (attr, values) => n > 1 ? `<animate attributeName="${attr}" values="${values.join(';')}" dur="${dur}" fill="freeze"/>` : ''
  const P0 = frames[0].P, m = P0.m, w = m.legW, o = []
  const proj = frames.map(f => f.P.legs.map(L => ({ H: P3(L.H), K: P3(L.K), A: P3(L.A), T: P3(lerp3(L.A, L.F, .72)), F: P3(L.F), Fz: L.F, stepping: L.stepping })))
  const SH = p => ({ x: p.x + Math.max(0, p.z) * .55, y: p.y + Math.max(0, p.z) * .42 })
  // ombres des pattes
  let shadow = ''
  for (let li = 0; li < 8; li++) { const ds = frames.map(f => { const L = f.P.legs[li], a = SH(L.H), b = SH(L.K), c = SH(L.A), d = SH(L.F); return `M${f1(a.x)} ${f1(a.y)}L${f1(b.x)} ${f1(b.y)}L${f1(c.x)} ${f1(c.y)}L${f1(d.x)} ${f1(d.y)}` }); shadow += `<path d="${ds[0]}">${anim('d', ds)}</path>` }
  o.push(`<g fill="none" stroke="#000" stroke-opacity=".35" stroke-width="${f1(w * 1.4)}" stroke-linecap="round" stroke-linejoin="round">${shadow}</g>`)
  // pattes : cuisse, tibia, métatarse, tarse
  const segs = [['H', 'K', 2.6], ['K', 'A', 2.1], ['A', 'T', 1.35], ['T', 'F', .85]]
  const legCol = S.wire || S.xray ? 'none' : 'url(#skg)'
  let legs = ''
  for (let li = 0; li < 8; li++) {
    for (const [a, b, ww] of segs) {
      const ds = proj.map(L => `M${f1(L[li][a].x)} ${f1(L[li][a].y)}L${f1(L[li][b].x)} ${f1(L[li][b].y)}`)
      if (S.wire) legs += `<path d="${ds[0]}" stroke="${S.leg[0]}" stroke-width="${f1(w * ww)}" stroke-opacity=".9" stroke-dasharray=".25 .9" fill="none">${anim('d', ds)}</path>`
      else if (S.xray) legs += `<path d="${ds[0]}" stroke="#e8e0ff" stroke-opacity=".14" stroke-width="${f1(w * ww)}">${anim('d', ds)}</path>`
      else legs += `<path d="${ds[0]}" stroke="${S.leg[1]}" stroke-width="${f1(w * ww)}">${anim('d', ds)}</path>`
    }
  }
  o.push(`<g stroke-linecap="round" fill="none"${S.xray ? '' : ' filter="url(#glow)"'}>${legs}</g>`)
  // reflet / filament lumineux le long de chaque patte
  const lineCol = S.xray ? '#f2f6ff' : S.wire ? S.leg[0] : (S.stripe || S.leg[2])
  let lines = ''
  for (let li = 0; li < 8; li++) { const ds = proj.map(L => { const q = L[li]; return `M${f1(q.H.x)} ${f1(q.H.y)}L${f1(q.K.x)} ${f1(q.K.y)}L${f1(q.A.x)} ${f1(q.A.y)}L${f1(q.T.x)} ${f1(q.T.y)}L${f1(q.F.x)} ${f1(q.F.y)}` }); lines += `<path d="${ds[0]}">${anim('d', ds)}</path>` }
  o.push(`<g fill="none" stroke="${lineCol}" stroke-width="${f1(S.xray ? w * .32 : w * .28)}" stroke-linejoin="round" stroke-linecap="round" stroke-opacity=".9" filter="url(#glow)">${lines}</g>`)
  if (S.photo) o.push(`<g fill="none" stroke="${S.photo[0]}" stroke-width="${f1(w * .7)}" stroke-linecap="round" stroke-dasharray=".01 4.5" filter="url(#glow)">${lines}<animate attributeName="stroke-dashoffset" values="0;-9" dur="1.4s" repeatCount="indefinite"/></g>`)
  if (S.mesh && !S.wire) o.push(`<g fill="none" stroke="${S.mesh}" stroke-opacity=".35" stroke-width="${f1(w * 2.2)}" stroke-dasharray=".12 1.6">${lines}</g>`)
  // articulations
  let joints = ''
  for (let li = 0; li < 8; li++) for (const [j, r] of [['K', 1.25], ['A', .9]]) { const xs = proj.map(L => f1(L[li][j].x)), ys = proj.map(L => f1(L[li][j].y)); joints += `<circle cx="${xs[0]}" cy="${ys[0]}" r="${f1(w * r)}"${S.ring && j === 'K' ? ` stroke="${S.ring}" stroke-width="${f1(w * .2)}"` : ''}>${anim('cx', xs)}${anim('cy', ys)}</circle>` }
  o.push(`<g fill="${S.xray ? '#ffffff' : S.wire ? 'none' : S.leg[2] || S.leg[0]}" stroke="${S.wire ? S.leg[0] : 'none'}" stroke-width=".2" filter="url(#glow)">${joints}</g>`)
  // pédipalpes
  let palps = ''
  for (let pi = 0; pi < 2; pi++) { const ds = frames.map(f => { const q = f.P.palps[pi], B = P3(q.B), K = P3(q.K), T = P3(q.T); return `M${f1(B.x)} ${f1(B.y)}L${f1(K.x)} ${f1(K.y)}L${f1(T.x)} ${f1(T.y)}` }); palps += `<path d="${ds[0]}">${anim('d', ds)}</path>` }
  o.push(`<g fill="none" stroke="${S.wire ? S.leg[0] : S.xray ? '#f2f6ff' : S.leg[2] || S.leg[0]}" stroke-width="${f1(w * 1.1)}" stroke-linecap="round">${palps}</g>`)
  // abdomen : déplacé et tourné à chaque image
  const ab = frames.map(f => { const P = f.P, c = abdC(P), p = P3({ x: c.x, y: c.y, z: P.bz + P.m.aw * .32 + P.abdUp * P.m.al * .42 }); return { x: p.x, y: p.y, r: P.abd / DEG, sx: 1 - .33 * P.abdUp } })
  const tr = (list, fn) => n > 1 ? `<animateTransform attributeName="transform" type="${fn}" values="${list.join(';')}" dur="${dur}" fill="freeze"/>` : ''
  o.push(`<g transform="translate(${f1(ab[0].x)} ${f1(ab[0].y)})">${tr(ab.map(a => f1(a.x) + ' ' + f1(a.y)), 'translate')}<g transform="rotate(${f1(ab[0].r)})">${tr(unwrapDeg(ab.map(a => a.r)).map(f1), 'rotate')}<g transform="scale(${f1(ab[0].sx)} 1)">${tr(ab.map(a => f1(a.sx) + ' 1'), 'scale')}<g><animateTransform attributeName="transform" type="scale" values="1;1.025;1" dur="2.6s" repeatCount="indefinite"/>${abdomenSVG(S, m.al * .5, m.aw * .5)}</g></g></g></g>`)
  // céphalothorax
  const cp = frames.map(f => { const P = f.P, p = P3({ x: P.x, y: P.y, z: P.bz + P.m.cw * .2 }); return { x: p.x, y: p.y, r: P.h / DEG } })
  o.push(`<g transform="translate(${f1(cp[0].x)} ${f1(cp[0].y)})">${tr(cp.map(a => f1(a.x) + ' ' + f1(a.y)), 'translate')}<g transform="rotate(${f1(cp[0].r)})">${tr(unwrapDeg(cp.map(a => a.r)).map(f1), 'rotate')}${carapaceSVG(S, m.cl, m.cw)}</g></g>`)
  // points de contact des pieds posés
  const feet = []
  for (let li = 0; li < 8; li++) { const xs = proj.map(L => f1(L[li].F.x)), ys = proj.map(L => f1(L[li].F.y)), op = proj.map(L => L[li].stepping ? 0 : .8); feet.push(`<circle cx="${xs[0]}" cy="${ys[0]}" r=".35">${anim('cx', xs)}${anim('cy', ys)}${anim('opacity', op)}</circle>`) }
  o.push(`<g fill="#fff" filter="url(#glow)">${feet.join('')}</g>`)
  return o.join('')
}
function unwrapDeg(list) { const out = []; let prev = list[0] || 0; list.forEach((v, i) => { if (i === 0) { out.push(v); return } let d = v - prev; while (d > 180) d -= 360; while (d < -180) d += 360; const nv = out[i - 1] + d; out.push(nv); prev = v }); return out }
function effectsSVG(W, ev, frames, X, dur) {
  const o = [], T = X.total, kt = s => (clamp(s / T, 0, 1)).toFixed(3), wd = X.walkDur
  const at = (s, body) => `<g opacity="0"><set attributeName="opacity" to="1" begin="${s.toFixed(2)}s"/>${body}</g>`
  const n = X.target
  if (ev.tool === 'Read' && n) {
    // le contenu du fichier remonte jusqu'aux yeux
    const lastP = frames[frames.length - 1].P, head = P3({ ...locP(lastP, lastP.m.cl * .45, 0), z: lastP.bz + lastP.m.cw * .2 })
    const chars = (ev.lines || ['…']).join('').replace(/\s+/g, '').slice(0, 40) || '·'
    for (let k = 0; k < 14; k++) { const ch = esc(chars[k % chars.length]), b = (wd + .5 + k * .1).toFixed(2), jx = ((k * 37) % 7 - 3); o.push(`<text font-family="monospace" font-size="3.4" fill="#c9fbff" filter="url(#glow)" opacity="0" x="0" y="0">${ch}<animateMotion path="M${f1(n.x)} ${f1(n.y - 3)}Q${f1((n.x + head.x) / 2 + jx)} ${f1((n.y + head.y) / 2 - 6)} ${f1(head.x)} ${f1(head.y)}" dur=".8s" begin="${b}s" repeatCount="2"/><animate attributeName="opacity" values="0;1;0" dur=".8s" begin="${b}s" repeatCount="2"/></text>`) }
  }
  if ((ev.tool === 'Edit' || ev.tool === 'Write') && n) {
    // la soie sort des filières et emballe le cocon
    const ds = [[], [], []]
    frames.forEach(f => { const ta = f.tAct, s = P3(spinneret(f.P)); for (let k = 0; k < 3; k++) { if (ta < .9 || ta > X.act.dur - .2) { ds[k].push(`M${f1(s.x)} ${f1(s.y)}L${f1(s.x)} ${f1(s.y)}`); continue } const a = ta * 11 + k * 2.09, q = { x: n.x + Math.cos(a) * 3.6, y: n.y + Math.sin(a) * 2.3 }; ds[k].push(`M${f1(s.x)} ${f1(s.y)}Q${f1((s.x + q.x) / 2)} ${f1((s.y + q.y) / 2 + 2)} ${f1(q.x)} ${f1(q.y)}`) } })
    o.push(`<g fill="none" stroke="#fff" stroke-width=".2" filter="url(#glow)">${ds.map(d => `<path d="${d[0]}"><animate attributeName="d" values="${d.join(';')}" dur="${dur}" fill="freeze"/></path>`).join('')}</g>`)
    for (let k = 0; k < 9; k++) { const plus = k % 3 !== 2, b = (wd + 1 + k * .22).toFixed(2), x = n.x + ((k * 53) % 9 - 4); o.push(`<text x="${f1(x)}" y="${f1(n.y - 4)}" font-family="monospace" font-weight="700" font-size="4.2" fill="${plus ? '#c8ffbd' : '#ffc2d0'}" filter="url(#glow)" opacity="0">${plus ? '+' : '−'}<animate attributeName="y" values="${f1(n.y - 4)};${f1(n.y - 20)}" dur="1.1s" begin="${b}s" fill="freeze"/><animate attributeName="opacity" values="1;0" dur="1.1s" begin="${b}s" fill="freeze"/></text>`) }
  }
  if (ev.tool === 'Grep') {
    X.plucks.forEach(p => o.push(`<circle cx="${f1(p.x)}" cy="${f1(p.y)}" r="2" fill="none" stroke="#ffd36b" stroke-width=".5" opacity="0"><animate attributeName="r" values="2;150" dur="1.4s" begin="${p.t.toFixed(2)}s" fill="freeze"/><animate attributeName="opacity" values=".7;0" dur="1.4s" begin="${p.t.toFixed(2)}s" fill="freeze"/></circle>`))
    const from = X.plucks[0] || { x: W.sp.x, y: W.sp.y, t: wd }
    X.targets.forEach((nd, k) => { const b = (from.t + .1 + k * .12).toFixed(2); o.push(`<circle r="1.1" fill="#fff" filter="url(#glow)" opacity="0"><animateMotion path="M${f1(from.x)} ${f1(from.y)}L${f1(nd.x)} ${f1(nd.y)}" dur=".9s" begin="${b}s" fill="freeze"/><animate attributeName="opacity" values="1;1;0" dur="1.2s" begin="${b}s" fill="freeze"/></circle><circle cx="${f1(nd.x)}" cy="${f1(nd.y)}" r="3" fill="none" stroke="#ffd36b" stroke-width=".7" opacity="0"><animate attributeName="r" values="3;24" dur=".9s" begin="${(+b + .9).toFixed(2)}s" fill="freeze"/><animate attributeName="opacity" values="1;0" dur=".9s" begin="${(+b + .9).toFixed(2)}s" fill="freeze"/></circle>`) })
  }
  if (ev.tool === 'Bash' && n) {
    for (let r = 0; r < 3; r++) o.push(`<rect x="${f1(n.x - 7.5)}" y="${f1(n.y - 4 + r * 3)}" height=".9" width="0" fill="#9dff8a"><animate attributeName="width" values="0;${r === 2 ? 9 : 14}" dur=".5s" begin="${(wd + .3 + r * .5).toFixed(2)}s" fill="freeze"/></rect>`)
    o.push(`<rect x="${f1(n.x - 10)}" y="${f1(n.y - 6.5)}" width="20" height="13" rx="3" fill="none" stroke="#9dff8a" stroke-width="1.2" opacity="0" filter="url(#glow)"><animate attributeName="opacity" values="0;1;0" dur=".8s" begin="${(wd + 2).toFixed(2)}s"/></rect>`)
  }
  if (ev.tool === 'Web') {
    const ds = [[], [], []]
    frames.forEach((f, i) => { const ta = f.tAct, s = P3(spinneret(f.P)), L = ta < 0 ? 0 : sm(.4, 1.9, ta) * 150, now = i / FPS; for (let k = 0; k < 3; k++) { let d = ''; for (let j = 0; j <= 14; j++) { const u = j / 14, x = s.x + u * L * (.55 + k * .13) + Math.sin(u * 8 - now * 3 + k * 2) * 6 * u, y = s.y - u * L * (.9 - k * .12) + Math.cos(u * 6 - now * 2.5 + k) * 4 * u; d += (j ? 'L' : 'M') + f1(x) + ' ' + f1(y) } ds[k].push(d) } })
    o.push(`<g fill="none" stroke="#f5f5ff" stroke-width=".22" stroke-opacity=".85" filter="url(#glow)">${ds.map(d => `<path d="${d[0]}"><animate attributeName="d" values="${d.join(';')}" dur="${dur}" fill="freeze"/></path>`).join('')}</g>`)
    const sp = frames[frames.length - 1].P
    o.push(`<circle cx="${f1(sp.x)}" cy="${f1(sp.y)}" r="3" fill="none" stroke="#a8b4ff" stroke-width=".8" opacity="0"><animate attributeName="r" values="3;30" dur=".9s" begin="${(wd + 2.65).toFixed(2)}s" fill="freeze"/><animate attributeName="opacity" values="1;0" dur=".9s" begin="${(wd + 2.65).toFixed(2)}s" fill="freeze"/></circle>`)
  }
  return o.join('')
}
function cardSVG(ev, X, dur) {
  const col = TOOL_COLOR[ev.toolName || ev.tool] || '#7df9ff', lines = (ev.lines || []).slice(0, 4), title = ev.label || ev.tool
  const anchor = X.target || (X.targets[0]) || { x: 0, y: 0 }
  const last = X.target ? X.target : null
  const begin = Math.max(0, X.walkDur + .2).toFixed(2)
  const w = 92, h = 12 + lines.length * 6
  // la carte suit la caméra : on la place en haut à gauche de la vue finale
  const cx = X._camEnd ? X._camEnd.x : anchor.x, cy = X._camEnd ? X._camEnd.y : anchor.y
  const x = (last ? last.x : anchor.x) + 10, y = (last ? last.y : anchor.y) - h - 14
  let s = `<g opacity="0" font-family="monospace"><animate attributeName="opacity" values="0;1;1;0" keyTimes="0;.12;.85;1" dur="${(X.total - X.walkDur).toFixed(2)}s" begin="${begin}s" fill="freeze"/>`
  s += `<rect x="${f1(x)}" y="${f1(y)}" width="${w}" height="${h}" rx="2.5" fill="rgba(12,9,22,.94)" stroke="${col}" stroke-opacity=".75" stroke-width=".35"/>`
  s += `<rect x="${f1(x)}" y="${f1(y)}" width="${w}" height="7" rx="2.5" fill="${col}" fill-opacity=".12"/>`
  s += `<text x="${f1(x + 3)}" y="${f1(y + 5)}" font-size="3.6" font-weight="700" fill="${col}">${esc(title.slice(0, 44))}</text>`
  lines.forEach((ln, k) => { const c = ln[0] === '+' || ln[0] === '✓' ? '#9dff8a' : ln[0] === '-' ? '#ff8aa8' : '#cfc4ef'; s += `<text x="${f1(x + 3)}" y="${f1(y + 12 + k * 6)}" font-size="3.3" fill="${c}">${esc(ln.slice(0, 50))}</text>` })
  return s + '</g>'
}
// image fixe quand Claude ne fait rien : l'araignée respire, la toile reste visible
export function idleClip(W) {
  const frames = []
  for (let i = 0; i < 2; i++) { stepPhysics(W, 1 / 60, {}); frames.push({ P: W.sp.pose(W.t, {}), cam: { ...W.cam }, o: {}, tAct: -1 }) }
  return renderClip(W, { tool: 'idle' }, frames, { total: .1, walkDur: 0, act: { tool: 'idle' }, target: null, targets: [], plucks: [], edgeNear: [], S: SKINS[W.skin] })
}
