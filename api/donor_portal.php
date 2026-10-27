<?php

declare(strict_types=1);

/* Donor Portal API: authenticated read/write operations using the existing SQL schema. */
require_once __DIR__ . '/eligibility.php';

if (session_status() !== PHP_SESSION_ACTIVE) {
    session_set_cookie_params(['httponly' => true, 'samesite' => 'Lax']);
    session_start();
}
header('Cache-Control: no-store, private');

$action = (string)($_GET['action'] ?? 'overview');
$method = strtoupper($_SERVER['REQUEST_METHOD'] ?? 'GET');
$accountId = (int)($_SESSION['account_id'] ?? 0);

if ($accountId <= 0 || ($_SESSION['role'] ?? '') !== 'donor') {
    sendJson(false, 'Please log in as a donor.', null, 401);
}
$db = getDbConnection();

$stmt = $db->prepare(
    'SELECT d.donor_id, d.account_id, d.full_name, d.birthdate, d.sex, d.weight_kg, d.contact_no, d.blood_type_id, d.latitude,'
        . ' d.longitude, d.last_donation_date, d.qr_code, d.photo_path, bt.code AS blood_type_code, a.email, a.role, a.is_active,'
        . ' a.last_login'
        . ' FROM donor d'
        . ' JOIN account a ON a.account_id = d.account_id'
        . ' JOIN blood_type bt ON bt.blood_type_id = d.blood_type_id'
        . ' WHERE a.account_id = ?'
        . ' LIMIT 1'
);
$stmt->bind_param('i', $accountId);
$stmt->execute();
$donor = $stmt->get_result()->fetch_assoc();
$stmt->close();

if (!$donor || (int)$donor['is_active'] !== 1) {
    sendJson(false, 'Your donor account is unavailable.', null, 403);
}

$donorId = (int)$donor['donor_id'];
$input = $method === 'GET' ? $_GET : getRequestData();

if ($method !== 'GET') {
    $origin = $_SERVER['HTTP_ORIGIN'] ?? '';
    $host = $_SERVER['HTTP_HOST'] ?? '';
    if ($origin !== '' && parse_url($origin, PHP_URL_HOST) !== explode(':', $host)[0]) {
        sendJson(false, 'Invalid request origin.', null, 403);
    }
}

function donorQuery(mysqli $db, string $query, string $types = '', array $params = []): array
{
    $stmt = $db->prepare($query);
    if (!$stmt) {
        sendJson(false, 'Could not prepare database request.', null, 500);
    }
    if ($types !== '') {
        $stmt->bind_param($types, ...$params);
    }
    if (!$stmt->execute()) {
        sendJson(false, 'Database request failed.', null, 500);
    }
    $result = $stmt->get_result();
    $rows = $result ? $result->fetch_all(MYSQLI_ASSOC) : [];
    $stmt->close();
    return $rows;
}

function donorWrite(mysqli $db, string $query, string $types, array $params): int
{
    $stmt = $db->prepare($query);
    if (!$stmt) {
        throw new RuntimeException('Could not prepare database operation.');
    }
    if ($types !== '') {
        $stmt->bind_param($types, ...$params);
    }
    if (!$stmt->execute()) {
        throw new RuntimeException('The database could not save your changes.');
    }
    $id = (int)$stmt->insert_id;
    $stmt->close();
    return $id;
}

function oneRow(mysqli $db, string $sql, string $types = '', array $params = []): ?array
{
    return donorQuery($db, $sql, $types, $params)[0] ?? null;
}

function validPositiveId(mixed $v): int
{
    $id = filter_var($v, FILTER_VALIDATE_INT);
    if (!$id || $id < 1) {
        sendJson(false, 'Invalid record ID.', null, 422);
    }
    return $id;
}

