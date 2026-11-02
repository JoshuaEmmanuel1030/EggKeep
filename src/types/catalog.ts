export interface PackSKU {
  id: string;
  code: string;
  displayName: string;
  eggsPerPack: number;
  eggProduct: string;
  packagingItem: string | null;
  isActive: boolean;
  createdAt: string;
  basePackCode?: string | null;
  boxMode?: string | null;
  // The unit word on the faktur ("Satuan di faktur"): box for the Osave boxes and N30B.
  unitLabel?: "pak" | "box";
}

export interface PackSKUInput {
  code: string;
  displayName: string;
  eggsPerPack: number;
  eggProduct: string;
  packagingItem?: string | null;
  isActive?: boolean;
  basePackCode?: string | null;
  boxMode?: string | null;
  unitLabel?: "pak" | "box";
}
