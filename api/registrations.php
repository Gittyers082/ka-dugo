<?php
// this is registrations.php - drive turnout for organizers (donors book through donor_portal.php)
//   GET organizer: registrations for its own drives (?drive_id=, ?status=) | admin: all
//   PUT organizer: mark a registration checked_in / no_show / cancelled
declare(strict_types=1);
require_once __DIR__ . '/validation.php';

const REGISTRATION_STATUSES = ['booked', 'checked_in', 'completed', 'cancelled', 'no_show'];

$conn = getDbConnection();
$input = getRequestData();
$method = getRequestMethod($input);
header('Cache-Control: no-store');

requireRole($method === 'GET' ? ['organizer', 'admin'] : ['organizer']);
$organizerId = $_SESSION['role'] === 'organizer' ? signedInOrganizer() : null;

if ($method === 'GET') {
    $where = [];
    $types = '';
    $params = [];
    if ($organizerId !== null) {
        $where[] = 'dv.organizer_id = ?';
        $types .= 'i';
        $params[] = $organizerId;
    }
    if (!empty($input['drive_id'])) {
        $where[] = 'r.drive_id = ?';
        $types .= 'i';
        $params[] = validateIntRange($input['drive_id'], 1, PHP_INT_MAX, 'drive_id');
    }
    if (!empty($input['status'])) {
        $where[] = 'r.status = ?';
        $types .= 's';
        $params[] = validateEnum((string)$input['status'], REGISTRATION_STATUSES, 'status');
    }

    $stmt = $conn->prepare(
        'SELECT r.registration_id, r.drive_id, r.status, r.checked_in_at, s.slot_time,
                dn.full_name, bt.code AS blood_type_code, bc.name AS component_name, dv.title AS drive_title
         FROM drive_registration r
         JOIN drive dv ON dv.drive_id = r.drive_id
         JOIN drive_slot s ON s.slot_id = r.slot_id
         JOIN donor dn ON dn.donor_id = r.donor_id
         JOIN blood_type bt ON bt.blood_type_id = dn.blood_type_id
         JOIN blood_component bc ON bc.component_id = r.component_id'
        . ($where ? ' WHERE ' . implode(' AND ', $where) : '')
        . ' ORDER BY dv.drive_date, s.slot_time, dn.full_name'
    );
    if ($types !== '') {
        $stmt->bind_param($types, ...$params);
    }
    $stmt->execute();
    $rows = $stmt->get_result()->fetch_all(MYSQLI_ASSOC);
    $stmt->close();

    sendJson(true, 'Registrations loaded.', ['count' => count($rows), 'registrations' => $rows]);
}

if ($method === 'PUT') {
    $registrationId = validateIntRange($input['registration_id'] ?? null, 1, PHP_INT_MAX, 'registration_id');
    $status = validateEnum((string)($input['status'] ?? ''), ['checked_in', 'no_show', 'cancelled'], 'status');

    $stmt = $conn->prepare(
        "UPDATE drive_registration r
         JOIN drive dv ON dv.drive_id = r.drive_id
         SET r.status = ?, r.checked_in_at = IF(? = 'checked_in', NOW(), r.checked_in_at)
         WHERE r.registration_id = ? AND dv.organizer_id = ?"
    );
    $stmt->bind_param('ssii', $status, $status, $registrationId, $organizerId);
    $stmt->execute();
    $changed = $stmt->affected_rows;
    $stmt->close();
    if ($changed === 0) {
        sendJson(false, 'Registration not found for your drives (or already in that status).', null, 404);
    }

    sendJson(true, 'Registration updated.', ['registration_id' => $registrationId, 'status' => $status]);
}

sendJson(false, 'Method not allowed.', null, 405);
