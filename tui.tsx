/** @jsxImportSource @opentui/solid */
// Blok „OpenCode Go” w bocznym panelu sesji — tuż pod blokiem Context.
//
// Slot: append "sidebar.content". Kolejność w slocie = kolejność włączenia
// pluginów, a pluginy wbudowane (Context, MCP) włączają się jako pierwsze,
// więc nasz blok ląduje pod nimi.
//
// Okna: rolling = 5h, weekly = tydzień, monthly = miesiąc.

import { Plugin } from "@opencode/plugin/tui"
import { createSignal } from "solid-js"
import { loadUsage, type UsageState, type WindowKey, type WindowUsage } from "./usage"

const WINDOWS: readonly { readonly key: WindowKey; readonly label: string }[] = [
  { key: "rolling", label: "5h" },
  { key: "weekly", label: "tydzień" },
  { key: "monthly", label: "miesiąc" },
]

const LABEL_WIDTH = 7
const BAR_WIDTH = 10
const REFRESH_MS = 60_000
const TICK_MS = 15_000

type Level = "success" | "warning" | "error"

function level(percent: number): Level {
  if (percent >= 80) return "error"
  if (percent >= 50) return "warning"
  return "success"
}

function bar(percent: number): string {
  const clamped = Number.isFinite(percent) ? Math.max(0, Math.min(100, percent)) : 0
  const filled = Math.round((clamped / 100) * BAR_WIDTH)
  return "█".repeat(filled) + "░".repeat(BAR_WIDTH - filled)
}

function countdown(resetsAt: string | undefined, now: number): string {
  if (!resetsAt) return ""
  const time = Date.parse(resetsAt)
  if (!Number.isFinite(time)) return ""
  const remaining = time - now
  if (remaining <= 0) return "teraz"
  const minutes = Math.floor(remaining / 60_000)
  const days = Math.floor(minutes / 1440)
  const hours = Math.floor((minutes % 1440) / 60)
  if (days > 0) return `za ${days}d ${hours}h`
  if (hours > 0) return `za ${hours}h ${minutes % 60}m`
  return `za ${minutes}m`
}

export default Plugin.define({
  id: "opencode-go-usage",
  setup(context) {
    const [state, setState] = createSignal<UsageState>({ type: "loading" })
    const [now, setNow] = createSignal(Date.now())
    let active = true

    const refresh = () => {
      void loadUsage(context.options, context.location?.directory).then((result) => {
        if (active) setState(result)
      })
    }
    refresh()
    const refreshTimer = setInterval(refresh, REFRESH_MS)
    const tickTimer = setInterval(() => setNow(Date.now()), TICK_MS)

    const row = (label: string, window: WindowUsage | undefined, at: number) => {
      const theme = context.theme
      const percent = typeof window?.percent === "number" ? window.percent : 0
      const limited = window?.status === "rate-limited"
      const tone = limited ? theme.text.feedback.error.base : theme.text.feedback[level(percent)].base
      const reset = limited ? "limit" : countdown(window?.resetsAt, at)
      const percentText = `${Math.round(percent)}%`.padStart(4)
      return (
        <text>
          <span style={{ fg: theme.text.muted }}>{label.padEnd(LABEL_WIDTH) + " "}</span>
          <span style={{ fg: tone }}>{bar(percent)}</span>
          <span style={{ fg: tone }}>{percentText + "  "}</span>
          <span style={{ fg: limited ? theme.text.feedback.error.base : theme.text.muted }}>{reset}</span>
        </text>
      )
    }

    const status = (current: UsageState) => {
      const theme = context.theme
      const muted = (line: string) => <text fg={theme.text.muted}>{line}</text>
      if (current.type === "loading") return muted("Ładowanie limitów…")
      if (current.type === "no-key")
        return [
          <text fg={theme.text.feedback.warning.base}>Brak klucza API</text>,
          muted("opencode login lub OPENCODE_API_KEY"),
        ]
      if (current.type === "unauthorized")
        return [
          <text fg={theme.text.feedback.error.base}>Odrzucono klucz (401)</text>,
          muted("opencode login"),
        ]
      if (current.type === "no-subscription")
        return [
          <text fg={theme.text.feedback.warning.base}>Brak subskrypcji Go</text>,
          muted("opencode login"),
        ]
      if (current.type === "error")
        return [
          <text fg={theme.text.feedback.error.base}>Błąd pobierania limitów</text>,
          muted(current.message.slice(0, LABEL_WIDTH + 30)),
        ]
      return muted("")
    }

    const content = () => {
      const current = state()
      if (current.type !== "ok") return status(current)
      const at = now()
      return WINDOWS.map((entry) => row(entry.label, current.usage[entry.key], at))
    }

    context.ui.slot({
      append: "sidebar.content",
      render: () => (
        <box>
          <text fg={context.theme.text.base}>
            <b>OpenCode Go</b>
          </text>
          {content()}
        </box>
      ),
    })

    return () => {
      active = false
      clearInterval(refreshTimer)
      clearInterval(tickTimer)
    }
  },
})
