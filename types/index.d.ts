export type Shot = { path: string; mtimeMs: number; thumb: string }
export type Sent = { text: string; thumbs: string[] }

declare module 'claude-code' {
  interface PluginState {
    'recent-screenshots': {
      shots: Shaped<Shot[]>
      attached: string[]
      dismissed: string[]
      sent: Shaped<Sent[]>
    }
  }
}
