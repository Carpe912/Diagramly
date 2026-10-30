export interface ActivityDetail {
  activity: {
    id: string;
    version: number;
    actName?: string;
    actType?: string;
    actDetailDesc?: string;
    isKeyStep?: boolean;
    code?: string;
    orgId?: string[];
    ioputs?: Record<string, unknown>[];
    [key: string]: unknown;
  };
  data?: { actName?: string };
  [key: string]: unknown;
}
export interface FlowDetail {
  id: string;
  name: string;
  version: number;
  drawioXml: string;
  lockUser?: unknown;
  flowObj?: { acts?: Record<string, unknown>[]; [key: string]: unknown };
  [key: string]: unknown;
}
export interface Organization {
  orgId: string;
  orgName: string;
  index?: number;
  porgId?: string;
}
export interface BusinessOption {
  value: string;
  label: string;
}
export interface BusinessMutation {
  kind: 'io' | 'exception' | 'difficult';
  action: 'save' | 'delete';
  data: Record<string, unknown>;
}
export interface IoOptions {
  objects: (BusinessOption & { tableIds: string[] })[];
  tables: (BusinessOption & { fields: BusinessOption[] })[];
  statements: BusinessOption[];
  documents: BusinessOption[];
  errors: string[];
}
export interface ActivityOptions {
  applications: BusinessOption[];
  devices: BusinessOption[];
  flows: BusinessOption[];
  terminals: BusinessOption[];
  operateTypes: BusinessOption[];
  requirements?: BusinessOption[];
  todos?: BusinessOption[];
}

export interface LinkedChoice {
  linkFlow: string;
  linkAct: string;
  showOrgName: boolean;
}
