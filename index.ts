// Wpis po stronie serwera. OpenCode wymaga entrypointu `server` (index.ts),
// żeby w ogóle wczytać katalog pluginu, ale sam plugin jest wyłącznie
// interfejsem TUI — logika siedzi w `tui.tsx`.
//
// Import "@opencode/plugin" celowo nie występuje: lokalny katalog pluginu nie
// ma node_modules, a schema modułu przyjmuje zwykły obiekt z `id` i `setup`.
export default {
  id: "opencode-go-usage",
  setup() {},
}
