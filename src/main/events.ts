export type EventSink = (channel: string, ...args: unknown[]) => void

const sinks: EventSink[] = []

export function addEventSink(sink: EventSink): void {
  sinks.push(sink)
}

export function pushEvent(channel: string, ...args: unknown[]): void {
  for (const sink of sinks) {
    try {
      sink(channel, ...args)
    } catch {
      continue
    }
  }
}
