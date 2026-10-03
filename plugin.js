// Minimalny kontrakt wtyczki companiona (`./web`) — lokalna kopia dla pakietu.
//
// Companion definiuje identyczny kształt (`src/plugin`), ale wtyczka nie może
// importować kodu companiona przez ścieżkę międzyrepozytoryjną (kruche i łamie
// typecheck pakietu). Wystarczy zgodność kształtu: `{ id, setup(ctx) }`.

export const Plugin = {
  define(definition) {
    return definition
  },
}
