SET session_replication_role = replica;
BEGIN;
-- fifo_deductions (part 4/4)
INSERT INTO public.fifo_deductions (id, outflow_id, inflow_id, quantity_deducted, created_at) VALUES ('ae2b50b9-6d8e-44d8-bc0e-fd51c250cd64', '8b604272-036e-4e7b-bb16-15ea64553804', 'b9ed7a8f-33e9-4a13-bba4-167ee7d3d853', 350, '2026-01-22 15:38:50.421172+00') ON CONFLICT (id) DO NOTHING;
INSERT INTO public.fifo_deductions (id, outflow_id, inflow_id, quantity_deducted, created_at) VALUES ('8369d18d-f342-4b46-bd9e-d1327fbfb907', '8b604272-036e-4e7b-bb16-15ea64553804', '4d825941-4a1a-4d29-b0d9-fd08a7d0abc8', 397, '2026-01-22 15:38:50.421172+00') ON CONFLICT (id) DO NOTHING;
INSERT INTO public.fifo_deductions (id, outflow_id, inflow_id, quantity_deducted, created_at) VALUES ('52630cf7-e0e1-42a0-b1a5-a2cddbe11a22', '79e1fff9-4bb3-4f1d-a306-b031fdb2fdd1', 'eb4b6a26-543e-4049-be94-1ee86f395871', 85, '2026-01-22 15:38:50.421172+00') ON CONFLICT (id) DO NOTHING;
INSERT INTO public.fifo_deductions (id, outflow_id, inflow_id, quantity_deducted, created_at) VALUES ('d2f1a637-890b-4938-986b-b889bae78b00', 'fa4e888d-47f8-4b9a-a963-16ec26848b37', '77c244da-3461-4bc1-964c-a0fb2a7ade1c', 19, '2026-01-22 15:38:50.421172+00') ON CONFLICT (id) DO NOTHING;
INSERT INTO public.fifo_deductions (id, outflow_id, inflow_id, quantity_deducted, created_at) VALUES ('d93d9aea-932f-4fca-84ea-27101993e4e0', '8a99e45f-f284-4853-843f-23e1d3a74f54', '0bfcb02d-a76f-4b6d-9be8-3d8fb8395069', 33, '2026-01-22 15:38:50.421172+00') ON CONFLICT (id) DO NOTHING;
COMMIT;
SET session_replication_role = DEFAULT;

-- Verify fifo_deductions
SELECT 'fifo_deductions' AS tbl, COUNT(*) FROM public.fifo_deductions;