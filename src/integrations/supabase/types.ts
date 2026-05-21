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
      approvals: {
        Row: {
          approval_route: string | null
          approval_type: Database["public"]["Enums"]["approval_type"]
          approver_id: string | null
          comments: string | null
          created_at: string
          decided_at: string | null
          id: string
          requested_by: string | null
          status: Database["public"]["Enums"]["approval_status"]
          target_id: string
          target_label: string | null
          target_type: string
        }
        Insert: {
          approval_route?: string | null
          approval_type: Database["public"]["Enums"]["approval_type"]
          approver_id?: string | null
          comments?: string | null
          created_at?: string
          decided_at?: string | null
          id?: string
          requested_by?: string | null
          status?: Database["public"]["Enums"]["approval_status"]
          target_id: string
          target_label?: string | null
          target_type: string
        }
        Update: {
          approval_route?: string | null
          approval_type?: Database["public"]["Enums"]["approval_type"]
          approver_id?: string | null
          comments?: string | null
          created_at?: string
          decided_at?: string | null
          id?: string
          requested_by?: string | null
          status?: Database["public"]["Enums"]["approval_status"]
          target_id?: string
          target_label?: string | null
          target_type?: string
        }
        Relationships: [
          {
            foreignKeyName: "approvals_approver_id_fkey"
            columns: ["approver_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "approvals_approver_id_fkey"
            columns: ["approver_id"]
            isOneToOne: false
            referencedRelation: "profiles_directory"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "approvals_requested_by_fkey"
            columns: ["requested_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "approvals_requested_by_fkey"
            columns: ["requested_by"]
            isOneToOne: false
            referencedRelation: "profiles_directory"
            referencedColumns: ["id"]
          },
        ]
      }
      attachments: {
        Row: {
          created_at: string
          entity_id: string
          entity_type: string
          file_name: string
          file_size: number | null
          file_url: string
          id: string
          mime_type: string | null
          uploaded_by: string | null
        }
        Insert: {
          created_at?: string
          entity_id: string
          entity_type: string
          file_name: string
          file_size?: number | null
          file_url: string
          id?: string
          mime_type?: string | null
          uploaded_by?: string | null
        }
        Update: {
          created_at?: string
          entity_id?: string
          entity_type?: string
          file_name?: string
          file_size?: number | null
          file_url?: string
          id?: string
          mime_type?: string | null
          uploaded_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "attachments_uploaded_by_fkey"
            columns: ["uploaded_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "attachments_uploaded_by_fkey"
            columns: ["uploaded_by"]
            isOneToOne: false
            referencedRelation: "profiles_directory"
            referencedColumns: ["id"]
          },
        ]
      }
      attendance_logs: {
        Row: {
          check_in_at: string | null
          check_out_at: string | null
          created_at: string
          id: string
          notes: string | null
          source: string | null
          status: Database["public"]["Enums"]["attendance_status"]
          user_id: string
          work_date: string
          worked_hours: number | null
        }
        Insert: {
          check_in_at?: string | null
          check_out_at?: string | null
          created_at?: string
          id?: string
          notes?: string | null
          source?: string | null
          status?: Database["public"]["Enums"]["attendance_status"]
          user_id: string
          work_date: string
          worked_hours?: number | null
        }
        Update: {
          check_in_at?: string | null
          check_out_at?: string | null
          created_at?: string
          id?: string
          notes?: string | null
          source?: string | null
          status?: Database["public"]["Enums"]["attendance_status"]
          user_id?: string
          work_date?: string
          worked_hours?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "attendance_logs_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "attendance_logs_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles_directory"
            referencedColumns: ["id"]
          },
        ]
      }
      companies: {
        Row: {
          code: string | null
          color: string | null
          created_at: string
          domain: string | null
          id: string
          initials: string | null
          is_active: boolean
          logo_url: string | null
          name: string
          short_name: string | null
        }
        Insert: {
          code?: string | null
          color?: string | null
          created_at?: string
          domain?: string | null
          id?: string
          initials?: string | null
          is_active?: boolean
          logo_url?: string | null
          name: string
          short_name?: string | null
        }
        Update: {
          code?: string | null
          color?: string | null
          created_at?: string
          domain?: string | null
          id?: string
          initials?: string | null
          is_active?: boolean
          logo_url?: string | null
          name?: string
          short_name?: string | null
        }
        Relationships: []
      }
      conversation_members: {
        Row: {
          conversation_id: string
          id: string
          joined_at: string
          member_role: string | null
          user_id: string
        }
        Insert: {
          conversation_id: string
          id?: string
          joined_at?: string
          member_role?: string | null
          user_id: string
        }
        Update: {
          conversation_id?: string
          id?: string
          joined_at?: string
          member_role?: string | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "conversation_members_conversation_id_fkey"
            columns: ["conversation_id"]
            isOneToOne: false
            referencedRelation: "conversations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "conversation_members_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "conversation_members_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles_directory"
            referencedColumns: ["id"]
          },
        ]
      }
      conversations: {
        Row: {
          channel_type: Database["public"]["Enums"]["channel_type"]
          company_id: string | null
          created_at: string
          created_by: string | null
          id: string
          last_message_at: string | null
          last_message_preview: string | null
          pinned: boolean
          project_id: string | null
          task_id: string | null
          title: string | null
          visibility: Database["public"]["Enums"]["visibility_scope"]
        }
        Insert: {
          channel_type: Database["public"]["Enums"]["channel_type"]
          company_id?: string | null
          created_at?: string
          created_by?: string | null
          id?: string
          last_message_at?: string | null
          last_message_preview?: string | null
          pinned?: boolean
          project_id?: string | null
          task_id?: string | null
          title?: string | null
          visibility?: Database["public"]["Enums"]["visibility_scope"]
        }
        Update: {
          channel_type?: Database["public"]["Enums"]["channel_type"]
          company_id?: string | null
          created_at?: string
          created_by?: string | null
          id?: string
          last_message_at?: string | null
          last_message_preview?: string | null
          pinned?: boolean
          project_id?: string | null
          task_id?: string | null
          title?: string | null
          visibility?: Database["public"]["Enums"]["visibility_scope"]
        }
        Relationships: [
          {
            foreignKeyName: "conversations_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "conversations_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "conversations_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles_directory"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "conversations_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "conversations_task_id_fkey"
            columns: ["task_id"]
            isOneToOne: false
            referencedRelation: "tasks"
            referencedColumns: ["id"]
          },
        ]
      }
      departments: {
        Row: {
          company_id: string | null
          created_at: string
          id: string
          is_active: boolean
          name: string
        }
        Insert: {
          company_id?: string | null
          created_at?: string
          id?: string
          is_active?: boolean
          name: string
        }
        Update: {
          company_id?: string | null
          created_at?: string
          id?: string
          is_active?: boolean
          name?: string
        }
        Relationships: [
          {
            foreignKeyName: "departments_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
        ]
      }
      email_account_credentials: {
        Row: {
          account_id: string
          imap_password: string
          smtp_password: string
          updated_at: string
        }
        Insert: {
          account_id: string
          imap_password: string
          smtp_password: string
          updated_at?: string
        }
        Update: {
          account_id?: string
          imap_password?: string
          smtp_password?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "email_account_credentials_account_id_fkey"
            columns: ["account_id"]
            isOneToOne: true
            referencedRelation: "email_accounts"
            referencedColumns: ["id"]
          },
        ]
      }
      email_accounts: {
        Row: {
          company_id: string | null
          created_at: string
          created_by: string | null
          default_sender_name: string | null
          display_name: string
          email: string
          id: string
          imap_encryption: Database["public"]["Enums"]["mail_encryption"]
          imap_host: string
          imap_port: number
          imap_username: string
          is_active: boolean
          is_shared: boolean
          last_error: string | null
          last_sync_at: string | null
          owner_user_id: string
          smtp_encryption: Database["public"]["Enums"]["mail_encryption"]
          smtp_host: string
          smtp_port: number
          smtp_username: string
          status: Database["public"]["Enums"]["mail_account_status"]
          sync_enabled: boolean
          sync_interval_min: number
          updated_at: string
          vault_secret_name: string | null
        }
        Insert: {
          company_id?: string | null
          created_at?: string
          created_by?: string | null
          default_sender_name?: string | null
          display_name: string
          email: string
          id?: string
          imap_encryption?: Database["public"]["Enums"]["mail_encryption"]
          imap_host: string
          imap_port: number
          imap_username: string
          is_active?: boolean
          is_shared?: boolean
          last_error?: string | null
          last_sync_at?: string | null
          owner_user_id: string
          smtp_encryption?: Database["public"]["Enums"]["mail_encryption"]
          smtp_host: string
          smtp_port: number
          smtp_username: string
          status?: Database["public"]["Enums"]["mail_account_status"]
          sync_enabled?: boolean
          sync_interval_min?: number
          updated_at?: string
          vault_secret_name?: string | null
        }
        Update: {
          company_id?: string | null
          created_at?: string
          created_by?: string | null
          default_sender_name?: string | null
          display_name?: string
          email?: string
          id?: string
          imap_encryption?: Database["public"]["Enums"]["mail_encryption"]
          imap_host?: string
          imap_port?: number
          imap_username?: string
          is_active?: boolean
          is_shared?: boolean
          last_error?: string | null
          last_sync_at?: string | null
          owner_user_id?: string
          smtp_encryption?: Database["public"]["Enums"]["mail_encryption"]
          smtp_host?: string
          smtp_port?: number
          smtp_username?: string
          status?: Database["public"]["Enums"]["mail_account_status"]
          sync_enabled?: boolean
          sync_interval_min?: number
          updated_at?: string
          vault_secret_name?: string | null
        }
        Relationships: []
      }
      email_attachments: {
        Row: {
          account_id: string
          content_id: string | null
          created_at: string
          filename: string
          id: string
          is_inline: boolean
          message_id: string
          mime_type: string | null
          size: number | null
          storage_path: string | null
        }
        Insert: {
          account_id: string
          content_id?: string | null
          created_at?: string
          filename: string
          id?: string
          is_inline?: boolean
          message_id: string
          mime_type?: string | null
          size?: number | null
          storage_path?: string | null
        }
        Update: {
          account_id?: string
          content_id?: string | null
          created_at?: string
          filename?: string
          id?: string
          is_inline?: boolean
          message_id?: string
          mime_type?: string | null
          size?: number | null
          storage_path?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "email_attachments_account_id_fkey"
            columns: ["account_id"]
            isOneToOne: false
            referencedRelation: "email_accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "email_attachments_message_id_fkey"
            columns: ["message_id"]
            isOneToOne: false
            referencedRelation: "email_messages"
            referencedColumns: ["id"]
          },
        ]
      }
      email_drafts: {
        Row: {
          account_id: string
          attachments: Json
          bcc_addresses: string[]
          body_html: string | null
          body_text: string | null
          cc_addresses: string[]
          created_at: string
          forward_of_message_id: string | null
          id: string
          in_reply_to_message_id: string | null
          subject: string | null
          to_addresses: string[]
          updated_at: string
          user_id: string
        }
        Insert: {
          account_id: string
          attachments?: Json
          bcc_addresses?: string[]
          body_html?: string | null
          body_text?: string | null
          cc_addresses?: string[]
          created_at?: string
          forward_of_message_id?: string | null
          id?: string
          in_reply_to_message_id?: string | null
          subject?: string | null
          to_addresses?: string[]
          updated_at?: string
          user_id: string
        }
        Update: {
          account_id?: string
          attachments?: Json
          bcc_addresses?: string[]
          body_html?: string | null
          body_text?: string | null
          cc_addresses?: string[]
          created_at?: string
          forward_of_message_id?: string | null
          id?: string
          in_reply_to_message_id?: string | null
          subject?: string | null
          to_addresses?: string[]
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "email_drafts_account_id_fkey"
            columns: ["account_id"]
            isOneToOne: false
            referencedRelation: "email_accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "email_drafts_forward_of_message_id_fkey"
            columns: ["forward_of_message_id"]
            isOneToOne: false
            referencedRelation: "email_messages"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "email_drafts_in_reply_to_message_id_fkey"
            columns: ["in_reply_to_message_id"]
            isOneToOne: false
            referencedRelation: "email_messages"
            referencedColumns: ["id"]
          },
        ]
      }
      email_folders: {
        Row: {
          account_id: string
          created_at: string
          delimiter: string | null
          id: string
          last_uid: number | null
          name: string
          path: string
          role: string | null
          total_count: number
          uid_validity: number | null
          unread_count: number
          updated_at: string
        }
        Insert: {
          account_id: string
          created_at?: string
          delimiter?: string | null
          id?: string
          last_uid?: number | null
          name: string
          path: string
          role?: string | null
          total_count?: number
          uid_validity?: number | null
          unread_count?: number
          updated_at?: string
        }
        Update: {
          account_id?: string
          created_at?: string
          delimiter?: string | null
          id?: string
          last_uid?: number | null
          name?: string
          path?: string
          role?: string | null
          total_count?: number
          uid_validity?: number | null
          unread_count?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "email_folders_account_id_fkey"
            columns: ["account_id"]
            isOneToOne: false
            referencedRelation: "email_accounts"
            referencedColumns: ["id"]
          },
        ]
      }
      email_links: {
        Row: {
          account_id: string
          created_at: string
          entity_id: string
          entity_type: Database["public"]["Enums"]["mail_link_entity"]
          id: string
          linked_by: string
          message_id: string
          note: string | null
        }
        Insert: {
          account_id: string
          created_at?: string
          entity_id: string
          entity_type: Database["public"]["Enums"]["mail_link_entity"]
          id?: string
          linked_by: string
          message_id: string
          note?: string | null
        }
        Update: {
          account_id?: string
          created_at?: string
          entity_id?: string
          entity_type?: Database["public"]["Enums"]["mail_link_entity"]
          id?: string
          linked_by?: string
          message_id?: string
          note?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "email_links_account_id_fkey"
            columns: ["account_id"]
            isOneToOne: false
            referencedRelation: "email_accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "email_links_message_id_fkey"
            columns: ["message_id"]
            isOneToOne: false
            referencedRelation: "email_messages"
            referencedColumns: ["id"]
          },
        ]
      }
      email_messages: {
        Row: {
          account_id: string
          bcc_addresses: string[]
          body_html: string | null
          body_text: string | null
          cc_addresses: string[]
          created_at: string
          folder_id: string | null
          from_address: string | null
          from_name: string | null
          has_attachments: boolean
          headers: Json | null
          id: string
          imap_uid: number | null
          in_reply_to: string | null
          is_draft: boolean
          is_read: boolean
          is_starred: boolean
          message_id: string | null
          raw_size: number | null
          received_at: string | null
          references_ids: string[] | null
          sent_at: string | null
          snippet: string | null
          subject: string | null
          thread_id: string | null
          to_addresses: string[]
          updated_at: string
        }
        Insert: {
          account_id: string
          bcc_addresses?: string[]
          body_html?: string | null
          body_text?: string | null
          cc_addresses?: string[]
          created_at?: string
          folder_id?: string | null
          from_address?: string | null
          from_name?: string | null
          has_attachments?: boolean
          headers?: Json | null
          id?: string
          imap_uid?: number | null
          in_reply_to?: string | null
          is_draft?: boolean
          is_read?: boolean
          is_starred?: boolean
          message_id?: string | null
          raw_size?: number | null
          received_at?: string | null
          references_ids?: string[] | null
          sent_at?: string | null
          snippet?: string | null
          subject?: string | null
          thread_id?: string | null
          to_addresses?: string[]
          updated_at?: string
        }
        Update: {
          account_id?: string
          bcc_addresses?: string[]
          body_html?: string | null
          body_text?: string | null
          cc_addresses?: string[]
          created_at?: string
          folder_id?: string | null
          from_address?: string | null
          from_name?: string | null
          has_attachments?: boolean
          headers?: Json | null
          id?: string
          imap_uid?: number | null
          in_reply_to?: string | null
          is_draft?: boolean
          is_read?: boolean
          is_starred?: boolean
          message_id?: string | null
          raw_size?: number | null
          received_at?: string | null
          references_ids?: string[] | null
          sent_at?: string | null
          snippet?: string | null
          subject?: string | null
          thread_id?: string | null
          to_addresses?: string[]
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "email_messages_account_id_fkey"
            columns: ["account_id"]
            isOneToOne: false
            referencedRelation: "email_accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "email_messages_folder_id_fkey"
            columns: ["folder_id"]
            isOneToOne: false
            referencedRelation: "email_folders"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "email_messages_thread_id_fkey"
            columns: ["thread_id"]
            isOneToOne: false
            referencedRelation: "email_threads"
            referencedColumns: ["id"]
          },
        ]
      }
      email_recipients: {
        Row: {
          account_id: string
          address: string
          created_at: string
          id: string
          kind: Database["public"]["Enums"]["mail_recipient_kind"]
          message_id: string
          name: string | null
        }
        Insert: {
          account_id: string
          address: string
          created_at?: string
          id?: string
          kind: Database["public"]["Enums"]["mail_recipient_kind"]
          message_id: string
          name?: string | null
        }
        Update: {
          account_id?: string
          address?: string
          created_at?: string
          id?: string
          kind?: Database["public"]["Enums"]["mail_recipient_kind"]
          message_id?: string
          name?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "email_recipients_account_id_fkey"
            columns: ["account_id"]
            isOneToOne: false
            referencedRelation: "email_accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "email_recipients_message_id_fkey"
            columns: ["message_id"]
            isOneToOne: false
            referencedRelation: "email_messages"
            referencedColumns: ["id"]
          },
        ]
      }
      email_summaries: {
        Row: {
          account_id: string
          action_items: Json | null
          deadlines: Json | null
          generated_at: string
          id: string
          kind: Database["public"]["Enums"]["mail_summary_kind"]
          links: Json | null
          message_id: string | null
          model: string | null
          people_mentioned: Json | null
          reply_recommended: boolean | null
          summary: string
          thread_id: string | null
        }
        Insert: {
          account_id: string
          action_items?: Json | null
          deadlines?: Json | null
          generated_at?: string
          id?: string
          kind: Database["public"]["Enums"]["mail_summary_kind"]
          links?: Json | null
          message_id?: string | null
          model?: string | null
          people_mentioned?: Json | null
          reply_recommended?: boolean | null
          summary: string
          thread_id?: string | null
        }
        Update: {
          account_id?: string
          action_items?: Json | null
          deadlines?: Json | null
          generated_at?: string
          id?: string
          kind?: Database["public"]["Enums"]["mail_summary_kind"]
          links?: Json | null
          message_id?: string | null
          model?: string | null
          people_mentioned?: Json | null
          reply_recommended?: boolean | null
          summary?: string
          thread_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "email_summaries_account_id_fkey"
            columns: ["account_id"]
            isOneToOne: false
            referencedRelation: "email_accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "email_summaries_message_id_fkey"
            columns: ["message_id"]
            isOneToOne: false
            referencedRelation: "email_messages"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "email_summaries_thread_id_fkey"
            columns: ["thread_id"]
            isOneToOne: false
            referencedRelation: "email_threads"
            referencedColumns: ["id"]
          },
        ]
      }
      email_sync_state: {
        Row: {
          account_id: string
          cursor: string | null
          folder_id: string | null
          id: string
          last_error: string | null
          last_synced_at: string | null
          status: Database["public"]["Enums"]["mail_sync_status"]
          updated_at: string
        }
        Insert: {
          account_id: string
          cursor?: string | null
          folder_id?: string | null
          id?: string
          last_error?: string | null
          last_synced_at?: string | null
          status?: Database["public"]["Enums"]["mail_sync_status"]
          updated_at?: string
        }
        Update: {
          account_id?: string
          cursor?: string | null
          folder_id?: string | null
          id?: string
          last_error?: string | null
          last_synced_at?: string | null
          status?: Database["public"]["Enums"]["mail_sync_status"]
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "email_sync_state_account_id_fkey"
            columns: ["account_id"]
            isOneToOne: false
            referencedRelation: "email_accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "email_sync_state_folder_id_fkey"
            columns: ["folder_id"]
            isOneToOne: false
            referencedRelation: "email_folders"
            referencedColumns: ["id"]
          },
        ]
      }
      email_threads: {
        Row: {
          account_id: string
          created_at: string
          folder_id: string | null
          has_attachments: boolean
          id: string
          last_message_at: string | null
          message_count: number
          participants: string[]
          starred: boolean
          subject: string | null
          unread_count: number
          updated_at: string
        }
        Insert: {
          account_id: string
          created_at?: string
          folder_id?: string | null
          has_attachments?: boolean
          id?: string
          last_message_at?: string | null
          message_count?: number
          participants?: string[]
          starred?: boolean
          subject?: string | null
          unread_count?: number
          updated_at?: string
        }
        Update: {
          account_id?: string
          created_at?: string
          folder_id?: string | null
          has_attachments?: boolean
          id?: string
          last_message_at?: string | null
          message_count?: number
          participants?: string[]
          starred?: boolean
          subject?: string | null
          unread_count?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "email_threads_account_id_fkey"
            columns: ["account_id"]
            isOneToOne: false
            referencedRelation: "email_accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "email_threads_folder_id_fkey"
            columns: ["folder_id"]
            isOneToOne: false
            referencedRelation: "email_folders"
            referencedColumns: ["id"]
          },
        ]
      }
      leave_requests: {
        Row: {
          created_at: string
          days: number
          decided_at: string | null
          end_date: string
          hr_approver_id: string | null
          hr_comments: string | null
          id: string
          leave_type: Database["public"]["Enums"]["leave_type"]
          reason: string | null
          start_date: string
          status: Database["public"]["Enums"]["leave_status"]
          user_id: string
        }
        Insert: {
          created_at?: string
          days?: number
          decided_at?: string | null
          end_date: string
          hr_approver_id?: string | null
          hr_comments?: string | null
          id?: string
          leave_type: Database["public"]["Enums"]["leave_type"]
          reason?: string | null
          start_date: string
          status?: Database["public"]["Enums"]["leave_status"]
          user_id: string
        }
        Update: {
          created_at?: string
          days?: number
          decided_at?: string | null
          end_date?: string
          hr_approver_id?: string | null
          hr_comments?: string | null
          id?: string
          leave_type?: Database["public"]["Enums"]["leave_type"]
          reason?: string | null
          start_date?: string
          status?: Database["public"]["Enums"]["leave_status"]
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "leave_requests_hr_approver_id_fkey"
            columns: ["hr_approver_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "leave_requests_hr_approver_id_fkey"
            columns: ["hr_approver_id"]
            isOneToOne: false
            referencedRelation: "profiles_directory"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "leave_requests_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "leave_requests_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles_directory"
            referencedColumns: ["id"]
          },
        ]
      }
      mailbox_permissions: {
        Row: {
          account_id: string
          created_at: string
          granted_by: string | null
          id: string
          permission: Database["public"]["Enums"]["mail_permission"]
          user_id: string
        }
        Insert: {
          account_id: string
          created_at?: string
          granted_by?: string | null
          id?: string
          permission?: Database["public"]["Enums"]["mail_permission"]
          user_id: string
        }
        Update: {
          account_id?: string
          created_at?: string
          granted_by?: string | null
          id?: string
          permission?: Database["public"]["Enums"]["mail_permission"]
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "mailbox_permissions_account_id_fkey"
            columns: ["account_id"]
            isOneToOne: false
            referencedRelation: "email_accounts"
            referencedColumns: ["id"]
          },
        ]
      }
      messages: {
        Row: {
          body: string
          conversation_id: string
          created_at: string
          id: string
          mentions: string[] | null
          parent_message_id: string | null
          sender_id: string
          task_ref_id: string | null
        }
        Insert: {
          body: string
          conversation_id: string
          created_at?: string
          id?: string
          mentions?: string[] | null
          parent_message_id?: string | null
          sender_id: string
          task_ref_id?: string | null
        }
        Update: {
          body?: string
          conversation_id?: string
          created_at?: string
          id?: string
          mentions?: string[] | null
          parent_message_id?: string | null
          sender_id?: string
          task_ref_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "messages_conversation_id_fkey"
            columns: ["conversation_id"]
            isOneToOne: false
            referencedRelation: "conversations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "messages_parent_message_id_fkey"
            columns: ["parent_message_id"]
            isOneToOne: false
            referencedRelation: "messages"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "messages_sender_id_fkey"
            columns: ["sender_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "messages_sender_id_fkey"
            columns: ["sender_id"]
            isOneToOne: false
            referencedRelation: "profiles_directory"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "messages_task_ref_id_fkey"
            columns: ["task_ref_id"]
            isOneToOne: false
            referencedRelation: "tasks"
            referencedColumns: ["id"]
          },
        ]
      }
      notifications: {
        Row: {
          body: string | null
          created_at: string
          entity_id: string | null
          entity_type: string | null
          id: string
          is_read: boolean
          link: string | null
          notification_type: Database["public"]["Enums"]["notification_type"]
          send_email: boolean
          title: string
          user_id: string
        }
        Insert: {
          body?: string | null
          created_at?: string
          entity_id?: string | null
          entity_type?: string | null
          id?: string
          is_read?: boolean
          link?: string | null
          notification_type: Database["public"]["Enums"]["notification_type"]
          send_email?: boolean
          title: string
          user_id: string
        }
        Update: {
          body?: string | null
          created_at?: string
          entity_id?: string | null
          entity_type?: string | null
          id?: string
          is_read?: boolean
          link?: string | null
          notification_type?: Database["public"]["Enums"]["notification_type"]
          send_email?: boolean
          title?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "notifications_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "notifications_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles_directory"
            referencedColumns: ["id"]
          },
        ]
      }
      profiles: {
        Row: {
          avatar_url: string | null
          created_at: string
          department_id: string | null
          designation: string | null
          doj: string | null
          email: string | null
          email_default_account_id: string | null
          full_name: string
          home_company_id: string | null
          id: string
          initials: string | null
          is_active: boolean
          phone: string | null
          productivity_score: number | null
          reporting_manager_id: string | null
          reviewer_id: string | null
          skills: string[] | null
          status: Database["public"]["Enums"]["user_status"]
        }
        Insert: {
          avatar_url?: string | null
          created_at?: string
          department_id?: string | null
          designation?: string | null
          doj?: string | null
          email?: string | null
          email_default_account_id?: string | null
          full_name: string
          home_company_id?: string | null
          id: string
          initials?: string | null
          is_active?: boolean
          phone?: string | null
          productivity_score?: number | null
          reporting_manager_id?: string | null
          reviewer_id?: string | null
          skills?: string[] | null
          status?: Database["public"]["Enums"]["user_status"]
        }
        Update: {
          avatar_url?: string | null
          created_at?: string
          department_id?: string | null
          designation?: string | null
          doj?: string | null
          email?: string | null
          email_default_account_id?: string | null
          full_name?: string
          home_company_id?: string | null
          id?: string
          initials?: string | null
          is_active?: boolean
          phone?: string | null
          productivity_score?: number | null
          reporting_manager_id?: string | null
          reviewer_id?: string | null
          skills?: string[] | null
          status?: Database["public"]["Enums"]["user_status"]
        }
        Relationships: [
          {
            foreignKeyName: "profiles_department_id_fkey"
            columns: ["department_id"]
            isOneToOne: false
            referencedRelation: "departments"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "profiles_home_company_id_fkey"
            columns: ["home_company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "profiles_reporting_manager_id_fkey"
            columns: ["reporting_manager_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "profiles_reporting_manager_id_fkey"
            columns: ["reporting_manager_id"]
            isOneToOne: false
            referencedRelation: "profiles_directory"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "profiles_reviewer_id_fkey"
            columns: ["reviewer_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "profiles_reviewer_id_fkey"
            columns: ["reviewer_id"]
            isOneToOne: false
            referencedRelation: "profiles_directory"
            referencedColumns: ["id"]
          },
        ]
      }
      project_members: {
        Row: {
          added_at: string
          id: string
          member_role: string | null
          project_id: string
          user_id: string
        }
        Insert: {
          added_at?: string
          id?: string
          member_role?: string | null
          project_id: string
          user_id: string
        }
        Update: {
          added_at?: string
          id?: string
          member_role?: string | null
          project_id?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "project_members_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "project_members_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "project_members_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles_directory"
            referencedColumns: ["id"]
          },
        ]
      }
      projects: {
        Row: {
          approved_at: string | null
          approver_id: string | null
          company_id: string
          created_at: string
          created_by: string | null
          department_id: string | null
          description: string | null
          due_date: string | null
          id: string
          is_strategic: boolean
          owner_id: string | null
          progress: number
          risk_level: string | null
          start_date: string | null
          status: string
          tags: string[] | null
          title: string
          updated_at: string
          visibility: Database["public"]["Enums"]["visibility_scope"]
        }
        Insert: {
          approved_at?: string | null
          approver_id?: string | null
          company_id: string
          created_at?: string
          created_by?: string | null
          department_id?: string | null
          description?: string | null
          due_date?: string | null
          id?: string
          is_strategic?: boolean
          owner_id?: string | null
          progress?: number
          risk_level?: string | null
          start_date?: string | null
          status?: string
          tags?: string[] | null
          title: string
          updated_at?: string
          visibility?: Database["public"]["Enums"]["visibility_scope"]
        }
        Update: {
          approved_at?: string | null
          approver_id?: string | null
          company_id?: string
          created_at?: string
          created_by?: string | null
          department_id?: string | null
          description?: string | null
          due_date?: string | null
          id?: string
          is_strategic?: boolean
          owner_id?: string | null
          progress?: number
          risk_level?: string | null
          start_date?: string | null
          status?: string
          tags?: string[] | null
          title?: string
          updated_at?: string
          visibility?: Database["public"]["Enums"]["visibility_scope"]
        }
        Relationships: [
          {
            foreignKeyName: "projects_approver_id_fkey"
            columns: ["approver_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "projects_approver_id_fkey"
            columns: ["approver_id"]
            isOneToOne: false
            referencedRelation: "profiles_directory"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "projects_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "projects_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "projects_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles_directory"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "projects_department_id_fkey"
            columns: ["department_id"]
            isOneToOne: false
            referencedRelation: "departments"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "projects_owner_id_fkey"
            columns: ["owner_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "projects_owner_id_fkey"
            columns: ["owner_id"]
            isOneToOne: false
            referencedRelation: "profiles_directory"
            referencedColumns: ["id"]
          },
        ]
      }
      task_activity: {
        Row: {
          activity_type: string
          actor_user_id: string | null
          created_at: string
          id: string
          message: string | null
          new_value: Json | null
          note: string | null
          old_value: Json | null
          task_id: string
        }
        Insert: {
          activity_type: string
          actor_user_id?: string | null
          created_at?: string
          id?: string
          message?: string | null
          new_value?: Json | null
          note?: string | null
          old_value?: Json | null
          task_id: string
        }
        Update: {
          activity_type?: string
          actor_user_id?: string | null
          created_at?: string
          id?: string
          message?: string | null
          new_value?: Json | null
          note?: string | null
          old_value?: Json | null
          task_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "task_activity_actor_user_id_fkey"
            columns: ["actor_user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "task_activity_actor_user_id_fkey"
            columns: ["actor_user_id"]
            isOneToOne: false
            referencedRelation: "profiles_directory"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "task_activity_task_id_fkey"
            columns: ["task_id"]
            isOneToOne: false
            referencedRelation: "tasks"
            referencedColumns: ["id"]
          },
        ]
      }
      task_dependencies: {
        Row: {
          created_at: string
          dependency: Database["public"]["Enums"]["dependency_type"]
          depends_on_task_id: string
          id: string
          task_id: string
        }
        Insert: {
          created_at?: string
          dependency: Database["public"]["Enums"]["dependency_type"]
          depends_on_task_id: string
          id?: string
          task_id: string
        }
        Update: {
          created_at?: string
          dependency?: Database["public"]["Enums"]["dependency_type"]
          depends_on_task_id?: string
          id?: string
          task_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "task_dependencies_depends_on_task_id_fkey"
            columns: ["depends_on_task_id"]
            isOneToOne: false
            referencedRelation: "tasks"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "task_dependencies_task_id_fkey"
            columns: ["task_id"]
            isOneToOne: false
            referencedRelation: "tasks"
            referencedColumns: ["id"]
          },
        ]
      }
      tasks: {
        Row: {
          approved_by_manager: boolean
          approved_by_reviewer: boolean
          assignee_id: string | null
          client_name: string | null
          company_id: string
          created_at: string
          created_by: string | null
          department_id: string | null
          description: string | null
          due_at: string | null
          email_notify_enabled: boolean
          email_notify_recipients: string[] | null
          escalated_to_user_id: string | null
          id: string
          is_recurring: boolean
          labels: string[] | null
          no_update_days: number | null
          parent_task_id: string | null
          priority: Database["public"]["Enums"]["priority_level"]
          project_id: string | null
          recurrence_rule: string | null
          reporting_manager_id: string | null
          reviewer_id: string | null
          sla_due_at: string | null
          sla_hours: number | null
          start_at: string | null
          status: Database["public"]["Enums"]["task_status"]
          task_key: string | null
          title: string
          updated_at: string
          visibility: Database["public"]["Enums"]["visibility_scope"]
        }
        Insert: {
          approved_by_manager?: boolean
          approved_by_reviewer?: boolean
          assignee_id?: string | null
          client_name?: string | null
          company_id: string
          created_at?: string
          created_by?: string | null
          department_id?: string | null
          description?: string | null
          due_at?: string | null
          email_notify_enabled?: boolean
          email_notify_recipients?: string[] | null
          escalated_to_user_id?: string | null
          id?: string
          is_recurring?: boolean
          labels?: string[] | null
          no_update_days?: number | null
          parent_task_id?: string | null
          priority?: Database["public"]["Enums"]["priority_level"]
          project_id?: string | null
          recurrence_rule?: string | null
          reporting_manager_id?: string | null
          reviewer_id?: string | null
          sla_due_at?: string | null
          sla_hours?: number | null
          start_at?: string | null
          status?: Database["public"]["Enums"]["task_status"]
          task_key?: string | null
          title: string
          updated_at?: string
          visibility?: Database["public"]["Enums"]["visibility_scope"]
        }
        Update: {
          approved_by_manager?: boolean
          approved_by_reviewer?: boolean
          assignee_id?: string | null
          client_name?: string | null
          company_id?: string
          created_at?: string
          created_by?: string | null
          department_id?: string | null
          description?: string | null
          due_at?: string | null
          email_notify_enabled?: boolean
          email_notify_recipients?: string[] | null
          escalated_to_user_id?: string | null
          id?: string
          is_recurring?: boolean
          labels?: string[] | null
          no_update_days?: number | null
          parent_task_id?: string | null
          priority?: Database["public"]["Enums"]["priority_level"]
          project_id?: string | null
          recurrence_rule?: string | null
          reporting_manager_id?: string | null
          reviewer_id?: string | null
          sla_due_at?: string | null
          sla_hours?: number | null
          start_at?: string | null
          status?: Database["public"]["Enums"]["task_status"]
          task_key?: string | null
          title?: string
          updated_at?: string
          visibility?: Database["public"]["Enums"]["visibility_scope"]
        }
        Relationships: [
          {
            foreignKeyName: "tasks_assignee_id_fkey"
            columns: ["assignee_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tasks_assignee_id_fkey"
            columns: ["assignee_id"]
            isOneToOne: false
            referencedRelation: "profiles_directory"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tasks_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tasks_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tasks_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles_directory"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tasks_department_id_fkey"
            columns: ["department_id"]
            isOneToOne: false
            referencedRelation: "departments"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tasks_escalated_to_user_id_fkey"
            columns: ["escalated_to_user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tasks_escalated_to_user_id_fkey"
            columns: ["escalated_to_user_id"]
            isOneToOne: false
            referencedRelation: "profiles_directory"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tasks_parent_task_id_fkey"
            columns: ["parent_task_id"]
            isOneToOne: false
            referencedRelation: "tasks"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tasks_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tasks_reporting_manager_id_fkey"
            columns: ["reporting_manager_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tasks_reporting_manager_id_fkey"
            columns: ["reporting_manager_id"]
            isOneToOne: false
            referencedRelation: "profiles_directory"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tasks_reviewer_id_fkey"
            columns: ["reviewer_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tasks_reviewer_id_fkey"
            columns: ["reviewer_id"]
            isOneToOne: false
            referencedRelation: "profiles_directory"
            referencedColumns: ["id"]
          },
        ]
      }
      user_roles: {
        Row: {
          created_at: string
          id: string
          role: Database["public"]["Enums"]["user_role"]
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          role: Database["public"]["Enums"]["user_role"]
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          role?: Database["public"]["Enums"]["user_role"]
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "user_roles_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "user_roles_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles_directory"
            referencedColumns: ["id"]
          },
        ]
      }
      webhook_events: {
        Row: {
          created_at: string
          error: string | null
          event: string
          id: string
          idempotency_key: string
          payload: Json
          processed_at: string | null
          source: string
          status: string
        }
        Insert: {
          created_at?: string
          error?: string | null
          event: string
          id?: string
          idempotency_key: string
          payload?: Json
          processed_at?: string | null
          source: string
          status?: string
        }
        Update: {
          created_at?: string
          error?: string | null
          event?: string
          id?: string
          idempotency_key?: string
          payload?: Json
          processed_at?: string | null
          source?: string
          status?: string
        }
        Relationships: []
      }
    }
    Views: {
      profiles_directory: {
        Row: {
          avatar_url: string | null
          department_id: string | null
          designation: string | null
          full_name: string | null
          home_company_id: string | null
          id: string | null
          initials: string | null
          is_active: boolean | null
          status: Database["public"]["Enums"]["user_status"] | null
        }
        Insert: {
          avatar_url?: string | null
          department_id?: string | null
          designation?: string | null
          full_name?: string | null
          home_company_id?: string | null
          id?: string | null
          initials?: string | null
          is_active?: boolean | null
          status?: Database["public"]["Enums"]["user_status"] | null
        }
        Update: {
          avatar_url?: string | null
          department_id?: string | null
          designation?: string | null
          full_name?: string | null
          home_company_id?: string | null
          id?: string | null
          initials?: string | null
          is_active?: boolean | null
          status?: Database["public"]["Enums"]["user_status"] | null
        }
        Relationships: [
          {
            foreignKeyName: "profiles_department_id_fkey"
            columns: ["department_id"]
            isOneToOne: false
            referencedRelation: "departments"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "profiles_home_company_id_fkey"
            columns: ["home_company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Functions: {
      can_access_mailbox: {
        Args: { _account_id: string; _user_id: string }
        Returns: boolean
      }
      has_any_role: {
        Args: {
          _roles: Database["public"]["Enums"]["user_role"][]
          _user_id: string
        }
        Returns: boolean
      }
      has_role: {
        Args: {
          _role: Database["public"]["Enums"]["user_role"]
          _user_id: string
        }
        Returns: boolean
      }
    }
    Enums: {
      approval_status: "pending" | "approved" | "rejected" | "returned"
      approval_type:
        | "task_completion"
        | "project_creation"
        | "content"
        | "leave"
      attendance_status:
        | "present"
        | "absent"
        | "half_day"
        | "holiday"
        | "weekly_off"
        | "work_from_home"
        | "leave"
      channel_type:
        | "direct"
        | "company_group"
        | "team_group"
        | "project_group"
        | "announcement"
      dependency_type: "blocked_by" | "starts_after" | "parallel"
      leave_status: "pending" | "approved" | "rejected" | "cancelled"
      leave_type:
        | "casual_leave"
        | "sick_leave"
        | "loss_of_pay"
        | "work_from_home"
        | "comp_off"
        | "optional_holiday"
      mail_account_status:
        | "connected"
        | "failed"
        | "needs_reauth"
        | "syncing"
        | "paused"
        | "pending"
      mail_encryption: "ssl" | "tls" | "starttls" | "none"
      mail_link_entity: "task" | "project" | "company" | "person"
      mail_permission: "read" | "send" | "admin"
      mail_recipient_kind: "from" | "to" | "cc" | "bcc" | "reply_to"
      mail_summary_kind: "message" | "thread"
      mail_sync_status: "idle" | "syncing" | "error" | "paused"
      notification_type:
        | "due_today"
        | "overdue"
        | "no_update_1_day"
        | "no_update_3_days"
        | "pending_approval"
        | "recurring_upcoming"
        | "mention"
        | "announcement"
        | "general"
      priority_level: "low" | "medium" | "high" | "critical"
      task_status:
        | "draft"
        | "created"
        | "assigned"
        | "accepted"
        | "in_progress"
        | "waiting_for_review"
        | "waiting_for_manager_approval"
        | "done"
        | "blocked"
        | "on_hold"
        | "rework_required"
        | "escalated"
        | "cancelled"
      user_role:
        | "super_admin"
        | "founder"
        | "founder_office_coordinator"
        | "founder_office_support"
        | "manager"
        | "employee"
        | "intern"
        | "hr_admin"
      user_status:
        | "active"
        | "intern"
        | "on_notice"
        | "on_leave"
        | "exited"
        | "inactive"
      visibility_scope:
        | "team"
        | "company"
        | "department"
        | "manager_only"
        | "founder_office_only"
        | "founder_private"
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
      approval_status: ["pending", "approved", "rejected", "returned"],
      approval_type: [
        "task_completion",
        "project_creation",
        "content",
        "leave",
      ],
      attendance_status: [
        "present",
        "absent",
        "half_day",
        "holiday",
        "weekly_off",
        "work_from_home",
        "leave",
      ],
      channel_type: [
        "direct",
        "company_group",
        "team_group",
        "project_group",
        "announcement",
      ],
      dependency_type: ["blocked_by", "starts_after", "parallel"],
      leave_status: ["pending", "approved", "rejected", "cancelled"],
      leave_type: [
        "casual_leave",
        "sick_leave",
        "loss_of_pay",
        "work_from_home",
        "comp_off",
        "optional_holiday",
      ],
      mail_account_status: [
        "connected",
        "failed",
        "needs_reauth",
        "syncing",
        "paused",
        "pending",
      ],
      mail_encryption: ["ssl", "tls", "starttls", "none"],
      mail_link_entity: ["task", "project", "company", "person"],
      mail_permission: ["read", "send", "admin"],
      mail_recipient_kind: ["from", "to", "cc", "bcc", "reply_to"],
      mail_summary_kind: ["message", "thread"],
      mail_sync_status: ["idle", "syncing", "error", "paused"],
      notification_type: [
        "due_today",
        "overdue",
        "no_update_1_day",
        "no_update_3_days",
        "pending_approval",
        "recurring_upcoming",
        "mention",
        "announcement",
        "general",
      ],
      priority_level: ["low", "medium", "high", "critical"],
      task_status: [
        "draft",
        "created",
        "assigned",
        "accepted",
        "in_progress",
        "waiting_for_review",
        "waiting_for_manager_approval",
        "done",
        "blocked",
        "on_hold",
        "rework_required",
        "escalated",
        "cancelled",
      ],
      user_role: [
        "super_admin",
        "founder",
        "founder_office_coordinator",
        "founder_office_support",
        "manager",
        "employee",
        "intern",
        "hr_admin",
      ],
      user_status: [
        "active",
        "intern",
        "on_notice",
        "on_leave",
        "exited",
        "inactive",
      ],
      visibility_scope: [
        "team",
        "company",
        "department",
        "manager_only",
        "founder_office_only",
        "founder_private",
      ],
    },
  },
} as const
