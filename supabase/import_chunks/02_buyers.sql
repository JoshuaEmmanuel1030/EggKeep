SET session_replication_role = replica;
BEGIN;
-- buyers
-- buyers
DELETE FROM public.buyers;

INSERT INTO public.buyers (id, name, default_box_mode, created_at, deleted_at) VALUES ('08adcbb0-b114-4293-9f54-48e6fc3ccd3a', 'Astro', 'box kecil', '2026-01-12 19:19:50.503615+00', NULL) ON CONFLICT (id) DO NOTHING;
INSERT INTO public.buyers (id, name, default_box_mode, created_at, deleted_at) VALUES ('199d231a-a522-4d41-85e6-ca84c8395466', 'Family Mart', 'box kecil', '2026-01-12 19:19:50.503615+00', NULL) ON CONFLICT (id) DO NOTHING;
INSERT INTO public.buyers (id, name, default_box_mode, created_at, deleted_at) VALUES ('1905c53b-35e7-463b-9bde-f39e69f73a96', 'K3Mart', 'box kecil', '2026-01-12 19:19:50.503615+00', NULL) ON CONFLICT (id) DO NOTHING;
INSERT INTO public.buyers (id, name, default_box_mode, created_at, deleted_at) VALUES ('357c9ed8-92ba-46d5-9890-464976df5f89', 'Osave', 'box osave', '2026-01-12 19:19:50.503615+00', NULL) ON CONFLICT (id) DO NOTHING;
INSERT INTO public.buyers (id, name, default_box_mode, created_at, deleted_at) VALUES ('bb7915ff-b8cc-4147-adfb-65804caf0878', 'Segari', 'keranjang', '2026-01-12 19:19:50.503615+00', NULL) ON CONFLICT (id) DO NOTHING;
INSERT INTO public.buyers (id, name, default_box_mode, created_at, deleted_at) VALUES ('43e568ad-f1f3-48b9-9fbb-fe41902f63b8', 'CircleK', 'keranjang', '2026-01-12 19:19:50.503615+00', NULL) ON CONFLICT (id) DO NOTHING;
INSERT INTO public.buyers (id, name, default_box_mode, created_at, deleted_at) VALUES ('3e567556-dbe8-4996-be52-423c89616f41', 'Sayurbox', 'tray', '2026-01-12 19:19:50.503615+00', NULL) ON CONFLICT (id) DO NOTHING;
COMMIT;
SET session_replication_role = DEFAULT;

-- Verify buyers
SELECT 'buyers' AS tbl, COUNT(*) FROM public.buyers;