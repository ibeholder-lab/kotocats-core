BEGIN;

CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE IF NOT EXISTS public.cafe_media_likes (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),

    media_id uuid NOT NULL,
    visitor_hash text NOT NULL,

    ip_hash text,
    user_agent_hash text,

    created_at timestamptz NOT NULL DEFAULT now(),

    CONSTRAINT cafe_media_likes_media_visitor_unique
        UNIQUE (media_id, visitor_hash),

    CONSTRAINT cafe_media_likes_media_foreign
        FOREIGN KEY (media_id)
        REFERENCES public.cafe_media(id)
        ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS cafe_media_likes_media_id_idx
    ON public.cafe_media_likes (media_id);

CREATE INDEX IF NOT EXISTS cafe_media_likes_ip_hash_created_at_idx
    ON public.cafe_media_likes (ip_hash, created_at);

CREATE INDEX IF NOT EXISTS cafe_media_likes_created_at_idx
    ON public.cafe_media_likes (created_at);

COMMIT;
