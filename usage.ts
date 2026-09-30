// Pobieranie limitów subskrypcji OpenCode Go.
//
// OpenCode nie wystawia limitów w swoim HTTP API, dlatego plugin woła
// bezpośrednio publiczny endpoint Go:
//
//   GET https://opencode.ai/zen/go/v1/usage
//   Authorization: Bearer <klucz>
//
// Odpowiedź:
//   {"usage":{"rolling":{"status":"ok","percent":0,"resetsAt":"...Z"},
//             "weekly":{...},"monthly":{...}}}
//
// status: "ok" | "rate-limited" (okno wyczerpane)
// 401 AuthError    -> klucz nieprawidłowy
// 403 EntitlementError -> brak aktywnej subskrypcji

import { readFile } from "node:fs/promises"
import os from "node:os"
import path from "node:path"

export const USAGE_URL = "https://opencode.ai/zen/go/v1/usage"

export type WindowKey = "rolling" | "weekly" | "monthly"

export interface WindowUsage {
  readonly status?: string
  readonly percent?: number
  readonly resetsAt?: string
}

export interface Usage {
  readonly rolling?: WindowUsage
  readonly weekly?: WindowUsage
  readonly monthly?: WindowUsage
}

export type UsageState =
  | { readonly type: "loading" }
  | { readonly type: "no-key" }
  | { readonly type: "unauthorized" }
  | { readonly type: "no-subscription" }
  | { readonly type: "error"; readonly message: string }
  | { readonly type: "ok"; readonly usage: Usage }

/** Pobiera klucz i dane użycia. Klucz jest rozwiązywany przy każdym odświeżeniu. */
export async function loadUsage(
  options: Readonly<Record<string, unknown>>,
  directory: string | undefined,
): Promise<UsageState> {
  const key = await resolveApiKey(options, directory)
  return fetchUsage(key)
}

/**
 * Kolejność wyszukiwania klucza:
 *  1. options.apiKey z konfiguracji pluginu
 *  2. OPENCODE_API_KEY / OPENCODE_GO_API_KEY
 *  3. pliki opencode.json(c) (projekt i katalog globalny)
 *  4. baza SQLite OpenCode (klucz zapisany przez `opencode login`)
 */
export async function resolveApiKey(
  options: Readonly<Record<string, unknown>>,
  directory: string | undefined,
): Promise<string | undefined> {
  const fromOptions = expandEnv(asKey(options?.apiKey))
  if (fromOptions) return fromOptions

  for (const name of ["OPENCODE_API_KEY", "OPENCODE_GO_API_KEY"]) {
    const value = process.env[name]?.trim()
    if (value) return value
  }

  const fromConfig = await readConfigApiKey(directory)
  if (fromConfig) return fromConfig

  return readStoredApiKey()
}

export async function fetchUsage(apiKey: string | undefined): Promise<UsageState> {
  if (!apiKey) return { type: "no-key" }

  let response: Response
  try {
    response = await fetch(USAGE_URL, {
      headers: { Authorization: `Bearer ${apiKey}`, Accept: "application/json" },
      signal: AbortSignal.timeout(15_000),
    })
  } catch (error) {
    return { type: "error", message: brief(error) }
  }

  if (response.status === 401) return { type: "unauthorized" }
  if (response.status === 403) return { type: "no-subscription" }
  if (!response.ok) return { type: "error", message: `HTTP ${response.status}` }

  try {
    const body = (await response.json()) as { usage?: Usage } | undefined
    if (!body?.usage) return { type: "error", message: "pusta odpowiedź API" }
    return { type: "ok", usage: body.usage }
  } catch (error) {
    return { type: "error", message: brief(error) }
  }
}

// --- klucz -----------------------------------------------------------------

function asKey(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined
  const trimmed = value.trim()
  return trimmed ? trimmed : undefined
}

/** Wartości typu "{env:ZMIENNA}" są rozwijane tak jak w konfiguracji OpenCode. */
function expandEnv(value: string | undefined): string | undefined {
  if (!value) return undefined
  const match = /^\{env:([A-Za-z_][A-Za-z0-9_]*)\}$/.exec(value.trim())
  if (!match) return value.trim()
  const fromEnv = process.env[match[1]]?.trim()
  return fromEnv ? fromEnv : undefined
}

