<?php
// this is alerts.php - in-app alerts to eligible donors near a point
//   Blood bank : alert about one of ITS blood requests  -> centered on the bank, blood type from the request
//   Organizer  : alert inviting donors to one of ITS drives -> centered on the drive's GPS point
//   Admin      : read-only (lists every alert)
// GET ?action=reach previews how many donors an alert would reach before it is sent.
declare(strict_types=1);
require_once __DIR__ . '/eligibility.php';

const ALERT_STATUSES = ['draft', 'active', 'completed', 'cancelled'];

$conn = getDbConnection();
$input = getRequestData();
$method = getRequestMethod($input);
header('Cache-Control: no-store');

requireRole($method === 'GET' ? ['bank', 'organizer', 'admin'] : ['bank', 'organizer']);
$role = $_SESSION['role'];
$bankId = $role === 'bank' ? signedInBankId() : null;
$organizerId = $role === 'organizer' ? signedInOrganizer() : null;

/* ---------- targeting ---------- */

function fetchOne(mysqli $conn, string $sql, string $types, array $params): ?array {
    $stmt = $conn->prepare($sql);
    $stmt->bind_param($types, ...$params);
    $stmt->execute();
    $row = $stmt->get_result()->fetch_assoc();
    $stmt->close();
    return $row ?: null;
}

// The organizer's own drive that is still upcoming; its GPS point, or its partner bank's, is the center.
function ownDrive(mysqli $conn, int $driveId, int $organizerId): array {
    $drive = fetchOne($conn,
        "SELECT d.drive_id, d.title, d.status,
                COALESCE(d.latitude, bb.latitude) AS latitude,
                COALESCE(d.longitude, bb.longitude) AS longitude
         FROM drive d
         LEFT JOIN blood_bank bb ON bb.bank_id = d.bank_id
         WHERE d.drive_id = ? AND d.organizer_id = ?",
        'ii', [$driveId, $organizerId]);
    if (!$drive) {
        sendJson(false, 'Drive not found for this organizer.', null, 404);
    }
    if (!in_array($drive['status'], ['scheduled', 'ongoing'], true)) {
        sendJson(false, 'Alerts can only be sent for scheduled or ongoing drives.', null, 422);
    }
    if ($drive['latitude'] === null) {
        sendJson(false, 'This drive has no location. Capture its GPS location on the Drives page first.', null, 422);
    }
    return $drive;
}

// The bank's own open request.
function ownRequest(mysqli $conn, int $requestId, int $bankId): array {
    $request = fetchOne($conn,
        "SELECT request_id, blood_type_id, status FROM blood_request WHERE request_id = ? AND bank_id = ?",
        'ii', [$requestId, $bankId]);
    if (!$request) {
        sendJson(false, 'Blood request not found for this bank.', null, 404);
    }
    if ($request['status'] !== 'open') {
        sendJson(false, 'Alerts can only be sent for open requests.', null, 422);
    }
    return $request;
}

// A drive alert must target a blood type the drive accepts (if the drive lists any).
function requireDriveBloodType(mysqli $conn, int $driveId, int $bloodTypeId): void {
    $listed = fetchOne($conn, 'SELECT COUNT(*) AS n FROM drive_blood_type WHERE drive_id = ?', 'i', [$driveId]);
    if ((int)$listed['n'] === 0) return;
    if (!fetchOne($conn, 'SELECT 1 AS ok FROM drive_blood_type WHERE drive_id = ? AND blood_type_id = ?', 'ii', [$driveId, $bloodTypeId])) {
        sendJson(false, 'This drive does not collect that blood type.', null, 422);
    }
}

// Center point (name + lat/lng) for the signed-in sender.
function alertCenter(mysqli $conn, array $input, ?int $bankId, ?int $organizerId): array {
    if ($organizerId !== null) {
        $driveId = validateIntRange($input['drive_id'] ?? null, 1, PHP_INT_MAX, 'drive_id');
        $drive = ownDrive($conn, $driveId, $organizerId);
        return ['name' => $drive['title'], 'latitude' => $drive['latitude'], 'longitude' => $drive['longitude']];
    }
    return fetchOne($conn, 'SELECT name, latitude, longitude FROM blood_bank WHERE bank_id = ?', 'i', [$bankId]);
}

// Eligible donors (active accounts) of one blood type within $radiusKm of $center.
function donorsInReach(mysqli $conn, array $center, int $bloodTypeId, int $radiusKm): array {
    $stmt = $conn->prepare(
        'SELECT d.* FROM donor d
         JOIN account a ON a.account_id = d.account_id
         WHERE a.is_active = 1 AND d.blood_type_id = ?'
    );
    $stmt->bind_param('i', $bloodTypeId);
    $stmt->execute();
    $donors = $stmt->get_result()->fetch_all(MYSQLI_ASSOC);
    $stmt->close();

    $ids = [];
    $missingLocation = 0;
    foreach ($donors as $donor) {
        if (!donorEligibility($conn, $donor)['is_eligible']) continue;
        if ($donor['latitude'] === null || $donor['longitude'] === null) {
            $missingLocation++;
            continue;
        }
        if (distanceKm($center, $donor) <= $radiusKm) {
            $ids[] = (int)$donor['donor_id'];
        }
    }

    return [
        'ids' => $ids,
        'count' => count($ids),
        'missing_location' => $missingLocation,
        'center_name' => $center['name'],
        'radius_km' => $radiusKm,
    ];
}