function eligibilityData(mysqli $db, array $donor): array
{
    $defs = donorQuery(
        $db,
        'SELECT reason, ends_on'
            . ' FROM donor_deferral'
            . ' WHERE donor_id = ? AND starts_on <= CURRENT_DATE AND (ends_on IS NULL OR ends_on >= CURRENT_DATE)',
        'i',
        [(int)$donor['donor_id']]
    );
    return evaluateDonorEligibility($donor, $defs);
}

function bookedRegistrations(mysqli $db, int $donorId): array
{
    return donorQuery(
        $db,
        "SELECT r.registration_id, r.drive_id, r.slot_id, r.component_id, r.status, r.checked_in_at, d.ref_code, d.title, d.venue,"
            . " d.drive_date, d.start_time, d.end_time, d.status AS drive_status, o.org_name, s.slot_time, c.name AS component_name"
            . " FROM drive_registration r"
            . " JOIN drive d ON d.drive_id=r.drive_id"
            . " JOIN organizer o ON o.organizer_id=d.organizer_id"
            . " JOIN drive_slot s ON s.slot_id=r.slot_id"
            . " JOIN blood_component c ON c.component_id=r.component_id"
            . " WHERE r.donor_id=?"
            . " ORDER BY d.drive_date DESC, s.slot_time",
        'i',
        [$donorId]
    );
}

/* changes: Combine verified history with live bank donations not yet inserted into blood_history. */
function historyRows(mysqli $db, int $donorId): array
{
    return donorQuery(
        $db,
        "SELECT h.history_id, h.public_ref, h.blood_type_id, bt.code AS blood_type_code,"
            . " h.donated_on, h.units, h.source, h.verification, h.donation_id,"
            . " d.collected_at, d.status AS donation_status, bc.name AS component_name,"
            . " bb.name AS bank_name, dv.title AS drive_title"
            . " FROM blood_history h"
            . " JOIN blood_type bt ON bt.blood_type_id=h.blood_type_id"
            . " LEFT JOIN donation d ON d.donation_id=h.donation_id"
            . " LEFT JOIN blood_component bc ON bc.component_id=d.component_id"
            . " LEFT JOIN blood_bank bb ON bb.bank_id=d.bank_id"
            . " LEFT JOIN drive dv ON dv.drive_id=d.drive_id"
            . " WHERE h.donor_id=?"
            . " UNION ALL"
            . " SELECT NULL AS history_id, d.client_uuid AS public_ref, d.blood_type_id,"
            . " bt.code AS blood_type_code, DATE(d.collected_at) AS donated_on, d.units,"
            . " 'system' AS source,"
            . " CASE WHEN d.status IN ('tested','processed','transfused') THEN 'verified'"
            . " WHEN d.status='discarded' THEN 'rejected' ELSE 'pending' END AS verification,"
            . " d.donation_id, d.collected_at, d.status AS donation_status,"
            . " bc.name AS component_name, bb.name AS bank_name, dv.title AS drive_title"
            . " FROM donation d"
            . " JOIN blood_type bt ON bt.blood_type_id=d.blood_type_id"
            . " JOIN blood_component bc ON bc.component_id=d.component_id"
            . " JOIN blood_bank bb ON bb.bank_id=d.bank_id"
            . " LEFT JOIN drive dv ON dv.drive_id=d.drive_id"
            . " WHERE d.donor_id=? AND NOT EXISTS"
            . " (SELECT 1 FROM blood_history h WHERE h.donation_id=d.donation_id)"
            . " ORDER BY donated_on DESC, collected_at DESC",
        'ii',
        [$donorId, $donorId]
    );
}

function unreadCount(mysqli $db, int $donorId): int
{
    $row = oneRow(
        $db,
        "SELECT COUNT(*) AS n"
            . " FROM alert_recipient ar"
            . " JOIN alert a ON a.alert_id=ar.alert_id"
            . " WHERE ar.donor_id=? AND ar.is_read=0 AND a.status='active'",
        'i',
        [$donorId]
    );
    return (int)($row['n'] ?? 0);
}

