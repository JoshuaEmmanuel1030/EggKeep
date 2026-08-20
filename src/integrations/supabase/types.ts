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
    PostgrestVersion: "14.5"
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
      buyers: {
        Row: {
          created_at: string
          default_box_mode: string
          deleted_at: string | null
          id: string
          name: string
        }
        Insert: {
          created_at?: string
          default_box_mode?: string
          deleted_at?: string | null
          id?: string
          name: string
        }
        Update: {
          created_at?: string
          default_box_mode?: string
          deleted_at?: string | null
          id?: string
          name?: string
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
          id: string
          invoice_supplier: string | null
          item_type_id: string | null
          product: string
          quantity_butir: number
          quantity_original: number
          remaining_butir: number
          user_id: string
          void_reason: string | null
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
          quantity_original: number
          remaining_butir: number
          user_id: string
          void_reason?: string | null
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
          quantity_original?: number
          remaining_butir?: number
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
          freshness_days: number | null
          id: string
          labels_per_pack: number | null
          low_stock_threshold: number | null
          name: string
          unit: string | null
        }
        Insert: {
          box_capacities?: Json | null
          category: Database["public"]["Enums"]["inventory_category"]
          count_tolerance?: number | null
          created_at?: string
          deleted_at?: string | null
          eggs_per_unit?: number | null
          freshness_days?: number | null
          id?: string
          labels_per_pack?: number | null
          low_stock_threshold?: number | null
          name: string
          unit?: string | null
        }
        Update: {
          box_capacities?: Json | null
          category?: Database["public"]["Enums"]["inventory_category"]
          count_tolerance?: number | null
          created_at?: string
          deleted_at?: string | null
          eggs_per_unit?: number | null
          freshness_days?: number | null
          id?: string
          labels_per_pack?: number | null
          low_stock_threshold?: number | null
          name?: string
          unit?: string | null
        }
        Relationships: []
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
          user_id: string
          void_reason: string | null
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
          user_id: string
          void_reason?: string | null
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
          user_id?: string
          void_reason?: string | null
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
        ]
      }
      pack_skus: {
        Row: {
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
        }
        Insert: {
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
        }
        Update: {
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
            foreignKeyName: "pack_skus_packaging_item_type_id_fkey"
            columns: ["packaging_item_type_id"]
            isOneToOne: false
            referencedRelation: "item_types"
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
      [_ in never]: never
    }
    Functions: {
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
      record_order_outflows: { Args: { p_entries: Json }; Returns: undefined }
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
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never = never,
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
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
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
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
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
  EnumName extends DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never = never,
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
  CompositeTypeName extends PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never = never,
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
