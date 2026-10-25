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
  on('clock.every', () => { periods += 1; if (periods > 3) return { deny: 'fin du test' } as any; mtime += 1000; return { value: undefined } })
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
  on('store.get', () => ({ value: undefined }))
  // hold : les minuteries ne partent pas, le clip en cours reste affiché
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
