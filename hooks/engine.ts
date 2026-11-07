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

/* ---------------- les fichiers : langage, taille, mémoire ---------------- */
const LANG = [[/\.(py|pyw|ipynb)$/i, '#5ec8ff'], [/\.(ts|tsx)$/i, '#4d9dff'], [/\.(js|jsx|mjs|cjs)$/i, '#ffe066'], [/\.(json|jsonc)$/i, '#ffa94d'], [/\.(md|mdx|txt|rst)$/i, '#eae6ff'], [/\.(html?|vue|svelte)$/i, '#ff7a59'], [/\.(css|scss|sass|less)$/i, '#c77dff'], [/\.lua$/i, '#8c9bff'], [/\.(sh|bash|ps1|bat|cmd)$/i, '#9dff8a'], [/\.(ya?ml|toml|ini|cfg|env)$/i, '#ff8ac8'], [/\.(png|jpe?g|gif|svg|webp|ico|mp3|wav|mp4|ttf|otf)$/i, '#ff6be6'], [/\.rs$/i, '#ff8a5c'], [/\.go$/i, '#5ef0c8'], [/\.(java|kt|cs)$/i, '#ffb347'], [/\.(c|cc|cpp|h|hpp)$/i, '#a8b4ff'], [/\.(sql|db|csv|tsv)$/i, '#7dffe0']]
export function langColor(p) { for (const [re, c] of LANG) if (re.test(p || '')) return c; return '#c9c2e6' }
const DAY = 864e5
// chaleur d'un fichier : combien Claude l'a touché, et depuis quand
export function heatOf(m, now) { if (!m) return 0; const score = (m.e || 0) + (m.r || 0) * .25; if (score <= 0) return 0; const rec = Math.exp(-Math.max(0, now - (m.t || now)) / (5 * DAY)); return (1 - Math.exp(-score / 3)) * (.35 + .65 * rec) }
export function applyMemory(W, mem, sizes, now = Date.now()) {
  const g = W.g
  g.nodes.forEach(n => {
    if (n.kind !== 'file') return
    const m = n.path ? mem[n.path] : null, sz = n.path && sizes ? sizes[n.path] : undefined
    n.edits = m?.e || 0; n.reads = m?.r || 0; n.touched = m?.t || 0
    if (m?.l) n.lines = m.l; else if (sz !== undefined) n.lines = Math.max(1, Math.round(sz / 38))
    n.heat = heatOf(m, now); n.lang = langColor(n.path || n.label)
  })
  g.nodes.forEach(n => { if (n.kind === 'file') return; let h = 0; for (const v of g.adj[n.id]) { const o = g.byId[v]; if (o.kind === 'file' && (o.heat || 0) > h) h = o.heat } n.heat = h * .7 })
  g.edges.forEach(e => { e.h = Math.max(g.byId[e.a].heat || 0, g.byId[e.b].heat || 0) })
}
// la taille du cocon suit le nombre de lignes du fichier
export const cocoonScale = n => clamp(.75 + Math.log10(1 + (n.lines || 20)) * .32, .75, 1.85)

export const TOOL_COLOR = { Read: '#7df9ff', Edit: '#ff6be6', Write: '#ff6be6', MultiEdit: '#ff6be6', NotebookEdit: '#ff6be6', Grep: '#ffd36b', Glob: '#ffd36b', Bash: '#9dff8a', WebSearch: '#a8b4ff', WebFetch: '#a8b4ff', Web: '#a8b4ff', Mood: '#9dff8a', Delete: '#ff6b8a', Repair: '#ffffff', Leave: '#c89bff' }
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
export function graphFromTree(paths, projectName, deps = []) {
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
  // les vraies relations : qui importe qui
  for (const [a, b] of deps) if (seen.has(a) && seen.has(b) && a !== b) edges.push({ a, b, kind: 'dep' })
  const uniq = new Set(), E = edges.filter(e => { const k = e.a + '|' + e.b, k2 = e.b + '|' + e.a; if (uniq.has(k) || uniq.has(k2)) return false; uniq.add(k); return true })
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
  buildOrbs(g)
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
// les fils de la boule ondulent comme des câbles posés : un, deux ou trois virages, dans tous les sens
// (les mêmes que dans la grande vue), avec à peine de poids ; l'araignée marche sur ces courbes
function wavePt(e, a, b, u) {
  if (!e.wv) { const R = rng(hash(e.a + '|' + e.b)), k = R() < .45 ? 1 : R() < .7 ? 2 : 3; e.wv = { k, amp: (R() < .5 ? -1 : 1) * (.05 + R() * .07) / Math.sqrt(k), ph: R() * 6.28, k2: k + 1 + Math.floor(R() * 2), a2: (R() - .5) * .05 } }
  const W = e.wv, dx = b.x - a.x, dy = b.y - a.y, L = Math.hypot(dx, dy) || .01, env = Math.sin(Math.PI * u)
  const off = env * L * (W.amp * Math.sin(Math.PI * W.k * u + (W.k > 1 ? W.ph * .3 : 0)) + W.a2 * Math.sin(Math.PI * W.k2 * u + W.ph))
  return { x: a.x + dx * u - dy / L * off, y: a.y + dy * u + dx / L * off + env * Math.min(L * .03, 6) }
}
// dans le panneau, un fil est une seule courbe de Bézier qui passe par la vague au tiers et aux deux tiers
// (un ou deux virages) : bien plus court à écrire, et l'araignée marche exactement sur la courbe dessinée
function waveCubic(e, a, b) {
  const w1 = wavePt(e, a, b, 1 / 3), w2 = wavePt(e, a, b, 2 / 3), A = { x: 27 * w1.x - 8 * a.x - b.x, y: 27 * w1.y - 8 * a.y - b.y }, B = { x: 27 * w2.x - a.x - 8 * b.x, y: 27 * w2.y - a.y - 8 * b.y }
  return [{ x: (2 * A.x - B.x) / 18, y: (2 * A.y - B.y) / 18 }, { x: (2 * B.x - A.x) / 18, y: (2 * B.y - A.y) / 18 }]
}
function cubicAt(a, c1, c2, b, u) { const v = 1 - u; return { x: v * v * v * a.x + 3 * v * v * u * c1.x + 3 * v * u * u * c2.x + u * u * u * b.x, y: v * v * v * a.y + 3 * v * v * u * c1.y + 3 * v * u * u * c2.y + u * u * u * b.y } }
const mixHex = (a, b, k) => { const A = [1, 3, 5].map(i => parseInt(a.slice(i, i + 2), 16)), B = [1, 3, 5].map(i => parseInt(b.slice(i, i + 2), 16)); return '#' + A.map((v, i) => Math.round(v + (B[i] - v) * k).toString(16).padStart(2, '0')).join('') }
function buildGeometry(g) {
  g.grid = new Map()
  g.edges.forEach(e => {
    const a = g.byId[e.a], b = g.byId[e.b], dx = b.x - a.x, dy = b.y - a.y, L = Math.hypot(dx, dy) || 1, nx = -dy / L, ny = dx / L
    const sag = g.straight ? 0 : L * (e.kind === 'dep' ? .1 : .045) * (hash(e.a + e.b) % 2 ? 1 : -1)
    e.c = { x: (a.x + b.x) / 2 + nx * sag * 2, y: (a.y + b.y) / 2 + ny * sag * 2 }
    e.pts = []; const N = Math.max(6, Math.round(L / 6))
    if (g.straight) { const [c1, c2] = waveCubic(e, a, b); for (let i = 0; i <= N; i++) e.pts.push(cubicAt(a, c1, c2, b, i / N)) }
    else for (let i = 0; i <= N; i++) { const u = i / N; e.pts.push({ x: (1 - u) * (1 - u) * a.x + 2 * u * (1 - u) * e.c.x + u * u * b.x, y: (1 - u) * (1 - u) * a.y + 2 * u * (1 - u) * e.c.y + u * u * b.y }) }
    for (let i = 1; i < e.pts.length; i++) addSeg(g, e.pts[i - 1], e.pts[i], e.kind === 'tree' ? .75 : .85)
  })
}
// chaque dossier (ou communauté) devient une petite toile circulaire : ses rayons vont vers
// ses fichiers, et des spirales les relient comme les fils d'une vraie toile orbiculaire
function buildOrbs(g) {
  g.orbs = []
  const make = (cx, cy, kids) => {
    if (kids.length < 3) return
    const ds = kids.map(k => ({ k, a: Math.atan2(k.y - cy, k.x - cx), d: Math.hypot(k.x - cx, k.y - cy) })).filter(o => o.d > 8).sort((p, q) => p.a - q.a)
    if (ds.length < 3) return
    const R = ds.reduce((s, o) => s + o.d, 0) / ds.length; if (R < 18 || R > 300) return
    // rayon de la toile dans chaque direction : interpolé entre les fichiers voisins
    const radAt = a => { let i = ds.findIndex(o => o.a > a); if (i < 0) i = 0; const p = ds[(i - 1 + ds.length) % ds.length], q = ds[i]; let span = q.a - p.a; if (span <= 0) span += Math.PI * 2; let u = a - p.a; if (u < 0) u += Math.PI * 2; const t = clamp(u / span, 0, 1); return Math.min(lerp(p.d, q.d, t), R * 1.2) * (1 - .12 * Math.sin(t * Math.PI)) }
    const N = Math.max(14, ds.length * 2), spirals = []
    for (const f of [.3, .52, .74, .94]) { const pts = []; for (let k = 0; k <= N; k++) { const a = -Math.PI + k / N * Math.PI * 2, r = radAt(a) * f; pts.push({ x: cx + Math.cos(a) * r, y: cy + Math.sin(a) * r }) } spirals.push(pts) }
    spirals.forEach(pts => { for (let i = 1; i < pts.length; i++) addSeg(g, pts[i - 1], pts[i], .95) })
    g.orbs.push({ x: cx, y: cy, r: R, spirals })
  }
  g.nodes.forEach(n => { if (n.kind === 'dir') make(n.x, n.y, g.adj[n.id].map(id => g.byId[id]).filter(k => k.kind === 'file' || k.kind === 'dir')) })
  if (!g.nodes.some(n => n.kind === 'dir')) g.comms.forEach((c, i) => make(c.cx, c.cy, g.nodes.filter(n => n.comm === i && n.kind === 'file')))
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
  while (q.length) {
    const u = q.shift()
    for (const v of g.adj[u]) {
      if (v in prev) continue
      const e = g.edges[g.edgeIdx[u + '|' + v]]
      if (e && (e.broken || e.hidden)) continue
      if (g.byId[v].gone && v !== to) continue
      prev[v] = u
      if (v === to) { const p = [v]; let w = u; while (w !== null) { p.unshift(w); w = prev[w] } return p }
      q.push(v)
    }
  }
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
  if (n) {
    if (n.gone) { n.gone = false; n.isNew = true; g.adj[n.id].forEach(v => { const e = g.edges[g.edgeIdx[n.id + '|' + v]]; if (e) { e.broken = null; e.hidden = false } }) }
    return n
  }
  // fichier inconnu : un nouveau cocon, accroché au nœud le plus proche par le nom de dossier
  const dir = rel.split('/').slice(0, -1).join('/')
  // jamais accroché à un fichier supprimé : il ne serait pas joignable
  const alive = g.nodes.filter(x => x.kind === 'file' && !x.gone)
  const anchor = g.nodes.find(x => !x.gone && x.path && dir && x.path.startsWith(dir + '/')) || alive[hash(rel) % Math.max(1, alive.length)] || g.nodes[0]
  const a = hash(rel) % 360 * DEG
  n = { id: rel, label: base, kind: 'file', comm: anchor.comm, path: rel, x: anchor.x + Math.cos(a) * 55, y: anchor.y + Math.sin(a) * 55, ang: a, visited: false, mod: false, wrap: 0, lang: langColor(rel), heat: 0, edits: 0 }
  if (g.W && g.W.sph) place3(g.W, n, anchor)
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
  // chaque pied s'agrippe à un fil : le plus proche à portée, sinon un peu plus loin ; s'il n'y en a vraiment aucun,
  // la patte se replie vers le corps au lieu de se poser dans le vide
  snapPt(p, L) {
    const r = this.reach(L), near = this.env.snap(p, r * .95)
    if (near) return near
    // un fil plus loin : seulement s'il est du côté de cette patte (sinon toutes les pattes iraient sur le même fil)
    const far = this.env.grip ? this.env.snap(p, r * 1.8) : null, side = far && ((far.x - this.x) * -Math.sin(this.h) + (far.y - this.y) * Math.cos(this.h)) * L.s
    if (far && side > -this.m.cw * .2) return far
    if (!this.env.grip || (this.env.free && this.env.free())) return p
    return { x: lerp(this.x, p.x, .45), y: lerp(this.y, p.y, .45) }
  }
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
      // une patte restée loin derrière (le corps a pivoté vite) fait un pas d'urgence, sans attendre son tour
      const urgent = far > r * 1.45
      if ((d > r * .28 || settle || far > r * 1.05) && (urgent ? stepping.length < 6 : !stepping.some(o => o.g !== L.g) && stepping.length < 4)) {
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
      if (o.tuck > .001) { const fold = this.local(hl.x + (L.i < 2 ? m.cl * .45 : -m.cl * .2), hl.y + L.s * m.legs[L.i] * .2); F = lerp3(F, { x: fold.x, y: fold.y, z: bz - m.bodyZ * .25 + m.legs[L.i] * .12 }, o.tuck) }
      for (const ov of (o.over || [])) if (ov.w > .001 && ov.i === L.i && (!ov.s || ov.s === L.s)) F = lerp3(F, ov.p(L.s), ov.w)
      // une patte qui doit aller plus loin que sa longueur peut s'étirer un peu (o.stretch : jusqu'à combien de fois)
      const len0 = m.legs[L.i] * (1 + LEG_JIT[L.i * 2 + (L.s > 0 ? 1 : 0)]), k = o.stretch ? clamp(Math.hypot(F.x - H.x, F.y - H.y, F.z - H.z) / (len0 * .97), 1, o.stretch) : 1, len = len0 * k, { K, A } = ik3(H, F, len * m.seg[0], len * m.seg[1], len * m.seg[2])
      return { H, K, A, F, s: L.s, i: L.i, stepping: L.p >= 0, k }
    })
    const palps = [-1, 1].map(s => {
      const b = this.local(m.cl * .4, s * m.cw * .17), w = Math.sin(t * 3.1 + s * 1.3) * m.cw * .05
      const tip = this.local(m.cl * .5 + m.palp * .78, s * (m.cw * .22 + w))
      const B = { x: b.x, y: b.y, z: bz }; let T = { x: tip.x, y: tip.y, z: bz - Math.max(.2, m.bodyZ * .6) }
      if (o.palp && o.palp.w > .001) T = lerp3(T, { x: o.palp.x - Math.sin(this.h) * s * 1.2, y: o.palp.y + Math.cos(this.h) * s * 1.2, z: o.palp.z }, o.palp.w)
      return { B, K: { x: (B.x + T.x) / 2, y: (B.y + T.y) / 2, z: Math.max(B.z, T.z) + m.palp * .32 }, T }
    })
    return { x: this.x, y: this.y, h: this.h, abd: this.abd, bz, legs, palps, m, abdUp: o.abdUp || 0 }
  }
}
const locP = (P, lx, ly) => { const c = Math.cos(P.h), s = Math.sin(P.h); return { x: P.x + lx * c - ly * s, y: P.y + lx * s + ly * c } }
function abdC(P) { const m = P.m, up = P.abdUp || 0, ped = locP(P, -m.cl * .48, 0), d = m.al * .47 * (1 - .35 * up); return { x: ped.x - Math.cos(P.abd) * d, y: ped.y - Math.sin(P.abd) * d } }
function spinneret(P) { const m = P.m, up = P.abdUp || 0, ped = locP(P, -m.cl * .48, 0), d = m.al * .96 * (1 - .55 * up); return { x: ped.x - Math.cos(P.abd) * d, y: ped.y - Math.sin(P.abd) * d, z: P.bz + up * m.al * .85 } }

/* ---------------- franchir un écart : enjamber ou bondir (sur une page comme sur le graphe) ---------------- */
// enjamber (u de 0 à 1) : les pattes avant s'étirent au-dessus du vide et attrapent l'autre bord (grab : un point par
// côté), puis elle s'y hisse en tirant, le corps glisse et les pattes reprennent leur longueur
const SPAN_STRETCH = 1.6
function spanAt(from, grab, u, m, ux, uy) {
  const reachW = sm(0, .3, u) * (1 - sm(.66, .8, u)), z0 = Math.sin(Math.PI * clamp(u / .3, 0, 1)) * m.legs[0] * .25
  const k = sm(.24, .76, u), e = k * k * (3 - 2 * k), back = m.legs[0] * .45
  const dest = { x: (grab[1].x + grab[-1].x) / 2 - ux * back, y: (grab[1].y + grab[-1].y) / 2 - uy * back }
  const over = [0, 1].map(i => ({ i, w: reachW * (i ? .85 : 1), p: s => { const g = grab[s], off = i ? -2.2 : 0; return { x: g.x + ux * off, y: g.y + uy * off, z: u < .3 ? z0 : 0 } } }))
  return { x: lerp(from.x, dest.x, e), y: lerp(from.y, dest.y, e), over, lift: -sm(.24, .4, u) * (1 - sm(.6, .76, u)) * m.bodyZ * .25 }
}
// bondir : elle s'accroupit (pattes fléchies), se détend d'un coup, vole pattes repliées (plus haut si c'est loin),
// les tend juste avant de toucher et amortit la réception
function leapAt(from, to, u, m) {
  const L = Math.hypot(to.x - from.x, to.y - from.y), crouch = sm(0, .22, u) * (1 - sm(.22, .3, u)), k = sm(.26, .88, u), land = sm(.86, .93, u) * (1 - sm(.93, 1, u))
  return { x: lerp(from.x, to.x, k), y: lerp(from.y, to.y, k), lift: Math.sin(Math.PI * k) * Math.min(60, 8 + L * .19) - crouch * m.bodyZ * .55 - land * m.bodyZ * .4, tuck: (k > 0 && k < 1 ? Math.sin(Math.PI * Math.min(1, k * 1.25)) * .85 : 0) + crouch * .3 }
}
const leapTime = L => clamp(.55 + L / 260, .6, 1.5), spanTime = L => clamp(.9 + L / 110, 1, 1.8)

/* ---------------- les skins (SVG) ---------------- */
// les huit pattes ne sont pas parfaitement égales (quelques pour cent de longueur en plus ou en moins)
const LEG_JIT = [.03, -.025, -.02, .035, .025, -.03, -.035, .02]
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
// dans le panneau, des pas un peu plus longs : chaque pas dure plusieurs images, on voit les pattes se lever et se poser
Object.values(SKINS).forEach(s => { s.m = prepMorph(s.morph); s.m.stepDur *= 1.45 })