// Great-circle distance (haversine) between two points with latitude/longitude keys.
function distanceKm(array $a, array $b): float {
    $lat1 = deg2rad((float)$a['latitude']);
    $lat2 = deg2rad((float)$b['latitude']);
    $dLat = $lat2 - $lat1;
    $dLng = deg2rad((float)$b['longitude'] - (float)$a['longitude']);
    $h = sin($dLat / 2) ** 2 + cos($lat1) * cos($lat2) * sin($dLng / 2) ** 2;
    return 6371 * 2 * asin(sqrt(min(1, max(0, $h))));
}

function readRadius(array $input): int {
    $radius = validateIntRange($input['radius_km'] ?? null, 5, 30, 'radius_km');
    if ($radius % 5 !== 0) {
        sendJson(false, 'Choose a radius in 5 km steps.', null, 422);
    }
    return $radius;
}

function deliver(mysqli $conn, int $alertId, array $donorIds): int {
    $stmt = $conn->prepare(
        "INSERT IGNORE INTO alert_recipient (alert_id, donor_id, is_read, channel, delivery_status)
         VALUES (?, ?, 0, 'push', 'sent')"
    );
    $added = 0;
    foreach ($donorIds as $donorId) {
        $stmt->bind_param('ii', $alertId, $donorId);
        $stmt->execute();
        $added += $stmt->affected_rows;
    }
    $stmt->close();
    return $added;
}

// The sender may only change its own alerts.
function ownAlert(mysqli $conn, int $alertId, ?int $bankId, ?int $organizerId): array {
    $alert = $bankId !== null
        ? fetchOne($conn, 'SELECT * FROM alert WHERE alert_id = ? AND bank_id = ?', 'ii', [$alertId, $bankId])
        : fetchOne($conn, 'SELECT * FROM alert WHERE alert_id = ? AND organizer_id = ?', 'ii', [$alertId, $organizerId]);
    if (!$alert) {
        sendJson(false, 'Alert not found.', null, 404);
    }
    return $alert;
}

/* ---------- GET ---------- */

if ($method === 'GET' && ($input['action'] ?? '') === 'reach') {
    if ($role === 'admin') {
        sendJson(false, 'Admins can view alerts but not send them.', null, 403);
    }
    $bloodTypeId = validateIntRange($input['blood_type_id'] ?? null, 1, 8, 'blood_type_id');
    $reach = donorsInReach($conn, alertCenter($conn, $input, $bankId, $organizerId), $bloodTypeId, readRadius($input));
    unset($reach['ids']);
    sendJson(true, 'Reach calculated.', $reach);
}

if ($method === 'GET') {
    $where = [];
    $types = '';
    $params = [];
    if ($bankId !== null) {
        $where[] = 'a.bank_id = ?';
        $types .= 'i';
        $params[] = $bankId;
    } elseif ($organizerId !== null) {
        $where[] = 'a.organizer_id = ?';
        $types .= 'i';
        $params[] = $organizerId;
    }
    if (!empty($input['status'])) {
        $where[] = 'a.status = ?';
        $types .= 's';
        $params[] = validateEnum((string)$input['status'], ALERT_STATUSES, 'status');
    }

    $stmt = $conn->prepare(
        'SELECT a.*, bt.code AS blood_type_code, bb.name AS bank_name, o.org_name,
                d.title AS drive_title, br.ward AS request_ward,
                (SELECT COUNT(*) FROM alert_recipient r WHERE r.alert_id = a.alert_id) AS recipients_count,
                (SELECT COUNT(*) FROM alert_recipient r WHERE r.alert_id = a.alert_id AND r.is_read = 1) AS read_count
         FROM alert a
         JOIN blood_type bt ON bt.blood_type_id = a.blood_type_id
         LEFT JOIN blood_bank bb ON bb.bank_id = a.bank_id
         LEFT JOIN organizer o ON o.organizer_id = a.organizer_id
         LEFT JOIN drive d ON d.drive_id = a.drive_id
         LEFT JOIN blood_request br ON br.request_id = a.request_id'
        . ($where ? ' WHERE ' . implode(' AND ', $where) : '')
        . ' ORDER BY a.sent_at IS NULL DESC, a.sent_at DESC, a.alert_id DESC' // drafts first, then newest
    );
    if ($types !== '') {
        $stmt->bind_param($types, ...$params);
    }
    $stmt->execute();
    $alerts = $stmt->get_result()->fetch_all(MYSQLI_ASSOC);
    $stmt->close();

    sendJson(true, 'Alerts loaded.', ['count' => count($alerts), 'alerts' => $alerts]);
}

/* ---------- POST: create (and usually send) an alert ---------- */

