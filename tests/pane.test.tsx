import { expect, test } from 'claude-code/testing'
import * as E from '../hooks/engine'

const PANE = {
  plugin: 'araignee',
  component: 'Pane',
  requestId: 'araignee',
  props: { title: 'Araignée', isFocused: false, bodyColumns: 60, placement: 'dock', scroll: { offset: 0, bodyRows: 30 }, view: {} },
} as const

// un petit graphe au format Graphify
const GRAPH = {
  nodes: [
    { id: 'src/a.ts', label: 'a.ts', type: 'file', community: 0, source_file: 'src/a.ts' },
    { id: 'src/b.ts', label: 'b.ts', type: 'file', community: 0, source_file: 'src/b.ts' },
    { id: 'fa', label: 'start', type: 'function', community: 0 },
    { id: 'docs/c.md', label: 'c.md', type: 'file', community: 1, source_file: 'docs/c.md' },
  ],
  links: [{ source: 'src/a.ts', target: 'fa', relation: 'contains' }, { source: 'fa', target: 'src/b.ts' }, { source: 'src/b.ts', target: 'docs/c.md' }],
}

test("une lecture de Claude fait jouer un clip SVG de l'araignée", async ($, on) => {
  on('command.register', () => ({ value: { command: 'araignee' } }))
  on('ui.open', () => ({ value: { isPlaced: true } }))
  on('ui.panes', () => ({ value: [] }))
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  on('session.cwd', () => ({ value: '/proj' }))
  on('fs.read', () => ({ value: JSON.stringify(GRAPH) }))
  on('store.get', () => ({ value: undefined }))
  on('fs.list', () => ({ value: [] }))
  on('clock.after', () => ({ value: undefined }))
  on('tool.call', () => ({ result: {}, text: '     1\texport const a = 1\n     2\texport const b = 2' }))

  await $.session.start({ cwd: '/proj', surface: 'desktop', isInteractive: true })
  await $.tool.call({ tool: 'Read', file_path: '/proj/src/b.ts' })
  for (let i = 0; i < 20; i++) await Promise.resolve()

  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  const svg: any = await ui.find({ type: 'Svg' })
  expect(String(svg?.props?.source ?? svg?.source ?? '')).toContain('<svg')
  expect((await ui.find({ type: 'Text', text: /Read/ }))?.text).toBe('Read')
  await ui.unmount()

  const term = await $.ui.mount({ ...PANE, surface: 'terminal' })
  expect((await term.find({ type: 'Text', text: /bureau/ }))).toBeDefined()
  await term.unmount()
})

test('à la fin du tour, le panneau affiche le bilan de ce que Claude a fait', async ($, on) => {
  on('command.register', () => ({ value: { command: 'araignee' } }))
  on('ui.open', () => ({ value: { isPlaced: true } }))
  on('ui.panes', () => ({ value: [] }))
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  on('session.cwd', () => ({ value: '/proj' }))
  on('fs.read', () => ({ value: JSON.stringify(GRAPH) }))
  on('store.get', () => ({ value: undefined }))
  on('fs.list', () => ({ value: [] }))
  on('clock.after', () => ({ value: undefined }))
  on('tool.call', () => ({ result: {}, text: 'ok' }))
  on('turn.start', (_, e) => ({ turnId: e.turnId }) as any)
  on('turn.complete', (_, e) => ({ text: e.answer }))

  await $.session.start({ cwd: '/proj', surface: 'desktop', isInteractive: true })
  await $.turn.start({ turnId: 't1', prompt: 'corrige b' } as any)
  await $.tool.call({ tool: 'Read', file_path: '/proj/src/b.ts' })
  await $.tool.call({ tool: 'Edit', file_path: '/proj/src/b.ts', old_string: 'a\nb', new_string: 'a\nb\nc', replace_all: false })
  await $.tool.call({ tool: 'Bash', command: 'npm test' })
  await $.turn.complete({ turnId: 't1', answer: "J'ai corrigé **b.ts** : la fonction renvoie le bon total. Les tests passent.", durationMs: 74000, isAborted: false, reason: 'answer' } as any)
  for (let i = 0; i < 20; i++) await Promise.resolve()

  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  expect((await ui.find({ type: 'Text', text: /Bilan du tour/ }))).toBeDefined()
  expect((await ui.find({ type: 'Text', text: /corrigé b\.ts : la fonction renvoie le bon total\./ }))).toBeDefined()
  expect((await ui.find({ type: 'Text', text: /b\.ts \+3 −2/ }))).toBeDefined()
  expect((await ui.find({ type: 'Text', text: /Commandes · 1/ }))).toBeDefined()
  expect((await ui.find({ type: 'Button', text: /Agrandir/ }))).toBeDefined()
  await ui.unmount()
})