function skinDefs(id, S) {
  return `<radialGradient id="${id}g" cx="35%" cy="30%" r="75%"><stop offset="0" stop-color="${S.leg[2] || S.leg[0]}"/><stop offset=".55" stop-color="${S.leg[1] || S.leg[0]}"/><stop offset="1" stop-color="${S.leg[0]}"/></radialGradient>`
}
// abdomen dessiné dans son repère (x vers l'avant), rx/ry ses demi-axes
// le contour d'un corps vivant : rond, mais pas un ovale parfait (de légères bosses), et l'abdomen s'affine vers
// l'arrière, là où sort la soie
function blobPath(rx, ry, taper) {
  let d = ''; const N = 30
  for (let k = 0; k < N; k++) {
    const a = k / N * Math.PI * 2, c = Math.cos(a), r = 1 + .035 * Math.sin(3 * a + .7) + .022 * Math.sin(7 * a + 2.1) + .014 * Math.sin(11 * a + .4)
    const back = c < 0 ? c * c : 0, x = rx * c * r * (1 + taper * .08 * back), y = ry * Math.sin(a) * r * (1 - taper * .24 * back)
    d += (k ? 'L' : 'M') + f1(x) + ' ' + f1(y)
  }
  return d + 'Z'
}
function abdomenSVG(S, rx, ry) {
  const B = S.body, o = [], outline = blobPath(rx, ry, 1)
  // un fond opaque sous le corps translucide : les os et les pattes qui passent dessous restent cachés
  o.push(`<path d="${outline}" fill="#0b0716"/>`)
  const ell = (fill, stroke, sw, extra = '') => `<path d="${outline}" fill="${fill}"${stroke ? ` stroke="${stroke}" stroke-width="${sw}"` : ''} ${extra}/>`
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
  // chélicères : une base trapue, puis un crochet recourbé vers l'intérieur qui finit en pointe acérée
  if (!B.wireOnly) for (const s of [-1, 1]) {
    const bx = cl * .44, by = s * cw * .13, fill = B.xray ? 'rgba(200,180,255,.15)' : B.solid ? '#1c1030' : 'rgba(40,18,80,.9)', edge = B.xray ? '#f2f6ff' : B.rim
    o.push(`<path d="M${f1(bx - cl * .06)} ${f1(by - s * cw * .1)}Q${f1(bx + cl * .2)} ${f1(by - s * cw * .12)} ${f1(bx + cl * .22)} ${f1(by + s * cw * .02)}Q${f1(bx + cl * .17)} ${f1(by + s * cw * .1)} ${f1(bx - cl * .04)} ${f1(by + s * cw * .07)}Z" fill="${fill}" stroke="${edge}" stroke-width=".14" stroke-opacity=".7"/>`)
    o.push(`<path d="M${f1(bx + cl * .18)} ${f1(by - s * cw * .04)}Q${f1(bx + cl * .36)} ${f1(by - s * cw * .02)} ${f1(bx + cl * .4)} ${f1(by - s * cw * .1)}Q${f1(bx + cl * .31)} ${f1(by + s * cw * .03)} ${f1(bx + cl * .2)} ${f1(by + s * cw * .05)}Z" fill="${edge}" fill-opacity=".85"/>`)
  }
  o.push(`<path d="${path}" fill="#0b0716"/>`)
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
// les bébés araignées (sous-agents, tâches de fond) : même apparence, en petit
function babyMorph(m) { const k = .7, o = { ...m }; ['cl', 'cw', 'al', 'aw', 'bodyZ', 'legW', 'palp', 'R'].forEach(key => o[key] = m[key] * k); o.legs = m.legs.map(v => v * k); o.stepDur = m.stepDur * .8; o.baby = true; return o }
function hubNode(g) { return g.nodes.filter(n => (n.kind === 'file' || n.kind === 'dir') && !n.gone).sort((a, b) => g.adj[b.id].length - g.adj[a.id].length)[0] || g.nodes[0] }
export function createWorld(graph, skinId) {
  const W = { g: graph, skin: SKINS[skinId] ? skinId : 'fusion', t: 0, loads: [], vib: [], waves: [], actors: {}, sleeping: false }
  const env = { grip: true, free: () => !!W.turning, snap: (p, r) => W.turning ? null : snapOn(graph, p, r), depth: (x, y) => W.sph ? 0 : depthFrom(W.loads, x, y, W.t), onPlant: (f, m) => W.vib.push({ x: f.x, y: f.y, t0: W.t, w: m.baby ? .5 : 1.3, f: 2 * Math.PI * 8, tau: .22, s2: 50 }) }
  W.env = env
  const start = hubNode(graph)
  W.actors.main = { id: 'main', baby: false, sp: new Spider(SKINS[W.skin].m, start.x, start.y, -Math.PI / 2, env), cur: start.id, hang: 0 }
  W.sp = W.actors.main.sp
  W.cam = { x: start.x, y: start.y }
  return W
}
export function setSkin(W, id) { if (!SKINS[id]) return; W.skin = id; Object.values(W.actors).forEach(a => a.sp.setMorph(a.baby ? babyMorph(SKINS[id].m) : SKINS[id].m)) }
export const hasActor = (W, id) => !!W.actors[id]
/* ---------------- plusieurs araignées sur un même dossier : chacune sa place ---------------- */
// la première arrivée garde le centre de l'étoile ; les suivantes se posent chacune sur un fil différent qui part du
// dossier, à une petite distance, tête vers l'étoile ; sans fil libre, en couronne (comme dans la grande toile)
const legSpan = a => Math.max(...a.sp.m.legs)
function arrive(W, a) { if (a.arrNode !== a.cur) { a.arrNode = a.cur; a.arrT = (W.arrSeq = (W.arrSeq || 0) + 1); a.slotWire = null; a.slotAng = null } }
function restSpot(W, a) {
  const g = W.g, n = g.byId[a.cur]; if (!n) return null
  arrive(W, a)
  const here = Object.values(W.actors).filter(o => o.cur === n.id && (o.hang < 1 || o === a))
  const first = here.reduce((b, o) => !b || (o.arrT || 0) < (b.arrT || 0) ? o : b, null)
  if (!first || first === a || !here.includes(a)) return { x: n.x, y: n.y, center: true }
  const D = (legSpan(first) + legSpan(a)) * .55
  const ok = v => { const i = g.edgeIdx[n.id + '|' + v], e = g.edges[i]; return i !== undefined && e && !e.broken && !e.hidden && g.byId[v] && !g.byId[v].gone }
  const onWire = v => {
    const e = g.edges[g.edgeIdx[n.id + '|' + v]], P = e.a === n.id ? e.pts : [...e.pts].reverse()
    let tot = 0; const L = P.reduce((s, p, k) => k ? s + dist(P[k - 1], p) : 0, 0), want = Math.min(D, L * .6)
    for (let k = 1; k < P.length; k++) { const d = dist(P[k - 1], P[k]); if (tot + d >= want) return lerp2(P[k - 1], P[k], (want - tot) / (d || 1)); tot += d }
    return { x: P[P.length - 1].x, y: P[P.length - 1].y }
  }
  if (a.slotWire == null && a.slotAng == null) {
    const others = here.filter(o => o !== a).map(o => o === first ? n : o.slotWire && ok(o.slotWire) ? onWire(o.slotWire) : o.sp)
    const free = g.adj[n.id].filter(v => ok(v) && !here.some(o => o !== a && o.slotWire === v))
    const best = free.map(v => { const q = onWire(v); return [v, Math.min(...others.map(o => dist(o, q)))] }).sort((p, q) => q[1] - p[1])[0]
    if (best && best[1] > legSpan(a) * .9) a.slotWire = best[0]; else a.slotAng = here.filter(o => o !== first).indexOf(a) * 2.4
  }
  const q = a.slotWire && ok(a.slotWire) ? onWire(a.slotWire) : { x: n.x + Math.cos((a.slotAng || 0) + .7) * D, y: n.y + Math.sin((a.slotAng || 0) + .7) * D }
  return { ...q, face: Math.atan2(n.y - q.y, n.x - q.x) }
}
function actorFor(W, ev) {
  const id = ev.actor || 'main'
  if (W.actors[id]) return W.actors[id]
  // un bébé araignée descend sur son fil, juste au-dessus de l'endroit où il va travailler
  const g = W.g, near = (ev.path && nodeForPath(g, ev.path)) || (ev.tool === 'Bash' ? g.byId['::terminal'] : null) || g.byId[W.actors.main.cur] || hubNode(g)
  const a = { id, baby: true, sp: new Spider(babyMorph(SKINS[W.skin].m), near.x, near.y, Object.keys(W.actors).length * 2.4, W.env), cur: near.id, hang: 70 }
  W.actors[id] = a
  const q = restSpot(W, a); if (q && !q.center) { a.sp.x = q.x; a.sp.y = q.y; a.sp.h = q.face; a.sp.setMorph(a.sp.m) }
  return a
}

function stepPhysics(W, dt) {
  W.t += dt
  W.vib = W.vib.filter(v => W.t - v.t0 < 1.2); W.waves = W.waves.filter(v => W.t - v.t0 < 2.5)
  const L = []
  for (const a of Object.values(W.actors)) {
    if (a.hang > 4) continue
    const sp = a.sp, k = a.baby ? .4 : 1
    L.push({ x: sp.x, y: sp.y, w: 4.2 * k, s2: 420 * k })
    sp.legs.forEach(l => { if (l.p < 0) L.push({ x: l.foot.x, y: l.foot.y, w: 1.15 * k, s2: 30 }) })
  }
  W.loads = L.concat(W.vib, W.waves)
  for (const a of Object.values(W.actors)) a.sp.update(dt)
}
function optsFor(a, act, t, dep) {
  const o = act ? actionOpts(act, t, a.sp, dep) : { over: [] }
  if (a.hang > .5) { o.lift = (o.lift || 0) + a.hang; o.tuck = Math.max(o.tuck || 0, clamp(a.hang / 10, 0, .85)) }
  if (a.leap) { o.lift = (o.lift || 0) + a.leap.lift; if (a.leap.tuck) o.tuck = Math.max(o.tuck || 0, a.leap.tuck); if (a.leap.over) o.over = [...(o.over || []), ...a.leap.over]; if (a.leap.stretch) o.stretch = a.leap.stretch }
  return o
}
function actionOpts(act, t, sp, dep) {
  const o = { over: [] }; if (!act) return o
  const m = sp.m, fwd = { x: Math.cos(sp.h), y: Math.sin(sp.h) }, side = { x: -fwd.y, y: fwd.x }
  const n = act.n
  if (act.tool === 'Read' && n) {
    const w = sm(0, .35, t) * (1 - sm(act.dur - .4, act.dur, t)), c = { x: n.x, y: n.y, z: dep(n.x, n.y) + w * 3.5 }
    o.over.push({ i: 0, w, p: s => ({ x: c.x + side.x * s * 3.3 - fwd.x, y: c.y + side.y * s * 3.3 - fwd.y, z: c.z + 1 + Math.sin(t * 9 + s * 1.7) * .8 }) })
    o.over.push({ i: 1, w: w * .35, p: s => ({ x: c.x + side.x * s * 7 - fwd.x * 4, y: c.y + side.y * s * 7 - fwd.y * 4, z: dep(c.x, c.y) + 1.5 }) })
    o.palp = { x: c.x, y: c.y, z: c.z + .8, w }; o.held = { ...c, w }
  } else if ((act.tool === 'Edit' || act.tool === 'Write' || act.tool === 'Repair') && (n || act.at)) {
    const q = act.at || n, w = sm(.9, 1.3, t) * (1 - sm(act.dur - .4, act.dur, t)), cz = dep(q.x, q.y) + 1.5, s0 = sp.local(-(m.cl * .48 + m.al * .7), 0)
    o.over.push({ i: 3, w, p: s => { const k = Math.max(0, Math.sin(t * 9 + (s > 0 ? Math.PI : 0))); return { x: lerp(q.x, s0.x, .3) + side.x * s * 3, y: lerp(q.y, s0.y, .3) + side.y * s * 3, z: cz + k * 4.5 } } })
    o.lift = -w * m.bodyZ * .15
  } else if (act.tool === 'Grep') {
    const w = sm(0, .2, t) * (1 - sm(1.55, 1.8, t)), ph = (((t - .05) % .5) + .5) % .5 / .5, up = t < 1.55 ? (ph < .78 ? Math.sin(ph / .78 * Math.PI / 2) : 1 - (ph - .78) / .22) : 0, tip = pluckTip(sp)
    o.over.push({ i: 0, s: 1, w, p: () => ({ x: tip.x, y: tip.y, z: dep(tip.x, tip.y) + up * m.legs[0] * .38 }) })
  } else if (act.tool === 'Bash' && n) {
    const w = sm(0, .3, t) * (1 - sm(act.dur - .3, act.dur, t)), c = { x: n.x, y: n.y - 2, z: dep(n.x, n.y) + 2.5 }
    o.over.push({ i: 0, w, p: s => ({ x: c.x + side.x * s * 4.5 - fwd.x * 2, y: c.y + side.y * s * 4.5 - fwd.y * 2, z: c.z + Math.max(0, Math.sin(t * 13 + (s > 0 ? Math.PI : 0))) * 3.2 }) })
    o.palp = { ...c, w: w * .7 }
  } else if (act.tool === 'Web') {
    const w = sm(0, .6, t) * (1 - sm(act.dur - .5, act.dur, t)); o.lift = m.bodyZ * .9 * w; o.abdUp = w
  } else if (act.tool === 'Mood' && act.ok) {
    // une petite danse : elle sautille et agite ses pattes avant
    const w = sm(0, .25, t) * (1 - sm(act.dur - .35, act.dur, t)), base = dep(sp.x, sp.y)
    o.lift = w * m.bodyZ * .55 * Math.abs(Math.sin(t * 10))
    o.over.push({ i: 0, w, p: s => { const q = sp.local(m.cl * .5 + m.legs[0] * .3, s * (m.cw * .6 + m.legs[0] * .22)); return { x: q.x, y: q.y, z: base + m.bodyZ + m.legs[0] * .42 + Math.sin(t * 14 + s * 2) * m.legs[0] * .14 } } })
    o.over.push({ i: 1, w: w * .6, p: s => { const q = sp.local(m.cl * .3 + m.legs[1] * .25, s * (m.cw * .7 + m.legs[1] * .35)); return { x: q.x, y: q.y, z: base + Math.max(0, Math.sin(t * 10 + s * Math.PI)) * 3 } } })
  } else if (act.tool === 'Mood') {
    // l'échec : elle se recroqueville et tremble
    const w = sm(0, .3, t) * (1 - sm(act.dur - .4, act.dur, t))
    o.tuck = w * .78; o.lift = -w * m.bodyZ * .4 + Math.sin(t * 40) * .18 * w
  }
  return o
}
function pluckTip(sp) { const L = sp.legs.find(l => l.i === 0 && l.s === 1), b = sp.ideal(L), f = { x: Math.cos(sp.h), y: Math.sin(sp.h) }; return { x: b.x + f.x * 3, y: b.y + f.y * 3 } }

/* ---------------- la sphère : la toile en 3D, en nébuleuses, qui tourne ---------------- */
// les nœuds gardent leur place à plat (x2, y2) ; en sphère, x et y sont la projection de p3 selon l'orientation
const NEB_HUES = ['#b46cff', '#5ee6ff', '#ff6be6', '#ffb347', '#8dff7a', '#ffd36b', '#ff7a8a', '#7f9dff', '#e8e2ff']
function sphereLayout(g) {
  const nodes = g.nodes, n = nodes.length; if (!n) return
  let cx = 0, cy = 0; nodes.forEach(o => { cx += o.x2; cy += o.y2 }); cx /= n; cy /= n
  // à aire égale : le rang de la distance au centre donne la latitude (le cœur de la toile ne s'entasse pas au pôle)
  const rk = new Map([...nodes].sort((p, q) => Math.hypot(p.x2 - cx, p.y2 - cy) - Math.hypot(q.x2 - cx, q.y2 - cy)).map((o, k) => [o.id, (k + .5) / n]))
  const U = nodes.map(o => { const th = Math.acos(1 - 2 * rk.get(o.id)), ph = Math.atan2(o.y2 - cy, o.x2 - cx) + (hash(o.id) % 100) * .0004; return { x: Math.sin(th) * Math.cos(ph), y: -Math.cos(th), z: Math.sin(th) * Math.sin(ph) } })
  // un moyeu (relié à une bonne partie du projet) tirerait tout de son côté : il va au cœur de la boule, sans tirer
  const hubDeg = Math.max(40, n * .15), isHub = o => g.adj[o.id].length > hubDeg; g.hubDeg = hubDeg
  const idx = new Map(nodes.map((o, i) => [o.id, i])), EE = g.edges.filter(e => !isHub(g.byId[e.a]) && !isHub(g.byId[e.b])).map(e => [idx.get(e.a), idx.get(e.b)])
  const iters = n > 900 ? 35 : n > 500 ? 60 : 110, q = .27 / Math.max(20, n), cap = .06 * Math.sqrt(166 / Math.max(166, n)), ks = .05 * clamp(2.2 * n / Math.max(1, 2 * EE.length), .15, 1)
  const F = U.map(() => ({ x: 0, y: 0, z: 0 }))
  for (let it = 0; it < iters; it++) {
    F.forEach(f => { f.x = f.y = f.z = 0 })
    for (let i = 0; i < n; i++) { const a = U[i]; for (let j = i + 1; j < n; j++) { const b = U[j], dx = b.x - a.x, dy = b.y - a.y, dz = b.z - a.z, d2 = dx * dx + dy * dy + dz * dz + .002; if (d2 > .5) continue; const f = q / d2; F[i].x -= dx * f; F[i].y -= dy * f; F[i].z -= dz * f; F[j].x += dx * f; F[j].y += dy * f; F[j].z += dz * f } }
    EE.forEach(([i, j]) => { const a = U[i], b = U[j]; F[i].x += (b.x - a.x) * ks; F[i].y += (b.y - a.y) * ks; F[i].z += (b.z - a.z) * ks; F[j].x += (a.x - b.x) * ks; F[j].y += (a.y - b.y) * ks; F[j].z += (a.z - b.z) * ks })
    U.forEach((u, i) => { const f = F[i], m = Math.hypot(f.x, f.y, f.z), k = m > cap ? cap / m : 1; u.x += f.x * k; u.y += f.y * k; u.z += f.z * k; const d = Math.hypot(u.x, u.y, u.z) || 1; u.x /= d; u.y /= d; u.z /= d })
  }
  // une profondeur au hasard, lissée entre voisins (les fils restent courts), puis répartie pour remplir la boule
  let dep = nodes.map(o => (hash(o.id) % 1000) / 1000)
  for (let it = 0; it < 6; it++) dep = dep.map((v, i) => { const nb = g.adj[nodes[i].id]; if (!nb.length) return v; let m = 0; nb.forEach(id => { m += dep[idx.get(id)] }); return v * .4 + m / nb.length * .6 })
  nodes.map((o, i) => i).sort((i, j) => dep[i] - dep[j]).forEach((i, k) => { const r = isHub(nodes[i]) ? 6 + (hash(nodes[i].id) % 10) : 100 * (.3 + .66 * Math.cbrt((k + .5) / n)); nodes[i].p3 = { x: U[i].x * r, y: U[i].y * r, z: U[i].z * r } })
}
// la caméra à la troisième personne (comme dans la grande toile) : elle vise le point F de la boule (l'araignée, ou
// la cible vers laquelle elle va) et se tient toujours à la même distance ; la boule ne tourne plus d'elle-même.
// zd dit ce qui compte à l'écran : près de l'araignée et sur son chemin, au premier plan ; au fond, fin et sombre ;
// entre la caméra et elle, effacé
const depthOf = z => z < 0 ? clamp(1 + z / 150, .04, 1) : clamp(1 - Math.max(0, z - 45) / 110, .06, 1)
function proj3(W, p, yaw, pitch, F, id) {
  const S = W.sph, f = F || S.F || { x: 0, y: 0, z: 0 }, cy = Math.cos(yaw), sy = Math.sin(yaw), cp = Math.cos(pitch), spp = Math.sin(pitch), RS = S.R / 100
  const px = p.x - f.x, py = p.y - f.y, pz = p.z - f.z
  const x = px * cy + pz * sy, z0 = -px * sy + pz * cy, y = py * cp - z0 * spp, z = py * spp + z0 * cp, k = S.D / (S.D - Math.min(z, S.D * .7))
  const d3 = Math.hypot(px, py, pz), zd = S.boost && S.boost.has(id) ? Math.max(.92, depthOf(z)) : depthOf(z) * (.2 + .8 * Math.exp(-d3 / 46))
  return { x: x * RS * k, y: y * RS * k, zd, k }
}
function placeAll(W, yaw, pitch, F) { const m = new Map(); W.g.nodes.forEach(n => { if (n.p3) m.set(n.id, proj3(W, n.p3, yaw, pitch, F, n.id)) }); return m }
function applyPlace(W, P) { W.g.nodes.forEach(n => { const q = P.get(n.id); if (q) { n.x = q.x; n.y = q.y; n.zd = q.zd; n.k = q.k } }) }
// l'angle dont la toile tourne autour d'un nœud d'un placement à l'autre (ses voisins, en moindres carrés)
function spinAt(g, id, P0, P1) {
  const a0 = P0.get(id), a1 = P1 ? P1.get(id) : g.byId[id]; if (!a0 || !a1) return 0
  let sc = 0, sd = 0; const nb = g.adj[id] || []
  for (let i = 0; i < nb.length && i < 14; i++) { const o0 = P0.get(nb[i]), o1 = P1 ? P1.get(nb[i]) : g.byId[nb[i]]; if (!o0 || !o1) continue; const ux = o0.x - a0.x, uy = o0.y - a0.y, vx = o1.x - a1.x, vy = o1.y - a1.y; sc += ux * vy - uy * vx; sd += ux * vx + uy * vy }
  return sd > 0 ? Math.atan2(sc, sd) : 0
}
// les araignées sont portées par la boule : corps et pattes suivent le nœud où elles se tiennent, et tournent avec
// la toile autour d'elles (sinon elles gardent toujours le même profil, comme une image collée sur un monde qui tourne)
function ride(W, before, after) {
  for (const a of Object.values(W.actors)) {
    const n = after ? after.get(a.cur) : W.g.byId[a.cur], b = before.get(a.cur); if (!n || !b) continue
    const th = spinAt(W.g, a.cur, before, after), co = Math.cos(th), si = Math.sin(th)
    if (n.x === b.x && n.y === b.y && !th) continue
    const mv = q => { const x = q.x - b.x, y = q.y - b.y; return { ...q, x: n.x + x * co - y * si, y: n.y + x * si + y * co } }
    const sp = a.sp, q = mv(sp); sp.x = q.x; sp.y = q.y; sp.h += th; if (sp.abd !== undefined) sp.abd += th; if (sp.hTarget != null) sp.hTarget += th
    for (const L of sp.legs) for (const k of ['foot', 'from', 'to', 'placed']) if (L[k]) L[k] = mv(L[k])
  }
}
// pendant que la boule tourne, l'araignée (dessinée à l'arrivée) part tournée à l'envers et revient avec la toile
const spinWrap = (W, X, id, svg, kt4, dur) => {
  if (!X.turn) return svg; const B = X.turn.B.get(id); if (!B) return svg
  const dA = -spinAt(W.g, id, X.turn.A, X.turn.B) * 180 / Math.PI, dM = -spinAt(W.g, id, X.turn.M, X.turn.B) * 180 / Math.PI
  if (Math.abs(dA) < .5 && Math.abs(dM) < .5) return svg
  const c = `${f1(B.x)} ${f1(B.y)}`, vals = `${dA.toFixed(1)} ${c};${dM.toFixed(1)} ${c};0 ${c}` + (kt4 ? `;0 ${c}` : '')
  return `<g><animateTransform attributeName="transform" type="rotate" values="${vals}" ${kt4 ? `keyTimes="${kt4}" dur="${dur}"` : `dur="${X.turn.T.toFixed(2)}s"`} fill="freeze"/>${svg}</g>`
}

/* ---------------- les vraies relations entre fichiers : qui importe qui ---------------- */
const CODE_EXT = /\.(py|pyw|js|jsx|mjs|cjs|ts|tsx|lua|md)$/i
export const readsImports = p => CODE_EXT.test(p || '')
const JS_EXT = ['', '.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs', '.json', '/index.ts', '/index.tsx', '/index.js', '/index.jsx']
function joinPath(dir, rel) {
  const out = dir ? dir.split('/') : []
  for (const part of rel.split('/')) { if (!part || part === '.') continue; if (part === '..') out.pop(); else out.push(part) }
  return out.join('/')
}
// les fichiers qu'un fichier utilise, parmi ceux du projet (all : ensemble des chemins ; byBase : nom de fichier → chemins)
export function importsOf(path, text, all, byBase) {
  const dir = path.includes('/') ? path.slice(0, path.lastIndexOf('/')) : '', found = new Set(), src = String(text || '').slice(0, 200000)
  const add = p => { if (p && p !== path && all.has(p)) found.add(p) }
  // un module par son nom seul : on préfère celui qui est dans le même dossier de premier niveau
  const byName = (name, ext) => { const list = byBase.get(name + ext) || []; if (!list.length) return; const top = path.split('/')[0]; add(list.find(p => p.split('/')[0] === top) || list[0]) }
  if (/\.(py|pyw)$/i.test(path)) {
    for (const m of src.matchAll(/^[ \t]*(?:from[ \t]+(\.*[\w.]*)[ \t]+import[ \t]+\(?([\w*, \t]+)|import[ \t]+([\w., \t]+))/gm)) {
      const mods = m[3] ? m[3].split(',').map(s => s.trim().split(/\s+as\s+/)[0]) : [m[1]]
      for (const mod of mods) {
        if (!mod) continue
        const dots = (mod.match(/^\.+/) || [''])[0].length, rest = mod.slice(dots).replace(/\./g, '/')
        let base = ''
        if (dots) { const parts = dir ? dir.split('/') : []; base = parts.slice(0, Math.max(0, parts.length - (dots - 1))).join('/') }
        const p = rest ? (base ? base + '/' + rest : rest) : base
        const before = found.size
        ;[p + '.py', p + '/__init__.py'].forEach(add)
        if (m[2]) m[2].split(',').map(s => s.trim().split(/\s+as\s+/)[0]).filter(s => s && s !== '*').forEach(nm => add((p ? p + '/' : '') + nm + '.py'))
        if (found.size === before && !dots && rest) { [...all].filter(f => f.endsWith('/' + rest + '.py')).slice(0, 1).forEach(add); if (found.size === before) byName(rest.split('/').pop(), '.py') }
      }
    }
  } else if (/\.(js|jsx|mjs|cjs|ts|tsx)$/i.test(path)) {
    for (const m of src.matchAll(/(?:\bfrom\s*|\bimport\s*\(\s*|\brequire\s*\(\s*|^\s*import\s+)['"]([^'"\n]+)['"]/gm)) {
      const spec = m[1]; if (!/^(\.{1,2}\/|@\/)/.test(spec)) continue
      const p = spec.startsWith('@/') ? joinPath('src', spec.slice(2)) : joinPath(dir, spec)
      for (const ext of JS_EXT) if (all.has(p + ext)) { add(p + ext); break }
    }
  } else if (/\.lua$/i.test(path)) {
    for (const m of src.matchAll(/require\s*\(?\s*['"]([\w./-]+)['"]/g)) { const p = m[1].replace(/\./g, '/'); const before = found.size; add(p + '.lua'); add(joinPath(dir, p) + '.lua'); if (found.size === before) byName(p.split('/').pop(), '.lua') }
  } else if (/\.md$/i.test(path)) {
    for (const m of src.matchAll(/\]\(([^)#\s]+)/g)) { const spec = decodeURI(m[1]); if (/^[a-z]+:/i.test(spec)) continue; add(spec.startsWith('/') ? spec.slice(1) : joinPath(dir, spec)) }
  }
  return [...found].slice(0, 15)
}
/* ---------------- une vraie boule : simulation de forces en 3D, comme Graphify ---------------- */
// les nœuds se repoussent, les fils les attirent, une gravité garde l'ensemble rond ; puis on remplit le volume
// (plein au centre comme sur la courbure) sans tout lisser : quelques dossiers peuvent dépasser
function force3D(g) {
  const N = g.nodes, n = N.length; if (!n) return
  const idx = new Map(N.map((o, i) => [o.id, i])), s = 100 * Math.cbrt(4.19 / Math.max(8, n)), R = rng(17), C = Math.max(1, g.comms.length)
  // départ : chaque communauté autour de sa direction, un peu de hasard
  const dirs = g.comms.map((c, k) => { const y = 1 - 2 * (k + .5) / C, r = Math.sqrt(1 - y * y), a = k * 2.39996; return { x: Math.cos(a) * r, y, z: Math.sin(a) * r } })
  const P = N.map(o => { const d = dirs[o.comm] || { x: 0, y: 0, z: 0 }; return { x: d.x * 50 + (R() - .5) * 60, y: d.y * 50 + (R() - .5) * 60, z: d.z * 50 + (R() - .5) * 60, vx: 0, vy: 0, vz: 0 } })
  const E = g.edges.map(e => [idx.get(e.a), idx.get(e.b), e.kind === 'dep' ? 1.5 : 1]).filter(e => e[0] !== undefined && e[1] !== undefined)
  const deg = N.map(o => Math.max(1, g.adj[o.id].length)), CELL = s * 2.4, iters = n > 700 ? 160 : 220
  for (let it = 0; it < iters; it++) {
    const cool = 1 - it / iters, grid = new Map()
    P.forEach((p, i) => { const k = Math.floor(p.x / CELL) + ',' + Math.floor(p.y / CELL) + ',' + Math.floor(p.z / CELL); (grid.get(k) || grid.set(k, []).get(k)).push(i) })
    P.forEach((p, i) => {
      const cx = Math.floor(p.x / CELL), cy = Math.floor(p.y / CELL), cz = Math.floor(p.z / CELL)
      for (let dx = -1; dx <= 1; dx++) for (let dy = -1; dy <= 1; dy++) for (let dz = -1; dz <= 1; dz++) {
        const arr = grid.get((cx + dx) + ',' + (cy + dy) + ',' + (cz + dz)); if (!arr) continue
        for (const j of arr) { if (j <= i) continue; const q = P[j]; let ex = p.x - q.x, ey = p.y - q.y, ez = p.z - q.z; const d2 = ex * ex + ey * ey + ez * ez + .01; if (d2 > CELL * CELL) continue; const f = s * s * .5 / d2; ex *= f; ey *= f; ez *= f; p.vx += ex; p.vy += ey; p.vz += ez; q.vx -= ex; q.vy -= ey; q.vz -= ez }
      }
    })
    for (const [i, j, w] of E) { const p = P[i], q = P[j]; let ex = q.x - p.x, ey = q.y - p.y, ez = q.z - p.z; const d = Math.hypot(ex, ey, ez) || .01, f = (d - s * w) / d * .08 / Math.sqrt(Math.min(deg[i], deg[j])); ex *= f; ey *= f; ez *= f; p.vx += ex; p.vy += ey; p.vz += ez; q.vx -= ex; q.vy -= ey; q.vz -= ez }
    P.forEach(p => { p.vx -= p.x * .012; p.vy -= p.y * .012; p.vz -= p.z * .012; const sp = Math.hypot(p.vx, p.vy, p.vz), mx = 12 * cool + .5; if (sp > mx) { p.vx *= mx / sp; p.vy *= mx / sp; p.vz *= mx / sp } p.x += p.vx; p.y += p.vy; p.z += p.vz; p.vx *= .55; p.vy *= .55; p.vz *= .55 })
  }
  // la taille : 92 % des nœuds dans la boule de rayon 96 ; le remplissage : moitié rayon réel, moitié rayon « plein »
  const rs = P.map(p => Math.hypot(p.x, p.y, p.z)), sorted = [...rs].sort((a, b) => a - b), k92 = sorted[Math.floor(n * .92)] || 1, sc = 96 / k92
  const order = rs.map((r, i) => i).sort((a, b) => rs[a] - rs[b])
  order.forEach((i, k) => { const p = P[i], r = rs[i] * sc, full = 98 * Math.cbrt((k + .5) / n), r2 = r * .5 + full * .5, u = rs[i] || 1; N[i].p3 = { x: p.x / u * r2, y: p.y / u * r2, z: p.z / u * r2 } })
}

export function sphereInit(W) {
  const g = W.g
  g.nodes.forEach(n => { n.x2 = n.x; n.y2 = n.y })
  g.straight = true; g.W = W
  // une vraie boule physique ; la disposition « à aire égale » ne sert plus que si la simulation échoue
  try { force3D(g) } catch { sphereLayout(g) }
  if (g.nodes.some(o => !o.p3 || !Number.isFinite(o.p3.x))) sphereLayout(g)
  W.sph = { F: { x: 0, y: 0, z: 0 }, boost: new Set(), yaw: .4, pitch: .28, R: 150 + 14 * Math.sqrt(g.nodes.length), D: 330, lastBolt: 0, dens: clamp(Math.sqrt(140 / Math.max(140, g.nodes.length)), .38, 1), edens: clamp(Math.sqrt(300 / Math.max(300, g.edges.length)), .3, 1) }
  const before = new Map(g.nodes.map(n => [n.id, { x: n.x, y: n.y }])), home = g.byId[W.actors.main.cur]
  if (home && home.p3) { W.sph.F = { ...home.p3 }; W.sph.boost = new Set([home.id]) }
  applyPlace(W, placeAll(W, W.sph.yaw, W.sph.pitch)); buildGeometry(g); g.orbs = []
  ride(W, before)
  for (const a of Object.values(W.actors)) { const n = g.byId[a.cur]; if (n) { a.sp.x = n.x; a.sp.y = n.y; a.sp.setMorph(a.sp.m) } }
  W.cam = { x: W.sp.x, y: W.sp.y }
}
// un nouveau fichier : il se pose tout près de son dossier dans la boule
function place3(W, n, anchor) {
  const a = anchor && anchor.p3 ? anchor.p3 : { x: 0, y: 0, z: 0 }, R = rng(hash(n.id)), p = { x: a.x + (R() - .5) * 16, y: a.y + (R() - .5) * 16, z: a.z + (R() - .5) * 16 }, d = Math.hypot(p.x, p.y, p.z)
  if (d > 97) { p.x *= 97 / d; p.y *= 97 / d; p.z *= 97 / d }
  n.x2 = n.x; n.y2 = n.y; n.p3 = p; const q = proj3(W, p, W.sph.yaw, W.sph.pitch); n.x = q.x; n.y = q.y; n.zd = q.zd; n.k = q.k
}
// la boule se tourne vers ce que fait l'araignée : orientation visée pour un nœud
// la rotation d'un clip : trois positions (départ, milieu, arrivée), interpolées en ligne droite par morceaux,
// exactement comme le fera l'animation SVG (keyTimes) : l'araignée reste sur son nœud
function turnPlan(W, to, T) {
  const S = W.sph, y0 = S.yaw, p0 = S.pitch, F0 = S.F, F1 = to.F || F0
  return { T, A: placeAll(W, y0, p0, F0), M: placeAll(W, (y0 + to.yaw) / 2, (p0 + to.pitch) / 2, lerp3(F0, F1, .5)), B: placeAll(W, to.yaw, to.pitch, F1), to }
}
// ce qui passe au premier plan : le dossier de l'araignée, sa cible et les dossiers du chemin entre les deux
function boostFor(W, a, target) { const B = new Set([a.cur]); if (target) { B.add(target.id); bfs(W.g, a.cur, target.id).forEach(id => B.add(id)) } return B }
function turnAt(plan, u) {
  const P = new Map(), A = plan.A, M = plan.M, B = plan.B
  A.forEach((a, id) => { const m = M.get(id), b = B.get(id); const v = u < .5 ? u * 2 : u * 2 - 1, p = u < .5 ? a : m, q = u < .5 ? m : b; P.set(id, { x: p.x + (q.x - p.x) * v, y: p.y + (q.y - p.y) * v, zd: p.zd + (q.zd - p.zd) * v, k: p.k + (q.k - p.k) * v }) })
  return P
}

/* ---------------- la foudre : un éclair qui part de l'araignée et suit les fils ---------------- */
function boltPlan(W, src) {
  const g = W.g; if (!src || !src.p3) return null
  const d = new Map([[src.id, 0]]), prev = new Map(), done = new Set(), heap = [[0, src.id]]
  while (heap.length) {
    let bi = 0; for (let i = 1; i < heap.length; i++) if (heap[i][0] < heap[bi][0]) bi = i
    const [du, u] = heap[bi]; heap[bi] = heap[heap.length - 1]; heap.pop()
    if (done.has(u)) continue; done.add(u)
    for (const v of g.adj[u]) { const ei = g.edgeIdx[u + '|' + v], e = g.edges[ei], o = g.byId[v]; if (!e || e.broken || e.hidden || o.gone || !o.p3 || g.adj[v].length > (g.hubDeg || 1e9)) continue; const A = g.byId[u].p3, B = o.p3, nd = du + Math.hypot(A.x - B.x, A.y - B.y, A.z - B.z); if (nd < (d.has(v) ? d.get(v) : Infinity)) { d.set(v, nd); prev.set(v, u); heap.push([nd, v]) } }
    if (heap.length > g.nodes.length * 6) break
  }
  let max = 1; d.forEach(v => { if (v > max) max = v })
  const T = new Map(); d.forEach((v, k) => T.set(k, v / max * 2.4))
  return { src: src.id, T, prev }
}
function boltSVG(W, B, t0, T, inBox, lod) {
  const g = W.g, o = [], left = T - t0 - .05; if (left < .3) return ''
  const R = rng(hash(B.src) + 7), RS = W.sph.R / 100, s = g.byId[B.src]
  // les branches de l'éclair : les fils de l'arbre des plus courts chemins, dans l'ordre où le courant les parcourt
  const br = []
  B.prev.forEach((u, v) => { const a = g.byId[u], b = g.byId[v], ta = B.T.get(u), tb = B.T.get(v); if (tb > left || (!inBox(a) && !inBox(b))) return; br.push({ a, b, ta, tb }) })
  br.sort((p, q) => p.ta - q.ta)
  const cap = lod >= 3 ? 10 : lod >= 1 ? 22 : 36
  let defs = '', uses = ''
  br.slice(0, cap).forEach((e, i) => {
    const dx = e.b.x - e.a.x, dy = e.b.y - e.a.y, L = Math.hypot(dx, dy) || 1, nx = -dy / L, ny = dx / L, pts = [e.a]
    for (let k = 1; k < 5; k++) { const u = k / 5, j = (R() - .5) * 4.5 * Math.min(RS, 3); pts.push({ x: e.a.x + dx * u + nx * j, y: e.a.y + dy * u + ny * j }) }
    pts.push(e.b)
    const len = Math.round(pts.reduce((sum, p, k) => k ? sum + Math.hypot(p.x - pts[k - 1].x, p.y - pts[k - 1].y) : 0, 0) + 1), b0 = (t0 + e.ta).toFixed(2), d0 = Math.max(.05, e.tb - e.ta).toFixed(2), id = 'bz' + i
    defs += `<path id="${id}" d="${relPath([pts])}" stroke-dasharray="${len} ${len}" stroke-dashoffset="${len}"><animate attributeName="stroke-dashoffset" values="${len};0" begin="${b0}s" dur="${d0}s" fill="freeze"/></path>`
    uses += `<use href="#${id}"><animate attributeName="opacity" values="1;0" begin="${(t0 + e.tb + .15).toFixed(2)}s" dur=".9s" fill="freeze"/></use>`
  })
  o.push(`<defs>${defs}</defs><g fill="none" stroke="#e8fbff" stroke-width="${f1(.7 * Math.min(RS, 3))}" stroke-linecap="round" stroke-linejoin="round" filter="url(#glow)">${uses}</g>`)
  // chaque nébuleuse atteinte s'illumine
  let fl = ''
  ;[...B.T.entries()].filter(([id, t]) => t < left && inBox(g.byId[id])).sort((p, q) => p[1] - q[1]).slice(0, lod >= 3 ? 10 : 30).forEach(([id, t]) => { const n = g.byId[id]; fl += `<circle cx="${f1(n.x)}" cy="${f1(n.y)}" r="${f1(6 * RS * (n.k || 1))}" fill="url(#nw)" opacity="0"><animate attributeName="opacity" values="0;.9;0" begin="${(t0 + t).toFixed(2)}s" dur=".7s" fill="freeze"/></circle>` })
  o.push(fl)
  // l'éclair blanc au départ, et la boule qui s'illumine un instant
  o.push(`<circle cx="${f1(s.x)}" cy="${f1(s.y)}" r="4" fill="url(#nw)" opacity="0"><animate attributeName="r" values="4;${f1(70 * RS)}" begin="${t0.toFixed(2)}s" dur=".35s" fill="freeze"/><animate attributeName="opacity" values="0;.85;0" begin="${t0.toFixed(2)}s" dur=".4s" fill="freeze"/></circle>`)
  return o.join('')
}


// en sphère, avant l'action : un court clip où la boule se tourne vers la cible, l'araignée roulant avec elle
// (séparé du clip de l'action : chacun reste sous la taille que le panneau accepte)
export function turnClip(W, ev) {
  if (!W.sph || !ev || ev.tool === 'Leave' || ev.tool === 'Mood') return null
  const g = W.g, a = actorFor(W, ev), sp = a.sp
  let target = null
  if (ev.tool === 'Bash') target = g.byId['::terminal']
  else if (ev.tool === 'Repair') { const e = g.edges.find(e => e.broken && !e.hidden); if (e) target = g.byId[e.a].gone ? g.byId[e.b] : g.byId[e.a] }
  else if (ev.path) target = nodeForPath(g, ev.path)
  else if (ev.tool === 'Grep' && Array.isArray(ev.targets) && ev.targets.length) target = nodeForPath(g, ev.targets[0])
  // la caméra glisse jusqu'à la cible (la boule ne tourne pas) : son chemin passe au premier plan
  const fo = target || g.byId[a.cur]; if (!fo || !fo.p3 || W.free) return null
  const F0 = W.sph.F, gap = Math.hypot(fo.p3.x - F0.x, fo.p3.y - F0.y, fo.p3.z - F0.z), boost = boostFor(W, a, fo)
  const same = [...boost].every(id => W.sph.boost.has(id))
  if (gap < 6 && same) return null
  W.sph.boost = boost
  const to = { yaw: W.sph.yaw, pitch: W.sph.pitch, F: { ...fo.p3 } }
  const turn = turnPlan(W, to, clamp(.5 + gap / 160, .6, 1.4)), frames = [], DT = 1 / 60, rec = Math.round(60 / FPS)
  W.turning = true
  let last = turn.A, step = 0
  for (let t = 0; t < turn.T; t += DT) {
    const P = turnAt(turn, Math.min(1, (t + DT) / turn.T))
    for (const o of Object.values(W.actors)) { const q = P.get(o.cur); if (!q) continue; const n = g.byId[o.cur]; n.x = q.x; n.y = q.y }
    ride(W, last, P); last = P
    sp.vx = sp.vy = 0; stepPhysics(W, DT)
    if (step++ % rec === 0) { W.cam.x += (sp.x - W.cam.x) * .25; W.cam.y += (sp.y - 8 - a.hang * TILT * .6 - W.cam.y) * .25; frames.push({ P: sp.pose(W.t, optsFor(a, null, 0, W.env.depth)), cam: { ...W.cam }, o: {}, tAct: -1, hang: a.hang }) }
  }
  applyPlace(W, turn.B); buildGeometry(g); W.sph.yaw = turn.to.yaw; W.sph.pitch = turn.to.pitch; if (turn.to.F) W.sph.F = turn.to.F; W.turning = false
  const X = { total: frames.length / FPS, walkDur: frames.length / FPS, act: { tool: 'idle' }, target: null, targets: [], plucks: [], edgeNear: [], S: SKINS[W.skin], actor: a, sounds: [], turn, others: Object.values(W.actors).filter(o => o !== a).map(o => ({ a: o, P: o.sp.pose(W.t, optsFor(o, null, 0, W.env.depth)) })) }
  return renderClip(W, { tool: 'idle' }, frames, X)
}

/* ---------------- fabrication d'un clip ---------------- */
// ev : { tool: 'Read'|'Edit'|'Write'|'Grep'|'Bash'|'Web'|'Mood'|'Delete'|'Repair'|'Leave', path?, targets?, label, lines?,
//        actor?: 'main' | id d'un bébé, ok?: bool (Mood), big?: bool, pace?: rythme (1 = normal) }
// 20 images par seconde : assez pour que la marche se lise patte après patte (à 12, l'araignée semblait glisser)
// la limite du panneau est 131 072 caractères : on garde une petite marge (le panneau réécrit la taille du dessin)
const FPS = 20, MAX_CHARS = 128500
const ACT_DUR = { Read: 2.6, Edit: 3.3, Write: 3.3, Grep: 1.9, Bash: 2.6, Web: 3.4, Delete: 1.9, Repair: 2.8 }
export function makeClip(W, ev) {
  const g = W.g, S = SKINS[W.skin], a = actorFor(W, ev), sp = a.sp, m = sp.m, pace = clamp(ev.pace || 1, .6, 2)
  // la caméra suit l'araignée qui travaille (un agent qui arrive compris)
  if (ev.tool !== 'Leave' && ev.tool !== 'Mood') W.camId = a.id
  let target = null, targets = [], edge = null, at = null
  if (ev.tool === 'Bash') target = g.byId['::terminal']
  else if (ev.tool === 'Repair') {
    const i = g.edges.findIndex(e => e.broken && !e.hidden)
    if (i >= 0) {
      edge = i; const e = g.edges[i], A = g.byId[e.a], B = g.byId[e.b]
      target = A.gone ? B : A
      at = e.broken.kind === 'stub' ? lerp2(target, A.gone ? A : B, .3) : e.pts[Math.floor(e.pts.length / 2)]
    }
  } else if (ev.path) target = nodeForPath(g, ev.path)
  if (ev.tool === 'Grep') targets = (Array.isArray(ev.targets) ? ev.targets : []).map(p => nodeForPath(g, p)).filter(Boolean).slice(0, 5)
  if (ev.tool === 'Mood' && !ev.ok) {
    const term = g.byId['::terminal'], i = g.edges.findIndex(e => !e.broken && !e.hidden && (e.a === term.id || e.b === term.id) && !g.byId[e.a].gone && !g.byId[e.b].gone)
    if (i >= 0) edge = i
  }
  const walkTo = ['Read', 'Edit', 'Write', 'Bash', 'Repair'].includes(ev.tool) ? target : null
  // une lecture parcourue en crawler : l'araignée ne s'attarde pas sur le fichier, elle saute ensuite sur la page
  const actDur = ev.crawl ? .5 : ev.tool === 'Mood' ? (ev.ok ? (ev.big ? 2.6 : 1.7) : 2.3) : (ACT_DUR[ev.tool] || 1.5) / Math.sqrt(pace)
  const act = { tool: ev.tool, n: target, dur: actDur, ok: ev.ok, at }
  const frames = [], DT = 1 / 60, rec = Math.round(60 / FPS), edgeNear = new Set(), sounds = []
  let step = 0
  const camTo = ev.tool === 'Delete' && target ? target : null
  const recFrame = (tAct) => {
    const o = optsFor(a, tAct >= 0 ? act : null, tAct, W.env.depth)
    const P = sp.pose(W.t, o)
    const fx = camTo ? camTo.x : sp.x, fy = camTo ? camTo.y : sp.y - 8 - a.hang * TILT * .6
    W.cam.x += (fx - W.cam.x) * .25; W.cam.y += (fy - W.cam.y) * .25
    frames.push({ P, cam: { ...W.cam }, o, tAct, hang: a.hang })
    g.edges.forEach((e, i) => { if (!e.hidden && dist(e.c, sp) < 70) edgeNear.add(i) })
  }
  const turn = null
  // une cible injoignable par la soie : à portée de pattes, elle les étire jusqu'à elle et s'y hisse ; plus loin, elle
  // y bondit (jamais de pattes tendues à travers toute la toile)
  if (walkTo && walkTo.id !== a.cur && bfs(g, a.cur, walkTo.id).length <= 1) {
    const x0 = sp.x, y0 = sp.y, L = Math.hypot(walkTo.x - x0, walkTo.y - y0), ux = (walkTo.x - x0) / (L || 1), uy = (walkTo.y - y0) / (L || 1), span = L < m.legs[0] * 1.5
    const grabAt = s => { const q = { x: walkTo.x + -uy * s * m.cw * .6, y: walkTo.y + ux * s * m.cw * .6 }; return snapOn(g, q, m.legs[0] * .4) || q }
    const grab = { 1: grabAt(1), [-1]: grabAt(-1) }, T = span ? spanTime(L) : leapTime(L)
    for (let t = 0; t < T; t += DT) {
      const u = Math.min(1, (t + DT) / T), q = span ? spanAt({ x: x0, y: y0 }, grab, u, m, ux, uy) : leapAt({ x: x0, y: y0 }, walkTo, u, m)
      sp.h += wrap(Math.atan2(uy, ux) - sp.h) * Math.min(1, DT * 10)
      const px = sp.x, py = sp.y; sp.x = q.x; sp.y = q.y; sp.vx = (sp.x - px) / DT; sp.vy = (sp.y - py) / DT
      a.leap = span ? { lift: q.lift, over: q.over, stretch: SPAN_STRETCH } : { lift: q.lift, tuck: q.tuck }
      stepPhysics(W, DT); if (step++ % rec === 0) recFrame(-1)
    }
    a.leap = null; a.cur = walkTo.id; sp.vx = sp.vy = 0; sounds.push({ at: frames.length / FPS, name: 'pluck' })
  }
  // descente : le bébé qui arrive, ou l'araignée qui se réveille
  let descDur = 0
  if (a.hang > .5 && ev.tool !== 'Leave') {
    const h0 = a.hang, T = a.baby ? 1.3 : 1.1
    sounds.push({ at: 0, name: 'silk' })
    for (let t = 0; t < T; t += DT) { a.hang = h0 * (1 - ease(t / T)); stepPhysics(W, DT); if (step++ % rec === 0) recFrame(-1) }
    a.hang = 0; descDur = T; if (a.id === 'main') W.sleeping = false
  }
  // marche
  let rt = null, stop = 0
  if (walkTo && walkTo.id !== a.cur) {
    const path = bfs(g, a.cur, walkTo.id)
    if (path.length > 1) { rt = route(g, path); stop = ev.tool === 'Edit' || ev.tool === 'Write' ? m.cl * .48 + m.al * .9 : ev.tool === 'Bash' ? m.cl * .5 + m.palp * .8 + 9 : ev.tool === 'Repair' ? m.cl * .5 : m.cl * .5 + m.palp * .85 }
  }
  const walkLen = rt ? Math.max(0, rt.total - stop) : 0, speed = Math.max(110, walkLen / (W.sph ? 2.2 : 2.6)) * pace
  let d = 0, wspd = 0
  if (rt) {
    sp.hTarget = null
    while (d < walkLen - .01) {
      const remain = walkLen - d, tgt = speed * clamp(remain / 28, .2, 1); wspd += (tgt - wspd) * Math.min(1, DT * 5)
      const px = sp.x, py = sp.y; d = Math.min(walkLen, d + wspd * DT); const p = along(rt, d); sp.x = p.x; sp.y = p.y
      sp.vx = (sp.x - px) / DT; sp.vy = (sp.y - py) / DT; if (Math.hypot(sp.vx, sp.vy) > 4) sp.h += wrap(Math.atan2(sp.vy, sp.vx) - sp.h) * Math.min(1, DT * 7)
      stepPhysics(W, DT); if (step++ % rec === 0) recFrame(-1)
      if (step > 60 * 7) break
    }
    const now = Date.now()
    rt.edgesUsed.forEach(i => { g.edges[i].trail = 1; g.edges[i].trailAt = now })
    a.cur = walkTo.id
    sp.vx = sp.vy = 0
    for (let k = 0; k < 15; k++) { stepPhysics(W, DT); if (step++ % rec === 0) recFrame(-1) }
  }
  // le dossier est déjà pris : elle va se poser sur son propre fil, tête vers l'étoile
  if (walkTo && walkTo.id === a.cur) {
    const q = restSpot(W, a)
    if (q && !q.center && dist(q, sp) > 2) {
      const x0 = sp.x, y0 = sp.y, T = .45
      for (let t = 0; t < T; t += DT) { const u = ease(Math.min(1, (t + DT) / T)), px = sp.x, py = sp.y; sp.x = lerp(x0, q.x, u); sp.y = lerp(y0, q.y, u); sp.h += wrap(q.face - sp.h) * Math.min(1, DT * 8); sp.vx = (sp.x - px) / DT; sp.vy = (sp.y - py) / DT; stepPhysics(W, DT); if (step++ % rec === 0) recFrame(-1) }
      sp.vx = sp.vy = 0; for (let k = 0; k < 9; k++) { stepPhysics(W, DT); if (step++ % rec === 0) recFrame(-1) }
    }
  }
  const actStart = frames.length / FPS
  // action
  const X = { walkDur: actStart, act, target, targets, plucks: [], S, actor: a, edge, sounds, pace }
  X.turn = turn
  // la foudre part de l'endroit où l'araignée commence son action (pas plus d'une fois toutes les 5 s)
  if (W.sph && !['Leave', 'Mood', 'Delete'].includes(ev.tool) && Date.now() - W.sph.lastBolt > 5000) { X.bolt = boltPlan(W, g.byId[a.cur]); X.boltT = actStart + .15; if (X.bolt) W.sph.lastBolt = Date.now() }
  if (ev.tool === 'Leave') {
    // le bébé remonte sur son fil et disparaît
    sounds.push({ at: actStart, name: 'silk' })
    for (let t = 0; t < 1.8; t += DT) { a.hang = 90 * ease(t / 1.8); stepPhysics(W, DT); if (step++ % rec === 0) recFrame(-1) }
    X.fadeOut = actStart + 1.2
  } else {
    const t0 = W.t
    if (ev.tool === 'Edit' || ev.tool === 'Write' || ev.tool === 'Repair') sp.hTarget = sp.h + Math.PI
    const h0 = sp.h
    let k = 0
    while (W.t - t0 < actDur) {
      const ta = W.t - t0
      if (ev.tool === 'Grep') { const kk = Math.floor((ta - .05) / .5); if (ta > .05 && kk < 3 && kk >= k) { k = kk + 1; const tip = pluckTip(sp); W.waves.push({ ring: true, x: tip.x, y: tip.y, t0: W.t, v: 120, w: 1.6, s2: 60, tau: .7 }); X.plucks.push({ x: tip.x, y: tip.y, t: actStart + ta }); sounds.push({ at: actStart + ta, name: 'pluck' }) } }
      if (ev.tool === 'Mood' && ev.ok) sp.hTarget = h0 + Math.sin(ta * 4) * .5
      sp.vx = sp.vy = 0
      stepPhysics(W, DT)
      if (step++ % rec === 0) recFrame(ta)
    }
    sp.hTarget = null
  }
  // conséquences sur la toile
  const sound = { Read: ['read', .5], Edit: ['silk', .9], Write: ['silk', .9], Bash: ['hum', .3], Web: ['web', .6], Repair: ['silk', .9] }[ev.tool]
  if (sound) sounds.push({ at: actStart + sound[1], name: sound[0] })
  if (ev.tool === 'Mood') sounds.push({ at: actStart + .15, name: ev.ok ? 'success' : 'fail' })
  if (ev.tool === 'Mood' && !ev.ok && edge !== null) { X.snapT = actStart + 1.1; X.snapEdges = [edge]; g.edges[edge].broken = { kind: 'snap' }; sounds.push({ at: X.snapT, name: 'snap' }) }
  if (ev.tool === 'Delete' && target) {
    X.snapT = actStart + .35; X.falling = target; X.snapEdges = []
    g.adj[target.id].forEach(v => { const i = g.edgeIdx[target.id + '|' + v], e = g.edges[i]; if (e && !e.hidden && !e.broken) { e.broken = { kind: 'stub', alive: v }; X.snapEdges.push(i) } })
    target.gone = true; sounds.push({ at: X.snapT, name: 'snap' })
  }
  if (ev.tool === 'Repair' && edge !== null) {
    const e = g.edges[edge]; X.repairEdge = edge; X.repairStub = e.broken.kind === 'stub'; X.repairT0 = actStart + .9; X.repairT1 = actStart + actDur - .25
    if (X.repairStub) e.hidden = true; e.broken = null
  }
  if (ev.tool === 'Grep') targets.forEach(n => n.visited = true)
  if (target && (ev.tool === 'Edit' || ev.tool === 'Write')) { target.mod = true; target.wrap = Math.min(3, (target.wrap || 0) + 1) }
  if (target && ev.tool !== 'Delete') target.visited = true
  X.total = frames.length / FPS
  X.edgeNear = [...edgeNear].filter(i => !g.edges[i].broken && i !== X.repairEdge && !(X.snapEdges || []).includes(i)).slice(0, 10)
  X.others = Object.values(W.actors).filter(o => o !== a).map(o => ({ a: o, P: o.sp.pose(W.t, optsFor(o, null, 0, W.env.depth)) }))
  if (ev.tool === 'Leave' && a.id !== 'main') { delete W.actors[a.id]; if (W.camId === a.id) W.camId = null }
  return renderClip(W, ev, frames, X)
}
// l'araignée remonte au centre de la toile, se suspend à un fil et dort
export function sleepClip(W) {
  const a = W.actors.main, sp = a.sp, g = W.g, hub = hubNode(g), frames = [], DT = 1 / 60, rec = Math.round(60 / FPS)
  let step = 0
  const recFrame = () => { const o = optsFor(a, null, 0, W.env.depth), P = sp.pose(W.t, o); W.cam.x += (sp.x - W.cam.x) * .25; W.cam.y += (sp.y - 8 - a.hang * TILT * .6 - W.cam.y) * .25; frames.push({ P, cam: { ...W.cam }, o, tAct: -1, hang: a.hang }) }
  if (hub.id !== a.cur) {
    const path = bfs(g, a.cur, hub.id)
    if (path.length > 1) {
      const rt = route(g, path), speed = 70; let d = 0
      while (d < rt.total - .01) { const px = sp.x, py = sp.y; d = Math.min(rt.total, d + speed * DT); const p = along(rt, d); sp.x = p.x; sp.y = p.y; sp.vx = (sp.x - px) / DT; sp.vy = (sp.y - py) / DT; if (Math.hypot(sp.vx, sp.vy) > 4) sp.h += wrap(Math.atan2(sp.vy, sp.vx) - sp.h) * Math.min(1, DT * 7); stepPhysics(W, DT); if (step++ % rec === 0) recFrame(); if (step > 60 * 8) break }
      a.cur = hub.id
    }
  }
  sp.vx = sp.vy = 0
  for (let t = 0; t < 1.6; t += DT) { a.hang = 26 * ease(t / 1.6); stepPhysics(W, DT); if (step++ % rec === 0) recFrame() }
  a.hang = 26; W.sleeping = true
  const X = { total: frames.length / FPS, walkDur: frames.length / FPS, act: { tool: 'idle' }, target: null, targets: [], plucks: [], edgeNear: [], S: SKINS[W.skin], actor: a, sounds: [], sleep: true, others: Object.values(W.actors).filter(o => o !== a).map(o => ({ a: o, P: o.sp.pose(W.t, optsFor(o, null, 0, W.env.depth)) })) }
  return renderClip(W, { tool: 'Sleep', label: 'Sleep', lines: [] }, frames, X)
}
// image fixe quand Claude ne fait rien : l'araignée respire (ou dort sur son fil)
export function idleClip(W) {
  const a = W.actors.main, frames = []
  // en sphère, au repos : la boule reste immobile ; si la caméra n'est plus sur l'araignée suivie, elle y revient en
  // glissant ; puis la foudre part de l'araignée
  if (W.sph && !W.sleeping) {
    const ca0 = camActor(W), hn = W.g.byId[ca0.cur], F0 = W.sph.F
    let turn = null
    if (!W.free && hn && hn.p3 && (Math.hypot(hn.p3.x - F0.x, hn.p3.y - F0.y, hn.p3.z - F0.z) > 6 || !W.sph.boost.has(hn.id))) {
      W.sph.boost = new Set([hn.id]); const to = { yaw: W.sph.yaw, pitch: W.sph.pitch, F: { ...hn.p3 } }; turn = turnPlan(W, to, 1.6)
      applyPlace(W, turn.B); ride(W, turn.A); buildGeometry(W.g); W.sph.F = to.F
    }
    // l'araignée revient se poser sur son dossier (elle y reste accrochée pendant que la boule tourne) : on la pose,
    // et le clip la fait glisser depuis l'endroit où elle était
    const home = restSpot(W, a), settle = home && Math.hypot(home.x - a.sp.x, home.y - a.sp.y) > .5 ? { x: home.x - a.sp.x, y: home.y - a.sp.y } : null
    if (settle) { const sp = a.sp; sp.x += settle.x; sp.y += settle.y; for (const L of sp.legs) for (const k of ['foot', 'from', 'to', 'placed']) if (L[k]) L[k] = { ...L[k], x: L[k].x + settle.x, y: L[k].y + settle.y } }
    stepPhysics(W, 1 / 60); const ca = camActor(W); W.cam = { x: ca.sp.x, y: ca.sp.y - 8 }
    frames.push({ P: a.sp.pose(W.t, optsFor(a, null, 0, W.env.depth)), cam: { ...W.cam }, o: {}, tAct: -1, hang: a.hang })
    const X = { total: 8, walkDur: 0, act: { tool: 'idle' }, target: null, targets: [], plucks: [], edgeNear: [], S: SKINS[W.skin], actor: a, sounds: [], sleep: false, turn, drift: true, settle, others: Object.values(W.actors).filter(o => o !== a).map(o => ({ a: o, P: o.sp.pose(W.t, optsFor(o, null, 0, W.env.depth)) })) }
    if (Date.now() - W.sph.lastBolt > 5000) { X.bolt = boltPlan(W, W.g.byId[a.cur]); X.boltT = 4.3; if (X.bolt) W.sph.lastBolt = Date.now() + 4300 }
    return renderClip(W, { tool: 'idle' }, frames, X)
  }
  for (let i = 0; i < 2; i++) { stepPhysics(W, 1 / 60); frames.push({ P: a.sp.pose(W.t, optsFor(a, null, 0, W.env.depth)), cam: { ...W.cam }, o: {}, tAct: -1, hang: a.hang }) }
  return renderClip(W, { tool: 'idle' }, frames, { total: .1, walkDur: 0, act: { tool: 'idle' }, target: null, targets: [], plucks: [], edgeNear: [], S: SKINS[W.skin], actor: a, sounds: [], sleep: W.sleeping, others: Object.values(W.actors).filter(o => o !== a).map(o => ({ a: o, P: o.sp.pose(W.t, optsFor(o, null, 0, W.env.depth)) })) })
}

/* ---------------- rendu SVG d'un clip ---------------- */
function vals(arr) { return arr.join(';') }
const ID_M = '1 0 0 0 0 0 1 0 0 0 0 0 1 0 0 0 0 0 1 0'
const RED_M = '1 .35 .35 0 .12 0 .22 0 0 0 0 0 .22 0 0 0 0 0 1 0'
const GREEN_M = '.35 0 0 0 0 .35 1 .35 0 .08 0 0 .4 0 0 0 0 0 1 0'
const qd = (a, c, b) => `M${f1(a.x)} ${f1(a.y)}Q${f1(c.x)} ${f1(c.y)} ${f1(b.x)} ${f1(b.y)}`
// la scène en sphère : un ciel, les fils (groupés par profondeur), les nébuleuses de l'arrière vers l'avant ;
// pendant la rotation, tout glisse entre les trois positions du plan (mêmes keyTimes que la simulation)
const nebR = (g, n) => n.kind === 'file' ? 7 * cocoonScale(n) : n.kind === 'dir' ? 12 : n.kind === 'concept' ? 10 : n.kind === 'term' ? 9 : n.kind === 'leaf' ? 3.2 : 4 + Math.min(4, g.adj[n.id].length * .4)
function sphereStage(W, frames, X, dur, kt, box, lod) {
  const g = W.g, S = W.sph, RS = S.R / 100, o = [], tr = X.turn && lod < 2 ? X.turn : null
  const inB = n => n.x > box[0] && n.x < box[2] && n.y > box[1] && n.y < box[3]
  const inA = n => { if (!tr) return false; const p = tr.A.get(n.id); return !!p && p.x > box[0] && p.x < box[2] && p.y > box[1] && p.y < box[3] }
  const TD = tr ? `dur="${tr.T.toFixed(2)}s"` : ''
  const mover = id => { if (!tr) return ''; const a = tr.A.get(id), m = tr.M.get(id), b = tr.B.get(id); if (!a || !m || !b) return ''; return `<animateTransform attributeName="transform" type="translate" values="${Math.round(a.x - b.x)} ${Math.round(a.y - b.y)};${Math.round(m.x - b.x)} ${Math.round(m.y - b.y)};0 0" ${TD} fill="freeze"/>` }
  // le ciel : des étoiles fixes, et un halo autour de la boule
  const R = rng(7); let stars = ''
  for (let k = 0; k < 70; k++) { const x = box[0] + R() * (box[2] - box[0]), y = box[1] + R() * (box[3] - box[1]); stars += `M${Math.round(x)} ${Math.round(y)}h.7v.7h-.7z` }
  o.push(`<path d="${stars}" fill="#e6e1ff" opacity=".45"/><circle r="${f1(S.R * 1.25)}" fill="url(#nhalo)"/>`)
  // les nébuleuses (un modèle par communauté, réutilisé), de l'arrière vers l'avant, avec leur nom si elles sont devant
  // sur un gros projet, on garde les nébuleuses de devant et les plus proches de la caméra (la taille du clip est limitée)
  const cEnd = frames.length ? frames[frames.length - 1].cam : W.cam, capN = lod >= 3 ? 60 : lod >= 1 ? 90 : tr ? 100 : 160
  let cand = g.nodes.filter(n => (!n.gone || X.falling === n) && (inB(n) || inA(n)))
  if (cand.length > capN) cand = cand.map(n => ({ n, s: (n.zd || 0) * 2 - Math.hypot(n.x - cEnd.x, n.y - cEnd.y) / 160 + (n === X.target || n.kind === 'term' ? 9 : 0) })).sort((p, q) => q.s - p.s).slice(0, capN).map(o => o.n)
  const used = new Set(), used8 = new Set(), list = cand.sort((p, q) => (p.zd || 0) - (q.zd || 0)), drawn = new Set(list)
  // les fils : pleins, colorés, tressés très fin (de petits bourrelets qui glissent le long du trait), ondulés ;
  // groupés par profondeur et par couleur ; chaque tracé est défini une fois et repris pour le fil et pour la torsade
  const groups = new Map(), at = (P, id) => P.get(id) || g.byId[id]
  // une courbe par fil, en coordonnées relatives (des nombres courts : le clip du panneau a une taille limitée)
  const wd = (e, p, q) => { const [c1, c2] = waveCubic(e, p, q), x = Math.round(p.x), y = Math.round(p.y); return `M${x} ${y}c${Math.round(c1.x) - x} ${Math.round(c1.y) - y} ${Math.round(c2.x) - x} ${Math.round(c2.y) - y} ${Math.round(q.x) - x} ${Math.round(q.y) - y}` }
  const wl0 = []
  g.edges.forEach(e => {
    if (e.hidden || e.broken) return; const a = g.byId[e.a], b = g.byId[e.b]; if (a.gone || b.gone || !(drawn.has(a) || drawn.has(b))) return
    // hors du cadre pendant tout le clip : inutile de l'écrire
    if (!tr && (Math.max(a.x, b.x) < box[0] || Math.min(a.x, b.x) > box[2] || Math.max(a.y, b.y) < box[1] || Math.min(a.y, b.y) > box[3])) return
    const d = ((a.zd || 0) + (b.zd || 0)) / 2, lvl = Math.min(3, Math.floor(d * 4)), hot = !!e.trail || (e.h || 0) > .12, spoke = !hot && Math.max(g.adj[e.a].length, g.adj[e.b].length) > (g.hubDeg || 40), dep = e.kind === 'dep' && !hot
    // clip trop lourd : les fils du fond de la boule (les plus sombres) partent avant qu'on ne retire des images
    if (lod >= 1 && !hot && (lvl === 0 || (lvl === 1 && e.kind === 'dep'))) return
    // loin de l'araignée et au fond : presque invisible, on ne l'écrit pas (moins de fouillis, clip plus léger)
    if (!hot && (a.zd || 0) < .1 && (b.zd || 0) < .1) return
    wl0.push({ e, a, b, lvl, hot, spoke, dep, s: (hot ? 9 : 0) + (a === X.target || b === X.target || e.a === X.actor.cur || e.b === X.actor.cur ? 5 : 0) + d * 2 - Math.hypot((a.x + b.x) / 2 - cEnd.x, (a.y + b.y) / 2 - cEnd.y) / 120 })
  })
  // encore trop lourd : on garde les fils chauds, ceux de l'araignée et de sa cible, puis les plus proches et les plus en avant
  const wcap = lod >= 5 ? 70 : lod >= 3 ? 110 : lod >= 1 ? 160 : Infinity
  ;(wl0.length > wcap ? wl0.sort((p, q) => q.s - p.s).slice(0, wcap) : wl0).forEach(({ e, a, b, lvl, hot, spoke, dep }) => {
    const cc = (g.adj[e.a].length >= g.adj[e.b].length ? b : a).comm, key = (hot ? 'h' : dep ? 'm' : spoke ? 's' : '') + cc + ':' + lvl
    let gr = groups.get(key); if (!gr) groups.set(key, gr = { lvl, hot, spoke, dep, col: g.comms[cc] ? g.comms[cc].col : '#c9c2e6', dB: '', dA: '', dM: '' })
    gr.dB += wd(e, a, b); if (tr) { gr.dA += wd(e, at(tr.A, e.a), at(tr.A, e.b)); gr.dM += wd(e, at(tr.M, e.a), at(tr.M, e.b)) }
  })
  let wdefs = '', wi = 0
  ;[...groups.values()].sort((p, q) => p.lvl - q.lvl).forEach(gr => {
    // des fils pleins (jamais transparents) : fins et sombres au fond, épais et lumineux devant
    const d = (gr.lvl + .5) / 4, a0 = Math.min(1, (.18 + .4 * d) * (gr.spoke ? .55 : 1) * (gr.dep ? .6 : 1) * (gr.hot ? 1.5 : Math.max(.5, S.edens) * .5 + .5)), w = (gr.hot ? .5 : gr.dep ? .26 : .38) * Math.min(RS, 3) * (.22 + 1.4 * d * d), id = 'w' + wi++
    const lum = gr.hot ? Math.min(1, a0 * 1.55) : Math.min(1, (.1 + .9 * d * d) * 1.5 * (gr.spoke ? .6 : 1) * (gr.dep ? .75 : 1))
    wdefs += `<path id="${id}" d="${tr ? 'M0 0' : gr.dB}">${tr ? `<animate attributeName="d" values="${gr.dA};${gr.dM};${gr.dB}" ${TD} fill="freeze"/>` : ''}</path>`
    if ((gr.lvl >= 2 && lod < 1) || gr.hot) o.push(`<use href="#${id}" stroke="${gr.col}" stroke-opacity="${(.12 * a0).toFixed(3)}" stroke-width="${f1(w * 3)}"/>`)
    o.push(`<use href="#${id}" stroke="${mixHex(mixHex(gr.col, '#ffffff', gr.hot ? .4 : .1), '#06040c', 1 - lum)}" stroke-width="${(w).toFixed(2)}"/>`)
    if (d > .3 && !gr.dep && lod < 1) o.push(`<use href="#${id}" stroke="${mixHex(mixHex(gr.col, '#ffffff', .45), '#06040c', 1 - lum * .8)}" stroke-width="${(w * 1.4).toFixed(2)}" stroke-dasharray="${(w * .35).toFixed(2)} ${(w * 2.4).toFixed(2)}"><animate attributeName="stroke-dashoffset" values="0;${(-w * 2.75 * 4).toFixed(2)}" dur="${(4 / 1.8 * 2.75).toFixed(1)}s" repeatCount="indefinite"/></use>`)
  })
  // le style passe par le groupe : un tracé repris par <use> hérite de son <use>, pas de ses <defs>
  const wl = o.splice(1); o.push(`<defs>${wdefs}</defs><g fill="none" stroke-linecap="round">${wl.join('')}</g>`)
  const named = new Set(list.filter(n => n.label && n.kind !== 'leaf' && (n.zd || 0) > .55 && (n.kind === 'dir' || n.kind === 'file' || n.kind === 'term' || n === X.target)).sort((p, q) => Math.hypot(p.x - cEnd.x, p.y - cEnd.y) - Math.hypot(q.x - cEnd.x, q.y - cEnd.y)).slice(0, lod >= 3 ? 8 : 22))
  if (X.target) named.add(X.target)
  let nodes = ''
  list.forEach(n => {
    const isT = n === X.target || X.targets.includes(n), zd = n.zd || 0, k = n.k || 1
    let body
    // une araignée sur le terminal : la boîte s'écarte à côté d'elle, reliée à son étoile par un fil
    let bo = { x: 0, y: 0 }
    if (n.kind === 'term') { const sc = k * RS * .55; for (const o of Object.values(W.actors)) { const vx = n.x - o.sp.x, vy = n.y - o.sp.y, dd = Math.hypot(vx, vy), need = 11.5 * sc + Math.max(...o.sp.m.legs) * .85; if (dd < need) { const ux = dd > .5 ? vx / dd : .94, uy = dd > .5 ? vy / dd : -.34; bo.x += ux * (need - dd); bo.y += uy * (need - dd) } } }
    if (n.kind === 'term') body = (Math.hypot(bo.x, bo.y) > 2 ? `<path d="M${f1(n.x)} ${f1(n.y)}l${f1(bo.x)} ${f1(bo.y)}" stroke="#9dff8a" stroke-opacity="${(.35 * zd).toFixed(2)}" stroke-width=".3"/>` : '') + `<g transform="translate(${f1(n.x + bo.x)} ${f1(n.y + bo.y)}) scale(${f1(k * RS * .55)})" opacity="${(.08 + .92 * zd).toFixed(2)}"><rect x="-10" y="-6.5" width="20" height="13" rx="3" fill="#0b1a0e" stroke="#9dff8a" stroke-width=".6" filter="url(#glow)"/><text y="1.8" text-anchor="middle" font-family="monospace" font-size="5.5" fill="#9dff8a">&gt;_</text></g>`
    else {
      used.add(n.comm)
      // loin de l'araignée : plus petite et plus discrète ; près d'elle, pleine
      const r = nebR(g, n) * RS * k * .62 * (.5 + .5 * zd) * (isT ? 1.25 : 1), touched = (n.heat || 0) > .01 || n.visited || n.mod, op = Math.min(1, (.12 + .88 * zd * zd) * (touched ? 1 : .72) * S.dens + (isT ? .3 : 0))
      // les dossiers : une étoile à huit branches qui tourne ; les fichiers : quatre branches qui scintillent
      const dir = n.kind === 'dir' || n.kind === 'concept'; if (dir) used8.add(n.comm)
      body = `<use href="#${dir ? 's8' : 's4'}${n.comm}" transform="translate(${Math.round(n.x)} ${Math.round(n.y)})${dir ? `rotate(${hash(n.id) % 45})` : ''}scale(${(r * (dir ? 1.25 : .95) / 16).toFixed(2)})" opacity="${op.toFixed(2)}"/>`
      if (isT) body += `<circle cx="${f1(n.x)}" cy="${f1(n.y)}" r="${f1(r * .55)}" fill="none" stroke="#fff" stroke-width=".5" opacity=".7"><animate attributeName="r" values="${f1(r * .45)};${f1(r * .7)};${f1(r * .45)}" dur="1.6s" repeatCount="indefinite"/></circle>`
      if (n.fallT !== undefined || (X.falling === n)) body = `<g>${body}<animate attributeName="opacity" values="1;1;0" keyTimes="0;${kt((X.snapT || 0) + .2)};${kt((X.snapT || 0) + 1.2)}" dur="${dur}" fill="freeze"/></g>`
    }
    if (named.has(n)) { const dx = n.kind === 'term' ? 0 : nebR(g, n) * RS * k * .45 + 3; body += `<text x="${f1(n.x + dx)}" y="${f1(n.y + (n.kind === 'term' ? 9 * RS * k * .55 : 1.4))}"${n.kind === 'term' ? ' text-anchor="middle"' : ''} fill="${isT ? '#fff' : n.kind === 'term' ? '#9dff8a' : n.kind === 'dir' ? 'rgba(240,236,255,.9)' : 'rgba(240,236,255,.78)'}" font-size="${isT ? 4.6 : n.kind === 'dir' ? 4.3 : 3.9}"${isT || n.kind === 'dir' ? ' font-weight="700"' : ''} opacity="${(.5 + .5 * zd).toFixed(2)}">${esc(n.label)}</text>` }
    const mv = tr ? mover(n.id) : ''
    nodes += mv ? `<g>${mv}${body}</g>` : body
  })
  // les modèles d'étoiles (un par communauté) : un nuage discret qui colore sans éblouir, des branches fines, un cœur net
  let defs = `<radialGradient id="nw"><stop offset="0" stop-color="#fff" stop-opacity=".95"/><stop offset=".35" stop-color="#e6f6ff" stop-opacity=".35"/><stop offset="1" stop-color="#fff" stop-opacity="0"/></radialGradient><radialGradient id="nhalo"><stop offset="0" stop-color="#5ee6ff" stop-opacity=".07"/><stop offset=".7" stop-color="#b46cff" stop-opacity=".04"/><stop offset="1" stop-color="#000" stop-opacity="0"/></radialGradient>`
  const rays = n => { let d = ''; for (let k = 0; k < n; k++) { const an = k / n * Math.PI * 2 - Math.PI / 2, L = 16 * (n === 8 && k % 2 ? .55 : .98), w = 16 * (n === 8 ? .055 : .07), dx = Math.cos(an), dy = Math.sin(an); d += `M${f1(-dy * w)} ${f1(dx * w)}L${f1(dx * L)} ${f1(dy * L)}L${f1(dy * w)} ${f1(-dx * w)}z` } return d }
  // les branches sont les mêmes pour toutes les couleurs : dessinées une fois
  if (used.size) defs += `<g id="k"><circle r="3.2" fill="url(#nw)"/><circle r="1.4" fill="#fff"/></g><path id="r4" d="${rays(4)}"/>` + (used8.size ? `<path id="r8" d="${rays(8)}"/>` : '')
  used.forEach(c => {
    const col = g.comms[c] ? g.comms[c].col : NEB_HUES[c % NEB_HUES.length]
    const grad = (id, stops) => `<radialGradient id="${id}">${stops.map(([o, cc, a]) => `<stop offset="${o}" stop-color="${cc}" stop-opacity="${a}"/>`).join('')}</radialGradient>`
    defs += grad('ng' + c, [[0, col, .5], [.3, col, .16], [1, col, 0]]) + grad('sr' + c, [[0, '#ffffff', .95], [.3, mixHex(col, '#ffffff', .35), .85], [1, col, 0]])
    const core = `<circle r="8" fill="url(#ng${c})" opacity=".65"/><use href="#k"/>`, cloud = `<circle r="17" fill="url(#ng${c})" opacity=".2"/>`
    defs += `<g id="s4${c}">${cloud}<use href="#r4" fill="url(#sr${c})"><animate attributeName="opacity" values="1;.68;1" dur="${(2.2 + (c % 5) * .37).toFixed(2)}s" repeatCount="indefinite"/></use>${core}</g>`
    if (used8.has(c)) defs += `<g id="s8${c}">${cloud}<use href="#r8" fill="url(#sr${c})"><animateTransform attributeName="transform" type="rotate" values="0;360" dur="52s" repeatCount="indefinite"/></use>${core}</g>`
  })
  o.push(`<defs>${defs}</defs>`, nodes)
  if (X.bolt) o.push(boltSVG(W, X.bolt, X.boltT, Math.max(.1, X.total), inB, lod))
  return o.join('')
}

// la caméra du panneau : le zoom choisi reste (il ne revient jamais tout seul) ; en caméra libre, elle ne bouge plus
export const ZOOM_MIN = .35, ZOOM_MAX = 3
export function setZoom(W, z) { W.zoom = clamp(Number(z) || 1, ZOOM_MIN, ZOOM_MAX); return W.zoom }
export function setFollow(W, on) { W.free = on ? null : { x: W.cam.x, y: W.cam.y }; if (on) W.camId = null }
// l'araignée que la caméra suit au repos : la dernière qui a travaillé, si elle est encore là
const camActor = W => (W.camId && W.actors[W.camId]) || W.actors.main
export function renderClip(W, ev, frames, X) {
  if (W.free) frames = frames.map(f => ({ ...f, cam: { x: W.free.x, y: W.free.y } }))
  // la vue épouse la forme du panneau (hauteur / largeur), à surface à peu près constante, au zoom choisi
  const asp = clamp(W.aspect || .63, .3, 3), VIEW_W = Math.sqrt(64000 / asp) / clamp(W.zoom || 1, ZOOM_MIN, ZOOM_MAX), VIEW_H = VIEW_W * asp
  const g = W.g, S = X.S, n = frames.length, T = Math.max(.1, X.total), dur = T.toFixed(2) + 's', now = Date.now(), lod = X.lod || 0
  X.sym = new Set()
  const anim = (attr, values) => `<animate attributeName="${attr}" values="${vals(values)}" dur="${dur}" fill="freeze" calcMode="linear"/>`
  const kt = s => clamp(s / T, 0, 1).toFixed(3)
  // zone visible pendant le clip
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity
  frames.forEach(f => { x0 = Math.min(x0, f.cam.x); x1 = Math.max(x1, f.cam.x); y0 = Math.min(y0, f.cam.y); y1 = Math.max(y1, f.cam.y) })
  if (!frames.length) { x0 = x1 = W.cam.x; y0 = y1 = W.cam.y }
  const pad = 30, bx0 = x0 - VIEW_W / 2 - pad, bx1 = x1 + VIEW_W / 2 + pad, by0 = y0 - VIEW_H / 2 - pad, by1 = y1 + VIEW_H / 2 + pad
  const inBox = p => p.x > bx0 && p.x < bx1 && p.y > by0 && p.y < by1
  const out = []
  const f0 = frames[0] ? frames[0].cam : W.cam
  out.push(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="${f1(f0.x - VIEW_W / 2)} ${f1(f0.y - VIEW_H / 2)} ${VIEW_W} ${VIEW_H}" width="1000" height="${Math.round(1000 * asp)}" preserveAspectRatio="xMidYMid slice" style="background:#06040c">`)
  if (n > 1 && !W.free) out.push(anim('viewBox', frames.map(f => `${f1(f.cam.x - VIEW_W / 2)} ${f1(f.cam.y - VIEW_H / 2)} ${VIEW_W} ${VIEW_H}`)))
  const driftOff = X.drift && X.turn && lod < 2 ? (() => { const id = X.actor.cur, A = X.turn.A.get(id), M = X.turn.M.get(id), B = X.turn.B.get(id); return A && M && B ? [A, M, B, B].map(p => ({ x: p.x - B.x, y: p.y - B.y })) : null })() : null
  if (driftOff) out.push(`<animate attributeName="viewBox" values="${driftOff.map(d => `${f1(f0.x + d.x - VIEW_W / 2)} ${f1(f0.y + d.y - VIEW_H / 2)} ${VIEW_W} ${VIEW_H}`).join(';')}" keyTimes="0;${kt(X.turn.T / 2)};${kt(X.turn.T)};1" dur="${dur}" fill="freeze"/>`)
  let defs = `<filter id="glow" x="-50%" y="-50%" width="200%" height="200%"><feGaussianBlur stdDeviation=".8" result="b"/><feMerge><feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge></filter><filter id="soft" x="-50%" y="-50%" width="200%" height="200%"><feGaussianBlur stdDeviation="1.6"/></filter>${skinDefs('sk', S)}`
  // l'humeur colore l'araignée : vert quand ça réussit, rouge quand ça échoue
  if (X.act.tool === 'Mood') { const M = X.act.ok ? GREEN_M : RED_M; defs += `<filter id="mood" x="-50%" y="-50%" width="200%" height="200%"><feColorMatrix type="matrix" values="${ID_M}"><animate attributeName="values" values="${ID_M};${M};${M};${ID_M}" keyTimes="0;${kt(X.walkDur + .2)};${kt(T - .45)};1" dur="${dur}" fill="freeze"/></feColorMatrix></filter>` }
  out.push(`<defs>${defs}</defs>`)
  out.push(`<rect x="${f1(bx0 - 400)}" y="${f1(by0 - 400)}" width="${f1(bx1 - bx0 + 800)}" height="${f1(by1 - by0 + 800)}" fill="#06040c"/>`)
  let broken = []
  if (W.sph) { out.push(sphereStage(W, frames, X, dur, kt, [bx0, by0, bx1, by1], lod)); g.edges.forEach((e, i) => { if (e.broken && !e.hidden && (inBox(g.byId[e.a]) || inBox(g.byId[e.b]))) broken.push(i) }) }
  else {
    // la profondeur : des toiles lointaines, floues, qui glissent moins vite que la nôtre
    if (lod < 1) out.push(farLayer(W, frames, VIEW_W, VIEW_H, dur, n))
    // nébuleuses des communautés
    g.comms.forEach(c => { if (c.cx > bx0 - 250 && c.cx < bx1 + 250 && c.cy > by0 - 250 && c.cy < by1 + 250) out.push(`<circle cx="${f1(c.cx)}" cy="${f1(c.cy)}" r="160" fill="${c.col}" opacity=".035" filter="url(#soft)"/>`) })
    // les toiles des dossiers : spirales entre les rayons
    let orbs = ''
    if (lod < 1) (g.orbs || []).forEach(o => { if (o.x + o.r < bx0 || o.x - o.r > bx1 || o.y + o.r < by0 || o.y - o.r > by1) return; o.spirals.forEach((pts, k) => { if (k % 2 && pts.length > 16) return; orbs += pts.map((p, i) => (i ? 'L' : 'M') + Math.round(p.x) + ' ' + Math.round(p.y)).join('') }) })
    if (orbs) out.push(`<path d="${orbs}" fill="none" stroke="#fff" stroke-opacity=".2" stroke-width=".22"/>`)
    // fils de soie : la mémoire du projet (les fils touchés brillent, les autres restent dans l'ombre)
    const near = new Set(X.edgeNear), special = new Set([...(X.snapEdges || []), X.repairEdge].filter(v => v !== undefined && v !== null))
    let cold = '', coldTree = '', thin = '', strong = '', trail = ''
    const hot = ['', '', ''], dews = []
    g.edges.forEach((e, i) => {
      if (near.has(i) || special.has(i) || e.hidden) return
      const a = g.byId[e.a], b = g.byId[e.b]; if (!inBox(a) && !inBox(b) && !inBox(e.c)) return
      if (e.broken) { broken.push(i); return }
      const dd = `M${Math.round(a.x)} ${Math.round(a.y)}Q${Math.round(e.c.x)} ${Math.round(e.c.y)} ${Math.round(b.x)} ${Math.round(b.y)}`, h = e.h || 0
      if (e.trail) trail += dd
      else if (h < .02) { if (e.kind === 'tree') coldTree += dd; else cold += dd }
      else if (e.kind === 'tree') strong += dd; else thin += dd
      if (h > .12) hot[h > .6 ? 2 : h > .3 ? 1 : 0] += dd
      if (e.trailAt && now - e.trailAt < 300000 && lod < 1) dews.push(e)
    })
    out.push(`<path d="${cold}" fill="none" stroke="#fff" stroke-opacity=".2" stroke-width=".28"/><path d="${coldTree}" fill="none" stroke="#fff" stroke-opacity=".42" stroke-width=".4"/>`)
    out.push(`<path d="${thin}" fill="none" stroke="#fff" stroke-opacity=".42" stroke-width=".34"/>`)
    out.push(`<path d="${strong}" fill="none" stroke="#fff" stroke-opacity=".78" stroke-width=".5"/><path d="${strong}" fill="none" stroke="#fff" stroke-opacity=".5" stroke-width=".9" stroke-dasharray="1.4 1.1"/>`)
    hot.forEach((d, k) => { if (d) out.push(`<path d="${d}" fill="none" stroke="#fff" stroke-opacity="${[.18, .28, .4][k]}" stroke-width="${[1.2, 1.8, 2.6][k]}" filter="url(#soft)"/><path d="${d}" fill="none" stroke="#fff" stroke-opacity=".95" stroke-width="${[.6, .8, 1][k]}"/>`) })
    out.push(`<path d="${trail}" fill="none" stroke="#fff" stroke-opacity=".95" stroke-width=".7" filter="url(#glow)"/>`)
    // la rosée sur les fils parcourus : elle scintille, puis s'évapore
    let drops = '', budget = 70
    dews.forEach(e => {
      const age = (now - e.trailAt) / 1000, a0 = .95 * Math.exp(-age / 110), step = Math.max(2, Math.floor(e.pts.length / 6))
      for (let j = step; j < e.pts.length - 1 && budget > 0; j += step) {
        budget--; const p = e.pts[j], r = .32 + (hash(e.a + j) % 5) * .06, b = -((hash(e.b + j) % 17) / 10)
        drops += `<circle cx="${f1(p.x)}" cy="${f1(p.y + .3)}" r="${f1(r)}" opacity="${a0.toFixed(2)}"><animate attributeName="opacity" values="${a0.toFixed(2)};${(a0 * .25).toFixed(2)};${a0.toFixed(2)}" dur="1.7s" begin="${b}s" repeatCount="indefinite"/></circle>`
      }
    })
    if (drops) out.push(`<g fill="#e6f6ff" filter="url(#glow)">${drops}</g>`)
  }
  // fils cassés : les bouts pendent et se balancent
  // (après la suppression d'un gros dossier il peut y en avoir des centaines : on garde les plus proches de la caméra)
  const cam = n ? frames[n - 1].cam : W.cam, byCam = i => { const e = g.edges[i]; return Math.hypot(e.c.x - cam.x, e.c.y - cam.y) }
  const capB = lod >= 5 ? 6 : lod >= 3 ? 16 : 40
  ;(broken.length > capB ? broken.sort((p, q) => byCam(p) - byCam(q)).slice(0, capB) : broken).forEach(i => out.push(halvesSVG(g, g.edges[i])))
  // le fil qui claque pendant ce clip
  ;(X.snapEdges || []).slice(0, lod >= 5 ? 4 : 12).forEach(i => {
    const e = g.edges[i], a = g.byId[e.a], b = g.byId[e.b], st = X.snapT.toFixed(2)
    out.push(`<path d="${qd(a, e.c, b)}" fill="none" stroke="#fff" stroke-opacity=".9" stroke-width=".5"><set attributeName="opacity" to="0" begin="${st}s"/></path>`)
    out.push(`<g opacity="0"><set attributeName="opacity" to="1" begin="${st}s"/>${halvesSVG(g, e)}</g>`)
    const p = e.pts[Math.floor(e.pts.length / 2)]
    out.push(`<circle cx="${f1(p.x)}" cy="${f1(p.y)}" r="1" fill="none" stroke="#fff" stroke-width=".6" opacity="0" filter="url(#glow)"><animate attributeName="r" values="1;14" dur=".5s" begin="${st}s" fill="freeze"/><animate attributeName="opacity" values="1;0" dur=".5s" begin="${st}s" fill="freeze"/></circle>`)
  })
  // le fil que l'araignée retisse pendant ce clip
  if (X.repairEdge !== undefined && X.repairEdge !== null) {
    const e = g.edges[X.repairEdge], a = g.byId[e.a], b = g.byId[e.b], k0 = kt(X.repairT0), k1 = kt(X.repairT1)
    out.push(`<g>${halvesSVG(g, e, X.repairStub ? (a.gone ? e.b : e.a) : null)}<animate attributeName="opacity" values="1;1;0" keyTimes="0;${k0};${k1}" dur="${dur}" fill="freeze"/></g>`)
    if (!X.repairStub) out.push(`<path d="${qd(a, e.c, b)}" fill="none" stroke="#fff" stroke-width=".7" filter="url(#glow)" opacity="0"><animate attributeName="opacity" values="0;0;1" keyTimes="0;${k0};${k1}" dur="${dur}" fill="freeze"/></path>`)
  }
  if (!W.sph) {
    // fils qui plient sous le poids
    X.edgeNear.forEach(i => {
      const e = g.edges[i], pts = e.pts.filter((_, j) => j % Math.max(1, Math.floor(e.pts.length / 8)) === 0 || j === e.pts.length - 1)
      const ds = frames.map(f => pts.map((p, j) => (j ? 'L' : 'M') + f1(p.x) + ' ' + f1(p.y - depthAtFrame(f, p) * TILT)).join(''))
      const h = e.h || 0, sw = e.trail ? .7 : e.kind === 'tree' ? .5 + h * .5 : .34 + h * .4, op = e.trail ? .95 : h < .02 ? (e.kind === 'tree' ? .45 : .22) : e.kind === 'tree' ? .8 : .45
      out.push(`<path d="${ds[0] || ''}" fill="none" stroke="#fff" stroke-opacity="${op}" stroke-width="${f1(sw)}"${e.trail || h > .3 ? ' filter="url(#glow)"' : ''}>${n > 1 ? anim('d', ds) : ''}</path>`)
    })
    // nœuds
    const nodesOut = [], dots = {}, halos = {}
    g.nodes.forEach(nd => {
      if (!inBox(nd) || (nd.gone && X.falling !== nd)) return
      const col = g.comms[nd.comm].col
      if (nd.kind === 'file') nodesOut.push(cocoonSVG(nd, col, X, frames, dur, kt))
      else if (nd.kind === 'term') nodesOut.push(`<g transform="translate(${f1(nd.x)} ${f1(nd.y)})"><rect x="-10" y="-6.5" width="20" height="13" rx="3" fill="#0b1a0e" stroke="#9dff8a" stroke-width=".6" filter="url(#glow)"/><text y="1.8" text-anchor="middle" font-family="monospace" font-size="5.5" fill="#9dff8a">&gt;_</text></g>`)
      else if (nd.kind === 'dir') nodesOut.push(`<circle cx="${f1(nd.x)}" cy="${f1(nd.y)}" r="2.6" fill="#fff" filter="url(#glow)"/><circle cx="${f1(nd.x)}" cy="${f1(nd.y)}" r="5" fill="none" stroke="${col}" stroke-opacity=".7" stroke-width=".35"/>`)
      else {
        // les fonctions et concepts : regroupés en un seul tracé par communauté (bien plus léger)
        const r = nd.kind === 'concept' ? 2.4 : 1.3 + Math.min(1.5, g.adj[nd.id].length * .16), k = nd.comm, dot = (rr) => `M${f1(nd.x - rr)} ${f1(nd.y)}a${f1(rr)} ${f1(rr)} 0 1 0 ${f1(rr * 2)} 0a${f1(rr)} ${f1(rr)} 0 1 0 ${f1(-rr * 2)} 0`
        dots[k] = (dots[k] || '') + dot(r); if (lod < 3) halos[k] = (halos[k] || '') + dot(r * 2.3)
      }
    })
    Object.keys(halos).forEach(k => out.push(`<path d="${halos[k]}" fill="${g.comms[k].col}" opacity=".2"/>`))
    Object.keys(dots).forEach(k => out.push(`<path d="${dots[k]}" fill="${g.comms[k].col}"/>`))
    out.push(nodesOut.join(''), cocoonDefs(X.sym))
    // étiquettes des nœuds visibles (les fichiers jamais touchés restent discrets)
    let labels = ''
    const cEnd = frames.length ? frames[frames.length - 1].cam : W.cam, lx0 = Math.min(cEnd.x, f0.x) - VIEW_W * .55, lx1 = Math.max(cEnd.x, f0.x) + VIEW_W * .55, ly0 = Math.min(cEnd.y, f0.y) - VIEW_H * .55, ly1 = Math.max(cEnd.y, f0.y) + VIEW_H * .55
    const shown = g.nodes.filter(nd => nd.x > lx0 && nd.x < lx1 && nd.y > ly0 && nd.y < ly1).sort((a, b) => Math.hypot(a.x - cEnd.x, a.y - cEnd.y) - Math.hypot(b.x - cEnd.x, b.y - cEnd.y)).slice(0, lod >= 3 ? 12 : 70)
    shown.forEach(nd => {
      if (nd.kind === 'leaf' || !nd.label || nd.gone) return
      const isT = nd === X.target || X.targets.includes(nd); if (nd.kind === 'sym' && !isT && g.adj[nd.id].length < 4) return
      const cold = nd.kind === 'file' && !isT && !(nd.heat > .01) && !nd.visited
      const dx = nd.kind === 'file' ? 4 + 3.6 * cocoonScale(nd) : 6
      labels += `<text x="${f1(nd.x + dx)}" y="${f1(nd.y + 1.4)}" fill="${isT ? '#fff' : nd.kind === 'dir' ? 'rgba(240,236,255,.85)' : nd.kind === 'file' ? (cold ? 'rgba(240,236,255,.45)' : 'rgba(240,236,255,.88)') : g.comms[nd.comm].col}" font-size="${isT ? 4.6 : nd.kind === 'dir' ? 4.2 : 3.8}" ${isT || nd.kind === 'dir' ? 'font-weight="700"' : ''}>${esc(nd.label)}</text>`
    })
    out.push(`<g font-family="monospace">${labels}</g>`)
  }
  // effets de l'action
  out.push(effectsSVG(W, ev, frames, X, dur, kt))
  // la page parcourue par le crawler, sous les araignées
  if (X.crawl) out.push(crawlSVG(X))
  // les autres araignées (immobiles pendant ce clip)
  X.others.forEach(o => {
    let s = dragSVG([o.P], [o.a.hang], dur, 1) + spiderSVG([o.P], S, dur, 1)
    if (o.a.id === 'main' && W.sleeping) s = swingWrap(o.P, s, 0) + zzzSVG(o.P)
    if (W.sph && X.turn && lod < 2) s = spinWrap(W, X, o.a.cur, s)
    if (W.sph && X.turn && lod < 2) { const A = X.turn.A.get(o.a.cur), M = X.turn.M.get(o.a.cur), B = X.turn.B.get(o.a.cur); if (A && M && B) s = `<g><animateTransform attributeName="transform" type="translate" values="${f1(A.x - B.x)} ${f1(A.y - B.y)};${f1(M.x - B.x)} ${f1(M.y - B.y)};0 0" dur="${X.turn.T.toFixed(2)}s" fill="freeze"/>${s}</g>` }
    out.push(s)
  })
  // l'araignée qui agit
  const Ps = frames.map(f => f.P)
  let sp = dragSVG(Ps, frames.map(f => f.hang || 0), dur, n) + spiderSVG(Ps, S, dur, n)
  if (X.act.tool === 'Mood') sp = `<g filter="url(#mood)">${sp}</g>`
  if (X.sleep) sp = swingWrap(Ps[Ps.length - 1], sp, T) + zzzSVG(Ps[Ps.length - 1])
  if (driftOff) sp = spinWrap(W, X, X.actor.cur, sp, `0;${kt(X.turn.T / 2)};${kt(X.turn.T)};1`, dur)
  // sans glissement de caméra : l'araignée rejoint simplement sa place
  if (!driftOff && X.settle && (X.settle.x || X.settle.y)) sp = `<g><animateTransform attributeName="transform" type="translate" values="${f1(-X.settle.x)} ${f1(-X.settle.y)};0 0" dur="1s" fill="freeze"/>${sp}</g>`
  if (driftOff) { const st = X.settle || { x: 0, y: 0 }, back = [1, .45, 0, 0]; sp = `<g><animateTransform attributeName="transform" type="translate" values="${driftOff.map((d, i) => f1(d.x - st.x * back[i]) + ' ' + f1(d.y - st.y * back[i])).join(';')}" keyTimes="0;${kt(X.turn.T / 2)};${kt(X.turn.T)};1" dur="${dur}" fill="freeze"/>${sp}</g>` }
  if (X.fadeOut !== undefined) sp = `<g>${sp}<animate attributeName="opacity" values="1;1;0" keyTimes="0;${kt(X.fadeOut)};1" dur="${dur}" fill="freeze"/></g>`
  out.push(sp)
  // carte de texte
  // les bébés araignées ouvrent une petite page : les vraies lignes, lues ou tissées
  if (!X.crawl && ev.page && ev.page.lines && ev.page.lines.length && ev.actor && ev.actor !== 'main' && X.target && ['Read', 'Edit', 'Write'].includes(ev.tool) && !ev.crawl) out.push(pageCardSVG(ev, X))
  else if ((ev.lines || []).length && !['idle', 'Sleep', 'Leave'].includes(ev.tool)) out.push(cardSVG(ev, X, frames))
  out.push('</svg>')
  const svg = out.join('')
  // trop lourd : on renonce d'abord à la foudre, avant de toucher aux images de l'araignée
  if (svg.length > MAX_CHARS && X.bolt) return renderClip(W, ev, frames, { ...X, bolt: null })
  if (svg.length > MAX_CHARS && lod < 7) {
    // trop lourd pour le panneau : 1 sans décor lointain, 2 et 4 une image sur deux, 3 moins d'étiquettes,
    // 5 et 6 l'essentiel, 7 en dernier recours une image fixe de la vue finale (elle passe toujours)
    const next = lod + 1, thin = next === 2 || next === 4 || next === 6
    const fr = next === 7 ? frames.slice(-1) : thin && frames.length > 4 ? frames.filter((_, i) => i % 2 === 0 || i === frames.length - 1) : frames
    return renderClip(W, ev, fr, { ...X, lod: next, edgeNear: X.edgeNear.slice(0, next >= 4 ? 2 : 5) })
  }
  return { svg, dur: X.total, sounds: X.sounds || [], lod }
}
// des toiles lointaines dans un plan plus profond : elles glissent à 45 % de la vitesse de la caméra
function farLayer(W, frames, VW, VH, dur, n) {
  const c0 = frames[0] ? frames[0].cam : W.cam, K = .55, TL = 240, fx = c0.x * (1 - K), fy = c0.y * (1 - K)
  let d = ''
  for (let tx = Math.floor((fx - VW / 2 - 130) / TL); tx <= Math.floor((fx + VW / 2 + 130) / TL); tx++) for (let ty = Math.floor((fy - VH / 2 - 130) / TL); ty <= Math.floor((fy + VH / 2 + 130) / TL); ty++) {
    const h = hash(tx + ':' + ty); if (h % 3 === 0) continue
    const R = rng(h), cx = tx * TL + R() * TL, cy = ty * TL + R() * TL, r = 60 + R() * 70, N = 9 + Math.floor(R() * 5), a0 = R() * 6
    for (let k = 0; k < N; k++) { const a = a0 + k / N * Math.PI * 2; d += `M${f1(cx)} ${f1(cy)}L${f1(cx + Math.cos(a) * r)} ${f1(cy + Math.sin(a) * r)}` }
    for (let f = .25; f < 1; f += .19) for (let k = 0; k <= N; k++) { const a = a0 + k / N * Math.PI * 2; d += (k ? 'L' : 'M') + f1(cx + Math.cos(a) * r * f) + ' ' + f1(cy + Math.sin(a) * r * f) }
  }
  const tr = n > 1 ? `<animateTransform attributeName="transform" type="translate" values="${frames.map(f => f1(f.cam.x * K) + ' ' + f1(f.cam.y * K)).join(';')}" dur="${dur}" fill="freeze"/>` : ''
  return `<g transform="translate(${f1(c0.x * K)} ${f1(c0.y * K)})">${tr}<path d="${d}" fill="none" stroke="#c9c2ff" stroke-opacity=".09" stroke-width=".8" filter="url(#soft)"/></g>`
}
// un fil cassé : chaque bout pend depuis son nœud et se balance (only : un seul côté)
function halvesSVG(g, e, only) {
  let s = ''
  for (const [id, from] of [[e.a, 0], [e.b, 1]]) {
    if (only && id !== only) continue
    if (e.broken && e.broken.kind === 'stub' && e.broken.alive !== id) continue
    if (g.byId[id].gone) continue
    const A = g.byId[id], pts = from ? [...e.pts].reverse() : e.pts, M = pts[Math.floor(pts.length * .42)]
    const tip = { x: M.x + (A.x - M.x) * .15, y: M.y + 9 + Math.abs(M.x - A.x) * .08 }, c = { x: (A.x + M.x) / 2, y: (A.y + M.y) / 2 + 3 }
    const sw = (hash(id + e.a + e.b) % 2 ? 1 : -1) * 7, b = -((hash(e.b + id) % 13) / 10)
    s += `<g><animateTransform attributeName="transform" type="rotate" values="${-sw} ${f1(A.x)} ${f1(A.y)};${sw} ${f1(A.x)} ${f1(A.y)};${-sw} ${f1(A.x)} ${f1(A.y)}" dur="2.6s" begin="${b}s" repeatCount="indefinite"/><path d="${qd(A, c, tip)}" fill="none" stroke="#fff" stroke-opacity=".8" stroke-width=".45"/><circle cx="${f1(tip.x)}" cy="${f1(tip.y)}" r=".5" fill="#fff" filter="url(#glow)"/></g>`
  }
  return s
}
function cocoonSVG(nd, col0, X, frames, dur, kt) {
  const col = nd.lang || langColor(nd.path || nd.label), sc = cocoonScale(nd), rx = 3.6 * sc, ry = 2.3 * sc
  const touched = (nd.heat || 0) > .01 || nd.visited || nd.mod
  const held = X.act.tool === 'Read' && X.target === nd, born = X.act.tool === 'Write' && X.target === nd && nd.isNew, falling = X.falling === nd
  const cnt = 5 + Math.min(10, (nd.edits || 0) * 2 + (nd.wrap || 0) * 2)
  if (!held && !born && !falling) {
    // le cas courant : une simple référence au modèle de cocon, tournée et mise à l'échelle
    const v = 'ck' + cnt + (nd.mod ? 'm' : ''); X.sym.add(v)
    let c = `<g transform="translate(${f1(nd.x)} ${f1(nd.y)}) rotate(${(nd.ang / DEG).toFixed(0)}) scale(${sc.toFixed(2)})"${touched ? '' : ' opacity=".55"'}>`
    if ((nd.heat || 0) > .08) c += `<circle r="6.8" fill="${col}" opacity="${(.06 + nd.heat * .16).toFixed(2)}" filter="url(#soft)"/>`
    if (!X.lod || X.lod < 3) c += `<circle r="6" fill="${col0}" opacity=".14"/>`
    const layers = Math.min(3, Math.floor((nd.edits || 0) / 2))
    for (let k = layers; k >= 1; k--) c += `<ellipse rx="${f1(3.6 * (1 + .2 * k))}" ry="${f1(2.3 * (1 + .3 * k))}" fill="#fff" fill-opacity=".04" stroke="#fff" stroke-opacity=".3" stroke-width=".18" stroke-dasharray="1 .7"/>`
    return c + `<use href="#${v}" fill="${col}"${touched ? ' filter="url(#glow)"' : ''}/></g>`
  }
  let s = `<g transform="translate(${f1(nd.x)} ${f1(nd.y)})"${touched || held ? '' : ' opacity=".55"'}>`
  if (falling) { const b = X.snapT.toFixed(2); s += `<animateTransform attributeName="transform" type="translate" values="${f1(nd.x)} ${f1(nd.y)};${f1(nd.x + 3)} ${f1(nd.y + 50)}" dur="1.4s" begin="${b}s" fill="freeze"/><animate attributeName="opacity" values="1;1;0" dur="1.4s" begin="${b}s" fill="freeze"/>` }
  if ((nd.heat || 0) > .08) s += `<circle r="${f1(rx * 1.9)}" fill="${col}" opacity="${(.06 + nd.heat * .16).toFixed(2)}" filter="url(#soft)"/>`
  s += `<circle r="${f1(6 * sc)}" fill="${col0}" opacity=".14"/>`
  let close = '</g>'
  if (held) { s += `<g><animateTransform attributeName="transform" type="translate" values="${frames.map(f => '0 ' + f1(-(f.o.held ? f.o.held.z * TILT : 0))).join(';')}" dur="${dur}" fill="freeze"/>`; close += '</g>' }
  if (born) { s += `<g transform="scale(.2)"><animateTransform attributeName="transform" type="scale" values=".2;.2;1" keyTimes="0;${kt(X.walkDur + .8)};${kt(X.walkDur + 2.6)}" dur="${dur}" fill="freeze"/>`; close += '</g>' }
  s += `<g transform="rotate(${(nd.ang / DEG).toFixed(0)})">`; close = '</g>' + close
  // une couche de soie de plus tous les deux passages d'édition
  const layers = Math.min(3, Math.floor((nd.edits || 0) / 2))
  for (let k = layers; k >= 1; k--) s += `<ellipse rx="${f1(rx * (1 + .2 * k))}" ry="${f1(ry * (1 + .3 * k))}" fill="#fff" fill-opacity=".04" stroke="#fff" stroke-opacity=".3" stroke-width=".18" stroke-dasharray="1 .7"/>`
  s += `<ellipse rx="${f1(rx)}" ry="${f1(ry)}" fill="${col}" fill-opacity="${nd.mod ? .95 : .78}" stroke="${nd.mod ? '#ffc6f4' : '#fff'}" stroke-opacity=".6" stroke-width=".2" filter="url(#glow)"/>`
  s += `<ellipse cx="${f1(-rx * .25)}" cy="${f1(-ry * .35)}" rx="${f1(rx * .45)}" ry="${f1(ry * .28)}" fill="#fff" opacity=".45"/>`
  let wraps = ''; for (let k = 0; k < cnt; k++) { const x = -rx * .83 + k * rx * 1.66 / cnt + rx * .17, h = ry * Math.sqrt(Math.max(0, 1 - (x / rx) ** 2)); wraps += `M${f1(x - .5)} ${f1(-h)}Q${f1(x + .5)} 0 ${f1(x - .5)} ${f1(h)}` }
  s += `<path d="${wraps}" fill="none" stroke="${nd.mod ? '#fff0fb' : 'rgba(20,14,40,.55)'}" stroke-width="${f1(.22 * Math.sqrt(sc))}"/>`
  if (held) s += `<ellipse rx="${f1(rx * .66)}" ry="${f1(ry * .5)}" fill="#c8faff" opacity="0" filter="url(#glow)"><animate attributeName="opacity" values="0;0;.9;.9;0" keyTimes="0;${kt(X.walkDur)};${kt(X.walkDur + .5)};${kt(X.total - .5)};1" dur="${dur}" fill="freeze"/></ellipse>`
  return s + close
}
// les modèles de cocons : l'ellipse, son reflet et ses tours de soie (la couleur vient de chaque cocon)
function cocoonDefs(sym) {
  let d = ''
  for (const v of sym) {
    const cnt = parseInt(v.slice(2)), mod = v.endsWith('m'), rx = 3.6, ry = 2.3
    let wraps = ''; for (let k = 0; k < cnt; k++) { const x = -rx * .83 + k * rx * 1.66 / cnt + rx * .17, h = ry * Math.sqrt(Math.max(0, 1 - (x / rx) ** 2)); wraps += `M${f1(x - .5)} ${f1(-h)}Q${f1(x + .5)} 0 ${f1(x - .5)} ${f1(h)}` }
    d += `<g id="${v}"><ellipse rx="${rx}" ry="${ry}" fill-opacity="${mod ? .95 : .78}" stroke="${mod ? '#ffc6f4' : '#fff'}" stroke-opacity=".6" stroke-width=".2"/><ellipse cx="-.9" cy="-.8" rx="1.62" ry=".64" fill="#fff" opacity=".45"/><path d="${wraps}" fill="none" stroke="${mod ? '#fff0fb' : 'rgba(20,14,40,.55)'}" stroke-width=".22"/></g>`
  }
  return d ? `<defs>${d}</defs>` : ''
}
function depthAtFrame(f, p) {
  // profondeur approchée à partir de la pose enregistrée (corps et pieds posés)
  const P = f.P; let z = 0
  if ((f.hang || 0) > 4) return 0
  const add = (x, y, w, s2) => { const dx = p.x - x, dy = p.y - y, d2 = dx * dx + dy * dy; if (d2 < s2 * 9) z -= w * Math.exp(-d2 / s2) }
  const k = P.m.baby ? .4 : 1
  add(P.x, P.y, 4.2 * k, 420 * k); P.legs.forEach(L => { if (!L.stepping) add(L.F.x, L.F.y, 1.15 * k, 30) })
  return z
}
// le fil de suspension (bébé qui descend, araignée qui dort)
function dragSVG(Ps, hangs, dur, n) {
  if (!hangs.some(h => h > .5)) return ''
  const ds = Ps.map((P, i) => { const s = P3(spinneret(P)); return hangs[i] > .5 ? `M${f1(s.x)} ${f1(s.y)}L${f1(s.x)} ${f1(s.y - 420)}` : `M${f1(s.x)} ${f1(s.y)}L${f1(s.x)} ${f1(s.y)}` })
  return `<path d="${ds[0]}" fill="none" stroke="#fff" stroke-opacity=".8" stroke-width=".3">${n > 1 ? `<animate attributeName="d" values="${ds.join(';')}" dur="${dur}" fill="freeze"/>` : ''}</path>`
}
function swingWrap(P, body, begin) {
  const s = P3(spinneret(P)), px = f1(s.x), py = f1(s.y - 420)
  return `<g><animateTransform attributeName="transform" type="rotate" values="-1.1 ${px} ${py};1.1 ${px} ${py};-1.1 ${px} ${py}" dur="3.6s" begin="${begin.toFixed(2)}s" repeatCount="indefinite"/>${body}</g>`
}
function zzzSVG(P) {
  const h = P3({ x: P.x, y: P.y, z: P.bz + P.m.cw }), o = []
  for (let k = 0; k < 3; k++) o.push(`<text x="${f1(h.x + 4)}" y="${f1(h.y)}" font-family="monospace" font-size="${(3 + k).toFixed(1)}" fill="#d9d2ff" opacity="0" filter="url(#glow)">z<animate attributeName="y" values="${f1(h.y)};${f1(h.y - 16)}" dur="3s" begin="${k}s" repeatCount="indefinite"/><animate attributeName="x" values="${f1(h.x + 4)};${f1(h.x + 10)}" dur="3s" begin="${k}s" repeatCount="indefinite"/><animate attributeName="opacity" values="0;.9;0" dur="3s" begin="${k}s" repeatCount="indefinite"/></text>`)
  return o.join('')
}
let SPID = 0
function keepFrames(F, tol) {
  const n = F.length; if (n <= 2) return F.map((_, i) => i)
  const out = [0]; let k = 0
  const fits = (a, b) => { for (let m = a + 1; m < b; m++) { const u = (m - a) / (b - a), A = F[a], B = F[b], M = F[m]; for (let p = 0; p < M.length; p++) { if (Math.abs(A[p].x + (B[p].x - A[p].x) * u - M[p].x) > tol || Math.abs(A[p].y + (B[p].y - A[p].y) * u - M[p].y) > tol) return false } } return true }
  for (let j = 2; j < n; j++) if (!fits(k, j)) { out.push(j - 1); k = j - 1 }
  out.push(n - 1); return out
}
const r1 = v => Math.round(v * 10) / 10
// un tracé compact : premier point absolu, les suivants relatifs (calculés sur les valeurs arrondies, sans dérive)
function relPath(groups) {
  let d = ''
  for (const pts of groups) { let px = 0, py = 0; pts.forEach((p, i) => { const x = r1(p.x), y = r1(p.y); d += i ? 'l' + r1(x - px) + ' ' + r1(y - py) : 'M' + x + ' ' + y; px = x; py = y }) }
  return d
}
function spiderSVG(Ps, S, dur, n) {
  if (!Ps.length) return ''
  const frames = Ps.map(P => ({ P })), uid = 'q' + (SPID++).toString(36)
  const anim = (attr, values) => n > 1 ? `<animate attributeName="${attr}" values="${values.join(';')}" dur="${dur}" fill="freeze"/>` : ''
  const P0 = frames[0].P, m = P0.m, w = m.legW, o = []
  // le bout de patte ne dépasse jamais sa vraie longueur : un pied resté loin est tiré, jamais étiré en élastique
  const tip = (L, P) => { const mt = P.m.legs[L.i] * (L.k || 1) * P.m.seg[2] * 1.1, dx = L.F.x - L.A.x, dy = L.F.y - L.A.y, dz = L.F.z - L.A.z, d = Math.hypot(dx, dy, dz); return d > mt ? { x: L.A.x + dx / d * mt, y: L.A.y + dy / d * mt, z: L.A.z + dz / d * mt } : L.F }
  const proj = frames.map(f => f.P.legs.map(L => { const F = tip(L, f.P); return { H: P3(L.H), K: P3(L.K), A: P3(L.A), T: P3(lerp3(L.A, F, .72)), F: P3(F), stepping: L.stepping } }))
  // quatre tracés animés pour les huit pattes : cuisse et tibia, puis métatarse et tarse, les articulations, les pieds ;
  // l'ombre, la patte, le reflet et les décors les réutilisent (<use>) au lieu de recopier les coordonnées
  // les images que l'interpolation entre leurs voisines reproduit à 0,2 près ne sont pas stockées (araignée immobile :
  // presque rien ; en marche : toutes les images) ; les pattes et les palpes partagent la même liste de temps
  const flat = proj.map(L => L.flatMap(q => [q.H, q.K, q.A, q.T, q.F]))
  const keep = keepFrames(flat, .3), kts = keep.length < n ? keep.map(i => (i / Math.max(1, n - 1)).toFixed(4)).join(';') : ''
  const animK = (attr, values) => n > 1 ? `<animate attributeName="${attr}" values="${keep.map(i => values[i]).join(';')}"${kts ? ` keyTimes="${kts}"` : ''} dur="${dur}" fill="freeze"/>` : ''
  // deux tracés par patte : cuisse et tibia (épais), puis métatarse et tarse (fins) qui finissent en griffe pointue
  const dA = proj.map(L => relPath(L.map(q => [q.H, q.K, q.A]))), dB = proj.map(L => relPath(L.map(q => [q.A, q.T, q.F])))
  // articulations et pieds : des marqueurs posés sur les sommets des tracés (genou au milieu, cheville au bout, pied au bout)
  const jc = S.xray ? '#ffffff' : S.wire ? S.leg[0] : S.leg[2] || S.leg[0], dot = (id, r, fill, extra = '') => `<marker id="${uid}${id}" viewBox="-2 -2 4 4" markerWidth="${f1(r * 2)}" markerHeight="${f1(r * 2)}" orient="auto" markerUnits="userSpaceOnUse">${extra}<path d="M-1.6 -.62Q-1.75 0 -1.6 .62L-.15 .82Q.05 .9 .25 .78L1.45 .5Q1.62 0 1.45 -.5L.25 -.78Q.05 -.9 -.15 -.82Z" fill="${fill}" fill-opacity=".32"/><path d="M.05 -.86L.05 .86" stroke="#0a0614" stroke-opacity=".5" stroke-width=".22"/><path d="M-1.3 -.38L-.2 -.5M.35 -.46L1.2 -.3" stroke="#fff" stroke-opacity=".4" stroke-width=".16" stroke-linecap="round"/></marker>`
  // la jointure d'une vraie patte : le bout du segment s'élargit un peu, une fine membrane sombre sépare les deux
  // segments, un reflet souligne le relief (et non plus une bille ronde)
  const ring = S.ring && !S.wire ? `<path d="M-1.85 -.8Q-2 0 -1.85 .8L1.7 .66Q1.9 0 1.7 -.66Z" fill="${S.ring}" opacity=".55"/>` : ''
  // la griffe au bout du tarse : une pointe orientée dans le sens de la patte (et non plus un bout arrondi)
  const legCol = S.xray ? '#e8e0ff' : S.leg[1], claw = `<marker id="${uid}g" viewBox="-1 -1.2 4.6 2.4" markerWidth="${f1(w * 2.3)}" markerHeight="${f1(w * 1.2)}" refX="0" refY="0" orient="auto" markerUnits="userSpaceOnUse"><path d="M-.6 -.9Q1.2 -.5 3.4 .25Q1.1 .2 -.6 .9Z" fill="${legCol}"/><path d="M1.4 -.18L3.4 .25" stroke="#fff" stroke-width=".3" stroke-opacity=".7"/></marker>`
  o.push(`<defs><path id="${uid}a" d="${dA[0]}">${animK('d', dA)}</path><path id="${uid}b" d="${dB[0]}">${animK('d', dB)}</path>${dot('k', w * 1.05, jc, ring)}${dot('n', w * .85, jc)}${claw}</defs>`)
  // épais près du corps, fins au bout ; le bout de la patte n'est pas arrondi
  const both = (wa, wb) => `<use href="#${uid}a" stroke-width="${f1(wa)}"/><use href="#${uid}b" stroke-width="${f1(wb * .8)}" stroke-linecap="butt"/>`
  o.push(`<g fill="none" stroke="#000" stroke-opacity=".35" stroke-linecap="round" stroke-linejoin="round" transform="translate(1.4 1.1)">${both(w * 2.2, w * 1.1)}</g>`)
  if (S.wire) o.push(`<g fill="none" stroke="${S.leg[0]}" stroke-opacity=".9" stroke-dasharray=".25 .9" stroke-linecap="round">${both(w * 2.35, w * 1.1)}</g>`)
  else if (S.xray) o.push(`<g fill="none" stroke="#e8e0ff" stroke-opacity=".14" stroke-linecap="round" stroke-linejoin="round">${both(w * 2.35, w * 1.1)}</g>`)
  else o.push(`<g fill="none" stroke="${S.leg[1]}" stroke-linecap="round" stroke-linejoin="round" filter="url(#glow)">${both(w * 2.35, w * 1.1)}</g>`)
  // le squelette, visible à travers la patte translucide : un os pâle par segment, et à chaque articulation les deux
  // têtes d'os qui se rejoignent (les pattes en fil de fer gardent leur filament lumineux)
  const lineCol = S.xray ? '#f2f6ff' : S.wire ? S.leg[0] : (S.stripe || S.leg[2]), lines = `<use href="#${uid}a"/><use href="#${uid}b"/>`
  let boneSVG = ''
  if (S.wire) o.push(`<g fill="none" stroke="${lineCol}" stroke-width="${f1(w * .28)}" stroke-linejoin="round" stroke-linecap="round" stroke-opacity=".9" filter="url(#glow)">${lines}</g>`)
  else {
    // des os comme de vrais os : une tige fine qui s'évase en deux grosses bosses arrondies à chaque bout, cerclée de
    // sombre avec un reflet ; à chaque articulation, une rotule ronde relie la tête d'un os à celle du suivant
    const bone = S.xray ? '#f2f6ff' : '#f4f0e6', ink = '#1a1024'
    const end = sg => { const k = v => f1(v * sg); return `M${k(-3)} -.17C${k(-2)} -.17 ${k(-1.55)} -.3 ${k(-1.3)} -.64A.5 .5 0 1 ${sg > 0 ? 1 : 0} ${k(-.42)} -.38Q${k(-.62)} 0 ${k(-.42)} .38A.5 .5 0 1 ${sg > 0 ? 1 : 0} ${k(-1.3)} .64C${k(-1.55)} .3 ${k(-2)} .17 ${k(-3)} .17Z` }
    const hi = sg => { const k = v => f1(v * sg); return `M${k(-1.05)} -.62Q${k(-.72)} -.78 ${k(-.55)} -.55` }
    const rot = '<circle r=".42" fill="' + bone + '" stroke="' + ink + '" stroke-width=".1"/><circle cx="-.12" cy="-.14" r=".12" fill="#fff" opacity=".8"/>'
    const piece = (sgs, withRot) => sgs.map(sg => `<path d="${end(sg)}" fill="${bone}" stroke="${ink}" stroke-width=".1"/><path d="${hi(sg)}" stroke="#fff" stroke-width=".1" stroke-linecap="round" fill="none" opacity=".8"/>`).join('') + (withRot ? rot : '')
    const mk = (id, sgs, withRot, wd) => `<marker id="${uid}${id}" viewBox="-3 -1.2 6 2.4" markerWidth="${f1(wd * 2.5)}" markerHeight="${f1(wd)}" orient="auto" markerUnits="userSpaceOnUse">${piece(sgs, withRot)}</marker>`
    o.push(`<defs>${mk('o', [1, -1], true, w * 1.45)}${mk('p', [1], true, w * 1.45)}${mk('q', [-1], false, w * 1.45)}${mk('r', [1, -1], true, w * 1.1)}${mk('s', [-1], false, w * 1.1)}${mk('t', [1], false, w * .85)}</defs>`)
    boneSVG = (`<g fill="none" stroke-linecap="butt"><g stroke="${ink}"><use href="#${uid}a" stroke-width="${f1(w * .44)}"/><use href="#${uid}b" stroke-width="${f1(w * .34)}"/></g><g stroke="${bone}"><use href="#${uid}a" stroke-width="${f1(w * .34)}" marker-start="url(#${uid}q)" marker-mid="url(#${uid}o)" marker-end="url(#${uid}p)"/><use href="#${uid}b" stroke-width="${f1(w * .26)}" marker-start="url(#${uid}s)" marker-mid="url(#${uid}r)" marker-end="url(#${uid}t)"/></g></g>`)
    o.push(`<g fill="none" stroke="${lineCol}" stroke-width="${f1(w * .12)}" stroke-linecap="round" stroke-opacity=".55">${lines}</g>`)
  }
  if (S.photo) o.push(`<g fill="none" stroke="${S.photo[0]}" stroke-width="${f1(w * .7)}" stroke-linecap="round" stroke-dasharray=".01 4.5" filter="url(#glow)">${lines}<animate attributeName="stroke-dashoffset" values="0;-9" dur="1.4s" repeatCount="indefinite"/></g>`)
  if (S.mesh && !S.wire) o.push(`<g fill="none" stroke="${S.mesh}" stroke-opacity=".35" stroke-width="${f1(w * 2.2)}" stroke-dasharray=".12 1.6">${lines}</g>`)
  o.push(`<g fill="none" stroke="none" filter="url(#glow)"><use href="#${uid}a" marker-mid="url(#${uid}k)" marker-end="url(#${uid}n)"/></g><g fill="none" stroke="none"><use href="#${uid}b" marker-end="url(#${uid}g)"/></g>`)
  // les os par-dessus les jointures translucides : on les voit au travers
  if (boneSVG) o.push(boneSVG)
  // abdomen : déplacé et tourné à chaque image
  const ab = frames.map(f => { const P = f.P, c = abdC(P), p = P3({ x: c.x, y: c.y, z: P.bz + P.m.aw * .32 + P.abdUp * P.m.al * .42 }); return { x: p.x, y: p.y, r: P.abd / DEG, sx: 1 - .33 * P.abdUp } })
  const tr = (list, fn) => n > 1 ? `<animateTransform attributeName="transform" type="${fn}" values="${keep.map(i => list[i]).join(';')}"${kts ? ` keyTimes="${kts}"` : ''} dur="${dur}" fill="freeze"/>` : ''
  o.push(`<g transform="translate(${f1(ab[0].x)} ${f1(ab[0].y)})">${tr(ab.map(a => f1(a.x) + ' ' + f1(a.y)), 'translate')}<g transform="rotate(${f1(ab[0].r)})">${tr(unwrapDeg(ab.map(a => a.r)).map(f1), 'rotate')}<g transform="scale(${f1(ab[0].sx)} 1)">${tr(ab.map(a => f1(a.sx) + ' 1'), 'scale')}<g><animateTransform attributeName="transform" type="scale" values="1;1.025;1" dur="2.6s" repeatCount="indefinite"/>${abdomenSVG(S, m.al * .5, m.aw * .5)}</g></g></g></g>`)
  // céphalothorax
  const cp = frames.map(f => { const P = f.P, p = P3({ x: P.x, y: P.y, z: P.bz + P.m.cw * .2 }); return { x: p.x, y: p.y, r: P.h / DEG } })
  o.push(`<g transform="translate(${f1(cp[0].x)} ${f1(cp[0].y)})">${tr(cp.map(a => f1(a.x) + ' ' + f1(a.y)), 'translate')}<g transform="rotate(${f1(cp[0].r)})">${tr(unwrapDeg(cp.map(a => a.r)).map(f1), 'rotate')}${carapaceSVG(S, m.cl, m.cw)}</g></g>`)
  return o.join('')
}
function unwrapDeg(list) { const out = []; let prev = list[0] || 0; list.forEach((v, i) => { if (i === 0) { out.push(v); return } let d = v - prev; while (d > 180) d -= 360; while (d < -180) d += 360; const nv = out[i - 1] + d; out.push(nv); prev = v }); return out }
// les fils de soie qui partent des filières vers un point (cocon, fil à retisser)
function silkSVG(frames, X, q, dur) {
  // seulement pendant le tissage : l'animation commence et finit avec lui (pas de valeurs inutiles avant et après)
  const idx = frames.map((f, i) => i).filter(i => frames[i].tAct >= .9 && frames[i].tAct <= X.act.dur - .2)
  if (idx.length < 2) return ''
  const ds = [[], [], []], b0 = idx[0] / FPS, d0 = Math.max(.1, (idx[idx.length - 1] - idx[0]) / FPS)
  idx.forEach(i => { const f = frames[i], ta = f.tAct, s = P3(spinneret(f.P)); for (let k = 0; k < 3; k++) { const a = ta * 11 + k * 2.09, p = { x: q.x + Math.cos(a) * 3.6, y: q.y + Math.sin(a) * 2.3 }; ds[k].push(relPath([[s, { x: (s.x + p.x) / 2, y: (s.y + p.y) / 2 + 2 }, p]])) } })
  return `<g fill="none" stroke="#fff" stroke-width=".2" filter="url(#glow)" visibility="hidden"><set attributeName="visibility" to="visible" begin="${b0.toFixed(2)}s"/><set attributeName="visibility" to="hidden" begin="${(b0 + d0).toFixed(2)}s"/>${ds.map(d => `<path d="${d[0]}"><animate attributeName="d" values="${d.join(';')}" begin="${b0.toFixed(2)}s" dur="${d0.toFixed(2)}s" fill="freeze"/></path>`).join('')}</g>`
}
function effectsSVG(W, ev, frames, X, dur, kt) {
  const o = [], wd = X.walkDur, last = frames[frames.length - 1]?.P
  const n = X.target
  if (ev.tool === 'Read' && n) {
    // le contenu du fichier remonte jusqu'aux yeux
    const head = P3({ ...locP(last, last.m.cl * .45, 0), z: last.bz + last.m.cw * .2 })
    const chars = (ev.lines || ['…']).join('').replace(/\s+/g, '').slice(0, 40) || '·'
    for (let k = 0; k < 14; k++) { const ch = esc(chars[k % chars.length]), b = (wd + .5 + k * .1).toFixed(2), jx = ((k * 37) % 7 - 3); o.push(`<text font-family="monospace" font-size="3.4" fill="#c9fbff" filter="url(#glow)" opacity="0" x="0" y="0">${ch}<animateMotion path="M${f1(n.x)} ${f1(n.y - 3)}Q${f1((n.x + head.x) / 2 + jx)} ${f1((n.y + head.y) / 2 - 6)} ${f1(head.x)} ${f1(head.y)}" dur=".8s" begin="${b}s" repeatCount="2"/><animate attributeName="opacity" values="0;1;0" dur=".8s" begin="${b}s" repeatCount="2"/></text>`) }
  }
  if ((ev.tool === 'Edit' || ev.tool === 'Write') && n) {
    // la soie sort des filières et emballe le cocon
    o.push(silkSVG(frames, X, n, dur))
    for (let k = 0; k < 9; k++) { const plus = k % 3 !== 2, b = (wd + 1 + k * .22).toFixed(2), x = n.x + ((k * 53) % 9 - 4); o.push(`<text x="${f1(x)}" y="${f1(n.y - 4)}" font-family="monospace" font-weight="700" font-size="4.2" fill="${plus ? '#c8ffbd' : '#ffc2d0'}" filter="url(#glow)" opacity="0">${plus ? '+' : '−'}<animate attributeName="y" values="${f1(n.y - 4)};${f1(n.y - 20)}" dur="1.1s" begin="${b}s" fill="freeze"/><animate attributeName="opacity" values="1;0" dur="1.1s" begin="${b}s" fill="freeze"/></text>`) }
    // le vrai texte ajouté file le long de la soie, puis s'enroule autour du cocon
    const added = (ev.lines || []).filter(l => l[0] === '+').map(l => l.slice(1).trim()).filter(Boolean).join('  ').slice(0, 64)
    const fi = frames.findIndex(f => f.tAct >= .9)
    if (added && fi >= 0) {
      const s = P3(spinneret(frames[fi].P)), L = dist(s, n), txt = esc(added), tl = added.length * 1.45, b0 = wd + 1, T1 = clamp((tl + L) / 26, 1.2, 2.2)
      const sc = cocoonScale(n), rx = 3.6 * sc + 2.4, ry = 2.3 * sc + 2.4
      o.push(`<path id="wv" d="M${f1(s.x)} ${f1(s.y)}Q${f1((s.x + n.x) / 2)} ${f1((s.y + n.y) / 2 + 3)} ${f1(n.x)} ${f1(n.y)}" fill="none"/>`)
      o.push(`<path id="wc" d="M${f1(n.x - rx)} ${f1(n.y)}a${f1(rx)} ${f1(ry)} 0 1 0 ${f1(rx * 2)} 0a${f1(rx)} ${f1(ry)} 0 1 0 ${f1(-rx * 2)} 0" fill="none"/>`)
      o.push(`<text font-family="monospace" font-size="2.4" fill="#eaffe2" filter="url(#glow)" opacity="0"><set attributeName="opacity" to="1" begin="${b0.toFixed(2)}s"/><textPath href="#wv" startOffset="${f1(-tl)}">${txt}<animate attributeName="startOffset" values="${f1(-tl)};${f1(L)}" dur="${T1.toFixed(2)}s" begin="${b0.toFixed(2)}s" fill="freeze"/></textPath></text>`)
      const per = Math.PI * (rx + ry), short = esc(added.slice(0, Math.floor(per / 1.45)))
      o.push(`<text font-family="monospace" font-size="2" fill="#f4ffee" filter="url(#glow)" opacity="0"><animate attributeName="opacity" values="0;.95;.95;0" keyTimes="0;.1;.7;1" dur="1.6s" begin="${(b0 + T1 * .7).toFixed(2)}s" fill="freeze"/><textPath href="#wc" startOffset="0">${short}<animate attributeName="startOffset" values="0;${f1(per * .5)}" dur="1.6s" begin="${(b0 + T1 * .7).toFixed(2)}s" fill="freeze"/></textPath></text>`)
    }
  }
  if (ev.tool === 'Repair' && X.act.at) o.push(silkSVG(frames, X, X.act.at, dur))
  if (ev.tool === 'Grep') {
    X.plucks.forEach(p => o.push(`<circle cx="${f1(p.x)}" cy="${f1(p.y)}" r="2" fill="none" stroke="#ffd36b" stroke-width=".5" opacity="0"><animate attributeName="r" values="2;150" dur="1.4s" begin="${p.t.toFixed(2)}s" fill="freeze"/><animate attributeName="opacity" values=".7;0" dur="1.4s" begin="${p.t.toFixed(2)}s" fill="freeze"/></circle>`))
    const from = X.plucks[0] || { x: last.x, y: last.y, t: wd }
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
    o.push(`<circle cx="${f1(last.x)}" cy="${f1(last.y)}" r="3" fill="none" stroke="#a8b4ff" stroke-width=".8" opacity="0"><animate attributeName="r" values="3;30" dur=".9s" begin="${(wd + 2.65).toFixed(2)}s" fill="freeze"/><animate attributeName="opacity" values="1;0" dur=".9s" begin="${(wd + 2.65).toFixed(2)}s" fill="freeze"/></circle>`)
  }
  if (ev.tool === 'Mood' && last) {
    // les photophores pulsent : des anneaux verts (réussite) ou rouges (échec)
    const col = ev.ok ? '#9dff8a' : '#ff5a7a', c = P3({ x: last.x, y: last.y, z: last.bz })
    for (let k = 0; k < (ev.ok ? 4 : 2); k++) { const b = (wd + .15 + k * .38).toFixed(2); o.push(`<circle cx="${f1(c.x)}" cy="${f1(c.y)}" r="3" fill="none" stroke="${col}" stroke-width=".7" opacity="0" filter="url(#glow)"><animate attributeName="r" values="3;${ev.big ? 46 : 30}" dur="1.1s" begin="${b}s" fill="freeze"/><animate attributeName="opacity" values="1;0" dur="1.1s" begin="${b}s" fill="freeze"/></circle>`) }
    const glyph = ev.ok ? '✓' : '✗'
    o.push(`<text x="${f1(c.x)}" y="${f1(c.y - 8)}" text-anchor="middle" font-family="monospace" font-weight="700" font-size="${ev.big ? 9 : 6}" fill="${col}" filter="url(#glow)" opacity="0">${glyph}<animate attributeName="y" values="${f1(c.y - 8)};${f1(c.y - 24)}" dur="1.4s" begin="${(wd + .3).toFixed(2)}s" fill="freeze"/><animate attributeName="opacity" values="0;1;1;0" dur="1.4s" begin="${(wd + .3).toFixed(2)}s" fill="freeze"/></text>`)
    if (ev.ok && ev.big) for (let k = 0; k < 10; k++) { const a = k / 10 * Math.PI * 2, b = (wd + .4 + (k % 3) * .15).toFixed(2); o.push(`<circle cx="${f1(c.x)}" cy="${f1(c.y)}" r=".6" fill="#d9ffd0" filter="url(#glow)" opacity="0"><animate attributeName="cx" values="${f1(c.x)};${f1(c.x + Math.cos(a) * 22)}" dur="1s" begin="${b}s" fill="freeze"/><animate attributeName="cy" values="${f1(c.y)};${f1(c.y + Math.sin(a) * 16 - 6)}" dur="1s" begin="${b}s" fill="freeze"/><animate attributeName="opacity" values="1;0" dur="1s" begin="${b}s" fill="freeze"/></circle>`) }
  }
  return o.join('')
}
function cardSVG(ev, X, frames) {
  const col = ev.tool === 'Mood' ? (ev.ok ? '#9dff8a' : '#ff5a7a') : TOOL_COLOR[ev.toolName] || TOOL_COLOR[ev.tool] || '#7df9ff', lines = (ev.lines || []).slice(0, 4).map(l => String(l)), title = String(ev.label || ev.tool || '')
  const last = frames[frames.length - 1]?.P
  const anchor = X.target || X.targets[0] || (last ? { x: last.x, y: last.y } : { x: 0, y: 0 })
  const begin = Math.max(0, X.walkDur + .2).toFixed(2)
  const w = 92, h = 12 + lines.length * 6
  const x = anchor.x + 10, y = anchor.y - h - 14
  let s = `<g opacity="0" font-family="monospace"><animate attributeName="opacity" values="0;1;1;0" keyTimes="0;.12;.85;1" dur="${Math.max(.5, X.total - X.walkDur).toFixed(2)}s" begin="${begin}s" fill="freeze"/>`
  s += `<rect x="${f1(x)}" y="${f1(y)}" width="${w}" height="${h}" rx="2.5" fill="rgba(12,9,22,.94)" stroke="${col}" stroke-opacity=".75" stroke-width=".35"/>`
  s += `<rect x="${f1(x)}" y="${f1(y)}" width="${w}" height="7" rx="2.5" fill="${col}" fill-opacity=".12"/>`
  s += `<text x="${f1(x + 3)}" y="${f1(y + 5)}" font-size="3.6" font-weight="700" fill="${col}">${esc(title.slice(0, 44))}</text>`
  lines.forEach((ln, k) => { const c = ln[0] === '+' || ln[0] === '✓' ? '#9dff8a' : ln[0] === '-' || ln[0] === '✗' ? '#ff8aa8' : '#cfc4ef'; s += `<text x="${f1(x + 3)}" y="${f1(y + 12 + k * 6)}" font-size="3.3" fill="${c}">${esc(ln.slice(0, 50))}</text>` })
  return s + '</g>'
}

/* ---------------- le crawler : l'araignée saute sur la page qu'elle lit et la parcourt ---------------- */
// elle rapetisse, saute sur la première ligne et avance lettre après lettre ; quand elle croise un mot important,
// une patte s'étire pour l'attraper : il est entouré, barré, encadré ou souligné selon ce qu'il est, et un fil le relie
// au précédent ; un petit tableau de bord compte ce qu'elle lit. La lecture se joue en plusieurs clips courts
// (la taille d'un clip du panneau est limitée), puis elle redescend sur son dossier.
const MARK_COL = { def: '#ffd36b', alert: '#ff6b8a', ok: '#9dff8a', imp: '#7df9ff', cst: '#ff9be6' }
function findMarks(lines, kind, maxC, md) {
  const out = [], seen = new Map(), add = (row, c0, word, k, pri) => {
    if (!word || c0 < 0 || c0 + word.length > maxC - 1) return; const n = seen.get(word) || 0; if (n >= 2) return; seen.set(word, n + 1)
    if (out.some(m => m.row === row && c0 < m.c1 && c0 + word.length > m.c0)) return; out.push({ row, c0, c1: c0 + word.length, k, pri, word })
  }
  const RX = [
    [/\b(?:def|class|function|fn|func|interface|type|struct|enum|trait|impl|local\s+function)\s+([A-Za-z_$][\w$]*)/g, 'def', 0],
    [/\b(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*(?:async\s*)?(?:\(|function|class)/g, 'def', 0],
    [/\b(TODO|FIXME|XXX|HACK|BUG|WARNING|Error|ERROR|error|failed|FAILED|Traceback|panic|Exception)\b/g, 'alert', 1],
    [/\b(passed|PASSED|success|OK)\b/g, 'ok', kind === 'term' ? 1 : 4],
    [/^\s*(?:from\s+([\w.]+)\s+import|import\s+([\w.]+))/g, 'imp', 2],
    [/(?:from\s+|require\()['"]([^'"]+)['"]/g, 'imp', 2],
    [/\b([A-Z][A-Z0-9_]{3,})\b/g, 'cst', 3],
    [/\b([A-Z][a-z0-9]+(?:[A-Z][A-Za-z0-9]*)+|[A-Z]{2,}[a-z][A-Za-z0-9]*)\b/g, 'cst', 3],
  ]
  lines.forEach((line, row) => {
    // les titres et le gras : seulement dans un texte Markdown (dans du code, # est un commentaire)
    if (md) { const h = line.match(/^(#{1,4})\s+(.+)/); if (h) add(row, h[1].length + 1, h[2].trim().slice(0, 30), 'def', 0); for (const m of line.matchAll(/\*\*([^*]{2,30})\*\*/g)) add(row, m.index + 2, m[1], 'def', 1) }
    for (const [rx, k, pri] of RX) for (const m of line.matchAll(rx)) { const w = m[1] || m[2]; if (!w) continue; add(row, m.index + m[0].indexOf(w), w, k, pri) }
  })
  return out.sort((a, b) => a.pri - b.pri).slice(0, 7).sort((a, b) => a.row - b.row || a.c0 - b.c0)
}
function pageMorph(m) { const k = .36, o = { ...m }; ['cl', 'cw', 'al', 'aw', 'bodyZ', 'legW', 'palp', 'R'].forEach(key => o[key] = m[key] * k); o.legs = m.legs.map(v => v * k); o.stepDur = m.stepDur * .7; o.baby = true; return o }
const CR = { FS: 6, CW: 3.6, LH: 9.5, MAXC: 44, ROWS: 12, SEG: 3.2 }
// une lecture avec une page : l'araignée la parcourra après être arrivée sur le fichier
export function crawlBegin(W, ev) {
  const pg = ev && ev.page; if (!pg || !Array.isArray(pg.lines) || pg.lines.length < 3 || ev.tool !== 'Read' || !ev.path) return false
  const n = nodeForPath(W.g, ev.path); if (!n) return false
  const L = pg.lines.length, R = Math.min(CR.ROWS, L), s0 = clamp((pg.hi ? pg.hi[0] : 0) - 2, 0, Math.max(0, L - R))
  const rows = pg.lines.slice(s0, s0 + R).map(l => String(l ?? '').replace(/\t/g, '  ').slice(0, CR.MAXC))
  let c = 0; const cum = [0, ...rows.map(l => (c += Math.max(4, l.trimEnd().length - Math.max(0, l.search(/\S/)))))]
  const words = rows.reduce((s, l) => s + (l.match(/[\wÀ-ÿ]+/g) || []).length, 0)
  W.crawl = { pi: 0, actor: ev.actor || 'main', n, pg, s0, rows, cum, tot: c || 1, words, marks: findMarks(rows, pg.kind || 'read', CR.MAXC, /\.(md|markdown|txt)$/i.test(ev.path)), t: 0, readT: clamp(R * .5, 3, 7), phase: 'in', seg: 0, hit: [], rowAt: rows.map(() => -1) }
  ev.crawl = true
  return true
}
export const crawling = W => !!W.crawl
// une lecture interrompue : l'araignée reprend sa taille et redescend sur son dossier
export function crawlAbort(W) {
  const C = W.crawl; W.crawl = null; if (!C) return
  const a = W.actors[C.actor]; if (!a) return
  if (C.m0) { a.sp.env = C.env0 || W.env; a.sp.setMorph(C.m0) }
  const q = restSpot(W, a) || C.n; a.sp.x = q.x; a.sp.y = q.y
}
function crawlLayout(C) {
  const n = C.n, w = 22 + CR.MAXC * CR.CW + 6, h = 16 + C.rows.length * CR.LH + 4
  return { x: n.x + 24, y: n.y - h * .35, w, h, tx: n.x + 24 + 20, row: i => n.y - h * .35 + 16 + (i + .5) * CR.LH }
}
function crawlCursor(C, u) {
  const want = clamp(u, 0, 1) * C.tot; let row = 0; while (row < C.rows.length - 1 && C.cum[row + 1] <= want) row++
  const f = clamp((want - C.cum[row]) / ((C.cum[row + 1] - C.cum[row]) || 1), 0, 1), line = C.rows[row] || '', first = Math.max(0, line.search(/\S/)), last = line.trimEnd().length
  return { row, col: first + (Math.max(first, last) - first) * f }
}
// y a-t-il un grand blanc sur le chemin (aucune lettre où poser les pieds) ? elle le franchira d'un bond
function gapKind(cells, a, b, reach) {
  const L = Math.hypot(b.x - a.x, b.y - a.y), n = Math.ceil(L / 3); let run = 0, best = 0
  for (let i = 1; i < n; i++) {
    const x = lerp(a.x, b.x, i / n), y = lerp(a.y, b.y, i / n); let near = false
    for (const c of cells) if (Math.abs(c.x - x) < 7 && Math.abs(c.y - y) < CR.LH * .75) { near = true; break }
    run = near ? 0 : run + 3; best = Math.max(best, run)
  }
  if (best < CR.LH * 1.6) return null
  // un blanc que ses pattes avant (un peu étirées) peuvent enjamber : elle tend les pattes et s'y hisse ; plus grand : un bond
  return { kind: best < reach ? 'span' : 'leap', run: best }
}
// son trajet sur la page : les mots importants dans un ordre un peu désordonné (le plus proche, mais pas toujours),
// avec de temps en temps un détour sur une autre ligne ; sans mot important, quelques arrêts au hasard
function crawlPath(C, lay, sp) {
  C.rnd = rng(hash(C.n.id + C.rows.length)); const R = C.rnd, pts = [], left = C.marks.slice(), at = { x: sp.x, y: sp.y }
  const pos = m => ({ x: lay.tx + (m.c0 + m.c1) / 2 * CR.CW, y: lay.row(m.row) })
  const roam = () => { const i = Math.floor(R() * C.rows.length), ln = C.rows[i], a = Math.max(0, ln.search(/\S/)), b = Math.max(a + 4, ln.trimEnd().length); return { x: lay.tx + (a + R() * (b - a)) * CR.CW, y: lay.row(i) - CR.LH * .15 } }
  while (left.length) {
    left.sort((p, q) => dist(pos(p), at) - dist(pos(q), at))
    const m = left.splice(left.length > 1 && R() < .3 ? 1 : 0, 1)[0]
    if (R() < .2) pts.push(roam())
    pts.push({ m }); Object.assign(at, pos(m))
  }
  if (pts.length < 3) for (let k = pts.length; k < 4; k++) pts.splice(Math.floor(R() * (pts.length + 1)), 0, roam())
  return pts
}
// le clip suivant de la lecture, ou null quand elle est finie
export function crawlClip(W, hurry) {
  const C = W.crawl; if (!C) return null
  const a = W.actors[C.actor]; if (!a || C.n.gone) { W.crawl = null; return null }
  const sp = a.sp, g = W.g, frames = [], DT = 1 / 60, rec = Math.round(60 / FPS), lay = crawlLayout(C), S = SKINS[W.skin], sounds = [], over = []
  // d'autres actions attendent, ou la lecture dure : elle finit vite (encore un ou deux mots)
  if (C.seg >= 6) hurry = true
  // chaque patte se pose sur une lettre du texte (jamais sur un blanc ni une ligne vide) ; un pied posé sur un mot
  // important l'attrape
  const cells = []; C.rows.forEach((ln, i) => { for (let k = 0; k < ln.length; k++) if (ln[k] !== ' ') cells.push({ x: lay.tx + (k + .5) * CR.CW, y: lay.row(i) }) })
  const markAt = f => C.marks.find(m => m.at === undefined && Math.abs(lay.row(m.row) - f.y) < CR.LH * .5 && f.x >= lay.tx + m.c0 * CR.CW - 1 && f.x <= lay.tx + m.c1 * CR.CW + 1)
  const pageEnv = {
    snap: p => { let b = null, bd = Infinity; for (const c of cells) { const d = (c.x - p.x) ** 2 + (c.y - p.y) ** 2 * 1.6; if (d < bd) { bd = d; b = c } } return b ? { x: b.x, y: b.y } : p },
    depth: () => 0,
    onPlant: f => { if (C.phase !== 'read') return; const m = markAt(f); if (m) { m.at = ct; m.seg = C.seg } }
  }
  let step = 0, ct = 0, lift = 0, spd = 0, tuck = 0, stretch = 0
  // la caméra cadre la page entière, et descend un peu avec l'araignée au fil des lignes
  const recFrame = () => { const o = { over: over.filter(r => r.w > .001), lift, tuck, stretch }, fx = lay.x + lay.w / 2, fy = lerp(lay.y + lay.h / 2 + 8, sp.y, .3); W.cam.x += (fx - W.cam.x) * .18; W.cam.y += (fy - W.cam.y) * .18; frames.push({ P: sp.pose(W.t, o), cam: { ...W.cam }, o, tAct: -1, hang: 0 }) }
  const tick = () => { stepPhysics(W, DT); ct += DT; if (step++ % rec === 0) recFrame() }
  const jump = (to, T) => { const x0 = sp.x, y0 = sp.y; for (let t = 0; t < T; t += DT) { const u = ease(Math.min(1, (t + DT) / T)), px = sp.x, py = sp.y; sp.x = lerp(x0, to.x, u); sp.y = lerp(y0, to.y, u); lift = Math.sin(Math.PI * u) * 9; sp.vx = (sp.x - px) / DT; sp.vy = (sp.y - py) / DT; tick() } lift = 0; sp.vx = sp.vy = 0 }
  const segStart = C.t, firstSeg = C.phase === 'in'
  if (C.phase === 'in') {
    C.m0 = sp.m; C.env0 = sp.env; sp.env = pageEnv; sp.setMorph(pageMorph(sp.m)); sounds.push({ at: 0, name: 'silk' })
    jump({ x: lay.tx, y: lay.row(0) - CR.LH * .1 }, .7); C.phase = 'read'
  } else sp.env = pageEnv
  // la lecture : elle va de mot important en mot important (dans un ordre un peu désordonné, avec parfois un détour
  // pour jeter un œil ailleurs), comme une vraie araignée : elle se tourne d'abord vers où elle va, puis marche,
  // accélère, ralentit et s'arrête devant le mot ; une patte s'étire pour l'attraper, le mot se marque, elle repart.
  // Les lignes s'éclairent là où elle passe.
  if (!C.path) C.path = crawlPath(C, lay, sp)
  const VMAX = 105, wordAt = m => ({ x: lay.tx + (m.c0 + m.c1) / 2 * CR.CW, y: lay.row(m.row) })
  while (C.phase === 'read' && ct < CR.SEG) {
    C.t += DT
    if (hurry && !C.hurried) { C.hurried = true; C.path = C.path.slice(0, C.pi + 2) }
    const tgt = C.path[C.pi]
    if (!tgt) { for (let i = 0; i < C.rows.length; i++) if (C.rowAt[i] < 0) C.rowAt[i] = 1, C.hit.push({ row: i, at: ct, seg: C.seg }); C.phase = 'out'; break }
    // où se poser : juste avant le mot, du côté d'où elle arrive, pour que sa patte l'atteigne
    const wc = tgt.m ? wordAt(tgt.m) : tgt
    const stand = wc
    const dx = stand.x - sp.x, dy = stand.y - sp.y, d = Math.hypot(dx, dy), px = sp.x, py = sp.y
    // un grand blanc entre elle et le mot (des paragraphes éloignés) : elle ne marche pas dans le vide, elle bondit
    if (!C.gap && C.gapFor !== C.pi && d > 14) { C.gapFor = C.pi; const gk = gapKind(cells, sp, wc, sp.m.legs[0] * 1.45), kind = gk && gk.kind; if (kind) C.gap = { kind, from: { x: sp.x, y: sp.y }, to: { x: wc.x, y: wc.y }, t: 0, T: kind === 'span' ? spanTime(d) : leapTime(d), run0: gk.run } }
    if (C.gap) {
      // un bond, comme une impulsion : elle s'accroupit (pattes fléchies), se détend d'un coup, vole pattes repliées,
      // les tend vers l'avant juste avant de toucher, amortit, et repart
      const G = C.gap; G.t += DT; const u = Math.min(1, G.t / G.T), L = Math.hypot(G.to.x - G.from.x, G.to.y - G.from.y)
      if (G.kind === 'span') {
        // enjamber : ses pattes avant s'étirent au-dessus du blanc et attrapent les lettres du paragraphe d'en face,
        // elle s'y hisse en tirant (le corps glisse, les pattes arrière lâchent en dernier), puis elle repart
        const ux = (G.to.x - G.from.x) / (L || 1), uy = (G.to.y - G.from.y) / (L || 1)
        if (!G.grab) {
          const far = cells.filter(c => (c.x - G.from.x) * ux + (c.y - G.from.y) * uy > G.run0 * .55 && Math.hypot(c.x - G.to.x, c.y - G.to.y) < L), side = c => ((c.x - G.from.x) * -uy + (c.y - G.from.y) * ux)
          const pick = sg => far.filter(c => side(c) * sg >= -2).sort((a, b) => Math.hypot(a.x - G.from.x, a.y - G.from.y) - Math.hypot(b.x - G.from.x, b.y - G.from.y))[0] || { x: G.to.x, y: G.to.y }
          G.grab = { 1: pick(1), [-1]: pick(-1) }
        }
        sp.h += wrap(Math.atan2(uy, ux) - sp.h) * Math.min(1, DT * 8)
        const q = spanAt(G.from, G.grab, u, sp.m, ux, uy)
        over.length = 0; over.push(...q.over.map(o => ({ ...o, t0: -9 })))
        sp.x = q.x; sp.y = q.y; sp.vx = (sp.x - px) / DT; sp.vy = (sp.y - py) / DT; stretch = SPAN_STRETCH; lift = q.lift
        if (u >= 1) { C.gap = null; over.length = 0; stretch = 0; lift = 0; spd = 25 }
        tick(); continue
      }
      sp.h += wrap(Math.atan2(G.to.y - G.from.y, G.to.x - G.from.x) - sp.h) * Math.min(1, DT * 10)
      const q = leapAt(G.from, G.to, u, sp.m); sp.x = q.x; sp.y = q.y; lift = q.lift; tuck = q.tuck
      sp.vx = (sp.x - px) / DT; sp.vy = (sp.y - py) / DT
      if (u >= 1) { C.gap = null; tuck = 0; lift = 0; spd = 35 }
    } else if (d < 5 && C.pi < C.path.length - 1) {
      // elle passe sur le mot sans s'arrêter : si aucun pied ne l'a touché, un petit coup de patte au passage
      const m = tgt.m
      if (m && m.at === undefined) {
        m.at = ct + .1; m.seg = C.seg
        const side = { x: -Math.sin(sp.h), y: Math.cos(sp.h) }, s = (wc.x - sp.x) * side.x + (wc.y - sp.y) * side.y >= 0 ? 1 : -1
        over.push({ i: 0, s, w: 0, t0: ct, p: () => ({ x: wc.x, y: wc.y, z: 0 }) })
      }
      C.pi++
    } else if (d < 1.6) {
      const m = tgt.m; if (m && m.at === undefined) { m.at = ct; m.seg = C.seg } C.pi++
    }
    if (!C.gap) {
      // se tourner vers sa destination et avancer droit devant (jamais de côté : pas de glissade) ; elle ne
      // ralentit qu'en arrivant au dernier mot
      const want = Math.atan2(dy, dx), turn = wrap(want - sp.h), last = C.pi >= C.path.length - 1
      sp.h += clamp(turn, -DT * 8, DT * 8)
      const ahead = Math.max(0, Math.cos(wrap(want - sp.h))), tv = VMAX * (last ? clamp(d / 16, .25, 1) : 1) * (.15 + .85 * ahead * ahead)
      spd += (tv - spd) * Math.min(1, DT * 5)
      sp.x += Math.cos(sp.h) * spd * DT; sp.y += Math.sin(sp.h) * spd * DT
      sp.vx = (sp.x - px) / DT; sp.vy = (sp.y - py) / DT
    }
    // les lignes qu'elle survole s'allument
    const r = Math.round((sp.y - lay.y - 16) / CR.LH - .5)
    for (const i of [r - 1, r, r + 1]) if (i >= 0 && i < C.rows.length && C.rowAt[i] < 0 && Math.abs(lay.row(i) - sp.y) < CR.LH * .9) { C.rowAt[i] = 1; C.hit.push({ row: i, at: ct, seg: C.seg }) }
    for (const rr of over) { const v = (ct - rr.t0) / .35; rr.w = v > 0 && v < 1 ? Math.sin(Math.PI * v) : 0 }
    tick()
  }
  let fadeOut = -1
  if (C.phase === 'out' && ct < CR.SEG + .1) {
    for (let k = 0; k < 6; k++) tick()
    const home = restSpot(W, a) || C.n; fadeOut = ct; jump(home, .6)
    sp.env = C.env0; sp.setMorph(C.m0); sp.x = home.x; sp.y = home.y; sounds.push({ at: ct, name: 'pluck' })
    for (let k = 0; k < 4; k++) tick()
    C.phase = 'done'
  }
  const X = { total: frames.length / FPS, walkDur: 0, act: { tool: 'idle' }, target: C.n, targets: [], plucks: [], edgeNear: [], S, actor: a, sounds, crawl: { C, lay, seg: C.seg, firstSeg, fadeOut, from: segStart }, others: Object.values(W.actors).filter(o => o !== a).map(o => ({ a: o, P: o.sp.pose(W.t, optsFor(o, null, 0, W.env.depth)) })) }
  const clip = renderClip(W, { tool: 'idle' }, frames, X)
  C.seg++; if (C.phase === 'done') W.crawl = null
  return clip
}
// la page, ses marques et le tableau de bord, pour un clip de la lecture
function crawlSVG(X, kt, dur) {
  const { C, lay, seg, firstSeg, fadeOut } = X.crawl, T = Math.max(.1, X.total), col = C.n.lang || langColor(C.n.path || C.n.label)
  const at = t => `begin="${t.toFixed(2)}s"`
  let s = `<g font-family="monospace" xml:space="preserve" style="white-space:pre"${firstSeg ? ' opacity="0"' : ''}>`
  if (firstSeg) s += `<animate attributeName="opacity" values="0;1" dur=".45s" begin=".15s" fill="freeze"/>`
  if (fadeOut >= 0) s += `<animate attributeName="opacity" values="1;0" dur=".6s" ${at(fadeOut + .2)} fill="freeze"/>`
  s += `<rect x="${f1(lay.x)}" y="${f1(lay.y)}" width="${f1(lay.w)}" height="${f1(lay.h)}" rx="3" fill="rgba(9,6,20,.94)" stroke="${col}" stroke-opacity=".7" stroke-width=".4" filter="url(#glow)"/>`
  s += `<text x="${f1(lay.x + 4)}" y="${f1(lay.y + 7)}" font-size="4.6" font-weight="700" fill="${col}">${esc(C.n.label.slice(0, 28))}</text><text x="${f1(lay.x + lay.w - 4)}" y="${f1(lay.y + 7)}" font-size="3.4" text-anchor="end" fill="rgba(200,190,235,.75)">crawler · lecture · l.${C.pg.start + C.s0}–${C.pg.start + C.s0 + C.rows.length - 1}</text>`
  s += `<line x1="${f1(lay.x + 3)}" y1="${f1(lay.y + 10.5)}" x2="${f1(lay.x + lay.w - 3)}" y2="${f1(lay.y + 10.5)}" stroke="#fff" stroke-opacity=".18" stroke-width=".25"/>`
  const rowHit = new Map(C.hit.map(h => [h.row, h]))
  C.rows.forEach((ln, i) => {
    const y = lay.row(i) + CR.FS * .35, h = rowHit.get(i), done = h && h.seg < seg, now = h && h.seg === seg, txt = esc(ln).replace(/^ +/, m => ' '.repeat(m.length))
    s += `<text x="${f1(lay.tx - 3)}" y="${f1(y)}" font-size="3.6" text-anchor="end" fill="rgba(150,140,190,.5)">${C.pg.start + C.s0 + i}</text>`
    s += `<text x="${f1(lay.tx)}" y="${f1(y)}" font-size="${CR.FS}" fill="${done ? '#cdeff5' : 'rgba(205,198,235,.55)'}">${txt}${now ? `<animate attributeName="fill" values="rgba(205,198,235,.55);#e6fdff;#cdeff5" dur=".6s" ${at(h.at)} fill="freeze"/>` : ''}</text>`
  })
  // les mots attrapés : la marque se trace à l'instant où la patte le touche ; un fil relie chaque mot au précédent
  const hits = C.marks.filter(m => m.at !== undefined && m.seg <= seg), pos = m => ({ x: lay.tx + (m.c0 + m.c1) / 2 * CR.CW, y: lay.row(m.row), w: (m.c1 - m.c0) * CR.CW })
  hits.forEach((m, k) => {
    const c = MARK_COL[m.k] || '#ffd36b', p = pos(m), live = m.seg === seg, draw = (len, el) => live ? el.replace('/>', ` stroke-dasharray="${f1(len)}" stroke-dashoffset="${f1(len)}"><animate attributeName="stroke-dashoffset" values="${f1(len)};0" dur=".45s" ${at(m.at)} fill="freeze"/></${el.match(/^<(\w+)/)[1]}>`) : el
    if (m.k === 'def' || m.k === 'ok') { const rx = p.w / 2 + 2.6, ry = CR.LH * .52; s += draw(2 * Math.PI * Math.sqrt((rx * rx + ry * ry) / 2), `<ellipse cx="${f1(p.x)}" cy="${f1(p.y)}" rx="${f1(rx)}" ry="${f1(ry)}" fill="none" stroke="${c}" stroke-width=".55" filter="url(#glow)"/>`) }
    else if (m.k === 'alert') s += draw(p.w + 4, `<path d="M${f1(p.x - p.w / 2 - 2)} ${f1(p.y)}h${f1(p.w + 4)}" stroke="${c}" stroke-width=".8"/>`)
    else if (m.k === 'cst') s += draw(p.w + 2, `<path d="M${f1(p.x - p.w / 2 - 1)} ${f1(p.y + CR.LH * .36)}h${f1(p.w + 2)}" stroke="${c}" stroke-width=".7"/>`)
    else s += `<rect x="${f1(p.x - p.w / 2 - 1.2)}" y="${f1(p.y - CR.LH * .42)}" width="${f1(p.w + 2.4)}" height="${f1(CR.LH * .84)}" rx="1" fill="${c}" fill-opacity=".22" stroke="${c}" stroke-width=".35"${live ? ` opacity="0"><animate attributeName="opacity" values="0;1" dur=".3s" ${at(m.at)} fill="freeze"/></rect>` : '/>'}`
    if (k) { const q = pos(hits[k - 1]), len = Math.hypot(p.x - q.x, p.y - q.y); s += draw(len, `<path d="M${f1(q.x)} ${f1(q.y)}L${f1(p.x)} ${f1(p.y)}" stroke="#7df9ff" stroke-opacity=".45" stroke-width=".3"/>`) }
  })
  // le tableau de bord, sous la page
  const hx = lay.x, hy = lay.y + lay.h + 3, readNow = C.hit.filter(h => h.seg <= seg).length, wps = Math.max(1, Math.round(C.words * readNow / C.rows.length / Math.max(1, C.t)))
  s += `<rect x="${f1(hx)}" y="${f1(hy)}" width="${f1(lay.w)}" height="15" fill="#1d3cff" fill-opacity=".85"/>`
  s += `<text x="${f1(hx + 3)}" y="${f1(hy + 5.4)}" font-size="3.6" fill="#e8f0ff">CRAWLER/01 · ${wps} mots/s · ${String(Math.round(C.words * readNow / C.rows.length)).padStart(3, '0')} / ${String(C.words).padStart(3, '0')} mots</text>`
  s += `<text x="${f1(hx + 3)}" y="${f1(hy + 11.6)}" font-size="3.6" fill="#e8f0ff">MOTS-CLÉS ${String(hits.length).padStart(2, '0')}${hits.length ? ' ·' : ''}`
  hits.forEach(m => { s += `<tspan fill="${MARK_COL[m.k]}"${m.seg === seg ? ` opacity="0"><set attributeName="opacity" to="1" ${at(m.at)}/` : ''}> ${esc(m.word.slice(0, 14).toUpperCase())}</tspan>` })
  return s + '</text></g>'
}

function pageCardSVG(ev, X) {
  const pg = ev.page, n = X.target, kind = pg.kind || 'read', R = 7, L = pg.lines.length
  const focus = pg.hi ? pg.hi[0] : 0, s0 = clamp(focus - 2, 0, Math.max(0, L - R)), rows = pg.lines.slice(s0, s0 + R)
  const w = 120, lh = 5.4, h = 13 + rows.length * lh + 3, x = n.x + 10, y = n.y - h - 12
  const col = n.lang || langColor(n.path || n.label), b = X.walkDur + .2, T = Math.max(.6, X.total - X.walkDur)
  const what = kind === 'read' ? 'lecture' : kind === 'write' ? 'écriture' : 'modification'
  let s = `<g opacity="0" font-family="monospace" xml:space="preserve" style="white-space:pre"><animate attributeName="opacity" values="0;1;1;0" keyTimes="0;.1;.88;1" dur="${T.toFixed(2)}s" begin="${b.toFixed(2)}s" fill="freeze"/>`
  s += `<rect x="${f1(x)}" y="${f1(y)}" width="${w}" height="${f1(h)}" rx="2.6" fill="rgba(9,6,20,.95)" stroke="${col}" stroke-opacity=".7" stroke-width=".35" filter="url(#glow)"/>`
  s += `<text x="${f1(x + 3)}" y="${f1(y + 5.4)}" font-size="3.5" font-weight="700" fill="${col}">${esc(n.label.slice(0, 26))}</text><text x="${f1(x + w - 3)}" y="${f1(y + 5.4)}" font-size="2.8" text-anchor="end" fill="rgba(200,190,235,.75)">${ev.actor === 'bg' ? 'tâche de fond' : 'agent'} · ${what}</text>`
  s += `<line x1="${f1(x + 2)}" y1="${f1(y + 8)}" x2="${f1(x + w - 2)}" y2="${f1(y + 8)}" stroke="#fff" stroke-opacity=".18" stroke-width=".2"/>`
  rows.forEach((ln, k) => {
    const i = s0 + k, yy = y + 13 + k * lh, inHi = !!pg.hi && i >= pg.hi[0] && i <= pg.hi[1], txt = esc(ln.slice(0, 46)).replace(/^ +/, m => '\u00a0'.repeat(m.length))
    s += `<text x="${f1(x + 9)}" y="${f1(yy)}" font-size="2.7" text-anchor="end" fill="${inHi ? 'rgba(157,255,138,.75)' : 'rgba(150,140,190,.5)'}">${pg.start + i}</text>`
    if (kind === 'read') {
      // la lecture : chaque ligne s'allume à son tour
      const bk = (b + .35 + k * .28).toFixed(2)
      s += `<rect x="${f1(x + 11)}" y="${f1(yy - lh * .72)}" width="${f1(w - 13)}" height="${f1(lh)}" fill="#7df9ff" opacity="0"><animate attributeName="opacity" values="0;.28;.08" dur=".7s" begin="${bk}s" fill="freeze"/></rect>`
      s += `<text x="${f1(x + 12)}" y="${f1(yy)}" font-size="3" fill="rgba(205,198,235,.6)">${txt}<animate attributeName="fill" values="rgba(205,198,235,.6);#e6fdff;#cdeff5" dur=".7s" begin="${bk}s" fill="freeze"/></text>`
    } else if (inHi || kind === 'write') {
      // le tissage : la ligne apparaît de gauche à droite
      const bk = (b + .7 + k * .38).toFixed(2)
      s += `<clipPath id="pc${k}"><rect x="${f1(x + 11)}" y="${f1(yy - lh)}" width="0" height="${f1(lh * 1.4)}"><animate attributeName="width" values="0;${w - 12}" dur=".45s" begin="${bk}s" fill="freeze"/></rect></clipPath>`
      s += `<rect x="${f1(x + 11)}" y="${f1(yy - lh * .72)}" width="${f1(w - 13)}" height="${f1(lh)}" fill="#9dff8a" opacity=".1"/>`
      s += `<text x="${f1(x + 12)}" y="${f1(yy)}" font-size="3" fill="#e6ffe0" clip-path="url(#pc${k})" filter="url(#glow)">${txt}</text>`
    } else s += `<text x="${f1(x + 12)}" y="${f1(yy)}" font-size="3" fill="rgba(205,198,235,.55)">${txt}</text>`
  })
  return s + '</g>'
}