function configFiles(directory?: string): string[] {
  const files: string[] = []
  const walk = (root: string) => {
    let current = path.resolve(root)
    for (let depth = 0; depth < 8; depth++) {
      files.push(path.join(current, "opencode.jsonc"), path.join(current, "opencode.json"))
      const parent = path.dirname(current)
      if (parent === current) break
      current = parent
    }
  }
  if (directory) walk(directory)
  walk(process.cwd())
  files.push(
    path.join(globalConfigDirectory(), "opencode.jsonc"),
    path.join(globalConfigDirectory(), "opencode.json"),
  )
  return [...new Set(files)]
}

function globalConfigDirectory(): string {
  if (process.env.OPENCODE_CONFIG_DIR) return process.env.OPENCODE_CONFIG_DIR
  const base = process.env.XDG_CONFIG_HOME ?? path.join(os.homedir(), ".config")
  return path.join(base, "opencode")
}

function dataDirectory(): string {
  const base = process.env.XDG_DATA_HOME ?? path.join(os.homedir(), ".local", "share")
  return path.join(base, "opencode")
}

async function readConfigApiKey(directory?: string): Promise<string | undefined> {
  for (const file of configFiles(directory)) {
    const text = await readFile(file, "utf8").catch(() => undefined)
    if (!text) continue
    const config = parseJsonc(text) as Record<string, any> | undefined
    if (!config) continue
    const candidates = [
      // v2: "providers": { "opencode-go": { "settings": { "apiKey" } } }
      config.providers?.["opencode-go"]?.settings?.apiKey,
      config.providers?.["opencode-go"]?.options?.apiKey,
      // v1: "provider": { "opencode-go": { "options": { "apiKey" } } }
      config.provider?.["opencode-go"]?.options?.apiKey,
      config.provider?.["opencode-go"]?.settings?.apiKey,
    ]
    for (const candidate of candidates) {
      const key = expandEnv(asKey(candidate))
      if (key) return key
    }
  }
  return undefined
}

/** JSONC: komentarze i przecinki przed `}` / `]` są usuwane przed parsowaniem. */
function parseJsonc(text: string): unknown {
  const stripped = text
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(^|[^:"'/])\/\/[^\n]*/g, "$1")
    .replace(/,\s*([}\]])/g, "$1")
  try {
    return JSON.parse(stripped)
  } catch {
    return undefined
  }
}

interface SqliteStatement {
  all(): unknown[]
}

interface SqliteDatabase {
  query(sql: string): SqliteStatement
  close(): void
}

interface SqliteModule {
  Database: new (file: string, options?: Record<string, unknown>) => SqliteDatabase
}

async function loadSqlite(): Promise<SqliteModule | undefined> {
  try {
    // Zmienna utrudnia statyczne rozpoznanie importu, dzięki czemu plik
    // kompiluje się też bez typów `bun-types`.
    const specifier = "bun:sqlite"
    return (await import(specifier)) as SqliteModule
  } catch {
    return undefined
  }
}

/**
 * Klucz zapisany przez `opencode login` / subskrypcję leży w tabeli `credential`.
 * Baza jest otwierana wyłącznie do odczytu.
 */
async function readStoredApiKey(): Promise<string | undefined> {
  const file = process.env.OPENCODE_DB ?? path.join(dataDirectory(), "opencode.db")
  const sqlite = await loadSqlite()
  if (!sqlite) return undefined
  try {
    const db = new sqlite.Database(file, { readonly: true, fileMustExist: true })
    try {
      const rows = db
        .query(
          `SELECT value FROM credential
           WHERE integration_id IN ('opencode-go', 'opencode') AND active = 1
           ORDER BY time_updated DESC`,
        )
        .all() as Array<Record<string, unknown> | unknown[]>
      for (const row of rows) {
        // bun:sqlite zwraca wiersze jako obiekty; tablice obsługuje w razie potrzeby.
        const value = Array.isArray(row) ? row[0] : (row as Record<string, unknown> | undefined)?.value
        const key = keyFromCredential(value)
        if (key) return key
      }
    } finally {
      db.close()
    }
  } catch {
    return undefined
  }
  return undefined
}

function keyFromCredential(value: unknown): string | undefined {
  if (typeof value !== "string" || !value) return undefined
  try {
    const parsed = JSON.parse(value) as Record<string, unknown> | string
    if (typeof parsed === "string") return parsed.trim() || undefined
    return asKey(parsed.key) ?? asKey(parsed.apiKey) ?? asKey(parsed.token)
  } catch {
    return asKey(value)
  }
}

function brief(error: unknown): string {
  if (error instanceof Error) return error.message
  return String(error)
}