test("une tâche en arrière-plan qui modifie un fichier fait bouger l'araignée", async ($, on) => {
  let mtime = 1000
  on('command.register', () => ({ value: { command: 'araignee' } }))
  on('ui.open', () => ({ value: { isPlaced: true } }))
  on('ui.panes', () => ({ value: [] }))
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  on('session.cwd', () => ({ value: '/proj' }))
  on('fs.read', () => ({ value: JSON.stringify(GRAPH) }))
  on('fs.list', (_, e: any) => ({ value: e.path === '/proj' ? [{ name: 'src', kind: 'dir', size: 0, mtimeMs: 1, isLink: false }] : [{ name: 'b.ts', kind: 'file', size: 10, mtimeMs: mtime, isLink: false }] }) as any)
  on('store.get', () => ({ value: undefined }))
  on('clock.after', () => ({ value: undefined }))
  // chaque période de la sentinelle : le fichier a changé entre-temps
  let periods = 0
  on('clock.every', (_, e: any) => { if (e.ms !== 2500) return { value: undefined }; periods += 1; if (periods > 3) return { deny: 'fin du test' } as any; mtime += 1000; return { value: undefined } })
  on('tool.call', () => ({ result: {}, text: 'ok' }))

  await $.session.start({ cwd: '/proj', surface: 'desktop', isInteractive: true })
  await $.tool.call({ tool: 'Read', file_path: '/proj/src/a.ts' })
  for (let i = 0; i < 200; i++) await Promise.resolve()

  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  expect((await ui.find({ type: 'Text', text: /Arrière-plan · b\.ts/ }))).toBeDefined()
  await ui.unmount()
})

// le socle commun des tests suivants
function base(on: any, read?: (path: string) => string, hold = false) {
  on('command.register', () => ({ value: { command: 'araignee' } }))
  on('ui.open', () => ({ value: { isPlaced: true } }))
  on('ui.panes', () => ({ value: [] }))
  on('session.start', (_: any, e: any) => ({ cwd: e.cwd }))
  on('session.cwd', () => ({ value: '/proj' }))
  on('fs.read', (_: any, e: any) => ({ value: read ? read(String(e.path)) : JSON.stringify(GRAPH) }) as any)
  on('fs.list', () => ({ value: [] }))
  // hold : les minuteries ne partent pas, le clip en cours reste affiché (donc toile à plat : en sphère, la rotation passerait d'abord)
  on('store.get', (_: any, e: any) => ({ value: hold && e.key === 'toile' ? 'classique' : undefined }))
  on('clock.after', () => (hold ? { deny: 'on garde le clip' } : { value: undefined }) as any)
}
const flush = async () => { for (let i = 0; i < 200; i++) await Promise.resolve() }

test("une commande qui échoue : l'araignée se recroqueville, le fil casse, puis elle le retisse", async ($, on) => {
  base(on)
  const logs: string[] = []
  on('ui.log', (_: any, e: any) => { logs.push(String(e.text ?? e.message ?? JSON.stringify(e))); return { value: undefined } })
  on('clock.every', () => ({ deny: 'pas de sentinelle ici' }) as any)
  on('tool.call', (_: any, e: any) => e.tool === 'Bash' ? { isError: true, result: 'boom', text: 'Error: exit 1' } as any : { result: {}, text: 'ok' })
  await $.session.start({ cwd: '/proj', surface: 'desktop', isInteractive: true })
  await $.tool.call({ tool: 'Bash', command: 'npm test' })
  await flush()
  expect(logs.join('\n')).toBe('')
  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  expect((await ui.find({ type: 'Text', text: /Repair|Retisse/ }))).toBeDefined()
  await ui.unmount()
})