if ($method === 'GET') {
    // Compare request deadlines using the PHP application's Asia/Manila timezone.
    $nowManila = date('Y-m-d H:i:s');
    if ($action === 'me' || $action === 'overview') {
        $donor['eligibility'] = eligibilityData($db, $donor);
        $history = historyRows($db, $donorId);
        $donor['history_count'] = count($history);
        $donor['total_units'] = (float) array_sum(
            array_map(
                fn($h) => (float) $h['units'],
                array_filter(
                    $history,
                    fn($h) => $h['source'] === 'system' && $h['verification'] === 'verified'
                )
            )
        );
        $donor['unread_count'] = unreadCount($db, $donorId);
        $donor['active_booking'] = null;
        foreach (bookedRegistrations($db, $donorId) as $b) {
            if (
                in_array($b['status'], ['booked', 'checked_in'], true)
                && $b['drive_date'] >= date('Y-m-d')
                && in_array($b['drive_status'], ['scheduled', 'ongoing'], true)
            ) {
                $donor['active_booking'] = $b;
                break;
            }
        }
        /* DONOR MATCHING REQUESTS: only open requests whose deadlines are in the future. */
        $donor['matching_requests'] = donorQuery(
            $db,
            "SELECT br.request_id, br.ward, br.units_needed, br.urgency, br.needed_by, br.status, br.blood_type_id,"
                . " bt.code AS blood_type_code, bc.name AS component_name, bb.name AS bank_name"
                . " FROM blood_request br"
                . " JOIN blood_type bt ON bt.blood_type_id=br.blood_type_id"
                . " JOIN blood_component bc ON bc.component_id=br.component_id"
                . " JOIN blood_bank bb ON bb.bank_id=br.bank_id"
                . " WHERE br.status='open' AND br.blood_type_id=? AND br.needed_by > ?"
                . " ORDER BY FIELD(br.urgency,'critical','high','normal'), br.needed_by, br.request_id DESC"
                . " LIMIT 3",
            'is',
            [(int)$donor['blood_type_id'], $nowManila]
        );
        sendJson(true, 'Donor account loaded.', $donor);
    }
    if ($action === 'history') {
        sendJson(true, 'Donation history loaded.', [
            'history' => historyRows($db, $donorId),
        ]);
    }
    if ($action === 'drives') {
        $rows = donorQuery(
            $db,
            "SELECT d.*, o.org_name, bb.name AS bank_name, (SELECT COUNT(*)"
                . " FROM drive_registration r"
                . " WHERE r.drive_id=d.drive_id AND r.status IN ('booked','checked_in','completed')) AS registered_count"
                . " FROM drive d"
                . " JOIN organizer o ON o.organizer_id=d.organizer_id"
                . " LEFT JOIN blood_bank bb ON bb.bank_id=d.bank_id"
                . " WHERE d.status IN ('scheduled','ongoing') AND d.drive_date >= CURRENT_DATE"
                . " ORDER BY d.drive_date, d.start_time"
        );
        foreach ($rows as &$drive) {
            $drive['slots'] = donorQuery(
                $db,
                "SELECT s.slot_id, s.slot_time, s.capacity, (SELECT COUNT(*)"
                    . " FROM drive_registration r"
                    . " WHERE r.slot_id=s.slot_id AND r.status IN ('booked','checked_in','completed')) AS booked_count"
                    . " FROM drive_slot s"
                    . " WHERE s.drive_id=?"
                    . " ORDER BY s.slot_time",
                'i',
                [(int)$drive['drive_id']]
            );
            $drive['slots_available'] = max(0, (int)$drive['slots_total'] - (int)$drive['registered_count']);
            $drive['target_blood_types'] = donorQuery(
                $db,
                'SELECT bt.code FROM drive_blood_type t JOIN blood_type bt ON bt.blood_type_id=t.blood_type_id WHERE t.drive_id=?',
                'i',
                [(int)$drive['drive_id']]
            );
        }
        unset($drive);
        sendJson(true, 'Upcoming drives loaded.', ['drives' => $rows]);
    }
    if ($action === 'bookings') {
        sendJson(true, 'Your registrations loaded.', ['bookings' => bookedRegistrations($db, $donorId)]);
    }
    if ($action === 'notifications') {
        $alerts = donorQuery(
            $db,
            "SELECT a.alert_id, a.message, a.sender_type, a.level, a.status, a.sent_at, a.drive_id, a.request_id, bt.code AS blood_type_code,"
                . " COALESCE(bb.name,o.org_name,'Ka-dugo') AS sender_name, ar.is_read, ar.responded_at,"
                . " br.needed_by AS request_needed_by, br.status AS request_status,"
                . " CASE WHEN br.request_id IS NOT NULL AND br.needed_by <= ? THEN 1 ELSE 0 END AS request_expired"
                . " FROM alert_recipient ar"
                . " JOIN alert a ON a.alert_id=ar.alert_id"
                . " JOIN blood_type bt ON bt.blood_type_id=a.blood_type_id"
                . " LEFT JOIN blood_bank bb ON bb.bank_id=a.bank_id"
                . " LEFT JOIN organizer o ON o.organizer_id=a.organizer_id"
                . " LEFT JOIN blood_request br ON br.request_id=a.request_id"
                . " WHERE ar.donor_id=? AND a.status='active'"
                . " ORDER BY a.sent_at DESC, a.alert_id DESC",
            'si',
            [$nowManila, $donorId]
        );
        /* DONOR NOTIFICATIONS
         * Existing dispatched alerts use alert_recipient (server-side read receipts).
         * An open bank request does NOT automatically create an alert; expose matching
         * requests as live inbox items without modifying bank/organizer records.
         */
        $matchingRequests = donorQuery(
            $db,
            "SELECT br.request_id, br.ward, br.units_needed, br.urgency, br.needed_by,"
                . " br.blood_type_id, bt.code AS blood_type_code,"
                . " bc.name AS component_name, bb.name AS bank_name"
                . " FROM blood_request br"
                . " JOIN blood_type bt ON bt.blood_type_id=br.blood_type_id"
                . " JOIN blood_component bc ON bc.component_id=br.component_id"
                . " JOIN blood_bank bb ON bb.bank_id=br.bank_id"
                . " WHERE br.status='open' AND br.blood_type_id=? AND br.needed_by > ?"
                . " ORDER BY FIELD(br.urgency,'critical','high','normal'), br.needed_by, br.request_id DESC"
                . " LIMIT 30",
            'is',
            [(int)$donor['blood_type_id'], $nowManila]
        );

        /* Expired open bank requests are shown as a distinct notification, never
         * as actionable dashboard requests or bookable blood drives. The donor
         * reads these browser-local notices; no bank request status is changed.
         */
        $expiredRequests = donorQuery(
            $db,
            "SELECT br.request_id, br.ward, br.units_needed, br.urgency, br.needed_by,"
                . " bt.code AS blood_type_code, bc.name AS component_name, bb.name AS bank_name"
                . " FROM blood_request br"
                . " JOIN blood_type bt ON bt.blood_type_id=br.blood_type_id"
                . " JOIN blood_component bc ON bc.component_id=br.component_id"
                . " JOIN blood_bank bb ON bb.bank_id=br.bank_id"
                . " WHERE br.status='open' AND br.blood_type_id=? AND br.needed_by <= ?"
                . " ORDER BY br.needed_by DESC, br.request_id DESC"
                . " LIMIT 50",
            'is',
            [(int)$donor['blood_type_id'], $nowManila]
        );

        /* Show ongoing/upcoming drives that accept this donor's blood type.
         * Drives without a target blood type list are open to every donor type.
         */
        $upcomingDrives = donorQuery(
            $db,
            "SELECT d.drive_id, d.title, d.venue, d.drive_date, d.start_time,"
                . " d.status, o.org_name AS organizer_name"
                . " FROM drive d"
                . " JOIN organizer o ON o.organizer_id=d.organizer_id"
                . " WHERE d.status IN ('scheduled','ongoing')"
                . " AND d.drive_date >= CURRENT_DATE"
                . " AND (NOT EXISTS (SELECT 1 FROM drive_blood_type t WHERE t.drive_id=d.drive_id)"
                . " OR EXISTS (SELECT 1 FROM drive_blood_type t"
                . " WHERE t.drive_id=d.drive_id AND t.blood_type_id=?))"
                . " ORDER BY d.drive_date, d.start_time, d.drive_id"
                . " LIMIT 30",
            'i',
            [(int)$donor['blood_type_id']]
        );

        /* Only link notifications to drives the donor can currently find
         * under Drives & Booking. Use the same availability conditions and
         * organizer join as the donor `drives` endpoint.
         */
        $browseableDrives = donorQuery(
            $db,
            "SELECT d.drive_id FROM drive d"
                . " JOIN organizer o ON o.organizer_id=d.organizer_id"
                . " WHERE d.status IN ('scheduled','ongoing') AND d.drive_date >= CURRENT_DATE"
        );

        sendJson(true, 'Notifications loaded.', [
            'donor_id' => $donorId,
            'browseable_drive_ids' => array_map('intval', array_column($browseableDrives, 'drive_id')),
            'alerts' => $alerts,
            'matching_requests' => $matchingRequests,
            'expired_requests' => $expiredRequests,
            'upcoming_drives' => $upcomingDrives,
            'unread_count' => unreadCount($db, $donorId),
        ]);
    }
    sendJson(false, 'Unknown donor operation.', null, 404);
}

