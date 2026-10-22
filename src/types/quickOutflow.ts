export interface Buyer {
  id: string;
  name: string;
  pinnedSkuIds?: string[]; // pack_skus ids pinned to the top of this buyer's PO SKU dropdown
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
  boxModeOverride?: BoxModeType;  // Set by resolveBoxLine for Box SKU lines
  labelSelection?: string | null;  // Paused feature placeholder
}

export interface LineMaterials {
  eggsButir: number;
  eggProduct: string;
  packagingPcs: number;
  packagingItem: string;
  labelPcs: number;
  labelItem: string | null;
  boxesPcs: number;
  boxType: string | null;
  isLogisticsOnly: boolean;
  lastBoxFill?: string;
  traysUsed?: number;
}

export interface AggregatedMaterials {
  eggsByProduct: Map<string, number>;
  packagingByItem: Map<string, number>;
  labelsByItem: Map<string, number>;
  boxesByType: Map<string, number>;
}

export interface StockShortage {
  category: 'egg' | 'packaging' | 'label' | 'box';
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
  dcId?: string;
  dcName?: string;
  lines: OrderLine[];
}
