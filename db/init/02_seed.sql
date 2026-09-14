-- =============================================================================
-- Society Events — Seed Data  (v2: full building structure + unit assignments)
-- Society: Prestige Verdant Heights, Whitefield, Bengaluru
-- All UUIDs are fixed so FK references stay predictable.
-- Keycloak sub UUIDs match test users in keycloak/realm.json  (password: Test@1234)
-- =============================================================================

-- ---------------------------------------------------------------------------
-- CLEAR ALL DATA  (schema preserved; sequences reset)
-- ---------------------------------------------------------------------------
TRUNCATE TABLE
    registration_svc.registration_item, event_svc.ticket_type,
    payment_svc.distribution_entry, payment_svc.vendor_revenue_distribution,
    payment_svc.event_vendor, payment_svc.vendor,
    registration_svc.complimentary_ticket, payment_svc.event_expense,
    payment_svc.sponsorship_refund, payment_svc.event_sponsorship, payment_svc.sponsor,
    notification, event_svc.announcement, registration_svc.refund, registration_svc.payment,
    registration_svc.registration, event_svc.event, event_svc.event_category,
    user_svc.admin_actions, oauth_session, user_svc.user_apartments,
    user_svc.users, user_svc.apartment, society,
    user_svc.structure_nodes, user_svc.building_hierarchy_config,
    exchange_rate, currency
RESTART IDENTITY CASCADE;

-- ---------------------------------------------------------------------------
-- CURRENCY
-- ---------------------------------------------------------------------------
INSERT INTO currency (code, name, symbol, is_active, is_base) VALUES
    ('INR', 'Indian Rupee',     '₹',   TRUE, TRUE),
    ('USD', 'US Dollar',        '$',   TRUE, FALSE),
    ('GBP', 'British Pound',    '£',   TRUE, FALSE),
    ('EUR', 'Euro',             '€',   TRUE, FALSE),
    ('SGD', 'Singapore Dollar', 'S$',  TRUE, FALSE),
    ('AED', 'UAE Dirham',       'د.إ', TRUE, FALSE);

-- ---------------------------------------------------------------------------
-- EXCHANGE RATE
-- ---------------------------------------------------------------------------
INSERT INTO exchange_rate (id, from_currency, to_currency, rate, source, valid_from) VALUES
    ('71100000-0000-0000-0000-000000000001', 'USD', 'INR', 83.50000000, 'manual', NOW()),
    ('71100000-0000-0000-0000-000000000002', 'GBP', 'INR', 106.2000000, 'manual', NOW()),
    ('71100000-0000-0000-0000-000000000003', 'EUR', 'INR', 91.30000000, 'manual', NOW()),
    ('71100000-0000-0000-0000-000000000004', 'SGD', 'INR', 62.50000000, 'manual', NOW()),
    ('71100000-0000-0000-0000-000000000005', 'AED', 'INR', 22.73000000, 'manual', NOW()),
    ('71100000-0000-0000-0000-000000000006', 'INR', 'USD', 0.01197000,  'manual', NOW()),
    ('71100000-0000-0000-0000-000000000007', 'INR', 'GBP', 0.00941000,  'manual', NOW());

-- ---------------------------------------------------------------------------
-- SOCIETY
-- ---------------------------------------------------------------------------
INSERT INTO society (id, name, address, city, contact_email, base_currency) VALUES
    ('11100000-0000-0000-0000-000000000001',
     'Prestige Verdant Heights',
     '14/1, Varthur Road, Whitefield',
     'Bengaluru',
     'admin@pvh-blr.in',
     'INR');

-- ---------------------------------------------------------------------------
-- BUILDING HIERARCHY CONFIG  (Tower → Wing → Floor → Flat)
-- Flat is the leaf / billable unit.
-- ---------------------------------------------------------------------------
INSERT INTO user_svc.building_hierarchy_config (level_index, level_name, is_billable) VALUES
    (1, 'Tower', FALSE),
    (2, 'Wing',  FALSE),
    (3, 'Floor', FALSE),
    (4, 'Flat',  TRUE);

-- ---------------------------------------------------------------------------
-- STRUCTURE NODES  (2 Towers · 2 Wings each · 2 Floors each · 2 Flats each)
-- UUID prefix guide:
--   a0…  = Towers   (level 1)
--   b0…  = Wings    (level 2)
--   c0…  = Floors   (level 3)
--   d0…  = Flats    (level 4, leaf)
-- ---------------------------------------------------------------------------

-- Towers
INSERT INTO user_svc.structure_nodes (id, name, level_index, parent_id) VALUES
    ('a0000000-0000-0000-0000-000000000001', 'Tower A', 1, NULL),
    ('a0000000-0000-0000-0000-000000000002', 'Tower B', 1, NULL);

-- Wings
INSERT INTO user_svc.structure_nodes (id, name, level_index, parent_id) VALUES
    ('b0000000-0000-0000-0000-000000000001', 'Wing 1', 2, 'a0000000-0000-0000-0000-000000000001'), -- A › W1
    ('b0000000-0000-0000-0000-000000000002', 'Wing 2', 2, 'a0000000-0000-0000-0000-000000000001'), -- A › W2
    ('b0000000-0000-0000-0000-000000000003', 'Wing 1', 2, 'a0000000-0000-0000-0000-000000000002'), -- B › W1
    ('b0000000-0000-0000-0000-000000000004', 'Wing 2', 2, 'a0000000-0000-0000-0000-000000000002'); -- B › W2

-- Floors
INSERT INTO user_svc.structure_nodes (id, name, level_index, parent_id) VALUES
    ('c0000000-0000-0000-0000-000000000001', 'Floor 1', 3, 'b0000000-0000-0000-0000-000000000001'), -- A-W1-F1
    ('c0000000-0000-0000-0000-000000000002', 'Floor 2', 3, 'b0000000-0000-0000-0000-000000000001'), -- A-W1-F2
    ('c0000000-0000-0000-0000-000000000003', 'Floor 1', 3, 'b0000000-0000-0000-0000-000000000002'), -- A-W2-F1
    ('c0000000-0000-0000-0000-000000000004', 'Floor 2', 3, 'b0000000-0000-0000-0000-000000000002'), -- A-W2-F2
    ('c0000000-0000-0000-0000-000000000005', 'Floor 1', 3, 'b0000000-0000-0000-0000-000000000003'), -- B-W1-F1
    ('c0000000-0000-0000-0000-000000000006', 'Floor 2', 3, 'b0000000-0000-0000-0000-000000000003'), -- B-W1-F2
    ('c0000000-0000-0000-0000-000000000007', 'Floor 1', 3, 'b0000000-0000-0000-0000-000000000004'), -- B-W2-F1
    ('c0000000-0000-0000-0000-000000000008', 'Floor 2', 3, 'b0000000-0000-0000-0000-000000000004'); -- B-W2-F2