test('la mémoire de la toile est gardée pour la prochaine discussion', async ($, on) => {
  base(on)
  const saved: any[] = []
  on('store.set', (_: any, e: any) => { saved.push(e); return { value: undefined } })
  on('tool.call', () => ({ result: {}, text: 'ok' }))
  await $.session.start({ cwd: '/proj', surface: 'desktop', isInteractive: true })
  await $.tool.call({ tool: 'Edit', file_path: '/proj/src/b.ts', old_string: 'a', new_string: 'b', replace_all: false })
  await flush()
  const m = saved.find(s => String(s.key).startsWith('mem-'))
  expect(m).toBeDefined()
  expect(m.value['src/b.ts'].e).toBe(1)
})

test("un sous-agent a son bébé araignée, qui remonte quand l'agent a fini", async ($, on) => {
  base(on)
  on('tool.call', () => ({ result: {}, text: 'ok' }))
  on('turn.complete', (_: any, e: any) => ({ text: e.answer }))
  await $.session.start({ cwd: '/proj', surface: 'desktop', isInteractive: true })
  await $.tool.call({ tool: 'Read', file_path: '/proj/src/a.ts', agentId: 'a1' } as any)
  await flush()
  let ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  expect((await ui.find({ type: 'Text', text: /Agent · Read/ }))).toBeDefined()
  await ui.unmount()
  await $.turn.complete({ turnId: 't1', agentId: 'a1', answer: 'fini', durationMs: 1000, isAborted: false, reason: 'answer' } as any)
  await flush()
  ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  expect((await ui.find({ type: 'Text', text: /Leave/ }))).toBeDefined()
  await ui.unmount()
})

test("un agent qui modifie un fichier ouvre une petite page avec les vraies lignes", async ($, on) => {
  base(on, path => path.endsWith('b.ts') ? 'const a = 1\nfunction total(items) {\n  return items.reduce(add, 0)\n}\n' : JSON.stringify(GRAPH), true)
  on('tool.call', () => ({ result: {}, text: 'ok' }))
  await $.session.start({ cwd: '/proj', surface: 'desktop', isInteractive: true })
  await $.tool.call({ tool: 'Edit', file_path: '/proj/src/b.ts', old_string: '  return 0', new_string: '  return items.reduce(add, 0)', replace_all: false, agentId: 'a1' } as any)
  for (let i = 0; i < 200; i++) await Promise.resolve()
  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  const svg: any = await ui.find({ type: 'Svg' })
  const src = String(svg?.props?.source ?? svg?.source ?? '')
  expect(src).toContain('agent · modification')
  expect(src).toContain('return items.reduce(add, 0)')
  await ui.unmount()
})