if ($method !== 'POST') {
    sendJson(false, 'Method not allowed.', null, 405);
}

if ($action === 'logout') {
    $_SESSION = [];
    if (ini_get('session.use_cookies')) {
        $params = session_get_cookie_params();
        setcookie(
            session_name(),
            '',
            time() - 42000,
            $params['path'],
            $params['domain'],
            $params['secure'],
            $params['httponly']
        );
    }
    session_destroy();
    sendJson(true, 'Signed out.');
}

/* changes: Self-reported donation creation removed; history is read-only for donors. */

if ($action === 'book' || $action === 'reschedule' || $action === 'cancel_booking') {
    $regId = $action === 'book' ? 0 : validPositiveId($input['registration_id'] ?? null);
    $driveId = $action === 'book' ? validPositiveId($input['drive_id'] ?? null) : 0;
    $slotId = $action === 'cancel_booking' ? 0 : validPositiveId($input['slot_id'] ?? null);
    if ($action === 'book' && !eligibilityData($db, $donor)['is_eligible']) {
        sendJson(false, 'You are currently not eligible to book a donation.', null, 422);
    }

    $db->begin_transaction();
    try {
        $reg = null;
        if ($regId) {
            $reg = oneRow(
                $db,
                'SELECT * FROM drive_registration WHERE registration_id=? AND donor_id=? FOR UPDATE',
                'ii',
                [$regId, $donorId]
            );
            if (!$reg || $reg['status'] !== 'booked') {
                $db->rollback();
                sendJson(false, 'This active booking cannot be changed.', null, 409);
            }
            $driveId = (int)$reg['drive_id'];
        }
        $drive = oneRow(
            $db,
            "SELECT drive_id,drive_date,status,slots_total FROM drive WHERE drive_id=? FOR UPDATE",
            'i',
            [$driveId]
        );
        if (!$drive || !in_array($drive['status'], ['scheduled', 'ongoing'], true) || $drive['drive_date'] < date('Y-m-d')) {
            $db->rollback();
            sendJson(false, 'This drive is no longer open for booking.', null, 409);
        }
        if ($action === 'cancel_booking') {
            donorWrite(
                $db,
                "UPDATE drive_registration SET status='cancelled' WHERE registration_id=? AND donor_id=?",
                'ii',
                [$regId, $donorId]
            );
            $db->commit();
            sendJson(true, 'Registration cancelled.');
        }
        $slot = oneRow(
            $db,
            'SELECT slot_id,capacity FROM drive_slot WHERE slot_id=? AND drive_id=? FOR UPDATE',
            'ii',
            [$slotId, $driveId]
        );
        if (!$slot) {
            $db->rollback();
            sendJson(false, 'Invalid drive slot.', null, 422);
        }
        $cnt = oneRow(
            $db,
            "SELECT COUNT(*) AS n FROM drive_registration WHERE slot_id=? AND status IN ('booked','checked_in','completed')",
            'i',
            [$slotId]
        );
        $used = (int)$cnt['n'];
        if ($action === 'reschedule' && (int)$reg['slot_id'] === $slotId) {
            $db->commit();
            sendJson(true, 'You already have this time slot.');
        }
        if ($used >= (int)$slot['capacity']) {
            $db->rollback();
            sendJson(false, 'That slot is already full.', null, 409);
        }
        if ($action === 'book') {
            $total = oneRow(
                $db,
                "SELECT COUNT(*) AS n FROM drive_registration WHERE drive_id=? AND status IN ('booked','checked_in','completed')",
                'i',
                [$driveId]
            );
            if ((int)$total['n'] >= (int)$drive['slots_total']) {
                $db->rollback();
                sendJson(false, 'This drive is already full.', null, 409);
            }
            $existing = oneRow(
                $db,
                "SELECT registration_id,status"
                    . " FROM drive_registration"
                    . " WHERE drive_id=? AND donor_id=?"
                    . " ORDER BY registration_id DESC"
                    . " LIMIT 1"
                    . " FOR UPDATE",
                'ii',
                [$driveId, $donorId]
            );
            if ($existing && $existing['status'] !== 'cancelled') {
                $db->rollback();
                sendJson(false, 'You already have a registration for this drive.', null, 409);
            }
            if ($existing) {
                donorWrite(
                    $db,
                    "UPDATE drive_registration"
                        . " SET slot_id=?,component_id=1,status='booked',checked_in_at=NULL"
                        . " WHERE registration_id=? AND donor_id=?",
                    'iii',
                    [$slotId, (int)$existing['registration_id'], $donorId]
                );
            } else {
                donorWrite(
                    $db,
                    "INSERT INTO drive_registration (drive_id,donor_id,slot_id,component_id,status) VALUES (?,?,?,1,'booked')",
                    'iii',
                    [$driveId, $donorId, $slotId]
                );
            }
        } else {
            donorWrite(
                $db,
                'UPDATE drive_registration SET slot_id=? WHERE registration_id=? AND donor_id=?',
                'iii',
                [$slotId, $regId, $donorId]
            );
        }
        $db->commit();
        sendJson(true, $action === 'book' ? 'Your drive booking is confirmed.' : 'Your booking time was updated.');
    } catch (Throwable $e) {
        $db->rollback();
        sendJson(false, 'Could not complete this booking.', null, 500);
    }
}

if ($action === 'read_alert' || $action === 'read_all') {
    try {
        if ($action === 'read_all') {
            donorWrite(
                $db,
                "UPDATE alert_recipient ar"
                    . " JOIN alert a ON a.alert_id=ar.alert_id"
                    . " SET ar.is_read=1"
                    . " WHERE ar.donor_id=? AND a.status='active'",
                'i',
                [$donorId]
            );
        } else {
            $alertId = validPositiveId($input['alert_id'] ?? null);
            donorWrite(
                $db,
                'UPDATE alert_recipient SET is_read=1 WHERE alert_id=? AND donor_id=?',
                'ii',
                [$alertId, $donorId]
            );
        }
        sendJson(true, 'Notification marked as read.', ['unread_count' => unreadCount($db, $donorId)]);
    } catch (Throwable $e) {
        sendJson(false, 'Could not update notification.', null, 500);
    }
}
sendJson(false, 'Unknown donor operation.', null, 404);
