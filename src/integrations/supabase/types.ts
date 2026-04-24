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
      grocery_budgets: {
        Row: {
          created_at: string
          currency: string
          id: string
          monthly_limit: number
          period_start: string
          updated_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          currency?: string
          id?: string
          monthly_limit?: number
          period_start?: string
          updated_at?: string
          user_id: string
        }
        Update: {
          created_at?: string
          currency?: string
          id?: string
          monthly_limit?: number
          period_start?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      helper_requests: {
        Row: {
          ai_summary: string | null
          answered_at: string | null
          created_at: string
          helper_response: string | null
          helper_user_id: string | null
          id: string
          image_url: string | null
          kind: Database["public"]["Enums"]["request_kind"]
          primary_user_id: string
          question: string | null
          status: Database["public"]["Enums"]["request_status"]
          whatsapp_sent: boolean
        }
        Insert: {
          ai_summary?: string | null
          answered_at?: string | null
          created_at?: string
          helper_response?: string | null
          helper_user_id?: string | null
          id?: string
          image_url?: string | null
          kind?: Database["public"]["Enums"]["request_kind"]
          primary_user_id: string
          question?: string | null
          status?: Database["public"]["Enums"]["request_status"]
          whatsapp_sent?: boolean
        }
        Update: {
          ai_summary?: string | null
          answered_at?: string | null
          created_at?: string
          helper_response?: string | null
          helper_user_id?: string | null
          id?: string
          image_url?: string | null
          kind?: Database["public"]["Enums"]["request_kind"]
          primary_user_id?: string
          question?: string | null
          status?: Database["public"]["Enums"]["request_status"]
          whatsapp_sent?: boolean
        }
        Relationships: []
      }
      joint_accounts: {
        Row: {
          created_at: string
          helper_email: string | null
          helper_user_id: string
          id: string
          primary_user_id: string
        }
        Insert: {
          created_at?: string
          helper_email?: string | null
          helper_user_id: string
          id?: string
          primary_user_id: string
        }
        Update: {
          created_at?: string
          helper_email?: string | null
          helper_user_id?: string
          id?: string
          primary_user_id?: string
        }
        Relationships: []
      }
      price_history: {
        Row: {
          currency: string
          id: string
          observed_at: string
          price: number
          product_id: string | null
          product_name: string
          store: string | null
        }
        Insert: {
          currency?: string
          id?: string
          observed_at?: string
          price: number
          product_id?: string | null
          product_name: string
          store?: string | null
        }
        Update: {
          currency?: string
          id?: string
          observed_at?: string
          price?: number
          product_id?: string | null
          product_name?: string
          store?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "price_history_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
        ]
      }
      product_categories: {
        Row: {
          child: string
          id: string
          parent: string
        }
        Insert: {
          child: string
          id?: string
          parent: string
        }
        Update: {
          child?: string
          id?: string
          parent?: string
        }
        Relationships: []
      }
      products: {
        Row: {
          attributes: Json
          brand: string | null
          category: string | null
          created_at: string
          currency: string
          id: string
          name: string
          typical_price: number | null
        }
        Insert: {
          attributes?: Json
          brand?: string | null
          category?: string | null
          created_at?: string
          currency?: string
          id?: string
          name: string
          typical_price?: number | null
        }
        Update: {
          attributes?: Json
          brand?: string | null
          category?: string | null
          created_at?: string
          currency?: string
          id?: string
          name?: string
          typical_price?: number | null
        }
        Relationships: []
      }
      profiles: {
        Row: {
          created_at: string
          display_name: string | null
          font_scale: number
          high_contrast: boolean
          id: string
          phone: string | null
          preferred_voice: string | null
          updated_at: string
        }
        Insert: {
          created_at?: string
          display_name?: string | null
          font_scale?: number
          high_contrast?: boolean
          id: string
          phone?: string | null
          preferred_voice?: string | null
          updated_at?: string
        }
        Update: {
          created_at?: string
          display_name?: string | null
          font_scale?: number
          high_contrast?: boolean
          id?: string
          phone?: string | null
          preferred_voice?: string | null
          updated_at?: string
        }
        Relationships: []
      }
      receipts: {
        Row: {
          created_at: string
          currency: string
          id: string
          image_url: string | null
          line_items: Json
          occurred_at: string
          store: string | null
          total: number | null
          user_id: string
        }
        Insert: {
          created_at?: string
          currency?: string
          id?: string
          image_url?: string | null
          line_items?: Json
          occurred_at?: string
          store?: string | null
          total?: number | null
          user_id: string
        }
        Update: {
          created_at?: string
          currency?: string
          id?: string
          image_url?: string | null
          line_items?: Json
          occurred_at?: string
          store?: string | null
          total?: number | null
          user_id?: string
        }
        Relationships: []
      }
      transactions: {
        Row: {
          amount: number
          category: string
          created_at: string
          currency: string
          id: string
          merchant: string
          occurred_at: string
          source: string
          user_id: string
        }
        Insert: {
          amount: number
          category?: string
          created_at?: string
          currency?: string
          id?: string
          merchant: string
          occurred_at?: string
          source?: string
          user_id: string
        }
        Update: {
          amount?: number
          category?: string
          created_at?: string
          currency?: string
          id?: string
          merchant?: string
          occurred_at?: string
          source?: string
          user_id?: string
        }
        Relationships: []
      }
      user_roles: {
        Row: {
          created_at: string
          id: string
          role: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          role: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Update: {
          created_at?: string
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
      is_helper_of: {
        Args: { _helper: string; _primary: string }
        Returns: boolean
      }
    }
    Enums: {
      app_role: "visually_impaired" | "helper" | "admin"
      request_kind:
        | "product_check"
        | "price_check"
        | "receipt_check"
        | "general"
      request_status: "pending" | "answered" | "dismissed"
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
      app_role: ["visually_impaired", "helper", "admin"],
      request_kind: [
        "product_check",
        "price_check",
        "receipt_check",
        "general",
      ],
      request_status: ["pending", "answered", "dismissed"],
    },
  },
} as const