-- Flats  (Tower A › Wing 1)
INSERT INTO user_svc.structure_nodes (id, name, level_index, parent_id) VALUES
    ('d0000000-0000-0000-0000-000000000001', 'Flat 101', 4, 'c0000000-0000-0000-0000-000000000001'), -- A-W1-F1-101
    ('d0000000-0000-0000-0000-000000000002', 'Flat 102', 4, 'c0000000-0000-0000-0000-000000000001'), -- A-W1-F1-102
    ('d0000000-0000-0000-0000-000000000003', 'Flat 201', 4, 'c0000000-0000-0000-0000-000000000002'), -- A-W1-F2-201
    ('d0000000-0000-0000-0000-000000000004', 'Flat 202', 4, 'c0000000-0000-0000-0000-000000000002'); -- A-W1-F2-202

-- Flats  (Tower A › Wing 2)
INSERT INTO user_svc.structure_nodes (id, name, level_index, parent_id) VALUES
    ('d0000000-0000-0000-0000-000000000005', 'Flat 101', 4, 'c0000000-0000-0000-0000-000000000003'), -- A-W2-F1-101
    ('d0000000-0000-0000-0000-000000000006', 'Flat 102', 4, 'c0000000-0000-0000-0000-000000000003'), -- A-W2-F1-102
    ('d0000000-0000-0000-0000-000000000007', 'Flat 201', 4, 'c0000000-0000-0000-0000-000000000004'), -- A-W2-F2-201
    ('d0000000-0000-0000-0000-000000000008', 'Flat 202', 4, 'c0000000-0000-0000-0000-000000000004'); -- A-W2-F2-202

-- Flats  (Tower B › Wing 1)
INSERT INTO user_svc.structure_nodes (id, name, level_index, parent_id) VALUES
    ('d0000000-0000-0000-0000-000000000009', 'Flat 101', 4, 'c0000000-0000-0000-0000-000000000005'), -- B-W1-F1-101
    ('d0000000-0000-0000-0000-000000000010', 'Flat 102', 4, 'c0000000-0000-0000-0000-000000000005'), -- B-W1-F1-102
    ('d0000000-0000-0000-0000-000000000011', 'Flat 201', 4, 'c0000000-0000-0000-0000-000000000006'), -- B-W1-F2-201
    ('d0000000-0000-0000-0000-000000000012', 'Flat 202', 4, 'c0000000-0000-0000-0000-000000000006'); -- B-W1-F2-202

-- Flats  (Tower B › Wing 2)
INSERT INTO user_svc.structure_nodes (id, name, level_index, parent_id) VALUES
    ('d0000000-0000-0000-0000-000000000013', 'Flat 101', 4, 'c0000000-0000-0000-0000-000000000007'), -- B-W2-F1-101
    ('d0000000-0000-0000-0000-000000000014', 'Flat 102', 4, 'c0000000-0000-0000-0000-000000000007'), -- B-W2-F1-102
    ('d0000000-0000-0000-0000-000000000015', 'Flat 201', 4, 'c0000000-0000-0000-0000-000000000008'), -- B-W2-F2-201
    ('d0000000-0000-0000-0000-000000000016', 'Flat 202', 4, 'c0000000-0000-0000-0000-000000000008'); -- B-W2-F2-202

-- ---------------------------------------------------------------------------
-- APARTMENT  (legacy table, aligned with structure_nodes flat layout)
-- block = "Tower X - Wing Y", unit_number = "FZ-NNN"
-- ---------------------------------------------------------------------------
INSERT INTO user_svc.apartment (id, society_id, block, unit_number, type) VALUES
    ('21100000-0000-0000-0000-000000000001', '11100000-0000-0000-0000-000000000001', 'A-W1', 'F1-101', '2BHK'),
    ('21100000-0000-0000-0000-000000000002', '11100000-0000-0000-0000-000000000001', 'A-W1', 'F1-102', '3BHK'),
    ('21100000-0000-0000-0000-000000000003', '11100000-0000-0000-0000-000000000001', 'A-W1', 'F2-201', '2BHK'),
    ('21100000-0000-0000-0000-000000000004', '11100000-0000-0000-0000-000000000001', 'A-W2', 'F1-101', '3BHK'),
    ('21100000-0000-0000-0000-000000000005', '11100000-0000-0000-0000-000000000001', 'A-W2', 'F2-201', '2BHK'),
    ('21100000-0000-0000-0000-000000000006', '11100000-0000-0000-0000-000000000001', 'B-W1', 'F1-101', '3BHK'),
    ('21100000-0000-0000-0000-000000000007', '11100000-0000-0000-0000-000000000001', 'B-W1', 'F2-201', '2BHK'),
    ('21100000-0000-0000-0000-000000000008', '11100000-0000-0000-0000-000000000001', 'B-W2', 'F1-101', '1BHK');

