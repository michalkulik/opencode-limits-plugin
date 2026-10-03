/** @jsxImportSource solid-js */
// Wersja companiona (web) wtyczki "OpenCode Go" (limity subskrypcji).
//
// Ten sam pomysł co `tui.tsx`: pokazuje limity 5 h / tydzień / miesiąc w bocznym
// panelu. Dane pochodzą z endpointu companiona `GET /api/limits`, który sam
// rozwiązuje klucz (ENV → opencode.json → baza OpenCode) i odpytuje
// `https://opencode.ai/zen/go/v1/usage`. Wtyczka nie ma dostępu do klucza, więc
// korzysta z `ctx.data.companion("/api/limits")`.
//
// Odświeżanie: start + co 60 s; przycisk „odśwież” woła `?force=1`.
//
// Opcje (companion.json, `plugins[].options`):
//   title – nagłówek karty (domyślnie "OpenCode Go")

import { For, Show, createSignal, onCleanup } from "solid-js"
import { Plugin } from "./plugin.js"

const WINDOWS = [
  { key: "rolling", label: "5h" },
  { key: "weekly", label: "tydzień" },
  { key: "monthly", label: "miesiąc" },
]
const REFRESH_MS = 60_000
const BAR_WIDTH = 10

function levelColor(theme, percent) {
  if (percent >= 80) return theme.state.danger
  if (percent >= 50) return theme.state.warning
  return theme.state.success
}

function countdown(resetsAt, now) {
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
  setup(ctx) {
    const options = ctx.options ?? {}
    const title = typeof options.title === "string" ? options.title : "OpenCode Go"

    const [state, setState] = createSignal({ type: "loading" })
    const [now, setNow] = createSignal(Date.now())
    let active = true
    let sequence = 0

    const load = async (force) => {
      const mine = ++sequence
      try {
        const body = await ctx.data.companion(`/api/limits${force ? "?force=1" : ""}`)
        if (active && mine === sequence) setState(body ?? { type: "error", message: "brak danych" })
      } catch (error) {
        if (active && mine === sequence)
          setState({ type: "error", message: error instanceof Error ? error.message : String(error) })
      }
    }

    void load(false)
    const refresh = setInterval(() => void load(false), REFRESH_MS)
    const tick = setInterval(() => setNow(Date.now()), 15_000)
    onCleanup(() => {
      active = false
      clearInterval(refresh)
      clearInterval(tick)
    })

    const Bar = (props) => {
      const percent = () => Math.max(0, Math.min(100, props.window?.percent ?? 0))
      const limited = () => props.window?.status === "rate-limited"
      const color = () => (limited() ? ctx.theme.state.danger : levelColor(ctx.theme, percent()))
      return (
        <span class="block h-1.5 w-full overflow-hidden rounded-full" style={{ "background-color": ctx.theme.background.layer03 }}>
          <span class="block h-full rounded-full transition-[width] duration-500" style={{ width: `${percent()}%`, "background-color": color() }} />
        </span>
      )
    }

    const Row = (entry) => {
      const window = () => (state().type === "ok" ? state().usage?.[entry.key] : undefined)
      const limited = () => window()?.status === "rate-limited"
      const percent = Math.round(window()?.percent ?? 0)
      const color = () => (limited() ? ctx.theme.state.danger : levelColor(ctx.theme, percent))
      return (
        <div class="flex items-center gap-2 text-xs" data-window={entry.key}>
          <span class="w-14 shrink-0" style={{ color: ctx.theme.text.muted }}>{entry.label}</span>
          <span class="min-w-0 flex-1"><Bar window={window()} /></span>
          <span class="w-10 shrink-0 text-right tabular-nums" style={{ color: color() }}>{percent}%</span>
          <span class="w-16 shrink-0 text-right tabular-nums" style={{ color: ctx.theme.text.muted }}>
            {limited() ? "limit" : countdown(window()?.resetsAt, now())}
          </span>
        </div>
      )
    }

    const Body = () => {
      const current = state()
      if (current.type === "loading") return <p class="text-xs" style={{ color: ctx.theme.text.muted }}>Ładowanie limitów…</p>
      if (current.type === "no-key") return <p class="text-xs" style={{ color: ctx.theme.state.warning }}>Brak klucza API</p>
      if (current.type === "unauthorized") return <p class="text-xs" style={{ color: ctx.theme.state.danger }}>Odrzucono klucz (401)</p>
      if (current.type === "no-subscription") return <p class="text-xs" style={{ color: ctx.theme.state.warning }}>Brak subskrypcji Go</p>
      if (current.type !== "ok")
        return <p class="text-xs" style={{ color: ctx.theme.state.danger }}>Błąd: {String(current.message ?? "").slice(0, 80)}</p>
      return <div class="flex flex-col gap-2"><For each={WINDOWS}>{Row}</For></div>
    }

    ctx.ui.slot({
      append: "sidebar.content",
      render: () => (
        <section
          class="rounded-lg border p-3"
          data-plugin="opencode-go-usage"
          style={{ "background-color": ctx.theme.background.layer01, "border-color": ctx.theme.border.muted }}
        >
          <header class="mb-2 flex items-center justify-between gap-2">
            <span class="text-sm font-medium" style={{ color: ctx.theme.text.base }}>{title}</span>
            <button
              type="button"
              onClick={() => void load(true)}
              class="rounded px-1 text-xs"
              style={{ color: ctx.theme.text.muted }}
              title="Odśwież limity"
            >
              odśwież
            </button>
          </header>
          {Body()}
        </section>
      ),
    })
  },
})
