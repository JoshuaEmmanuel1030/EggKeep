import { InventoryCategory } from "./inventory";

export interface ActivityLogMetadata {
  orderType?: 'quick_outflow' | 'manual';
  buyerName?: string;
  // The id of the outflow/inflow row this log corresponds to. Lets void look up
  // the source row directly instead of guessing by product + timestamp.
  relatedEntryId?: string;
  invoiceRef?: string;
  skuCode?: string;
  packQty?: number;
  boxMode?: string;
  // The date when the outflow actually occurred (business date)
  outflowDate?: string;
  // The date when the inflow actually occurred (business date)
  inflowDate?: string;
  // Order lines showing what customer ordered
  orderLines?: Array<{ 
    skuCode?: string; 
    packQty?: number; 
    eggProduct?: string;
    looseQty?: number;
  }>;
  // Raw materials that were consumed
  relatedProducts?: Array<{ product: string; quantity: number; type: string }>;
}

export interface ActivityLog {
  id: string;
  user_id: string;
  action_type: 'inflow' | 'outflow';
  product: string;
  quantity_butir: number;
  quantity_original?: number;
  recorded_at: string;
  synced_at?: string;
  created_at: string;
  client_id: string;
  category: InventoryCategory;
  invoice_supplier?: string;
  user_email?: string;
  metadata?: ActivityLogMetadata;
  // Void tracking
  voided_at?: string;
  void_reason?: string;
  original_log_id?: string;
  corrected_by_log_id?: string;
  // Local state
  isSynced?: boolean;
}

export interface PendingActivityLog {
  id: string;
  user_id: string;
  action_type: 'inflow' | 'outflow';
  product: string;
  quantity_butir: number;
  quantity_original?: number;
  recorded_at: string;
  client_id: string;
  category: InventoryCategory;
  invoice_supplier?: string;
  user_email?: string;
  metadata?: ActivityLogMetadata;
}
