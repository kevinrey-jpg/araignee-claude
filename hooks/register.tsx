import { atom, read, update } from 'claude-code'
import type { Register, EngineInterface } from 'claude-code'

import type { Clip, Status, Recap } from '../types'
import { createWorld, graphFromGraphify, graphFromTree, idleClip, makeClip, nodeForPath, setSkin, SKINS, TOOL_COLOR } from './engine'

const PANE = 'araignee'
// Changer l'étiquette quand la forme d'une valeur change : elle survit aux rechargements.
const clipAtom = atom({ plugin: 'araignee', key: 'clip' } as const, { svg: '', seq: 0 }, { shape: 'clip-1' })
const statusAtom = atom({ plugin: 'araignee', key: 'status' } as const, { tool: 'prête', path: '', source: '' }, { shape: 'status-1' })
const skinAtom = atom({ plugin: 'araignee', key: 'skin' } as const, 'fusion')
const recapAtom = atom({ plugin: 'araignee', key: 'recap' } as const, { title: '', duration: '', said: '', rows: [], at: 0 } as Recap, { shape: 'recap-1' })
const grandAtom = atom({ plugin: 'araignee', key: 'grand' } as const, false)

const TOOLS: Record<string, string> = { Read: 'Read', Edit: 'Edit', MultiEdit: 'Edit', NotebookEdit: 'Edit', Write: 'Write', Grep: 'Grep', Glob: 'Grep', Bash: 'Bash', WebSearch: 'Web', WebFetch: 'Web' }
const IGNORE = new Set(['node_modules', '.git', 'dist', 'build', 'out', '.next', '.venv', 'venv', '__pycache__', '.cache', 'coverage', 'target', '.idea', '.vscode', 'graphify-out'])

type Ev = { tool: string; toolName: string; path?: string; targets?: string[]; label: string; lines: string[] }
// le monde de l'araignée vit dans le module : un rechargement le reconstruit
let world: any = null
let loading: Promise<void> | null = null
let cwd = ''
let source = ''
let queue: Ev[] = []
let playing = false
// la fenêtre du navigateur : quand le panneau ne peut pas s'afficher, la toile vit dans une page locale
let viewerDir = ''
let sid = ''
let liveSeq = 0
let liveEvents: any[] = []
let shown = false
// ce que Claude a fait pendant le tour en cours, pour le bilan de fin
type Turn = { reads: string[]; edits: Map<string, { add: number; del: number; created: boolean }>; greps: string[]; bash: string[]; web: string[] }
const newTurn = (): Turn => ({ reads: [], edits: new Map(), greps: [], bash: [], web: [] })
let turn = newTurn()
let grandRun: { return?: () => unknown } | null = null

