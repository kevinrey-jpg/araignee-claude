import { expect, test } from 'claude-code/testing'

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
  on('clock.after', () => ({ value: {} }))
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
