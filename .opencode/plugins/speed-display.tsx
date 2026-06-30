/** @jsxImportSource @opentui/solid */
import { createSignal, onCleanup } from "solid-js"
import type { TuiPlugin, TuiPluginModule } from "@opencode-ai/plugin/tui"
import type { AssistantMessage, Part } from "@opencode-ai/sdk/v2"

const money = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
})

const speedFormat = new Intl.NumberFormat("en-US", {
  maximumSignificantDigits: 3,
})

function tokenTotal(msg: AssistantMessage): number {
  return msg.tokens.input + msg.tokens.output + msg.tokens.reasoning + msg.tokens.cache.read + msg.tokens.cache.write
}

/**
 * Sum output+reasoning tokens across every step-finish part of a message.
 *
 * Why not read msg.tokens directly: opencode overwrites (not accumulates)
 * assistantMsg.tokens at each finish-step event, so mid-message the field
 * only reflects the latest step. A tool-only step would zero it out and
 * make the speed display collapse to "--". Aggregating step-finish parts
 * preserves the true cumulative generation count across the whole turn.
 */
function generatedTotal(parts: ReadonlyArray<Part>): number {
  let sum = 0
  for (const p of parts) {
    if (p.type === "step-finish") {
      // Runtime payloads may drift from the narrowed type; guard each field
      // instead of trusting the schema to be populated at runtime.
      sum += (p.tokens?.output ?? 0) + (p.tokens?.reasoning ?? 0)
    }
  }
  return sum
}

/**
 * Compute token generation speed (tokens/second).
 *
 * Uses end-to-end elapsed time (created -> completed) because the SDK does not
 * expose per-part timestamps (StepStartPart/StepFinishPart carry no time
 * field), so a pure generation window cannot be derived from the message alone.
 *
 * For in-flight messages (time.completed absent), falls back to `now` so the
 * sidebar can render a live-updating speed driven by the 1s tick.
 */
function calcSpeed(msg: AssistantMessage, parts: ReadonlyArray<Part>, now: number): number | null {
  // Unfinished message -> measure against current wall clock for real-time speed
  const end = msg.time.completed ?? now
  const start = msg.time.created
  // Guard against malformed data: a missing/non-finite start would yield NaN,
  // which the `elapsed <= 0` check below does NOT catch (NaN <= 0 is false).
  if (!Number.isFinite(start)) return null
  const elapsed = (end - start) / 1000
  if (!Number.isFinite(elapsed) || elapsed <= 0) return null
  const generated = generatedTotal(parts)
  if (generated <= 0) return null
  return generated / elapsed
}

const tui: TuiPlugin = async (api) => {
  const [tick, setTick] = createSignal(0)

  const timer = setInterval(() => setTick((v) => (v + 1) % 1e6), 1000)
  onCleanup(() => clearInterval(timer))

  api.slots.register({
    order: 100,
    slots: {
      sidebar_content(_ctx, props) {
        void tick()

        const theme = api.theme.current
        const session = api.state.session.get(props.session_id)
        const all = api.state.session.messages(props.session_id) as readonly any[]
        // Pick the most recent non-errored assistant message. An in-flight
        // message (time.completed absent) is preferred so live speed can be
        // shown; completed messages without generated tokens are skipped so
        // we fall back to the last meaningful measurement instead of "--".
        const last = all.findLast(
          (m) =>
            m?.role === "assistant" &&
            !m.error &&
            (m.time?.completed == null ||
              (m.tokens?.output ?? 0) > 0 ||
              (m.tokens?.reasoning ?? 0) > 0),
        )
        const assistant = last as AssistantMessage | undefined
        const tokens = assistant ? tokenTotal(assistant) : 0
        const model = assistant
          ? api.state.provider.find((item) => item.id === assistant.providerID)?.models[assistant.modelID]
          : undefined
        const percent = model?.limit.context ? Math.round((tokens / model.limit.context) * 100) : 0
        // Fetch parts once per render to feed the cumulative token counter.
        // state.part() is a synchronous cached lookup (no await), so the 1s
        // tick cadence and render latency are unchanged.
        const parts = assistant ? api.state.part(assistant.id) : []
        const speed = assistant ? calcSpeed(assistant, parts, Date.now()) : null
        // Distinguish "still generating, no step-finish yet" from "no data".
        // The former shows "..." so the user knows it is measuring, not dead.
        const inFlight = assistant?.time.completed == null

        return (
          <box>
            <text fg={theme.text}>
              <b>Context</b>
            </text>
            <text fg={theme.textMuted}>{tokens.toLocaleString()} tokens</text>
            <text fg={theme.textMuted}>{percent}% used</text>
            <text fg={theme.textMuted}>{money.format(session?.cost ?? 0)} spent</text>
            <text fg={theme.textMuted}>{speed != null ? `${speedFormat.format(speed)} t/s` : inFlight ? "… t/s" : "-- t/s"}</text>
          </box>
        )
      },
    },
  })
}

const plugin: TuiPluginModule = {
  id: "opencode-speed-display",
  tui,
}

export default plugin