const norm = (p: string) => p.replace(/\\/g, '/').replace(/\/+$/, '')
function rel(p: unknown): string | undefined {
  if (typeof p !== 'string' || !p) return undefined
  const a = norm(p), c = norm(cwd)
  if (c && a.toLowerCase().startsWith(c.toLowerCase() + '/')) return a.slice(c.length + 1)
  return a.replace(/^\.\//, '')
}
const firstLines = (text: string | undefined, n: number) => (text || '').split('\n').map(l => l.replace(/^\s*\d+[\t→]/, '').replace(/\t/g, ' ').trimEnd()).filter(l => l.trim()).slice(0, n)

async function ensureWorld($: EngineInterface) {
  if (world) return
  if (!loading) loading = (async () => {
    cwd = await $.session.cwd()
    const project = norm(cwd).split('/').pop() || 'projet'
    let graph: any = null
    try {
      const json = JSON.parse(await $.fs.read(`${cwd}/graphify-out/graph.json`) as string)
      graph = graphFromGraphify(json)
      source = 'Graphify'
    } catch {
      const files: string[] = []
      const walk = async (dir: string, depth: number) => {
        if (files.length >= 300 || depth > 4) return
        const entries = await $.fs.list(dir ? `${cwd}/${dir}` : cwd).catch(() => [])
        for (const en of entries) {
          if (files.length >= 300) return
          if (en.name.startsWith('.') && en.name !== '.claude-plugin') continue
          const p = dir ? `${dir}/${en.name}` : en.name
          if (en.kind === 'dir' && !IGNORE.has(en.name)) await walk(p, depth + 1)
          else if (en.kind === 'file') files.push(p)
        }
      }
      await walk('', 0)
      graph = graphFromTree(files, project)
      source = 'dossiers'
    }
    const saved = await $.store.get('skin')
    world = createWorld(graph, typeof saved === 'string' ? saved : 'fusion')
    await $.state.set({ plugin: 'araignee', key: 'skin' }, world.skin)
  })()
  await loading
}

async function showClip($: EngineInterface, clip: { svg: string }) {
  await update($, clipAtom, old => ({ svg: clip.svg, seq: (old?.seq || 0) + 1 }))
}

async function pump($: EngineInterface) {
  if (playing) return
  const ev = queue.shift()
  if (!ev) { if (world) await showClip($, idleClip(world)); return }
  playing = true
  try {
    await ensureWorld($)
    await update($, statusAtom, () => ({ tool: ev.toolName, path: ev.label, source }))
    const clip = makeClip(world, ev)
    await showClip($, clip)
    $.clock.after(Math.max(500, clip.dur * 1000 + 150), () => { playing = false; void pump($) })
  } catch (err) {
    playing = false
    $.ui.log(`araignee : ${String(err)}`)
  }
}

const VIEWER_TOOL: Record<string, string> = { Read: 'Read', Edit: 'Edit', MultiEdit: 'Edit', NotebookEdit: 'Edit', Write: 'Write', Grep: 'Grep', Glob: 'Glob', Bash: 'Bash', WebSearch: 'WebSearch', WebFetch: 'WebSearch' }
const nodeData = (n: any) => ({ id: n.id, label: n.label, kind: n.kind, comm: n.comm, x: Math.round(n.x * 10) / 10, y: Math.round(n.y * 10) / 10, path: n.path })
async function viewerSetup($: EngineInterface) {
  if (viewerDir) return
  await ensureWorld($)
  const home = (await $.env.get('USERPROFILE')) || (await $.env.get('HOME')) || cwd
  const dir = norm(home) + '/.claude/araignee'
  sid = String((await $.session.id()) || Date.now()).replace(/[^A-Za-z0-9_-]/g, '').slice(0, 16)
  const g = world.g
  const data = { name: norm(cwd).split('/').pop() || 'projet', comms: g.comms.map((c: any) => ({ name: c.name, col: c.col })), nodes: g.nodes.map(nodeData), edges: g.edges.map((e: any) => ({ a: e.a, b: e.b, kind: e.kind })) }
  await $.fs.write(`${dir}/graph-${sid}.js`, 'window.ARAIGNEE_GRAPH = ' + JSON.stringify(data) + ';\n')
  const html = await $.fs.read(`${$.plugin.root}/viewer/viewer.html`) as string
  await $.fs.write(`${dir}/araignee-${sid}.html`, html.replace('<!--SID-->', `<script>window.ARAIGNEE_SID = ${JSON.stringify(sid)}</script><script src="graph-${sid}.js"></script>`))
  viewerDir = dir
  await writeLive($)
}
async function writeLive($: EngineInterface) {
  if (!viewerDir) return
  await $.fs.write(`${viewerDir}/live-${sid}.js`, `window.__araigneeLive && window.__araigneeLive(${JSON.stringify({ seq: liveSeq, events: liveEvents })});\n`)
}
async function openViewer($: EngineInterface): Promise<string> {
  await viewerSetup($)
  const file = `${viewerDir}/araignee-${sid}.html`
  const tries = (await $.env.get('OS')) === 'Windows_NT' ? [['explorer', file.replace(/\//g, '\\')]] : [['open', file], ['xdg-open', file]]
  for (const argv of tries) { try { await $.process.run(argv, { timeoutMs: 8000 }); break } catch { /* on essaie le suivant */ } }
  return file
}
// la toile s'affiche une fois par discussion : dans le panneau si Claude en a un, sinon dans le navigateur
async function showOnce($: EngineInterface) {
  if (shown) return
  shown = true
  const key = 'shown-' + String(await $.session.id())
  const opened: any = await $.ui.open({ id: PANE, title: 'Araignée' })
  if (opened.isPlaced) return
  await viewerSetup($)
  if (await $.store.get(key)) return
  await $.store.set(key, true)
  await openViewer($)
}
async function pushLive($: EngineInterface, toolName: string, ev: Ev, e: any) {
  if (!viewerDir) return
  const g = world.g, before = g.nodes.length
  let t: any
  if (ev.tool === 'Bash') t = '::terminal'
  else if (ev.tool === 'Grep') t = (ev.targets || []).map(p => nodeForPath(g, p)?.id).filter(Boolean)
  else if (ev.path) t = nodeForPath(g, ev.path)?.id
  const nodes = g.nodes.slice(before).map((n: any) => ({ ...nodeData(n), anchor: g.adj[n.id][0] }))
  const d = String(e.pattern ?? e.command ?? e.query ?? e.url ?? '').split('\n')[0]?.slice(0, 60) ?? ''
  liveSeq += 1
  liveEvents.push({ seq: liveSeq, tool: VIEWER_TOOL[toolName] || ev.tool, t, d, label: ev.label, lines: ev.lines, nodes })
  if (liveEvents.length > 30) liveEvents = liveEvents.slice(-30)
  await writeLive($)
}

function enqueue($: EngineInterface, ev: Ev) {
  queue.push(ev)
  // Claude va plus vite que l'araignée : on garde les actions les plus récentes
  while (queue.length > 4) { const i = queue.findIndex(q => q.tool === 'Read' || q.tool === 'Grep'); queue.splice(i < 0 ? 0 : i, 1) }
  void pump($)
}

async function openPane($: EngineInterface) {
  const isUp = (await $.ui.panes()).some(p => p.id === PANE)
  if (!isUp) await $.ui.open({ id: PANE, title: 'Araignée' })
}

function eventFor(toolName: string, e: any, ran: any): Ev | null {
  const kind = TOOLS[toolName]
  const text: string | undefined = ran && typeof ran.text === 'string' ? ran.text : undefined
  if (kind === 'Read') { const p = rel(e.file_path || e.notebook_path); if (!p) return null; return { tool: 'Read', toolName, path: p, label: 'Read · ' + p.split('/').pop(), lines: firstLines(text, 4) } }
  if (kind === 'Edit') {
    const p = rel(e.file_path || e.notebook_path); if (!p) return null
    const first = (s: unknown) => String(s ?? '').split('\n').find(l => l.trim()) || ''
    const ed = Array.isArray(e.edits) && e.edits[0] ? e.edits[0] : e
    return { tool: 'Edit', toolName, path: p, label: 'Edit · ' + p.split('/').pop(), lines: ['- ' + first(ed?.old_string).trim(), '+ ' + first(ed?.new_string ?? e.new_source).trim()].filter(l => l.length > 2) }
  }
  if (kind === 'Write') { const p = rel(e.file_path); if (!p) return null; return { tool: 'Write', toolName, path: p, label: 'Write · ' + p.split('/').pop(), lines: firstLines(String(e.content ?? ''), 3).map(l => '+ ' + l) } }
  if (kind === 'Grep') {
    const found: string[] = []
    firstLines(text, 40).forEach(l => { const m = l.match(/^([^:\s][^:]*\.[A-Za-z0-9]+)(?::|$)/); if (m) { const p = rel(m[1]); if (p && !found.includes(p)) found.push(p) } })
    return { tool: 'Grep', toolName, targets: found.slice(0, 5), label: `${toolName} · ${String(e.pattern ?? '').slice(0, 30)}`, lines: found.length ? found.slice(0, 4).map(f => '✓ ' + f) : ['aucun fichier trouvé'] }
  }
  if (kind === 'Bash') { const cmd = (String(e.command ?? '').split('\n')[0] ?? '').slice(0, 48); return { tool: 'Bash', toolName, label: '$ ' + cmd, lines: ['$ ' + cmd, ...firstLines(text, 2)] } }
  if (kind === 'Web') { const q = String(e.query ?? e.url ?? '').slice(0, 44); return { tool: 'Web', toolName, label: toolName + ' · ' + q, lines: ['« ' + q + ' »'] } }
  return null
}

const countLines = (v: unknown) => { const t = String(v ?? ''); return t ? t.split('\n').length : 0 }
function track(toolName: string, e: any, ev: Ev) {
  const kind = TOOLS[toolName]
  if (kind === 'Read' && ev.path && !turn.reads.includes(ev.path)) turn.reads.push(ev.path)
  if ((kind === 'Edit' || kind === 'Write') && ev.path) {
    const cur = turn.edits.get(ev.path) || { add: 0, del: 0, created: false }
    if (kind === 'Write') { cur.add += countLines(e.content); cur.created = cur.created || !turn.reads.includes(ev.path) }
    else for (const ed of Array.isArray(e.edits) ? e.edits : [e]) { cur.del += countLines(ed?.old_string); cur.add += countLines(ed?.new_string ?? ed?.new_source) }
    turn.edits.set(ev.path, cur)
  }
  if (kind === 'Grep') turn.greps.push(String(e.pattern ?? '').slice(0, 40))
  if (kind === 'Bash') turn.bash.push((String(e.command ?? '').split('\n')[0] ?? '').slice(0, 50))
  if (kind === 'Web') turn.web.push(String(e.query ?? e.url ?? '').slice(0, 50))
}
const fmtDuration = (ms: number) => { const s = Math.round(ms / 1000); return s < 60 ? `${s} s` : `${Math.floor(s / 60)} min ${String(s % 60).padStart(2, '0')} s` }
// la première ou les deux premières phrases de la réponse de Claude, sans la mise en forme
function gist(answer: string): string {
  const flat = answer.replace(/```[\s\S]*?```/g, ' ').split('\n').map(l => l.replace(/^\s*(#+|[-*>]|\d+\.)\s+/, '').replace(/[*_`]/g, '').replace(/\[([^\]]+)\]\([^)]*\)/g, '$1').trim()).filter(Boolean).join(' ')
  const parts = flat.match(/[^.!?]+[.!?]+/g) || [flat]
  let out = ''
  for (const p of parts) { if ((out + p).length > 260 && out) break; out += p; if (out.length > 120) break }
  return out.trim().slice(0, 280)
}
function recapOf(answer: string, ms: number, aborted: boolean): Recap | null {
  const t = turn
  if (!t.reads.length && !t.edits.size && !t.greps.length && !t.bash.length && !t.web.length) return null
  const base = (p: string) => p.split('/').pop() || p
  const rows: Recap['rows'] = []
  const list = (arr: { name: string; add?: number; del?: number }[], max: number) => ({ items: arr.slice(0, max), more: Math.max(0, arr.length - max) })
  if (t.edits.size) rows.push({ tool: 'Edit', label: `Modifié · ${t.edits.size}`, ...list([...t.edits].map(([p, v]) => ({ name: base(p) + (v.created ? ' (nouveau)' : ''), add: v.add, del: v.del })), 6) })
  if (t.reads.length) rows.push({ tool: 'Read', label: `Lu · ${t.reads.length}`, ...list(t.reads.map(p => ({ name: base(p) })), 8) })
  if (t.greps.length) rows.push({ tool: 'Grep', label: `Cherché · ${t.greps.length}`, ...list(t.greps.map(g => ({ name: `« ${g} »` })), 4) })
  if (t.bash.length) rows.push({ tool: 'Bash', label: `Commandes · ${t.bash.length}`, ...list(t.bash.map(c => ({ name: c })), 4) })
  if (t.web.length) rows.push({ tool: 'WebSearch', label: `Web · ${t.web.length}`, ...list(t.web.map(q => ({ name: q })), 3) })
  return { title: aborted ? 'Bilan · interrompu' : 'Bilan du tour', duration: fmtDuration(ms), said: gist(answer), rows, at: Date.now() }
}
async function pushRaw($: EngineInterface, data: any) {
  if (!viewerDir) return
  liveSeq += 1
  liveEvents.push({ seq: liveSeq, ...data })
  if (liveEvents.length > 30) liveEvents = liveEvents.slice(-30)
  await writeLive($)
}

// la toile en grand, calée sur la zone de discussion de Claude (Windows : Edge en mode application)
async function openGrand($: EngineInterface): Promise<string> {
  await viewerSetup($)
  if ((await $.env.get('OS')) !== 'Windows_NT') { await openViewer($); return 'La grande toile se cale sur Claude seulement sous Windows : elle s\'ouvre dans ton navigateur.' }
  const m = await $.store.get('marges')
  const [left, top] = Array.isArray(m) ? m : [300, 44]
  const file = `${viewerDir}/araignee-${sid}.html`.replace(/\//g, '\\')
  const url = 'file:///' + file.replace(/\\/g, '/').split('/').map(encodeURIComponent).join('/').replace(/^([A-Za-z])%3A/, '$1:') + '?grand=1'
  const script = `${$.plugin.root}/scripts/grand.ps1`.replace(/\//g, '\\')
  const argv = ['powershell', '-NoProfile', '-ExecutionPolicy', 'Bypass', '-WindowStyle', 'Hidden', '-File', script, '-Url', url, '-Title', 'grand-' + sid, '-Left', String(left), '-Top', String(top)]
  stopGrand()
  const run = $.process.spawn({ argv })
  grandRun = run as any
  await update($, grandAtom, () => true)
  void (async () => {
    try { for await (const piece of run) if (/introuvable/.test(piece.text)) $.ui.toast(`Araignée : ${piece.text.trim()}`) } catch (err) { $.ui.log(`araignee grand : ${String(err)}`) }
    if (grandRun === (run as any)) grandRun = null
    await update($, grandAtom, () => false)
  })()
  return 'La toile s\'ouvre en grand sur la discussion. Échap ou « Réduire » pour revenir.'
}
function stopGrand() { const r = grandRun; grandRun = null; try { void r?.return?.() } catch { /* déjà terminé */ } }
async function closeGrand($: EngineInterface) {
  await pushRaw($, { close: true })
  $.clock.after(1500, () => stopGrand())
  await update($, grandAtom, () => false)
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    await $.command.register({ name: 'araignee', description: "Ouvre le panneau de l'araignée qui suit le travail de Claude" })
    await $.command.register({ name: 'araignee-plein-ecran', description: "Ouvre la toile de l'araignée en grand, dans le navigateur (version haute qualité)" })
    await $.command.register({ name: 'araignee-grand', description: "Agrandit l'araignée sur toute la zone de la discussion (Échap pour revenir)" })
    await $.command.register({ name: 'araignee-marges', description: "Règle le calage de la grande toile : /araignee-marges <gauche> <haut> (en pixels, 300 44 par défaut)" })
    return next(e)
  })

  on('command.run', { command: 'araignee-plein-ecran' }, async $ => {
    const file = await openViewer($)
    return { text: `La toile en plein écran s'ouvre dans ton navigateur (touche F11 pour le vrai plein écran) : ${file}` }
  })

  on('command.run', { command: 'araignee-grand' }, async $ => ({ text: await openGrand($) }))

  on('command.run', { command: 'araignee-marges' }, async ($, e) => {
    const n = String(e.args || '').match(/-?\d+/g)?.map(Number) || []
    if (n.length < 2) { const m = await $.store.get('marges'); return { text: `Marges actuelles : ${Array.isArray(m) ? m.join(' ') : '300 44'} (gauche haut, en pixels). Exemple : /araignee-marges 320 50` } }
    await $.store.set('marges', [n[0], n[1]])
    return { text: `C'est noté : ${n[0]} px à gauche, ${n[1]} px en haut. Rouvre la grande toile pour voir le résultat.` }
  })

  // le tour commence : nouveau bilan à zéro
  on('turn.start', async ($, e, next) => {
    if (!(e as any).agentId) { turn = newTurn(); await update($, recapAtom, old => ({ ...old, at: 0 })).catch(() => undefined) }
    return next(e)
  })

  // le tour se termine : l'araignée affiche le bilan de ce que Claude a fait
  on('turn.complete', async ($, e, next) => {
    const done = await next(e)
    if (!e.agentId) {
      try {
        const r = recapOf(e.answer || '', e.durationMs || 0, !!e.isAborted)
        turn = newTurn()
        if (r) { await update($, recapAtom, () => r); await pushRaw($, { summary: r }) }
      } catch { /* le bilan ne doit jamais gêner Claude */ }
    }
    return done
  })

  on('command.run', { command: 'araignee' }, async $ => {
    const opened: any = await $.ui.open({ id: PANE, title: 'Araignée' })
    await ensureWorld($)
    if (!playing) await showClip($, idleClip(world))
    if (opened.isPlaced) return { text: "Panneau de l'araignée ouvert." }
    const file = await openViewer($)
    return { text: `La toile s'ouvre dans ton navigateur : ${file}` }
  })

  // repli : sans panneau, l'araignée vit dans le bandeau au-dessus de la zone de message
  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    const els = $.ui.resolve(e) as any
    if (e.surface === 'terminal' || !els.Svg) return next(e)
    const placed = (await $.ui.panes()).some(p => p.id === PANE && p.isPlaced)
    const clip = await read($, clipAtom)
    if (placed || !clip.svg) return next(e)
    const st = await read($, statusAtom)
    const { Box, Text, Svg } = els
    return (
      <Box flexDirection="column">
        <Box flexDirection="row" gap={1}>
          <Text color={(TOOL_COLOR as any)[st.tool] || '#c89bff'} bold>{st.tool}</Text>
          <Text dimColor>{st.path}</Text>
        </Box>
        <Svg source={clip.svg} alt={`L'araignée : ${st.tool} ${st.path}`} width={480} height={304} isInteractive />
      </Box>
    )
  })

  // chaque action de Claude devient un geste de l'araignée
  on('tool.call', async ($, e, next) => {
    const toolName = String(e.tool)
    if (!TOOLS[toolName]) return next(e)
    const ran = await next(e)
    try {
      await ensureWorld($)
      await showOnce($).catch(() => undefined)
      const ev = eventFor(toolName, e, ran)
      if (ev) { track(toolName, e, ev); await pushLive($, toolName, ev, e).catch(() => undefined); enqueue($, ev) }
    } catch { /* l'araignée ne doit jamais gêner Claude */ }
    return ran
  }).catch(($, e, next) => next(e))

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const els = $.ui.resolve(e) as any
    const { Box, Text } = els
    const clip = await read($, clipAtom)
    const st = await read($, statusAtom)
    const skin = await read($, skinAtom)
    const recap = await read($, recapAtom)
    const grand = await read($, grandAtom)
    const props: any = e.props
    if (e.surface === 'terminal' || !els.Svg) return (
      <Box flexDirection="column">
        <Text bold>{st.tool} <Text dimColor>{st.path}</Text></Text>
        <Text dimColor>La toile animée s'affiche dans l'application de bureau.</Text>
      </Box>
    )
    // la toile remplit tout le panneau : on prend sa forme (une cellule fait ~2 fois plus haut que large)
    const showRecap = recap.at > 0
    const recapRows = showRecap ? 3 + recap.rows.length * 2 : 0
    const cols = Math.max(20, props.bodyColumns || 60), rows = Math.max(8, (props.scroll?.bodyRows || e.viewport?.rows || 30) - 5 - recapRows)
    const asp = Math.min(3, Math.max(.3, rows * 2.1 / cols))
    if (world && Math.abs((world.aspect || .63) - asp) / asp > .12) {
      world.aspect = asp
      if (!playing) $.clock.after(0, () => { if (!playing && world) void showClip($, idleClip(world)) })
    }
    const svg = clip.svg.replace(/width="1000" height="\d+"/, `width="1000" height="${Math.round(1000 * asp)}"`)
    const { Svg, Select, Button } = els
    return (
      <Box flexDirection="column">
        <Box flexDirection="row" gap={1}>
          <Text color={(TOOL_COLOR as any)[st.tool] || '#c89bff'} bold>{st.tool}</Text>
          <Text dimColor>{st.path || 'en attente du travail de Claude'}</Text>
          {Button && (grand
            ? <Button key="reduire" onPress={() => { void closeGrand($) }}>Réduire</Button>
            : <Button key="agrandir" variant="primary" onPress={() => { void openGrand($).then(t => $.ui.toast(t)) }}>Agrandir</Button>)}
        </Box>
        {clip.svg
          ? <Svg source={svg} alt={`L'araignée : ${st.tool} ${st.path}`} isInteractive />
          : <Text dimColor>La toile se prépare au premier geste de Claude.</Text>}
        {showRecap && (
          <Box flexDirection="column" borderStyle="round" paddingX={1}>
            <Text bold>{recap.title} <Text dimColor>· {recap.duration}</Text></Text>
            {recap.said ? <Text>{recap.said}</Text> : null}
            {recap.rows.map(row => (
              <Text key={row.label}>
                <Text color={(TOOL_COLOR as any)[row.tool] || '#ffffff'} bold>{row.label}</Text>
                <Text dimColor>  {row.items.map(it => it.name + (it.add ? ` +${it.add}` : '') + (it.del ? ` −${it.del}` : '')).join(' · ')}{row.more ? ` … et ${row.more} autres` : ''}</Text>
              </Text>
            ))}
          </Box>
        )}
        {Select && (
          <Select
            key="skin"
            label="Araignée "
            value={skin}
            options={Object.entries(SKINS).map(([value, s]: [string, any]) => ({ value, label: s.name }))}
            onSelect={(value: string) => {
              void (async () => {
                await $.state.set({ plugin: 'araignee', key: 'skin' }, value)
                await $.store.set('skin', value)
                if (world) { setSkin(world, value); if (!playing) await showClip($, idleClip(world)) }
              })()
            }}
          />
        )}
      </Box>
    )
  })
}