test('sur un très gros projet, chaque animation reste sous la taille que le panneau accepte', async () => {
  const nodes: any[] = [], links: any[] = []
  for (let i = 0; i < 900; i++) { const c = i % 14, isF = i % 4 === 0; nodes.push({ id: isF ? `pkg${c}/m${i}.py` : `sym${i}`, label: isF ? `m${i}.py` : `fn_${i}`, type: isF ? 'file' : 'function', community: c, source_file: isF ? `pkg${c}/m${i}.py` : undefined }) }
  for (let i = 1; i < 900; i++) { links.push({ source: nodes[i].id, target: nodes[(i * 7 + 3) % i].id }); if (i % 3 === 0) links.push({ source: nodes[i].id, target: nodes[(i * 13) % 900].id }) }
  const W: any = E.createWorld(E.graphFromGraphify({ nodes, links }), 'fusion')
  W.aspect = .7
  const files = W.g.nodes.filter((n: any) => n.kind === 'file').map((n: any) => n.path)
  const evs = [{ tool: 'Read', path: files[5], label: 'Read', lines: ['a'] }, { tool: 'Edit', path: files[90], label: 'Edit', lines: ['- a', '+ b'] }, { tool: 'Grep', targets: files.slice(0, 5), label: 'g', lines: ['✓'] }, { tool: 'Bash', label: '$ x', lines: ['$'] }, { tool: 'Mood', ok: false, label: 'x', lines: ['✗'] }, { tool: 'Repair', label: 'r', lines: ['r'] }, { tool: 'Write', path: 'pkg3/neuf.py', label: 'w', lines: ['+ x'], actor: 'agent:1', page: { start: 1, lines: ['a', 'b'], hi: [0, 1], kind: 'write' } }, { tool: 'Leave', actor: 'agent:1', label: 'l', lines: [] }]
  for (const ev of evs) expect(E.makeClip(W, ev).svg.length).toBeLessThan(131072)
  expect(E.sleepClip(W).svg.length).toBeLessThan(131072)
  expect(E.idleClip(W).svg.length).toBeLessThan(131072)
})

test("un dossier supprimé : ses fichiers sont vus comme supprimés", async ($, on) => {
  let gone = false
  on('command.register', () => ({ value: { command: 'araignee' } }))
  on('ui.open', () => ({ value: { isPlaced: true } }))
  on('ui.panes', () => ({ value: [] }))
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  on('session.cwd', () => ({ value: '/proj' }))
  on('fs.read', () => ({ value: JSON.stringify(GRAPH) }))
  on('fs.list', (_, e: any) => (e.path === '/proj' ? { value: gone ? [] : [{ name: 'src', kind: 'dir', size: 0, mtimeMs: 1, isLink: false }] } : gone ? { deny: 'absent' } : { value: [{ name: 'b.ts', kind: 'file', size: 10, mtimeMs: 1, isLink: false }] }) as any)
  on('fs.exists', () => ({ value: !gone }))
  on('store.get', (_: any, e: any) => ({ value: e.key === 'toile' ? 'classique' : undefined }))
  on('clock.after', () => ({ value: undefined }))
  let periods = 0
  on('clock.every', (_, e: any) => { if (e.ms !== 2500) return { value: undefined }; periods += 1; if (periods > 2) return { deny: 'fin du test' } as any; gone = true; return { value: undefined } })
  on('tool.call', () => ({ result: {}, text: 'ok' }))
  await $.session.start({ cwd: '/proj', surface: 'desktop', isInteractive: true })
  await $.tool.call({ tool: 'Read', file_path: '/proj/README.md' })
  for (let i = 0; i < 300; i++) await Promise.resolve()
  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  // la suppression fait claquer les fils : une araignée vient ensuite retisser la toile
  expect((await ui.find({ type: 'Text', text: /Retisse la toile/ }))).toBeDefined()
  await ui.unmount()
})

test("une cible injoignable par la soie : l'araignée y descend sur son fil au lieu d'étirer ses pattes", () => {
  const g: any = E.graphFromTree(['src/a.ts', 'src/b.ts', 'docs/c.md'], 'proj')
  const W: any = E.createWorld(g, 'fusion')
  // on coupe tous les fils de docs/c.md : il devient injoignable
  const c = g.nodes.find((n: any) => n.id === 'docs/c.md')
  g.adj[c.id].forEach((v: string) => { g.edges[g.edgeIdx[c.id + '|' + v]].broken = { kind: 'snap' } })
  const clip = E.makeClip(W, { tool: 'Read', path: 'docs/c.md', label: 'Read', lines: ['x'] })
  const sp = W.actors.main.sp
  expect(Math.hypot(sp.x - c.x, sp.y - c.y)).toBeLessThan(30)
  // les pattes restent près du corps : aucune ne s'étire au loin
  const far = Math.max(...sp.legs.map((L: any) => Math.hypot(L.foot.x - sp.x, L.foot.y - sp.y)))
  expect(far).toBeLessThan(sp.m.R * 1.6)
  expect(clip.svg.length).toBeLessThan(131072)
})

