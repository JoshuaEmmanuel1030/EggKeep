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
    PostgrestVersion: "14.1"
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
          product?: string
          quantity_butir?: number
          quantity_original?: number
          remaining_butir?: number
          user_id?: string
          void_reason?: string | null
          voided_at?: string | null
        }
        Relationships: []
      }
      item_types: {
        Row: {
          box_capacities: Json | null
          category: Database["public"]["Enums"]["inventory_category"]
          created_at: string
          deleted_at: string | null
          eggs_per_unit: number | null
          id: string
          name: string
          unit: string | null
        }
        Insert: {
          box_capacities?: Json | null
          category: Database["public"]["Enums"]["inventory_category"]
          created_at?: string
          deleted_at?: string | null
          eggs_per_unit?: number | null
          id?: string
          name: string
          unit?: string | null
        }
        Update: {
          box_capacities?: Json | null
          category?: Database["public"]["Enums"]["inventory_category"]
          created_at?: string
          deleted_at?: string | null
          eggs_per_unit?: number | null
          id?: string
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
          product?: string
          quantity_butir?: number
          user_id?: string
          void_reason?: string | null
          voided_at?: string | null
        }
        Relationships: []
      }
      pack_skus: {
        Row: {
          code: string
          created_at: string | null
          deleted_at: string | null
          display_name: string
          egg_product: string
          eggs_per_pack: number
          id: string
          is_active: boolean | null
          packaging_item: string | null
        }
        Insert: {
          code: string
          created_at?: string | null
          deleted_at?: string | null
          display_name: string
          egg_product: string
          eggs_per_pack: number
          id?: string
          is_active?: boolean | null
          packaging_item?: string | null
        }
        Update: {
          code?: string
          created_at?: string | null
          deleted_at?: string | null
          display_name?: string
          egg_product?: string
          eggs_per_pack?: number
          id?: string
          is_active?: boolean | null
          packaging_item?: string | null
        }
        Relationships: []
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
