import type { DiagramDocument } from '../domain/model';
import { newId } from '../domain/model';
import type { EditorTransport, RemoteCommit } from './transport';

/** 编辑命令只更新草稿，显式保存时才提交基线与当前文档的差异。 */
export class DraftTransport implements EditorTransport {
  private baseline: DiagramDocument;
  private current: DiagramDocument;
  private saving = false;
  private pending?: RemoteCommit;
  constructor(
    document: DiagramDocument,
    private readonly remote: EditorTransport,
  ) {
    this.baseline = structuredClone(document);
    this.current = structuredClone(document);
  }
  get dirty() {
    const content = (document: DiagramDocument) => {
      const { revision: _, ...value } = document;
      return JSON.stringify(value);
    };
    return content(this.baseline) !== content(this.current);
  }
  async commit(request: RemoteCommit) {
    if (this.saving || this.pending) throw new Error('保存尚未确认，请先重试保存或读取远端核对');
    this.current = structuredClone(request.document);
    return structuredClone(this.current);
  }
  async save(): Promise<DiagramDocument> {
    if (this.saving) throw new Error('正在保存草稿');
    if (!this.dirty && !this.pending) return structuredClone(this.current);
    this.saving = true;
    this.pending ??= {
      kind: 'command',
      before: structuredClone(this.baseline),
      document: structuredClone(this.current),
      command: {
        commandId: newId('save'),
        expectedRevision: this.baseline.revision,
        origin: 'user',
        label: '保存画布草稿',
        operations: [],
      },
    };
    try {
      const saved = await this.remote.commit(this.pending);
      this.baseline = structuredClone(saved);
      this.current = structuredClone(saved);
      this.pending = undefined;
      return structuredClone(saved);
    } finally {
      this.saving = false;
    }
  }
}
