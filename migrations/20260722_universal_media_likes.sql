BEGIN;
ALTER TABLE public.cafe_media_likes ADD COLUMN IF NOT EXISTS media_type text NOT NULL DEFAULT 'cafe_media';
ALTER TABLE public.cafe_media_likes DROP CONSTRAINT IF EXISTS cafe_media_likes_media_visitor_unique;
ALTER TABLE public.cafe_media_likes DROP CONSTRAINT IF EXISTS cafe_media_likes_media_foreign;
ALTER TABLE public.cafe_media_likes DROP CONSTRAINT IF EXISTS cafe_media_likes_media_type_check;
ALTER TABLE public.cafe_media_likes ADD CONSTRAINT cafe_media_likes_media_type_check CHECK (media_type IN ('cafe_media','animal_media'));
ALTER TABLE public.cafe_media_likes ADD CONSTRAINT cafe_media_likes_media_visitor_unique UNIQUE (media_type, media_id, visitor_hash);
CREATE INDEX IF NOT EXISTS cafe_media_likes_media_type_id_idx ON public.cafe_media_likes (media_type, media_id);
COMMIT;
