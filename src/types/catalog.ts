export interface PackSKU {
  id: string;
  code: string;
  displayName: string;
  eggsPerPack: number;
  eggProduct: string;
  packagingItem: string | null;
  isActive: boolean;
  createdAt: string;
}

export interface PackSKUInput {
  code: string;
  displayName: string;
  eggsPerPack: number;
  eggProduct: string;
  packagingItem?: string | null;
  isActive?: boolean;
}
