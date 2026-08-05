declare module 'node:sqlite' {
  export interface StatementResult {
    lastInsertRowid: number | bigint;
    changes: number;
  }

  export class StatementSync {
    run(...anonymousParameters: unknown[]): StatementResult;
    get(...anonymousParameters: unknown[]): Record<string, unknown> | undefined;
    all(...anonymousParameters: unknown[]): Array<Record<string, unknown>>;
  }

  export class DatabaseSync {
    constructor(location: string);
    exec(sql: string): void;
    prepare(sql: string): StatementSync;
    close(): void;
  }

  export function backup(
    sourceDb: DatabaseSync,
    path: string,
    options?: { rate?: number; progress?: (info: { totalPages: number; remainingPages: number }) => void }
  ): Promise<void>;
}
