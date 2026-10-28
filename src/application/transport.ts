import type { Command } from './commands';
import type { DiagramDocument } from '../domain/model';
export interface RemoteCommit {
  kind: 'command' | 'undo' | 'redo';
  command: Command;
  before: DiagramDocument;
  document: DiagramDocument;
}
/** Resolves only after business writes AND the versioned diagram save are acknowledged. */
export interface EditorTransport {
  commit(request: RemoteCommit): Promise<DiagramDocument>;
}
