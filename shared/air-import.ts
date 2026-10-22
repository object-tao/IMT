import type { Catalog } from './model.js';
export type AirImportPreview={catalog:Catalog;rows:{row:number;route:string;flight:string;period:string;times:string;details:string;action:'new'|'existing'|'error';errors:string[]}[];errors:string[];newLanes:number;newFlights:number;existing:number;source:string};
