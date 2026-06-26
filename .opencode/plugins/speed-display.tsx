/** @jsxImportSource @opentui/solid */
import { createSignal, onCleanup } from "solid-js"
import type { TuiPlugin, TuiPluginModule } from "@opencode-ai/plugin/tui"
import type { AssistantMessage } from "@opencode-ai/sdk/v2"

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

function calcSpeed(msg: AssistantMessage): number | null {
  const completed = msg.time.completed
  if (!completed) return null
  const elapsed = (completed - msg.time.created) / 1000
  if (elapsed <= 0) return null
  return (msg.tokens.output + msg.tokens.reasoning) / elapsed
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
        const last = all.findLast(
          (m) => m?.role === "assistant" && m.tokens?.output > 0,
        )
        const assistant = last as AssistantMessage | undefined
        const tokens = assistant ? tokenTotal(assistant) : 0
        const model = assistant
          ? api.state.provider.find((item) => item.id === assistant.providerID)?.models[assistant.modelID]
          : undefined
        const percent = model?.limit.context ? Math.round((tokens / model.limit.context) * 100) : 0
        const speed = assistant ? calcSpeed(assistant) : null

        return (
          <box>
            <text fg={theme.text}>
              <b>Context</b>
            </text>
            <text fg={theme.textMuted}>{tokens.toLocaleString()} tokens</text>
            <text fg={theme.textMuted}>{percent}% used</text>
            <text fg={theme.textMuted}>{money.format(session?.cost ?? 0)} spent</text>
            <text fg={theme.textMuted}>{speed != null ? `${speedFormat.format(speed)} t/s` : "-- t/s"}</text>
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
