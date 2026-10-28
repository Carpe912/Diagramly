import { z } from 'zod';
import { commandSchema } from '../application/commands';
import type { Editor } from '../application/editor';

/** Local, structured tool boundary. A host can expose these through MCP or its own tool protocol. */
export function createAgentTools(editor: Editor) {
  return {
    describe: () => ({
      name: 'Diagramly', schemaVersion: 1, shapes: editor.registry.describe(),
      tools: ['diagram.read', 'diagram.preview', 'diagram.apply'],
      applyInputSchema: z.toJSONSchema(commandSchema),
      capabilities: { atomicBatch: !editor.remote, atomicDocumentCommit: true, optimisticConcurrency: true, sessionIdempotency: true, externalBusinessApi: editor.remote, durableServerIdempotency: false },
    }),
    read: () => structuredClone(editor.snapshot),
    preview: (command: unknown) => {
      const parsed = commandSchema.parse(command);
      if (parsed.origin !== 'agent') throw new Error('Agent 命令的 origin 必须为 agent');
      const { document, changes } = editor.preview(parsed);
      return { revision: document.revision, changes, document };
    },
    apply: (command: unknown) => {
      const parsed = commandSchema.parse(command);
      if (parsed.origin !== 'agent') throw new Error('Agent 命令的 origin 必须为 agent');
      return editor.submit(parsed);
    },
  };
}
