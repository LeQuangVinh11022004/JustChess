declare module 'js-chess-engine' {
  export function aiMove(
    config?: string | Record<string, unknown>,
    level?: 0 | 1 | 2 | 3 | 4,
  ): Record<string, string>

  export class Game {
    constructor(configuration?: string | Record<string, unknown>)
    aiMove(level?: 0 | 1 | 2 | 3 | 4): Record<string, string>
    exportFEN(): string
  }
}
