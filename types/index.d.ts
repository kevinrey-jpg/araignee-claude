export type Clip = { svg: string; seq: number }
export type Status = { tool: string; path: string; source: string }
export type RecapItem = { name: string; add?: number; del?: number }
export type Recap = { title: string; duration: string; said: string; rows: { tool: string; label: string; items: RecapItem[]; more: number }[]; at: number }

declare module 'claude-code' {
  interface PluginState {
    araignee: { clip: Shaped<Clip>; status: Shaped<Status>; skin: string; recap: Shaped<Recap>; grand: boolean; sound: boolean }
  }
}