-- ---------------------------------------------------------------------------
-- USERS
-- Flat assignments (structure_node_id):
--   Rajesh (admin)           → A-W1-F2-Flat 201   (d…003)   active
--   Meera  (committee)       → A-W1-F1-Flat 101   (d…001)   active  [also owns F2-202 via user_apartments]
--   Arjun  (resident)        → A-W1-F1-Flat 102   (d…002)   active
--   Priya  (resident)        → A-W1-F1-Flat 102   (d…002)   active  [couple — same flat as Arjun]
--   Sanjay (resident)        → A-W2-F1-Flat 101   (d…005)   active
--   Vikram (resident, NRI)   → B-W1-F1-Flat 101   (d…009)   active
--   Deepa  (resident)        → A-W2-F2-Flat 201   (d…007)   active
--   Suresh (resident)        → A-W2-F2-Flat 201   (d…007)   active  [couple — same flat as Deepa]
--   Ananya (resident)        → B-W1-F2-Flat 201   (d…011)   active
--   Kiran  (resident)        → B-W2-F1-Flat 101   (d…013)   active
--   Kavya  (sponsor)         → NULL                          active
--   Ramu   (security_guard)  → NULL                          active
--   Lakshmi (resident)       → NULL (pending approval)       is_active=FALSE
--   Ravi   (resident)        → NULL (pending approval)       is_active=FALSE
-- ---------------------------------------------------------------------------
INSERT INTO user_svc.users (id, name, email, phone, role, keycloak_sub, identity_provider, is_active, structure_node_id) VALUES

    -- ── Active: admin ──────────────────────────────────────────────────────
    ('31100000-0000-0000-0000-000000000001',
     'Rajesh Iyer', 'rajesh.iyer@pvh-blr.in', '+91-98450-11111',
     'admin', 'a1000000-0000-0000-0000-000000000001', 'keycloak',
     TRUE, 'd0000000-0000-0000-0000-000000000003'),  -- A-W1-F2-201

    -- ── Active: committee ─────────────────────────────────────────────────
    ('31100000-0000-0000-0000-000000000002',
     'Meera Krishnan', 'meera.krishnan@gmail.com', '+91-99001-22222',
     'committee_member', 'a1000000-0000-0000-0000-000000000002', 'keycloak',
     TRUE, 'd0000000-0000-0000-0000-000000000001'),  -- A-W1-F1-101 (primary; also owns 202 via user_apartments)

    -- ── Active: residents ─────────────────────────────────────────────────
    ('31100000-0000-0000-0000-000000000003',
     'Arjun Sharma', 'arjun.sharma@gmail.com', '+91-98765-33333',
     'resident', 'a1000000-0000-0000-0000-000000000003', 'keycloak',
     TRUE, 'd0000000-0000-0000-0000-000000000002'),  -- A-W1-F1-102

    ('31100000-0000-0000-0000-000000000004',
     'Priya Sharma', 'priya.nair@gmail.com', '+91-97789-44444',
     'resident', 'a1000000-0000-0000-0000-000000000004', 'keycloak',
     TRUE, 'd0000000-0000-0000-0000-000000000002'),  -- A-W1-F1-102 (Arjun's wife, same flat)

    ('31100000-0000-0000-0000-000000000005',
     'Sanjay Mehta', 'sanjay.mehta@outlook.com', '+91-90001-55555',
     'resident', 'a1000000-0000-0000-0000-000000000005', 'keycloak',
     TRUE, 'd0000000-0000-0000-0000-000000000005'),  -- A-W2-F1-101

    ('31100000-0000-0000-0000-000000000006',
     'Vikram Patel', 'vikram.patel@gmail.com', '+1-415-999-6666',
     'resident', 'a1000000-0000-0000-0000-000000000006', 'keycloak',
     TRUE, 'd0000000-0000-0000-0000-000000000009'),  -- B-W1-F1-101 (NRI owner)

    ('31100000-0000-0000-0000-000000000008',
     'Balavigneshkumar Pethuchetty', 'balavigneskumar@gmail.com', NULL,
     'admin', 'a1000000-0000-0000-0000-000000000008', 'keycloak',
     TRUE, 'd0000000-0000-0000-0000-000000000007'),  -- A-W2-F2-201

    ('31100000-0000-0000-0000-000000000009',
     'Suresh Menon', 'suresh.menon@gmail.com', '+91-98123-77777',
     'resident', 'a1000000-0000-0000-0000-000000000009', 'keycloak',
     TRUE, 'd0000000-0000-0000-0000-000000000007'),  -- A-W2-F2-201 (Deepa's husband, same flat)

    ('31100000-0000-0000-0000-000000000010',
     'Ananya Krishnaswamy', 'ananya.k@gmail.com', '+91-97654-88888',
     'resident', 'a1000000-0000-0000-0000-000000000010', 'keycloak',
     TRUE, 'd0000000-0000-0000-0000-000000000011'),  -- B-W1-F2-201

    ('31100000-0000-0000-0000-000000000011',
     'Kiran Rao', 'kiran.rao@gmail.com', '+91-96543-99999',
     'resident', 'a1000000-0000-0000-0000-000000000011', 'keycloak',
     TRUE, 'd0000000-0000-0000-0000-000000000013'),  -- B-W2-F1-101

    -- ── Active: sponsor — no flat ──────────────────────────────────────────
    ('31100000-0000-0000-0000-000000000007',
     'Kavya Reddy', 'kavya.reddy@techcorp.com', '+91-98800-77777',
     'sponsor', 'a1000000-0000-0000-0000-000000000007', 'keycloak',
     TRUE, NULL),   -- external sponsor, no unit

    -- ── Active: security guard — no flat ──────────────────────────────────
    ('31100000-0000-0000-0000-000000000012',
     'Ramu Kumar', 'ramu.guard@pvh-blr.in', '+91-95432-10101',
     'security_guard', 'a1000000-0000-0000-0000-000000000012', 'keycloak',
     TRUE, NULL),   -- security staff, no resident unit

    -- ── Pending approval: is_active=FALSE, no flat yet ────────────────────
    ('31100000-0000-0000-0000-000000000013',
     'Lakshmi Iyer', 'lakshmi.iyer@gmail.com', '+91-94321-20202',
     'resident', 'a1000000-0000-0000-0000-000000000013', 'keycloak',
     FALSE, NULL),  -- pending approval — flat to be assigned after approval

    ('31100000-0000-0000-0000-000000000014',
     'Ravi Shankar', 'ravi.shankar@gmail.com', '+91-93210-30303',
     'resident', 'a1000000-0000-0000-0000-000000000014', 'keycloak',
     FALSE, NULL);  -- pending approval — flat to be assigned after approval

-- ---------------------------------------------------------------------------
-- USER_APARTMENTS  (legacy many-to-many; also shows Meera's dual ownership)
-- ---------------------------------------------------------------------------
INSERT INTO user_svc.user_apartments (user_id, apartment_id) VALUES
    ('31100000-0000-0000-0000-000000000001', '21100000-0000-0000-0000-000000000003'), -- Rajesh  → A-W1-F2-201
    ('31100000-0000-0000-0000-000000000002', '21100000-0000-0000-0000-000000000001'), -- Meera   → A-W1-F1-101 (parents')
    ('31100000-0000-0000-0000-000000000002', '21100000-0000-0000-0000-000000000003'), -- Meera   → A-W1-F2-201 (own, co-owned)
    ('31100000-0000-0000-0000-000000000003', '21100000-0000-0000-0000-000000000002'), -- Arjun   → A-W1-F1-102
    ('31100000-0000-0000-0000-000000000004', '21100000-0000-0000-0000-000000000002'), -- Priya   → A-W1-F1-102 (same)
    ('31100000-0000-0000-0000-000000000005', '21100000-0000-0000-0000-000000000004'), -- Sanjay  → A-W2-F1-101
    ('31100000-0000-0000-0000-000000000006', '21100000-0000-0000-0000-000000000006'), -- Vikram  → B-W1-F1-101
    ('31100000-0000-0000-0000-000000000008', '21100000-0000-0000-0000-000000000005'), -- Deepa   → A-W2-F2-201
    ('31100000-0000-0000-0000-000000000009', '21100000-0000-0000-0000-000000000005'), -- Suresh  → A-W2-F2-201 (same)
    ('31100000-0000-0000-0000-000000000010', '21100000-0000-0000-0000-000000000007'), -- Ananya  → B-W1-F2-201
    ('31100000-0000-0000-0000-000000000011', '21100000-0000-0000-0000-000000000008'); -- Kiran   → B-W2-F1-101

-- ---------------------------------------------------------------------------
-- ADMIN_ACTIONS  (historical audit log — some past approvals)
-- ---------------------------------------------------------------------------
INSERT INTO user_svc.admin_actions (id, admin_id, admin_name, target_user_id, target_user_name,
                            target_user_email, action, role, performed_at) VALUES
    ('aa100000-0000-0000-0000-000000000001',
     '31100000-0000-0000-0000-000000000001', 'Rajesh Iyer',
     '31100000-0000-0000-0000-000000000002', 'Meera Krishnan', 'meera.krishnan@gmail.com',
     'approved', 'committee_member', NOW() - INTERVAL '60 days'),

    ('aa100000-0000-0000-0000-000000000002',
     '31100000-0000-0000-0000-000000000001', 'Rajesh Iyer',
     '31100000-0000-0000-0000-000000000003', 'Arjun Sharma', 'arjun.sharma@gmail.com',
     'approved', 'resident', NOW() - INTERVAL '55 days'),

    ('aa100000-0000-0000-0000-000000000003',
     '31100000-0000-0000-0000-000000000001', 'Rajesh Iyer',
     '31100000-0000-0000-0000-000000000004', 'Priya Sharma', 'priya.nair@gmail.com',
     'approved', 'resident', NOW() - INTERVAL '55 days'),

    ('aa100000-0000-0000-0000-000000000004',
     '31100000-0000-0000-0000-000000000001', 'Rajesh Iyer',
     '31100000-0000-0000-0000-000000000005', 'Sanjay Mehta', 'sanjay.mehta@outlook.com',
     'approved', 'resident', NOW() - INTERVAL '50 days'),

    ('aa100000-0000-0000-0000-000000000005',
     '31100000-0000-0000-0000-000000000001', 'Rajesh Iyer',
     '31100000-0000-0000-0000-000000000006', 'Vikram Patel', 'vikram.patel@gmail.com',
     'approved', 'resident', NOW() - INTERVAL '48 days'),

    ('aa100000-0000-0000-0000-000000000006',
     '31100000-0000-0000-0000-000000000001', 'Rajesh Iyer',
     '31100000-0000-0000-0000-000000000007', 'Kavya Reddy', 'kavya.reddy@techcorp.com',
     'approved', 'sponsor', NOW() - INTERVAL '45 days'),

    ('aa100000-0000-0000-0000-000000000007',
     '31100000-0000-0000-0000-000000000001', 'Rajesh Iyer',
     '31100000-0000-0000-0000-000000000008', 'Balavigneshkumar Pethuchetty', 'balavigneskumar@gmail.com',
     'approved', 'resident', NOW() - INTERVAL '40 days'),

    ('aa100000-0000-0000-0000-000000000008',
     '31100000-0000-0000-0000-000000000001', 'Rajesh Iyer',
     '31100000-0000-0000-0000-000000000009', 'Suresh Menon', 'suresh.menon@gmail.com',
     'approved', 'resident', NOW() - INTERVAL '40 days'),

    ('aa100000-0000-0000-0000-000000000009',
     '31100000-0000-0000-0000-000000000002', 'Meera Krishnan',
     '31100000-0000-0000-0000-000000000010', 'Ananya Krishnaswamy', 'ananya.k@gmail.com',
     'approved', 'resident', NOW() - INTERVAL '30 days'),

    ('aa100000-0000-0000-0000-000000000010',
     '31100000-0000-0000-0000-000000000002', 'Meera Krishnan',
     '31100000-0000-0000-0000-000000000011', 'Kiran Rao', 'kiran.rao@gmail.com',
     'approved', 'resident', NOW() - INTERVAL '25 days'),

    ('aa100000-0000-0000-0000-000000000011',
     '31100000-0000-0000-0000-000000000001', 'Rajesh Iyer',
     '31100000-0000-0000-0000-000000000012', 'Ramesh Kumar', 'ramesh.kumar@pvh-blr.in',
     'approved', 'security_guard', NOW() - INTERVAL '20 days');

-- ---------------------------------------------------------------------------
-- EVENT CATEGORY
-- ---------------------------------------------------------------------------
INSERT INTO event_svc.event_category (id, society_id, name, icon, color_hex) VALUES
    ('41100000-0000-0000-0000-000000000001', '11100000-0000-0000-0000-000000000001', 'Festival',   'sparkles', '#F59E0B'),
    ('41100000-0000-0000-0000-000000000002', '11100000-0000-0000-0000-000000000001', 'Sports',     'trophy',   '#10B981'),
    ('41100000-0000-0000-0000-000000000003', '11100000-0000-0000-0000-000000000001', 'Wellness',   'heart',    '#8B5CF6'),
    ('41100000-0000-0000-0000-000000000004', '11100000-0000-0000-0000-000000000001', 'Governance', 'building', '#6B7280'),
    ('41100000-0000-0000-0000-000000000005', '11100000-0000-0000-0000-000000000001', 'Kids',       'star',     '#EC4899');

-- ---------------------------------------------------------------------------
-- EVENTS
-- ---------------------------------------------------------------------------
INSERT INTO event_svc.event (id, society_id, category_id, organizer_id, title, description,
                   start_time, end_time, venue, capacity, status,
                   ticket_price, price_currency, is_free) VALUES

    ('51100000-0000-0000-0000-000000000001',
     '11100000-0000-0000-0000-000000000001',
     '41100000-0000-0000-0000-000000000001',
     '31100000-0000-0000-0000-000000000002',
     'Diwali Mela 2025',
     'Annual Diwali celebration with rangoli competition, diyas, cultural performances, and a grand potluck dinner. All residents and guests welcome.',
     NOW() + INTERVAL '45 days', NOW() + INTERVAL '45 days' + INTERVAL '5 hours',
     'Society Clubhouse & Garden', 500, 'published', 0.00, 'INR', TRUE),

    ('51100000-0000-0000-0000-000000000002',
     '11100000-0000-0000-0000-000000000001',
     '41100000-0000-0000-0000-000000000002',
     '31100000-0000-0000-0000-000000000002',
     'Annual Sports Day 2026',
     'Cricket, badminton, throwball, tug-of-war and 100 m sprint. Medals and trophies for top three in each category. Registration covers sports kit and refreshments.',
     NOW() + INTERVAL '80 days', NOW() + INTERVAL '80 days' + INTERVAL '8 hours',
     'Society Sports Ground', 200, 'published', 150.00, 'INR', FALSE),

    ('51100000-0000-0000-0000-000000000003',
     '11100000-0000-0000-0000-000000000001',
     '41100000-0000-0000-0000-000000000003',
     '31100000-0000-0000-0000-000000000001',
     'Sunday Morning Yoga',
     'Guided yoga and pranayama every Sunday at 6:30 AM. Suitable for all levels. Bring your own mat.',
     NOW() + INTERVAL '5 days', NOW() + INTERVAL '5 days' + INTERVAL '1 hour',
     'Rooftop Terrace — Tower A', 30, 'published', 0.00, 'INR', TRUE),

    ('51100000-0000-0000-0000-000000000004',
     '11100000-0000-0000-0000-000000000001',
     '41100000-0000-0000-0000-000000000004',
     '31100000-0000-0000-0000-000000000001',
     'Annual General Meeting 2025',
     'Mandatory AGM covering FY2025 accounts, maintenance fee revision, upcoming infrastructure projects, and election of new committee members.',
     NOW() + INTERVAL '20 days', NOW() + INTERVAL '20 days' + INTERVAL '3 hours',
     'Conference Room, Clubhouse', 150, 'published', 0.00, 'INR', TRUE),

    ('51100000-0000-0000-0000-000000000005',
     '11100000-0000-0000-0000-000000000001',
     '41100000-0000-0000-0000-000000000005',
     '31100000-0000-0000-0000-000000000002',
     'Children''s Day Carnival',
     'Games, face painting, puppet show, and art competition for kids aged 4–14. Fee covers activity kits, snacks, and participation gifts.',
     NOW() + INTERVAL '12 days', NOW() + INTERVAL '12 days' + INTERVAL '4 hours',
     'Society Amphitheatre', 100, 'published', 100.00, 'INR', FALSE);

-- ---------------------------------------------------------------------------
-- REGISTRATION
-- ---------------------------------------------------------------------------
INSERT INTO registration_svc.registration (id, event_id, user_id, ticket_count, total_amount,
                           display_currency, status, qr_code) VALUES

    -- Diwali (free)
    ('61100000-0000-0000-0000-000000000001',
     '51100000-0000-0000-0000-000000000001', '31100000-0000-0000-0000-000000000003',
     3, 0.00, 'INR', 'confirmed', 'QR-DIWALI-ARJUN-001'),

    ('61100000-0000-0000-0000-000000000002',
     '51100000-0000-0000-0000-000000000001', '31100000-0000-0000-0000-000000000004',
     2, 0.00, 'INR', 'confirmed', 'QR-DIWALI-PRIYA-001'),

    ('61100000-0000-0000-0000-000000000003',
     '51100000-0000-0000-0000-000000000001', '31100000-0000-0000-0000-000000000005',
     4, 0.00, 'INR', 'confirmed', 'QR-DIWALI-SANJAY-001'),

    ('61100000-0000-0000-0000-000000000009',
     '51100000-0000-0000-0000-000000000001', '31100000-0000-0000-0000-000000000008',
     2, 0.00, 'INR', 'confirmed', 'QR-DIWALI-DEEPA-001'),

    ('61100000-0000-0000-0000-000000000010',
     '51100000-0000-0000-0000-000000000001', '31100000-0000-0000-0000-000000000010',
     1, 0.00, 'INR', 'confirmed', 'QR-DIWALI-ANANYA-001'),

    -- Sports Day (paid INR) — Arjun: 2 tickets = ₹300
    ('61100000-0000-0000-0000-000000000004',
     '51100000-0000-0000-0000-000000000002', '31100000-0000-0000-0000-000000000003',
     2, 300.00, 'INR', 'confirmed', 'QR-SPORTS-ARJUN-001'),

    -- Sports Day (paid USD) — Vikram: 1 ticket ($1.80)
    ('61100000-0000-0000-0000-000000000005',
     '51100000-0000-0000-0000-000000000002', '31100000-0000-0000-0000-000000000006',
     1, 1.80, 'USD', 'confirmed', 'QR-SPORTS-VIKRAM-001'),

    -- Sports Day — Kiran: 1 participant ticket = ₹150
    ('61100000-0000-0000-0000-000000000011',
     '51100000-0000-0000-0000-000000000002', '31100000-0000-0000-0000-000000000011',
     1, 150.00, 'INR', 'confirmed', 'QR-SPORTS-KIRAN-001'),

    -- Children's Carnival — Priya: 2 tickets = ₹200
    ('61100000-0000-0000-0000-000000000006',
     '51100000-0000-0000-0000-000000000005', '31100000-0000-0000-0000-000000000004',
     2, 200.00, 'INR', 'confirmed', 'QR-KIDS-PRIYA-001'),

    -- Yoga (free)
    ('61100000-0000-0000-0000-000000000007',
     '51100000-0000-0000-0000-000000000003', '31100000-0000-0000-0000-000000000003',
     1, 0.00, 'INR', 'confirmed', 'QR-YOGA-ARJUN-001'),

    ('61100000-0000-0000-0000-000000000012',
     '51100000-0000-0000-0000-000000000003', '31100000-0000-0000-0000-000000000008',
     1, 0.00, 'INR', 'confirmed', 'QR-YOGA-DEEPA-001'),

    -- AGM (free) — Sanjay: pending
    ('61100000-0000-0000-0000-000000000008',
     '51100000-0000-0000-0000-000000000004', '31100000-0000-0000-0000-000000000005',
     1, 0.00, 'INR', 'pending', NULL);

-- ---------------------------------------------------------------------------
-- PAYMENT
-- ---------------------------------------------------------------------------
INSERT INTO registration_svc.payment (id, registration_id, gateway_name,
                     gateway_order_id, gateway_txn_id,
                     original_amount, original_currency,
                     settled_amount, settled_currency,
                     exchange_rate_used, exchange_rate_id,
                     status, gateway_response, paid_at) VALUES

    -- Arjun: ₹300 Sports Day
    ('81100000-0000-0000-0000-000000000001',
     '61100000-0000-0000-0000-000000000004',
     'razorpay', 'order_RZP_sports_arjun_001', 'pay_RZP_sports_arjun_001',
     300.00, 'INR', 300.00, 'INR', 1.0, NULL,
     'success',
     '{"method":"upi","vpa":"arjun@oksbi","fee":600,"tax":91}'::jsonb,
     NOW() - INTERVAL '2 days'),

    -- Vikram: $1.80 USD → ₹150.30
    ('81100000-0000-0000-0000-000000000002',
     '61100000-0000-0000-0000-000000000005',
     'razorpay', 'order_RZP_sports_vikram_001', 'pay_RZP_sports_vikram_001',
     1.80, 'USD', 150.30, 'INR',
     83.50000000, '71100000-0000-0000-0000-000000000001',
     'success',
     '{"method":"card","bank":"HDFC","international":true,"currency":"USD"}'::jsonb,
     NOW() - INTERVAL '3 days'),

    -- Priya: ₹200 Children's Carnival
    ('81100000-0000-0000-0000-000000000003',
     '61100000-0000-0000-0000-000000000006',
     'razorpay', 'order_RZP_kids_priya_001', 'pay_RZP_kids_priya_001',
     200.00, 'INR', 200.00, 'INR', 1.0, NULL,
     'success',
     '{"method":"netbanking","bank":"SBIN"}'::jsonb,
     NOW() - INTERVAL '1 day'),

    -- Kiran: ₹150 Sports Day
    ('81100000-0000-0000-0000-000000000004',
     '61100000-0000-0000-0000-000000000011',
     'razorpay', 'order_RZP_sports_kiran_001', 'pay_RZP_sports_kiran_001',
     150.00, 'INR', 150.00, 'INR', 1.0, NULL,
     'success',
     '{"method":"upi","vpa":"kiran@ybl","fee":300,"tax":46}'::jsonb,
     NOW() - INTERVAL '1 day');

-- ---------------------------------------------------------------------------
-- REFUND  (Priya: partial ₹100 for carnival)
-- ---------------------------------------------------------------------------
INSERT INTO registration_svc.refund (id, payment_id, initiated_by,
                    original_refund_amount, original_currency,
                    settled_refund_amount, settled_currency,
                    reason, status, gateway_refund_id) VALUES
    ('91100000-0000-0000-0000-000000000001',
     '81100000-0000-0000-0000-000000000003',
     '31100000-0000-0000-0000-000000000004',
     100.00, 'INR', 100.00, 'INR',
     'One family member unable to attend due to travel. Requesting partial refund for 1 ticket.',
     'processed', 'rfnd_RZP_kids_priya_001');

-- ---------------------------------------------------------------------------
-- ANNOUNCEMENT
-- ---------------------------------------------------------------------------
INSERT INTO event_svc.announcement (id, event_id, author_id, title, body, sent_at) VALUES
    ('a1100000-0000-0000-0000-000000000001',
     '51100000-0000-0000-0000-000000000001',
     '31100000-0000-0000-0000-000000000002',
     'Diwali Mela — Rangoli Competition Details',
     'Dear residents, the rangoli competition will begin at 5 PM sharp. Each flat may register one team of up to 4 members. Colours and stencils will be provided. Theme: "Unity in Diversity".',
     NOW() - INTERVAL '5 days'),

    ('a1100000-0000-0000-0000-000000000002',
     '51100000-0000-0000-0000-000000000002',
     '31100000-0000-0000-0000-000000000002',
     'Sports Day — Schedule Released',
     'The final event schedule is now available on the notice board and app. Cricket registration closes in 48 hours.',
     NOW() - INTERVAL '1 day'),

    ('a1100000-0000-0000-0000-000000000003',
     '51100000-0000-0000-0000-000000000004',
     '31100000-0000-0000-0000-000000000001',
     'AGM Agenda Published',
     'Key items: (1) FY2025 audited accounts, (2) Maintenance fee increase proposal of 8%, (3) EV charging station in Tower B, (4) New committee election. Documents shared on the app.',
     NOW() - INTERVAL '3 days');

-- ---------------------------------------------------------------------------
-- NOTIFICATION
-- ---------------------------------------------------------------------------
INSERT INTO notification (id, user_id, event_id, type, title, message, is_read) VALUES

    ('b1100000-0000-0000-0000-000000000001',
     '31100000-0000-0000-0000-000000000003',
     '51100000-0000-0000-0000-000000000002',
     'payment_success', 'Payment confirmed — Annual Sports Day 2026',
     'Your payment of ₹300 for 2 tickets to Annual Sports Day 2026 was successful. QR code is ready under My Tickets.',
     TRUE),

    ('b1100000-0000-0000-0000-000000000002',
     '31100000-0000-0000-0000-000000000003',
     '51100000-0000-0000-0000-000000000001',
     'event_reminder', 'Diwali Mela is 3 days away!',
     'The Diwali Mela starts in 3 days at the Clubhouse. You have 3 tickets. Don''t forget your potluck dish!',
     FALSE),

    ('b1100000-0000-0000-0000-000000000003',
     '31100000-0000-0000-0000-000000000006',
     '51100000-0000-0000-0000-000000000002',
     'payment_success', 'Payment confirmed — Annual Sports Day 2026',
     'Your payment of $1.80 USD (₹150.30 settled) for 1 ticket to Annual Sports Day 2026 was successful.',
     TRUE),

    ('b1100000-0000-0000-0000-000000000004',
     '31100000-0000-0000-0000-000000000004',
     '51100000-0000-0000-0000-000000000005',
     'refund_processed', 'Refund of ₹100 processed',
     'Your partial refund of ₹100 for Children''s Day Carnival has been processed. It will reflect in 5–7 business days.',
     FALSE),

    ('b1100000-0000-0000-0000-000000000005',
     '31100000-0000-0000-0000-000000000005',
     '51100000-0000-0000-0000-000000000004',
     'event_reminder', 'Confirm your AGM attendance',
     'The AGM is 20 days away. Please confirm your attendance. Quorum requires 51% of flat owners.',
     FALSE),

    ('b1100000-0000-0000-0000-000000000006',
     '31100000-0000-0000-0000-000000000002',
     '51100000-0000-0000-0000-000000000002',
     'announcement', 'Sports Day — Schedule Released',
     'The event schedule for Annual Sports Day 2026 has been published. Cricket registration closes in 48 hours.',
     TRUE),

    ('b1100000-0000-0000-0000-000000000007',
     '31100000-0000-0000-0000-000000000004',
     '51100000-0000-0000-0000-000000000001',
     'registration_confirmed', 'You''re registered for Diwali Mela 2025',
     'Your registration for Diwali Mela 2025 (2 tickets) is confirmed. See you at the Clubhouse!',
     TRUE),

    ('b1100000-0000-0000-0000-000000000008',
     '31100000-0000-0000-0000-000000000011',
     '51100000-0000-0000-0000-000000000002',
     'payment_success', 'Payment confirmed — Annual Sports Day 2026',
     'Your payment of ₹150 for 1 participant ticket to Annual Sports Day 2026 was successful.',
     FALSE);

-- ---------------------------------------------------------------------------
-- SPONSOR
-- ---------------------------------------------------------------------------
INSERT INTO payment_svc.sponsor (id, user_id, organization_name, organization_type,
                     contact_name, contact_email, contact_phone) VALUES
    ('c1100000-0000-0000-0000-000000000001',
     '31100000-0000-0000-0000-000000000007',
     'TechCorp Solutions Pvt. Ltd.', 'private',
     'Kavya Reddy', 'kavya.reddy@techcorp.com', '+91-98800-77777'),
    ('c1100000-0000-0000-0000-000000000002',
     NULL,
     'Community Welfare Foundation', 'ngo',
     'Anand Kumar', 'anand.kumar@cwf.org', '+91-99900-88888');

-- ---------------------------------------------------------------------------
-- EVENT_SPONSORSHIP
-- ---------------------------------------------------------------------------
INSERT INTO payment_svc.event_sponsorship (id, event_id, sponsor_id, amount, currency_code,
                                status, payment_reference, notes) VALUES
    ('d1100000-0000-0000-0000-000000000001',
     '51100000-0000-0000-0000-000000000001',
     'c1100000-0000-0000-0000-000000000001',
     25000.00, 'INR', 'received', 'TXN-DIWALI-TECHCORP-001',
     'Sponsoring decorations and prizes for rangoli competition'),

    ('d1100000-0000-0000-0000-000000000002',
     '51100000-0000-0000-0000-000000000002',
     'c1100000-0000-0000-0000-000000000002',
     15000.00, 'INR', 'received', 'TXN-SPORTS-CWF-001',
     'Sponsoring sports kits and medals'),

    ('d1100000-0000-0000-0000-000000000003',
     '51100000-0000-0000-0000-000000000002',
     'c1100000-0000-0000-0000-000000000001',
     10000.00, 'INR', 'pledged', NULL,
     'Pledged to sponsor the refreshment counter');

-- ---------------------------------------------------------------------------
-- SPONSORSHIP_REFUND
-- ---------------------------------------------------------------------------
INSERT INTO payment_svc.sponsorship_refund (id, sponsorship_id, requested_by, amount,
                                 currency_code, reason, status) VALUES
    ('e1100000-0000-0000-0000-000000000001',
     'd1100000-0000-0000-0000-000000000003',
     '31100000-0000-0000-0000-000000000007',
     5000.00, 'INR',
     'Event capacity was reduced; requesting partial refund for the unsupported portion.',
     'pending');

-- ---------------------------------------------------------------------------
-- EVENT_EXPENSE
-- ---------------------------------------------------------------------------
INSERT INTO payment_svc.event_expense (id, event_id, description, amount, currency_code,
                            category, created_by) VALUES
    ('f1100000-0000-0000-0000-000000000001',
     '51100000-0000-0000-0000-000000000001',
     'Decoration materials — diyas, lanterns, flowers', 8500.00, 'INR',
     'venue', '31100000-0000-0000-0000-000000000002'),

    ('f1100000-0000-0000-0000-000000000002',
     '51100000-0000-0000-0000-000000000001',
     'Potluck setup and utensils', 3200.00, 'INR',
     'catering', '31100000-0000-0000-0000-000000000002'),

    ('f1100000-0000-0000-0000-000000000003',
     '51100000-0000-0000-0000-000000000001',
     'Sound system rental', 5000.00, 'INR',
     'equipment', '31100000-0000-0000-0000-000000000002'),

    ('f1100000-0000-0000-0000-000000000004',
     '51100000-0000-0000-0000-000000000002',
     'Cricket set and badminton nets', 6000.00, 'INR',
     'equipment', '31100000-0000-0000-0000-000000000002'),

    ('f1100000-0000-0000-0000-000000000005',
     '51100000-0000-0000-0000-000000000002',
     'Medals and trophies', 4500.00, 'INR',
     'other', '31100000-0000-0000-0000-000000000002'),

    ('f1100000-0000-0000-0000-000000000006',
     '51100000-0000-0000-0000-000000000002',
     'Refreshments for participants', 3800.00, 'INR',
     'catering', '31100000-0000-0000-0000-000000000002');

-- ---------------------------------------------------------------------------
-- COMPLIMENTARY_TICKET
-- ---------------------------------------------------------------------------
INSERT INTO registration_svc.complimentary_ticket (id, event_id, invited_by_user_id, inviter_type,
                                   ticket_count, notes, created_by) VALUES
    ('0c100000-0000-0000-0000-000000000001',
     '51100000-0000-0000-0000-000000000001',
     '31100000-0000-0000-0000-000000000002', 'committee_member',
     2, 'Committee member''s family guests',
     '31100000-0000-0000-0000-000000000002'),

    ('0c100000-0000-0000-0000-000000000002',
     '51100000-0000-0000-0000-000000000001',
     '31100000-0000-0000-0000-000000000001', 'organizer',
     3, 'Organizer''s family and neighbours',
     '31100000-0000-0000-0000-000000000001'),

    ('0c100000-0000-0000-0000-000000000003',
     '51100000-0000-0000-0000-000000000001',
     '31100000-0000-0000-0000-000000000007', 'sponsor',
     4, 'TechCorp sponsor team members',
     '31100000-0000-0000-0000-000000000002'),

    ('0c100000-0000-0000-0000-000000000004',
     '51100000-0000-0000-0000-000000000001',
     NULL, 'walk_in',
     15, 'Walk-in attendees at gate',
     '31100000-0000-0000-0000-000000000001'),

    ('0c100000-0000-0000-0000-000000000005',
     '51100000-0000-0000-0000-000000000002',
     NULL, 'walk_in',
     8, 'Walk-ins at entry gate on event day',
     '31100000-0000-0000-0000-000000000002');

-- ---------------------------------------------------------------------------
-- VENDOR
-- ---------------------------------------------------------------------------
INSERT INTO payment_svc.vendor (id, society_id, name, category,
                    contact_name, contact_email, contact_phone) VALUES
    ('0d100000-0000-0000-0000-000000000001',
     '11100000-0000-0000-0000-000000000001',
     'Raj Sweets & Snacks', 'food',
     'Rajan Pillai', 'rajan@rajsweets.in', '+91-98001-11001'),
    ('0d100000-0000-0000-0000-000000000002',
     '11100000-0000-0000-0000-000000000001',
     'Fun Games Zone', 'games',
     'Deepak Rao', 'deepak@fungames.in', '+91-97001-22002'),
    ('0d100000-0000-0000-0000-000000000003',
     '11100000-0000-0000-0000-000000000001',
     'Sparkle Merchandise', 'merchandise',
     'Sunita Bose', 'sunita@sparklemerch.in', '+91-96001-33003');

-- ---------------------------------------------------------------------------
-- EVENT_VENDOR
-- ---------------------------------------------------------------------------
INSERT INTO payment_svc.event_vendor (id, event_id, vendor_id, stall_number, fee_type,
                           fixed_fee, revenue_share_pct, actual_revenue, status, notes) VALUES
    ('0e100000-0000-0000-0000-000000000001',
     '51100000-0000-0000-0000-000000000001',
     '0d100000-0000-0000-0000-000000000001',
     'A-01', 'revenue_share', 0.00, 15.00, 20000.00, 'confirmed',
     'Sweets and snacks near main entrance'),

    ('0e100000-0000-0000-0000-000000000002',
     '51100000-0000-0000-0000-000000000001',
     '0d100000-0000-0000-0000-000000000002',
     'B-03', 'fixed', 2000.00, 0.00, NULL, 'confirmed',
     'Games stall for kids and adults'),

    ('0e100000-0000-0000-0000-000000000003',
     '51100000-0000-0000-0000-000000000001',
     '0d100000-0000-0000-0000-000000000003',
     'C-02', 'revenue_share', 0.00, 20.00, 9500.00, 'confirmed',
     'Diwali-themed gifts and decorative items');

-- ---------------------------------------------------------------------------
-- VENDOR_REVENUE_DISTRIBUTION
-- ---------------------------------------------------------------------------
INSERT INTO payment_svc.vendor_revenue_distribution (id, event_id, total_pool, currency_code,
                                          status, notes) VALUES
    ('0f100000-0000-0000-0000-000000000001',
     '51100000-0000-0000-0000-000000000001',
     6900.00, 'INR', 'draft',
     'Combined pool: Raj Sweets ₹3000 + Fun Games ₹2000 + Sparkle ₹1900');

-- ---------------------------------------------------------------------------
-- DISTRIBUTION_ENTRY
-- ---------------------------------------------------------------------------
INSERT INTO payment_svc.distribution_entry (id, distribution_id, recipient_type,
                                  recipient_user_id, recipient_sponsor_id,
                                  share_percentage, amount, status) VALUES
    ('0f200000-0000-0000-0000-000000000001',
     '0f100000-0000-0000-0000-000000000001',
     'sponsor', NULL, 'c1100000-0000-0000-0000-000000000001',
     30.00, 2070.00, 'pending'),

    ('0f200000-0000-0000-0000-000000000002',
     '0f100000-0000-0000-0000-000000000001',
     'sponsor', NULL, 'c1100000-0000-0000-0000-000000000002',
     10.00, 690.00, 'pending'),

    ('0f200000-0000-0000-0000-000000000003',
     '0f100000-0000-0000-0000-000000000001',
     'organizer', '31100000-0000-0000-0000-000000000002', NULL,
     30.00, 2070.00, 'pending'),

    ('0f200000-0000-0000-0000-000000000004',
     '0f100000-0000-0000-0000-000000000001',
     'society', NULL, NULL,
     30.00, 2070.00, 'pending');

-- ---------------------------------------------------------------------------
-- TICKET_TYPE
-- ---------------------------------------------------------------------------
INSERT INTO event_svc.ticket_type (id, event_id, name, description, price, is_free,
                          capacity, sort_order) VALUES
    ('0f300000-0000-0000-0000-000000000001',
     '51100000-0000-0000-0000-000000000001',
     'General Entry', 'Access to all open stalls, performances and rangoli area',
     0.00, TRUE, NULL, 1),
    ('0f300000-0000-0000-0000-000000000002',
     '51100000-0000-0000-0000-000000000001',
     'Dinner Pass', 'Grand potluck dinner buffet plate',
     150.00, FALSE, 200, 2),
    ('0f300000-0000-0000-0000-000000000003',
     '51100000-0000-0000-0000-000000000001',
     'Games Bundle', 'Unlimited Fun Games Zone access',
     50.00, FALSE, 150, 3),

    ('0f300000-0000-0000-0000-000000000004',
     '51100000-0000-0000-0000-000000000002',
     'Participant', 'Play in any category — includes kit + refreshments',
     150.00, FALSE, NULL, 1),
    ('0f300000-0000-0000-0000-000000000005',
     '51100000-0000-0000-0000-000000000002',
     'Spectator', 'Watch all events from spectator stands',
     50.00, FALSE, NULL, 2),
    ('0f300000-0000-0000-0000-000000000006',
     '51100000-0000-0000-0000-000000000002',
     'Kids Zone', 'Kids 5–12 — mini-games and activity corner',
     75.00, FALSE, 80, 3);

-- ---------------------------------------------------------------------------
-- REGISTRATION_ITEM
-- ---------------------------------------------------------------------------
INSERT INTO registration_svc.registration_item (id, registration_id, ticket_type_id, quantity, unit_price) VALUES
    ('0f400000-0000-0000-0000-000000000001',
     '61100000-0000-0000-0000-000000000004',
     '0f300000-0000-0000-0000-000000000004',
     2, 150.00),   -- Arjun: 2 participant @ ₹150

    ('0f400000-0000-0000-0000-000000000002',
     '61100000-0000-0000-0000-000000000005',
     '0f300000-0000-0000-0000-000000000005',
     1, 50.00),    -- Vikram: 1 spectator (shown as USD)

    ('0f400000-0000-0000-0000-000000000003',
     '61100000-0000-0000-0000-000000000001',
     '0f300000-0000-0000-0000-000000000001',
     3, 0.00),     -- Arjun: 3 general entry (free)

    ('0f400000-0000-0000-0000-000000000004',
     '61100000-0000-0000-0000-000000000011',
     '0f300000-0000-0000-0000-000000000004',
     1, 150.00);   -- Kiran: 1 participant @ ₹150

-- ---------------------------------------------------------------------------
-- Sponsor notification
-- ---------------------------------------------------------------------------
INSERT INTO notification (id, user_id, event_id, type, title, message, is_read) VALUES
    ('b1100000-0000-0000-0000-000000000009',
     '31100000-0000-0000-0000-000000000007',
     '51100000-0000-0000-0000-000000000001',
     'payment_success', 'Sponsorship confirmed — Diwali Mela 2025',
     'Your sponsorship of ₹25,000 for Diwali Mela 2025 has been received. Thank you!',
     TRUE),

    ('b1100000-0000-0000-0000-000000000010',
     '31100000-0000-0000-0000-000000000007',
     '51100000-0000-0000-0000-000000000002',
     'refund_processed', 'Refund request submitted — Annual Sports Day 2026',
     'Your refund request of ₹5,000 is under review. You will be notified once approved.',
     FALSE);
