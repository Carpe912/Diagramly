import type { ActivityOptions, BusinessOption, IoOptions } from '../../domain/business';
import { request, hasServerSession, listDocuments, getDocument } from './client';
export interface BusinessDataApi {
  activityOptions(): Promise<ActivityOptions>;
  flowActivities(id: string): Promise<BusinessOption[]>;
  interfaceOptions(): Promise<BusinessOption[]>;
  ioOptions(): Promise<IoOptions>;
}
export class StandaloneBusinessApi implements BusinessDataApi {
  constructor(private documentId: () => string) {}
  private async options(kind: string): Promise<BusinessOption[]> {
    if (!hasServerSession()) return [];
    const rows = (await request(`/business/${kind}`)) as { id: string; name: string }[];
    return rows.map((row) => ({ value: row.id, label: row.name }));
  }
  async activityOptions(): Promise<ActivityOptions> {
    const [applications, devices, terminals, operateTypes, requirements, todos] = await Promise.all(
      ['applications', 'devices', 'terminals', 'operations', 'requirements', 'todos'].map((kind) =>
        this.options(kind),
      ),
    );
    const flows = hasServerSession()
      ? (await listDocuments())
          .filter((row) => row.id !== this.documentId())
          .map((row) => ({ value: row.id, label: row.title }))
      : [];
    return { applications, devices, terminals, operateTypes, flows, requirements, todos };
  }
  async flowActivities(id: string) {
    const { document } = await getDocument(id);
    return Object.values(document.nodes)
      .filter(
        (node) =>
          node.type === 'activity' && document.entities[node.entityId].activityType !== 'linked',
      )
      .map((node) => ({ value: node.entityId, label: document.entities[node.entityId].name }));
  }
  interfaceOptions() {
    return this.options('interfaces');
  }
  async roles() {
    return (await this.options('roles')).map((row) => ({ orgId: row.value, orgName: row.label }));
  }
  async ioOptions(): Promise<IoOptions> {
    const [objects, tables, statements] = hasServerSession()
      ? await Promise.all(
          ['objects', 'tables', 'statements'].map((kind) => request(`/business/${kind}`)),
        )
      : [[], [], []];
    const documents = hasServerSession()
      ? ((await request('/attachments')) as { id: string; name: string }[]).map((row) => ({
          value: row.id,
          label: row.name,
        }))
      : [];
    return {
      objects: objects.map((row: { id: string; name: string; data?: { tableIds?: string[] } }) => ({
        value: row.id,
        label: row.name,
        tableIds: row.data?.tableIds ?? [],
      })),
      tables: tables.map(
        (row: {
          id: string;
          name: string;
          data?: { fields?: { id: string; name: string }[] };
        }) => ({
          value: row.id,
          label: row.name,
          fields: (row.data?.fields ?? []).map((field) => ({ value: field.id, label: field.name })),
        }),
      ),
      statements: statements.map((row: { id: string; name: string }) => ({
        value: row.id,
        label: row.name,
      })),
      documents,
      errors: [],
    };
  }
}
