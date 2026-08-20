import { StockLocation } from "@/lib/stockCount";

export interface StockCountRecord {
  id: string;
  countDate: string; // YYYY-MM-DD
  location: StockLocation;
  itemTypeId: string;
  product: string;
  category: string;
  quantity: number;
  systemQty: number | null;
  countedBy: string | null;
}

export interface StockCountSaveEntry {
  itemTypeId: string;
  product: string;
  category: string;
  location: StockLocation;
  quantity: number;
  systemQty?: number | null;
}
