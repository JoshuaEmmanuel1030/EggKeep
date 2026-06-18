export interface Buyer {
  id: string;
  name: string;
  defaultBoxMode: BoxModeType;
}

export type BoxModeType = 'box kecil' | 'box osave' | 'box osave polos' | 'keranjang' | 'tray' | 'plastic';

export type OrderLineType = 'pack' | 'loose';

export interface OrderLine {
  id: string;
  lineType: OrderLineType;
  skuCode?: string;        // For pack lines
  packQty?: number;        // For pack lines
  eggProduct?: string;     // For loose egg lines
  looseQty?: number;       // For loose egg lines
  looseUnit?: 'butir' | 'kg';
  boxModeOverride?: BoxModeType;
  labelSelection?: string | null;  // Paused feature placeholder
}

export interface LineMaterials {
  eggsButir: number;
  eggProduct: string;
  packagingPcs: number;
  packagingItem: string;
  boxesPcs: number;
  boxType: string | null;
  isLogisticsOnly: boolean;
  lastBoxFill?: string;
  traysUsed?: number;
}

export interface AggregatedMaterials {
  eggsByProduct: Map<string, number>;
  packagingByItem: Map<string, number>;
  boxesByType: Map<string, number>;
  logistics: { keranjang: boolean; traysUsed: number };
}

export interface StockShortage {
  category: 'egg' | 'packaging' | 'box';
  item: string;
  required: number;
  available: number;
  shortage: number;
}

export interface QuickOutflowOrder {
  buyerId: string;
  buyerName: string;
  date: string;
  invoiceRef: string;
  boxMode: BoxModeType;
  boxesRequired: boolean;
  lines: OrderLine[];
}
