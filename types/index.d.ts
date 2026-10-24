export type Clip = { svg: string; seq: number }
export type Status = { tool: string; path: string; source: string }

declare module 'claude-code' {
  interface PluginState {
    araignee: { clip: Shaped<Clip>; status: Shaped<Status>; skin: string }
  }
}