test("un nouveau fichier n'est jamais accroché à un fichier supprimé", () => {
  const g: any = E.graphFromTree(['e2e/router.py', 'src/a.ts'], 'proj')
  const r = g.nodes.find((n: any) => n.id === 'e2e/router.py')
  r.gone = true
  const n = E.nodeForPath(g, 'e2e/notes.md')
  expect(g.adj[n.id].includes('e2e/router.py')).toBe(false)
})

test('des centaines d’événements inattendus : jamais d’erreur, jamais une animation trop lourde', async () => {
  const nodes: any[] = [], links: any[] = []
  for (let i = 0; i < 160; i++) { const c = i % 9, isF = i % 3 === 0; nodes.push({ id: isF ? `pkg${c}/m${i}.py` : `sym${i}`, label: isF ? `m${i}.py` : `fn_${i}`, type: isF ? 'file' : 'function', community: c, source_file: isF ? `pkg${c}/m${i}.py` : undefined }) }
  for (let i = 1; i < 160; i++) links.push({ source: nodes[i].id, target: nodes[(i * 7 + 3) % i].id })
  const W: any = E.createWorld(E.graphFromGraphify({ nodes, links }), 'fusion')
  W.aspect = .63
  const files = W.g.nodes.filter((n: any) => n.kind === 'file').map((n: any) => n.path)
  let r = 11
  const R = () => (r = (r * 16807) % 2147483647) / 2147483647, pick = (a: any[]) => a[Math.floor(R() * a.length)]
  const tools = ['Read', 'Edit', 'Write', 'Grep', 'Bash', 'WebSearch', 'Mood', 'Delete', 'Leave', 'Repair', undefined]
  const paths = [...files.slice(0, 12), 'nouveau/x.py', '', undefined]
  for (let i = 0; i < 90; i++) {
    const tool = pick(tools), ev: any = { tool, toolName: tool, path: pick(paths), label: R() < .1 ? undefined : 'x', lines: R() < .5 ? [] : ['+ a', 'x'.repeat(200)], actor: pick(['main', 'agent:1', 'bg', undefined]), ok: R() < .5 }
    if (R() < .3) ev.targets = R() < .2 ? 'pas-un-tableau' : [pick(paths), pick(paths)]
    if (R() < .3) ev.page = { start: 3, lines: ['a', 'b', 'c'], hi: [0, 1], kind: 'edit' }
    const c = E.makeClip(W, ev)
    expect(c.svg.length).toBeLessThan(131072)
    expect(c.svg).not.toContain('NaN')
  }
  expect(E.idleClip(W).svg.length).toBeLessThan(131072)
})

