-- ============================================================
-- VYRALIST — Messaging RLS Migration
-- Run this in: Supabase Dashboard → SQL Editor → New Query
--
-- This fixes two bugs:
--   1. Admin cannot insert messages into conversations (silent fail)
--   2. Creator cannot read messages from their own conversations
-- ============================================================

-- ── CONVERSATIONS TABLE ──────────────────────────────────────

-- Creators can read their own conversations (may already exist)
DO $$ BEGIN
  CREATE POLICY "creator_select_conversations"
  ON conversations FOR SELECT
  USING (creator_id = auth.uid());
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- Any authenticated user can INSERT a conversation row
-- (Admin creates "Vyralist" threads; brands create their own threads)
DO $$ BEGIN
  CREATE POLICY "authenticated_insert_conversations"
  ON conversations FOR INSERT
  WITH CHECK (auth.role() = 'authenticated');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- Any authenticated user can UPDATE a conversation row
-- (Admin marks unread=true; creator marks unread=false)
DO $$ BEGIN
  CREATE POLICY "authenticated_update_conversations"
  ON conversations FOR UPDATE
  USING (auth.role() = 'authenticated');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;


-- ── MESSAGES TABLE ────────────────────────────────────────────

-- Make sure RLS is enabled
ALTER TABLE messages ENABLE ROW LEVEL SECURITY;

-- Creators can SELECT messages from their own conversations
DO $$ BEGIN
  CREATE POLICY "creator_read_messages"
  ON messages FOR SELECT
  USING (
    conversation_id IN (
      SELECT id FROM conversations WHERE creator_id = auth.uid()
    )
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- Any authenticated user can INSERT messages
-- (Admin inserts sender='brand'; creator inserts sender='creator')
DO $$ BEGIN
  CREATE POLICY "authenticated_insert_messages"
  ON messages FOR INSERT
  WITH CHECK (auth.role() = 'authenticated');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- Any authenticated user can UPDATE messages
-- (Brand marks read_by_brand=true; creator marks read_by_creator=true)
DO $$ BEGIN
  CREATE POLICY "authenticated_update_messages"
  ON messages FOR UPDATE
  USING (auth.role() = 'authenticated');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;


-- ── VERIFY ────────────────────────────────────────────────────
-- After running, confirm with:
--   SELECT policyname, cmd FROM pg_policies WHERE tablename IN ('conversations','messages');
