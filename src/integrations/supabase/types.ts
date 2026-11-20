export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: "14.15"
  }
  public: {
    Tables: {
      activity_logs: {
        Row: {
          action_type: string
          category: Database["public"]["Enums"]["inventory_category"]
          client_id: string
          corrected_by_log_id: string | null
          created_at: string
          id: string
          invoice_supplier: string | null
          metadata: Json | null
          original_log_id: string | null
          product: string
          quantity_butir: number
          quantity_original: number | null
          recorded_at: string
          synced_at: string | null
          user_email: string | null
          user_id: string
          void_reason: string | null
          voided_at: string | null
        }
        Insert: {
          action_type: string
          category?: Database["public"]["Enums"]["inventory_category"]
          client_id: string
          corrected_by_log_id?: string | null
          created_at?: string
          id?: string
          invoice_supplier?: string | null
          metadata?: Json | null
          original_log_id?: string | null
          product: string
          quantity_butir: number
          quantity_original?: number | null
          recorded_at: string
          synced_at?: string | null
          user_email?: string | null
          user_id: string
          void_reason?: string | null
          voided_at?: string | null
        }
        Update: {
          action_type?: string
          category?: Database["public"]["Enums"]["inventory_category"]
          client_id?: string
          corrected_by_log_id?: string | null
          created_at?: string
          id?: string
          invoice_supplier?: string | null
          metadata?: Json | null
          original_log_id?: string | null
          product?: string
          quantity_butir?: number
          quantity_original?: number | null
          recorded_at?: string
          synced_at?: string | null
          user_email?: string | null
          user_id?: string
          void_reason?: string | null
          voided_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "activity_logs_corrected_by_log_id_fkey"
            columns: ["corrected_by_log_id"]
            isOneToOne: false
            referencedRelation: "activity_logs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "activity_logs_original_log_id_fkey"
            columns: ["original_log_id"]
            isOneToOne: false
            referencedRelation: "activity_logs"
            referencedColumns: ["id"]
          },
        ]
      }
      buyer_dcs: {
        Row: {
          buyer_id: string
          created_at: string
          id: string
          name: string
        }
        Insert: {
          buyer_id: string
          created_at?: string
          id?: string
          name: string
        }
        Update: {
          buyer_id?: string
          created_at?: string
          id?: string
          name?: string
        }
        Relationships: [
          {
            foreignKeyName: "buyer_dcs_buyer_id_fkey"
            columns: ["buyer_id"]
            isOneToOne: false
            referencedRelation: "buyers"
            referencedColumns: ["id"]
          },
        ]
      }
      buyers: {
        Row: {
          created_at: string
          default_box_mode: string
          deleted_at: string | null
          id: string
          name: string
          pinned_sku_ids: string[]
          requires_claim_ref: boolean
        }
        Insert: {
          created_at?: string
          default_box_mode?: string
          deleted_at?: string | null
          id?: string
          name: string
          pinned_sku_ids?: string[]
          requires_claim_ref?: boolean
        }
        Update: {
          created_at?: string
          default_box_mode?: string
          deleted_at?: string | null
          id?: string
          name?: string
          pinned_sku_ids?: string[]
          requires_claim_ref?: boolean
        }
        Relationships: []
      }
      deliveries: {
        Row: {
          buyer_name: string
          created_at: string
          dc_name: string | null
          delivery_date: string
          driver_id: string | null
          driver_name: string | null
          id: string
          invoice_checked_by: string | null
          invoice_ref: string
          invoice_ref_norm: string | null
          invoice_returned_at: string | null
          notes: string | null
          pic: string | null
          status: string
          updated_at: string
        }
        Insert: {
          buyer_name: string
          created_at?: string
          dc_name?: string | null
          delivery_date: string
          driver_id?: string | null
          driver_name?: string | null
          id?: string
          invoice_checked_by?: string | null
          invoice_ref: string
          invoice_ref_norm?: string | null
          invoice_returned_at?: string | null
          notes?: string | null
          pic?: string | null
          status?: string
          updated_at?: string
        }
        Update: {
          buyer_name?: string
          created_at?: string
          dc_name?: string | null
          delivery_date?: string
          driver_id?: string | null
          driver_name?: string | null
          id?: string
          invoice_checked_by?: string | null
          invoice_ref?: string
          invoice_ref_norm?: string | null
          invoice_returned_at?: string | null
          notes?: string | null
          pic?: string | null
          status?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "deliveries_driver_id_fkey"
            columns: ["driver_id"]
            isOneToOne: false
            referencedRelation: "drivers"
            referencedColumns: ["id"]
          },
        ]
      }
      delivery_lines: {
        Row: {
          claim_ref: string | null
          claim_ref_norm: string | null
          created_at: string
          created_by: string | null
          delivery_id: string
          expected_expiry: string | null
          id: string
          note: string | null
          pieces_per_unit: number
          quantity: number
          reason: string
          sku_code: string
          source: string
          unit_label: string
          updated_at: string
        }
        Insert: {
          claim_ref?: string | null
          claim_ref_norm?: string | null
          created_at?: string
          created_by?: string | null
          delivery_id: string
          expected_expiry?: string | null
          id: string
          note?: string | null
          pieces_per_unit: number
          quantity?: number
          reason: string
          sku_code: string
          source?: string
          unit_label: string
          updated_at?: string
        }
        Update: {
          claim_ref?: string | null
          claim_ref_norm?: string | null
          created_at?: string
          created_by?: string | null
          delivery_id?: string
          expected_expiry?: string | null
          id?: string
          note?: string | null
          pieces_per_unit?: number
          quantity?: number
          reason?: string
          sku_code?: string
          source?: string
          unit_label?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "delivery_lines_delivery_id_fkey"
            columns: ["delivery_id"]
            isOneToOne: false
            referencedRelation: "deliveries"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "delivery_lines_delivery_id_fkey"
            columns: ["delivery_id"]
            isOneToOne: false
            referencedRelation: "open_delivery_items"
            referencedColumns: ["delivery_id"]
          },
        ]
      }
      cash_customers: {
        Row: {
          created_at: string
          id: string
          is_active: boolean
          name: string
        }
        Insert: {
          created_at?: string
          id?: string
          is_active?: boolean
          name: string
        }
        Update: {
          created_at?: string
          id?: string
          is_active?: boolean
          name?: string
        }
        Relationships: []
      }
      drivers: {
        Row: {
          created_at: string
          id: string
          is_active: boolean
          name: string
        }
        Insert: {
          created_at?: string
          id?: string
          is_active?: boolean
          name: string
        }
        Update: {
          created_at?: string
          id?: string
          is_active?: boolean
          name?: string
        }
        Relationships: []
      }
      expiry_rules: {
        Row: {
          buyer_keyword: string | null
          created_at: string
          id: string
          note: string | null
          shelf_days: number | null
          shelf_months: number | null
          sku_code: string | null
        }
        Insert: {
          buyer_keyword?: string | null
          created_at?: string
          id?: string
          note?: string | null
          shelf_days?: number | null
          shelf_months?: number | null
          sku_code?: string | null
        }
        Update: {
          buyer_keyword?: string | null
          created_at?: string
          id?: string
          note?: string | null
          shelf_days?: number | null
          shelf_months?: number | null
          sku_code?: string | null
        }
        Relationships: []
      }
      fifo_deductions: {
        Row: {
          created_at: string | null
          id: string
          inflow_id: string
          outflow_id: string
          quantity_deducted: number
        }
        Insert: {
          created_at?: string | null
          id?: string
          inflow_id: string
          outflow_id: string
          quantity_deducted: number
        }
        Update: {
          created_at?: string | null
          id?: string
          inflow_id?: string
          outflow_id?: string
          quantity_deducted?: number
        }
        Relationships: [
          {
            foreignKeyName: "fifo_deductions_inflow_id_fkey"
            columns: ["inflow_id"]
            isOneToOne: false
            referencedRelation: "inflows"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "fifo_deductions_outflow_id_fkey"
            columns: ["outflow_id"]
            isOneToOne: false
            referencedRelation: "outflows"
            referencedColumns: ["id"]
          },
        ]
      }
      inflows: {
        Row: {
          category: Database["public"]["Enums"]["inventory_category"]
          created_at: string
          date: string
          form: string | null
          form_count: number | null
          id: string
          invoice_supplier: string | null
          item_type_id: string | null
          product: string
          quantity_butir: number
          quantity_original: number
          remaining_butir: number
          return_id: string | null
          stock_adjustment_id: string | null
          tonase_kg: number | null
          user_id: string
          void_reason: string | null
          voided_at: string | null
        }
        Insert: {
          category?: Database["public"]["Enums"]["inventory_category"]
          created_at?: string
          date: string
          form?: string | null
          form_count?: number | null
          id?: string
          invoice_supplier?: string | null
          item_type_id?: string | null
          product: string
          quantity_butir: number
          quantity_original: number
          remaining_butir: number
          return_id?: string | null
          stock_adjustment_id?: string | null
          tonase_kg?: number | null
          user_id: string
          void_reason?: string | null
          voided_at?: string | null
        }
        Update: {
          category?: Database["public"]["Enums"]["inventory_category"]
          created_at?: string
          date?: string
          form?: string | null
          form_count?: number | null
          id?: string
          invoice_supplier?: string | null
          item_type_id?: string | null
          product?: string
          quantity_butir?: number
          quantity_original?: number
          remaining_butir?: number
          return_id?: string | null
          stock_adjustment_id?: string | null
          tonase_kg?: number | null
          user_id?: string
          void_reason?: string | null
          voided_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "inflows_item_type_id_fkey"
            columns: ["item_type_id"]
            isOneToOne: false
            referencedRelation: "item_types"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "inflows_item_type_id_fkey"
            columns: ["item_type_id"]
            isOneToOne: false
            referencedRelation: "v_recon_products"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "inflows_return_id_fkey"
            columns: ["return_id"]
            isOneToOne: false
            referencedRelation: "returns"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "inflows_stock_adjustment_id_fkey"
            columns: ["stock_adjustment_id"]
            isOneToOne: false
            referencedRelation: "stock_adjustments"
            referencedColumns: ["id"]
          },
        ]
      }
      item_types: {
        Row: {
          box_capacities: Json | null
          category: Database["public"]["Enums"]["inventory_category"]
          count_tolerance: number | null
          created_at: string
          deleted_at: string | null
          eggs_per_unit: number | null
          forms: Json | null
          freshness_days: number | null
          id: string
          is_retakan: boolean
          labels_per_pack: number | null
          low_stock_threshold: number | null
          name: string
          parent_item_type_id: string | null
          unit: string | null
        }
        Insert: {
          box_capacities?: Json | null
          category: Database["public"]["Enums"]["inventory_category"]
          count_tolerance?: number | null
          created_at?: string
          deleted_at?: string | null
          eggs_per_unit?: number | null
          forms?: Json | null
          freshness_days?: number | null
          id?: string
          is_retakan?: boolean
          labels_per_pack?: number | null
          low_stock_threshold?: number | null
          name: string
          parent_item_type_id?: string | null
          unit?: string | null
        }
        Update: {
          box_capacities?: Json | null
          category?: Database["public"]["Enums"]["inventory_category"]
          count_tolerance?: number | null
          created_at?: string
          deleted_at?: string | null
          eggs_per_unit?: number | null
          forms?: Json | null
          freshness_days?: number | null
          id?: string
          is_retakan?: boolean
          labels_per_pack?: number | null
          low_stock_threshold?: number | null
          name?: string
          parent_item_type_id?: string | null
          unit?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "item_types_parent_item_type_id_fkey"
            columns: ["parent_item_type_id"]
            isOneToOne: false
            referencedRelation: "item_types"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "item_types_parent_item_type_id_fkey"
            columns: ["parent_item_type_id"]
            isOneToOne: false
            referencedRelation: "v_recon_products"
            referencedColumns: ["id"]
          },
        ]
      }
      outflows: {
        Row: {
          category: Database["public"]["Enums"]["inventory_category"]
          created_at: string
          date: string
          id: string
          invoice_supplier: string | null
          item_type_id: string | null
          product: string
          quantity_butir: number
          stock_adjustment_id: string | null
          user_id: string
          void_reason: string | null
          void_return_id: string | null
          voided_at: string | null
        }
        Insert: {
          category?: Database["public"]["Enums"]["inventory_category"]
          created_at?: string
          date: string
          id?: string
          invoice_supplier?: string | null
          item_type_id?: string | null
          product: string
          quantity_butir: number
          stock_adjustment_id?: string | null
          user_id: string
          void_reason?: string | null
          void_return_id?: string | null
          voided_at?: string | null
        }
        Update: {
          category?: Database["public"]["Enums"]["inventory_category"]
          created_at?: string
          date?: string
          id?: string
          invoice_supplier?: string | null
          item_type_id?: string | null
          product?: string
          quantity_butir?: number
          stock_adjustment_id?: string | null
          user_id?: string
          void_reason?: string | null
          void_return_id?: string | null
          voided_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "outflows_item_type_id_fkey"
            columns: ["item_type_id"]
            isOneToOne: false
            referencedRelation: "item_types"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "outflows_item_type_id_fkey"
            columns: ["item_type_id"]
            isOneToOne: false
            referencedRelation: "v_recon_products"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "outflows_stock_adjustment_id_fkey"
            columns: ["stock_adjustment_id"]
            isOneToOne: false
            referencedRelation: "stock_adjustments"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "outflows_void_return_id_fkey"
            columns: ["void_return_id"]
            isOneToOne: false
            referencedRelation: "returns"
            referencedColumns: ["id"]
          },
        ]
      }
      pack_skus: {
        Row: {
          base_pack_code: string | null
          box_mode: string | null
          code: string
          created_at: string | null
          deleted_at: string | null
          display_name: string
          egg_item_type_id: string | null
          egg_product: string
          eggs_per_pack: number
          id: string
          is_active: boolean | null
          packaging_item: string | null
          packaging_item_type_id: string | null
          unit_label: string
        }
        Insert: {
          base_pack_code?: string | null
          box_mode?: string | null
          code: string
          created_at?: string | null
          deleted_at?: string | null
          display_name: string
          egg_item_type_id?: string | null
          egg_product: string
          eggs_per_pack: number
          id?: string
          is_active?: boolean | null
          packaging_item?: string | null
          packaging_item_type_id?: string | null
          unit_label?: string
        }
        Update: {
          base_pack_code?: string | null
          box_mode?: string | null
          code?: string
          created_at?: string | null
          deleted_at?: string | null
          display_name?: string
          egg_item_type_id?: string | null
          egg_product?: string
          eggs_per_pack?: number
          id?: string
          is_active?: boolean | null
          packaging_item?: string | null
          packaging_item_type_id?: string | null
          unit_label?: string
        }
        Relationships: [
          {
            foreignKeyName: "pack_skus_egg_item_type_id_fkey"
            columns: ["egg_item_type_id"]
            isOneToOne: false
            referencedRelation: "item_types"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "pack_skus_egg_item_type_id_fkey"
            columns: ["egg_item_type_id"]
            isOneToOne: false
            referencedRelation: "v_recon_products"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "pack_skus_packaging_item_type_id_fkey"
            columns: ["packaging_item_type_id"]
            isOneToOne: false
            referencedRelation: "item_types"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "pack_skus_packaging_item_type_id_fkey"
            columns: ["packaging_item_type_id"]
            isOneToOne: false
            referencedRelation: "v_recon_products"
            referencedColumns: ["id"]
          },
        ]
      }
      pengiriman_scans: {
        Row: {
          corrected_rows: Json | null
          created_at: string
          created_by: string
          form_version: string | null
          id: string
          image_path: string
          model: string
          outflow_entry_ids: string[] | null
          raw_rows: Json
          status: string
        }
        Insert: {
          corrected_rows?: Json | null
          created_at?: string
          created_by: string
          form_version?: string | null
          id?: string
          image_path: string
          model: string
          outflow_entry_ids?: string[] | null
          raw_rows: Json
          status?: string
        }
        Update: {
          corrected_rows?: Json | null
          created_at?: string
          created_by?: string
          form_version?: string | null
          id?: string
          image_path?: string
          model?: string
          outflow_entry_ids?: string[] | null
          raw_rows?: Json
          status?: string
        }
        Relationships: []
      }
      poker_players: {
        Row: {
          archived: boolean
          created_at: string
          id: string
          name: string
        }
        Insert: {
          archived?: boolean
          created_at?: string
          id?: string
          name: string
        }
        Update: {
          archived?: boolean
          created_at?: string
          id?: string
          name?: string
        }
        Relationships: []
      }
      poker_session_players: {
        Row: {
          carry_in: number
          created_at: string
          final_chips: number | null
          id: string
          player_id: string
          session_id: string
        }
        Insert: {
          carry_in?: number
          created_at?: string
          final_chips?: number | null
          id?: string
          player_id: string
          session_id: string
        }
        Update: {
          carry_in?: number
          created_at?: string
          final_chips?: number | null
          id?: string
          player_id?: string
          session_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "poker_session_players_player_id_fkey"
            columns: ["player_id"]
            isOneToOne: false
            referencedRelation: "poker_players"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "poker_session_players_session_id_fkey"
            columns: ["session_id"]
            isOneToOne: false
            referencedRelation: "poker_sessions"
            referencedColumns: ["id"]
          },
        ]
      }
      poker_sessions: {
        Row: {
          created_at: string
          fee: number
          id: string
          name: string
          settled_at: string | null
          status: string
        }
        Insert: {
          created_at?: string
          fee?: number
          id?: string
          name: string
          settled_at?: string | null
          status?: string
        }
        Update: {
          created_at?: string
          fee?: number
          id?: string
          name?: string
          settled_at?: string | null
          status?: string
        }
        Relationships: []
      }
      poker_settlements: {
        Row: {
          amount: number
          created_at: string
          from_player: string
          id: string
          session_id: string
          to_player: string
        }
        Insert: {
          amount: number
          created_at?: string
          from_player: string
          id?: string
          session_id: string
          to_player: string
        }
        Update: {
          amount?: number
          created_at?: string
          from_player?: string
          id?: string
          session_id?: string
          to_player?: string
        }
        Relationships: [
          {
            foreignKeyName: "poker_settlements_from_player_fkey"
            columns: ["from_player"]
            isOneToOne: false
            referencedRelation: "poker_players"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "poker_settlements_session_id_fkey"
            columns: ["session_id"]
            isOneToOne: false
            referencedRelation: "poker_sessions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "poker_settlements_to_player_fkey"
            columns: ["to_player"]
            isOneToOne: false
            referencedRelation: "poker_players"
            referencedColumns: ["id"]
          },
        ]
      }
      poker_transactions: {
        Row: {
          amount: number
          created_at: string
          id: string
          player_id: string
          session_id: string
          type: string
        }
        Insert: {
          amount: number
          created_at?: string
          id?: string
          player_id: string
          session_id: string
          type: string
        }
        Update: {
          amount?: number
          created_at?: string
          id?: string
          player_id?: string
          session_id?: string
          type?: string
        }
        Relationships: [
          {
            foreignKeyName: "poker_transactions_player_id_fkey"
            columns: ["player_id"]
            isOneToOne: false
            referencedRelation: "poker_players"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "poker_transactions_session_id_fkey"
            columns: ["session_id"]
            isOneToOne: false
            referencedRelation: "poker_sessions"
            referencedColumns: ["id"]
          },
        ]
      }
      return_restocks: {
        Row: {
          id: string
          inflow_id: string
          quantity_restored: number
          return_id: string
        }
        Insert: {
          id?: string
          inflow_id: string
          quantity_restored: number
          return_id: string
        }
        Update: {
          id?: string
          inflow_id?: string
          quantity_restored?: number
          return_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "return_restocks_inflow_id_fkey"
            columns: ["inflow_id"]
            isOneToOne: false
            referencedRelation: "inflows"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "return_restocks_return_id_fkey"
            columns: ["return_id"]
            isOneToOne: false
            referencedRelation: "returns"
            referencedColumns: ["id"]
          },
        ]
      }
      returns: {
        Row: {
          buyer_name: string | null
          category: Database["public"]["Enums"]["inventory_category"]
          created_at: string
          disposition: string
          id: string
          item_type_id: string | null
          outflow_id: string
          product: string
          quantity: number
          reason: string | null
          return_date: string
          sku_code: string | null
          user_email: string | null
          user_id: string
          void_reason: string | null
          voided_at: string | null
          voided_by: string | null
        }
        Insert: {
          buyer_name?: string | null
          category: Database["public"]["Enums"]["inventory_category"]
          created_at?: string
          disposition: string
          id: string
          item_type_id?: string | null
          outflow_id: string
          product: string
          quantity: number
          reason?: string | null
          return_date: string
          sku_code?: string | null
          user_email?: string | null
          user_id: string
          void_reason?: string | null
          voided_at?: string | null
          voided_by?: string | null
        }
        Update: {
          buyer_name?: string | null
          category?: Database["public"]["Enums"]["inventory_category"]
          created_at?: string
          disposition?: string
          id?: string
          item_type_id?: string | null
          outflow_id?: string
          product?: string
          quantity?: number
          reason?: string | null
          return_date?: string
          sku_code?: string | null
          user_email?: string | null
          user_id?: string
          void_reason?: string | null
          voided_at?: string | null
          voided_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "returns_item_type_id_fkey"
            columns: ["item_type_id"]
            isOneToOne: false
            referencedRelation: "item_types"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "returns_item_type_id_fkey"
            columns: ["item_type_id"]
            isOneToOne: false
            referencedRelation: "v_recon_products"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "returns_outflow_id_fkey"
            columns: ["outflow_id"]
            isOneToOne: false
            referencedRelation: "outflows"
            referencedColumns: ["id"]
          },
        ]
      }
      stock_adjustments: {
        Row: {
          applied_at: string
          applied_by: string
          applied_by_email: string | null
          count_date: string
          id: string
          lines: Json
        }
        Insert: {
          applied_at?: string
          applied_by: string
          applied_by_email?: string | null
          count_date: string
          id?: string
          lines: Json
        }
        Update: {
          applied_at?: string
          applied_by?: string
          applied_by_email?: string | null
          count_date?: string
          id?: string
          lines?: Json
        }
        Relationships: []
      }
      stock_counts: {
        Row: {
          category: string
          count_date: string
          counted_by: string | null
          created_at: string
          id: string
          item_type_id: string
          location: string
          product: string
          quantity: number
          system_qty: number | null
          updated_at: string
        }
        Insert: {
          category: string
          count_date?: string
          counted_by?: string | null
          created_at?: string
          id?: string
          item_type_id: string
          location: string
          product: string
          quantity: number
          system_qty?: number | null
          updated_at?: string
        }
        Update: {
          category?: string
          count_date?: string
          counted_by?: string | null
          created_at?: string
          id?: string
          item_type_id?: string
          location?: string
          product?: string
          quantity?: number
          system_qty?: number | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "stock_counts_item_type_id_fkey"
            columns: ["item_type_id"]
            isOneToOne: false
            referencedRelation: "item_types"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "stock_counts_item_type_id_fkey"
            columns: ["item_type_id"]
            isOneToOne: false
            referencedRelation: "v_recon_products"
            referencedColumns: ["id"]
          },
        ]
      }
      user_roles: {
        Row: {
          granted_at: string | null
          granted_by: string | null
          id: string
          role: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Insert: {
          granted_at?: string | null
          granted_by?: string | null
          id?: string
          role?: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Update: {
          granted_at?: string | null
          granted_by?: string | null
          id?: string
          role?: Database["public"]["Enums"]["app_role"]
          user_id?: string
        }
        Relationships: []
      }
    }
    Views: {
      open_delivery_items: {
        Row: {
          buyer_name: string | null
          dc_name: string | null
          delivery_date: string | null
          delivery_id: string | null
          invoice_not_back: boolean | null
          invoice_ref: string | null
          invoice_ref_norm: string | null
          invoice_returned_at: string | null
          not_logged: boolean | null
          status: string | null
        }
        Relationships: []
      }
      purchase_orders: {
        Row: {
          buyer_name: string | null
          dc_id: string | null
          dc_name: string | null
          egg_totals: Json | null
          invoice_ref: string | null
          order_lines: Json | null
          outflow_date: string | null
          recorded_at: string | null
        }
        Relationships: []
      }
      v_recon_daily: {
        Row: {
          catatan: string | null
          hitung_fisik: number | null
          is_retakan: boolean | null
          item: string | null
          keluar_po: number | null
          keluar_tunai: number | null
          masuk: number | null
          nama_katalog: string | null
          penyesuaian: number | null
          retur: number | null
          selisih_fisik: number | null
          stok_akhir: number | null
          stok_awal: number | null
          tanggal: string | null
          tanpa_label: boolean | null
          unit: string | null
          urutan: number | null
        }
        Relationships: []
      }
      v_recon_ledger: {
        Row: {
          butir_per_unit: number | null
          dibuat_wib: string | null
          disposisi: string | null
          flags: string[] | null
          id: string | null
          is_retakan: boolean | null
          item: string | null
          jenis: string | null
          keluar_po: number | null
          keluar_tunai: number | null
          masuk: number | null
          nama_katalog: string | null
          no_faktur: string | null
          outflow_id: string | null
          pembeli_pemasok: string | null
          penyesuaian: number | null
          qty: number | null
          retur: number | null
          return_id: string | null
          tanggal: string | null
          tanggal_faktur_asal: string | null
          tanpa_label: boolean | null
          unit: string | null
          urutan: number | null
          voided: boolean | null
        }
        Relationships: []
      }
      v_recon_products: {
        Row: {
          butir_per_unit: number | null
          deleted_at: string | null
          id: string | null
          induk: string | null
          is_retakan: boolean | null
          item: string | null
          nama_katalog: string | null
          tanpa_label: boolean | null
          unit: string | null
          urutan: number | null
        }
        Relationships: []
      }
    }
    Functions: {
      apply_stock_count_adjustment: {
        Args: { p_expected: Json }
        Returns: Json
      }
      correct_order: {
        Args: {
          p_entries: Json
          p_logs: Json
          p_old_log_ids: string[]
          p_reason: string
        }
        Returns: undefined
      }
      has_role: {
        Args: {
          _role: Database["public"]["Enums"]["app_role"]
          _user_id: string
        }
        Returns: boolean
      }
      recalculate_inventory_fifo: {
        Args: never
        Returns: {
          deductions_created: number
          outflows_processed: number
          product_name: string
          total_deducted: number
        }[]
      }
      reconcile_inventory: {
        Args: never
        Returns: {
          drift: number
          expected_remaining: number
          inflow_id: string
          kind: string
          product: string
          stored_remaining: number
        }[]
      }
      record_order_outflows: { Args: { p_entries: Json }; Returns: undefined }
      record_return: { Args: { p_return: Json }; Returns: undefined }
      stock_count_adjustment_preview: {
        Args: never
        Returns: {
          applied: number
          book_at_count: number
          book_now: number
          delta: number
          item_type_id: string
          physical_js: number
          physical_loaded: number
          product: string
          shortfall: number
          target: number
          unit: string
        }[]
      }
      void_outflow: {
        Args: { p_outflow_id: string; p_reason: string }
        Returns: undefined
      }
      void_return: {
        Args: { p_reason: string; p_return_id: string }
        Returns: undefined
      }
    }
    Enums: {
      app_role: "admin" | "user"
      inventory_category: "egg" | "box" | "label" | "packaging"
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] &
        DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] &
        DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R
      }
      ? R
      : never
    : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I
      }
      ? I
      : never
    : never

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U
      }
      ? U
      : never
    : never

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends (DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never) = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends (PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never) = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  public: {
    Enums: {
      app_role: ["admin", "user"],
      inventory_category: ["egg", "box", "label", "packaging"],
    },
  },
} as const