test('en sphère : la boule se tourne vers la cible, puis l’action se joue, la foudre part de l’araignée', () => {
  const g: any = E.graphFromTree(['src/a.ts', 'src/b.ts', 'src/c.ts', 'docs/d.md', 'docs/e.md', 'lib/f.lua', 'lib/g.lua', 'README.md'], 'proj')
  const W: any = E.createWorld(g, 'fusion')
  W.aspect = .63
  E.sphereInit(W)
  expect(W.g.nodes.every((n: any) => n.p3 && Number.isFinite(n.x) && Number.isFinite(n.y))).toBe(true)
  for (const p of ['docs/e.md', 'lib/g.lua', 'src/a.ts']) {
    const ev = { tool: 'Read', path: p, label: 'Read', lines: ['x'] }
    const pre: any = E.turnClip(W, ev), c: any = E.makeClip(W, ev)
    if (pre) { expect(pre.svg.length).toBeLessThan(131072); expect(pre.svg).not.toContain('NaN') }
    expect(c.svg.length).toBeLessThan(131072)
    expect(c.svg).not.toContain('NaN')
    expect(c.svg).toMatch(/href="#s[48]/)
  }
  // au repos, la foudre repart de l’araignée
  W.sph.lastBolt = 0
  const idle: any = E.idleClip(W)
  expect(idle.svg).toContain('stroke-dashoffset')
  expect(idle.dur).toBeGreaterThan(5)
})

test("la caméra du panneau : le zoom reste, elle suit l'agent qui travaille, et en mode libre elle ne bouge plus", () => {
  const g: any = E.graphFromTree(['src/a.ts', 'src/b.ts', 'src/c.ts', 'docs/d.md', 'docs/e.md', 'lib/f.lua'], 'proj', [['src/a.ts', 'src/b.ts']])
  const W: any = E.createWorld(g, 'fusion')
  W.aspect = .63
  E.sphereInit(W)
  const vb = (svg: string) => +svg.match(/viewBox="[-\d.]+ [-\d.]+ ([\d.]+)/)![1]
  const w1 = vb(E.idleClip(W).svg)
  E.setZoom(W, 2)
  expect(Math.abs(vb(E.idleClip(W).svg) - w1 / 2)).toBeLessThan(1)
  expect(Math.abs(vb(E.idleClip(W).svg) - w1 / 2)).toBeLessThan(1)
  // un agent se met au travail : la caméra le suit, même au repos ensuite
  E.makeClip(W, { tool: 'Read', path: 'docs/e.md', label: 'Read', lines: ['x'], actor: 'agent:z' })
  expect(W.camId).toBe('agent:z')
  // libre : la vue reste au même endroit, quoi que fasse l'araignée
  E.setFollow(W, false)
  const box = (svg: string) => svg.match(/viewBox="([^"]+)"/)![1]
  const b0 = box(E.idleClip(W).svg), c: any = E.makeClip(W, { tool: 'Read', path: 'lib/f.lua', label: 'Read', lines: ['x'] })
  expect(box(c.svg)).toBe(b0)
  expect(c.svg).not.toContain('attributeName="viewBox"')
  E.setFollow(W, true)
  expect(W.free).toBe(null)
})

test("fermée avec /araignee-fermer, l'araignée ne se rouvre pas toute seule ; /araignee la rouvre", async ($, on) => {
  let opens = 0, closes = 0
  on('command.register', () => ({ value: { command: 'araignee' } }))
  on('ui.open', () => { opens++; return { value: { isPlaced: true } } })
  on('ui.panes', () => ({ value: [] }))
  on('session.start', (_: any, e: any) => ({ cwd: e.cwd }))
  on('session.cwd', () => ({ value: '/proj' }))
  on('session.id', () => ({ value: 'sess-test' }))
  on('fs.read', () => ({ value: JSON.stringify(GRAPH) }))
  on('fs.list', () => ({ value: [] }))
  on('store.get', () => ({ value: undefined }))
  on('clock.after', () => ({ deny: 'pas de minuterie ici' }) as any)
  on('ui.close', () => { closes++; return { value: undefined } })
  on('tool.call', () => ({ result: {}, text: 'ok' }))
  on('store.set', () => ({ value: undefined }))
  await $.session.start({ cwd: '/proj', surface: 'desktop', isInteractive: true })
  const r: any = await $.command.run({ command: 'araignee-fermer', args: '' } as any)
  expect(String(r?.text ?? '')).toContain('fermée')
  expect(closes).toBe(1)
  const before = opens
  await $.tool.call({ tool: 'Read', file_path: '/proj/src/b.ts' })
  await flush()
  expect(opens).toBe(before)
  // fermée, le bandeau passe son tour (next) : il ne dessine pas l'araignée
  let band = ''
  try { const ui = await $.ui.mount({ ...PANE, component: 'AbovePrompt', props: {}, surface: 'desktop' } as any); band = (await ui.find({ type: 'Svg' })) ? 'svg' : 'vide'; await ui.unmount() } catch (err) { band = /no implementation for ui.render/.test(String(err)) ? 'laissé' : String(err) }
  expect(['vide', 'laissé']).toContain(band)
  await $.command.run({ command: 'araignee', args: '' } as any)
  expect(opens).toBe(before + 1)
})
