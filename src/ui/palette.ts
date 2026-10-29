import type { BusinessEntity } from '../domain/model';
import type { ShapeDefinition } from '../shapes/registry';

export type PaletteShape = ShapeDefinition & {
  id: string;
  activityType?: BusinessEntity['activityType'];
};
