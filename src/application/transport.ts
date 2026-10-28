import type { Command } from './commands';
import type { DiagramDocument } from '../domain/model';
export interface RemoteCommit {
  kind: 'command' | 'undo' | 'redo';
  command: Command;
  before: DiagramDocument;
  document: DiagramDocument;
}
/** 业务写入和带版本的流程图保存均确认后，才算提交成功。 */
export interface EditorTransport {
  commit(request: RemoteCommit): Promise<DiagramDocument>;
}