if ($method === 'POST') {
    $status = validateEnum((string)($input['status'] ?? 'active'), ['draft', 'active'], 'status');
    $level = validateIntRange($input['level'] ?? 1, 1, 3, 'level');
    $message = sanitizeString($input['message'] ?? '');
    if ($message === '' || mb_strlen($message) > 280) {
        sendJson(false, 'Enter a message of 1–280 characters.', null, 422);
    }
    $radius = readRadius($input);

    $requestId = null;
    $driveId = null;
    if ($role === 'bank') {
        $request = ownRequest($conn, validateIntRange($input['request_id'] ?? null, 1, PHP_INT_MAX, 'request_id'), $bankId);
        $requestId = (int)$request['request_id'];
        $bloodTypeId = (int)$request['blood_type_id'];
    } else {
        $driveId = validateIntRange($input['drive_id'] ?? null, 1, PHP_INT_MAX, 'drive_id');
        $bloodTypeId = validateIntRange($input['blood_type_id'] ?? null, 1, 8, 'blood_type_id');
        requireDriveBloodType($conn, $driveId, $bloodTypeId);
    }

    $reach = donorsInReach($conn, alertCenter($conn, $input, $bankId, $organizerId), $bloodTypeId, $radius);
    if ($status === 'active' && $reach['count'] === 0) {
        sendJson(false, 'No eligible donors match this blood type and radius. Widen the radius or save a draft.', null, 422);
    }

    $senderType = $role;
    $sentAt = $status === 'active' ? date('Y-m-d H:i:s') : null;
    $conn->begin_transaction();
    try {
        $stmt = $conn->prepare(
            'INSERT INTO alert (sender_type, bank_id, organizer_id, request_id, drive_id, blood_type_id, level, message, status, sent_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)'
        );
        $stmt->bind_param('siiiiiisss', $senderType, $bankId, $organizerId, $requestId, $driveId,
            $bloodTypeId, $level, $message, $status, $sentAt);
        $stmt->execute();
        $alertId = (int)$stmt->insert_id;
        $stmt->close();

        $notified = $status === 'active' ? deliver($conn, $alertId, $reach['ids']) : 0;
        $conn->commit();
    } catch (mysqli_sql_exception $e) {
        $conn->rollback();
        throw $e;
    }

    sendJson(true, $status === 'draft' ? 'Draft saved.' : 'Alert sent.', [
        'alert_id' => $alertId,
        'status' => $status,
        'recipients_notified' => $notified,
    ], 201);
}

/* ---------- PUT: edit a draft, send it, or mark the alert completed/cancelled ---------- */

if ($method === 'PUT') {
    $alertId = validateIntRange($input['alert_id'] ?? null, 1, PHP_INT_MAX, 'alert_id');
    $alert = ownAlert($conn, $alertId, $bankId, $organizerId);

    $message = ($input['message'] ?? '') !== '' ? sanitizeString($input['message']) : $alert['message'];
    if (mb_strlen($message) > 280) {
        sendJson(false, 'Enter a message of 1–280 characters.', null, 422);
    }
    $status = ($input['status'] ?? '') !== '' ? validateEnum((string)$input['status'], ALERT_STATUSES, 'status') : $alert['status'];
    if ($alert['status'] !== 'draft' && $message !== $alert['message']) {
        sendJson(false, 'Only drafts can be edited; sent alerts are already in donor inboxes.', null, 422);
    }

    $deliverTo = [];
    if ($status === 'active' && $alert['status'] === 'draft') {
        $centerInput = ['drive_id' => $alert['drive_id']];
        $reach = donorsInReach($conn, alertCenter($conn, $centerInput, $bankId, $organizerId), (int)$alert['blood_type_id'], readRadius($input));
        if ($reach['count'] === 0) {
            sendJson(false, 'No eligible donors match this blood type and radius.', null, 422);
        }
        $deliverTo = $reach['ids'];
    }

    $conn->begin_transaction();
    try {
        $stmt = $conn->prepare(
            "UPDATE alert SET message = ?, status = ?,
                    sent_at = IF(? = 'active', COALESCE(sent_at, NOW()), sent_at)
             WHERE alert_id = ?"
        );
        $stmt->bind_param('sssi', $message, $status, $status, $alertId);
        $stmt->execute();
        $stmt->close();
        $notified = deliver($conn, $alertId, $deliverTo);
        $conn->commit();
    } catch (mysqli_sql_exception $e) {
        $conn->rollback();
        throw $e;
    }

    sendJson(true, 'Alert updated.', ['alert_id' => $alertId, 'status' => $status, 'recipients_notified' => $notified]);
}

/* ---------- DELETE: cancel (alerts stay for the record) ---------- */

if ($method === 'DELETE') {
    $alertId = validateIntRange($input['alert_id'] ?? null, 1, PHP_INT_MAX, 'alert_id');
    ownAlert($conn, $alertId, $bankId, $organizerId);

    $stmt = $conn->prepare("UPDATE alert SET status = 'cancelled' WHERE alert_id = ?");
    $stmt->bind_param('i', $alertId);
    $stmt->execute();
    $stmt->close();

    sendJson(true, 'Alert cancelled.', ['alert_id' => $alertId]);
}

sendJson(false, 'Method not allowed.', null, 405);
