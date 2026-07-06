INSERT INTO v1_tile(id, kind, owner_id, revision, title, created_at, updated_at)
VALUES ('22222222-2222-2222-2222-222222222222', 1, '11111111-1111-1111-1111-111111111111', 1, 'tile A', NOW(), NOW()),
       ('33333333-3333-3333-3333-333333333333', 1, '11111111-1111-1111-1111-111111111111', 1, 'tile B', NOW(), NOW()),
       ('66666666-6666-6666-6666-666666666666', 1, '11111111-1111-1111-1111-111111111111', 1, 'tile study', NOW(), NOW())
ON CONFLICT (id) DO NOTHING;
INSERT INTO v1_plan(id, tile_id, owner_id, role, revision, created_at, updated_at)
VALUES ('44444444-4444-4444-4444-444444444444', '22222222-2222-2222-2222-222222222222', '11111111-1111-1111-1111-111111111111', 0, 1, NOW(), NOW()),
       ('55555555-5555-5555-5555-555555555555', '33333333-3333-3333-3333-333333333333', '11111111-1111-1111-1111-111111111111', 0, 1, NOW(), NOW()),
       ('77777777-7777-7777-7777-777777777777', '66666666-6666-6666-6666-666666666666', '11111111-1111-1111-1111-111111111111', 0, 1, NOW(), NOW())
ON CONFLICT (id) DO NOTHING;
INSERT INTO v1_placement(id, tile_id, plan_id, owner_id, source_kind, revision, created_at, updated_at)
VALUES ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', '22222222-2222-2222-2222-222222222222', '44444444-4444-4444-4444-444444444444', '11111111-1111-1111-1111-111111111111', 0, 1, NOW(), NOW()),
       ('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', '33333333-3333-3333-3333-333333333333', '55555555-5555-5555-5555-555555555555', '11111111-1111-1111-1111-111111111111', 0, 1, NOW(), NOW())
ON CONFLICT (id) DO NOTHING;
INSERT INTO v1_placement_baseline(placement_id, span_start, span_end, inside_scope_kind)
VALUES ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', '2026-07-07T09:00:00Z', '2026-07-07T10:00:00Z', 0),
       ('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', '2026-07-07T10:30:00Z', '2026-07-07T11:30:00Z', 0)
ON CONFLICT (placement_id) DO NOTHING;
INSERT INTO v1_placement_life(placement_id, detach, close, closed_at)
VALUES ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', false, false, NULL),
       ('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', false, false, NULL)
ON CONFLICT (placement_id) DO NOTHING;
INSERT INTO v1_flow(id, owner_id, created_at) VALUES ('88888888-8888-8888-8888-888888888888', '11111111-1111-1111-1111-111111111111', NOW()) ON CONFLICT (id) DO NOTHING;
INSERT INTO v1_flow_candidate(id, flow_id, when_condition_id, rank, position_no)
VALUES ('99999999-9999-9999-9999-999999999999', '88888888-8888-8888-8888-888888888888', NULL, 10, 0) ON CONFLICT (id) DO NOTHING;
INSERT INTO v1_flow_candidate_output(id, candidate_id, kind, proposal_id, change_id, position_no)
VALUES ('10101010-1010-1010-1010-101010101010', '99999999-9999-9999-9999-999999999999', 0, 'cccccccc-cccc-cccc-cccc-cccccccccccc', NULL, 0) ON CONFLICT (id) DO NOTHING;
INSERT INTO v1_flow_candidate_output_proposal(output_id, tile_id, plan_id, baseline_span_start, baseline_span_end, baseline_inside_kind, baseline_inside_placement_id, baseline_inside_window_ref_id)
VALUES ('10101010-1010-1010-1010-101010101010', '66666666-6666-6666-6666-666666666666', '77777777-7777-7777-7777-777777777777', '2026-07-07T10:00:00Z', '2026-07-07T10:30:00Z', 0, NULL, NULL)
ON CONFLICT (output_id) DO NOTHING;
