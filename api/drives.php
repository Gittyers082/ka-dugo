<?php
// this is drives.php - blood drives hosted by organizers
//   GET    organizer: own drives | bank, phlebotomist: drives at their bank | admin: all
//          ?drive_id= one drive with slots; ?lookup=blood_types | banks for the organizer form
//   POST   organizer creates a drive (venue GPS point, partner bank, blood types, time slots)
//   PUT    organizer edits drive details, or replaces its slot list (slots[])
//   DELETE organizer cancels a drive
declare(strict_types=1);
require_once __DIR__ . '/validation.php';

const DRIVE_STATUSES = ['scheduled', 'ongoing', 'completed', 'cancelled'];
const DRIVE_CATEGORIES = ['community', 'corporate', 'university'];
const TIME_PATTERN = '/^(?:[01]\d|2[0-3]):[0-5]\d(?::[0-5]\d)?$/';
const MAX_DRIVE_CAPACITY = 2000;

$conn = getDbConnection();
$input = getRequestData();
$method = getRequestMethod($input);
header('Cache-Control: no-store');

requireRole($method === 'GET' ? ['organizer', 'bank', 'phlebotomist', 'admin'] : ['organizer']);
$role = $_SESSION['role'];
$organizerId = $role === 'organizer' ? signedInOrganizer() : null;
$bankId = in_array($role, ['bank', 'phlebotomist'], true) ? signedInBankId() : null;

/* ---------- helpers ---------- */

// "08:00" -> "08:00:00"; rejects anything that is not a clock time.
function clockTime(mixed $value, string $field): string {
    $time = trim((string)$value);
    if (!preg_match(TIME_PATTERN, $time)) {
        sendJson(false, "{$field} must use HH:MM format.", null, 422);
    }
    return strlen($time) === 5 ? "{$time}:00" : $time;
}

function optionalCoordinate(array $input, string $field, float $limit): ?float {
    if (($input[$field] ?? '') === '') return null;
    return validateFloatRange($input[$field], -$limit, $limit, $field);
}

function partnerBankId(mysqli $conn, array $input): ?int {
    if (empty($input['bank_id'])) return null;
    $bankId = validateIntRange($input['bank_id'], 1, PHP_INT_MAX, 'bank_id');
    $stmt = $conn->prepare('SELECT 1 FROM blood_bank WHERE bank_id = ?');
    $stmt->bind_param('i', $bankId);
    $stmt->execute();
    if (!$stmt->get_result()->fetch_assoc()) {
        sendJson(false, 'Choose a partner blood bank from the list.', null, 422);
    }
    return $bankId;
}

function driveBloodTypes(mysqli $conn, int $driveId): array {
    $stmt = $conn->prepare(
        'SELECT bt.blood_type_id, bt.code FROM drive_blood_type dbt
         JOIN blood_type bt ON bt.blood_type_id = dbt.blood_type_id
         WHERE dbt.drive_id = ? ORDER BY bt.blood_type_id'
    );
    $stmt->bind_param('i', $driveId);
    $stmt->execute();
    $rows = $stmt->get_result()->fetch_all(MYSQLI_ASSOC);
    $stmt->close();
    return $rows;
}

function driveSlots(mysqli $conn, int $driveId): array {
    $stmt = $conn->prepare(
        "SELECT ds.slot_id, ds.slot_time, ds.capacity,
                COUNT(CASE WHEN dr.status IN ('booked', 'checked_in', 'completed') THEN 1 END) AS booked_count
         FROM drive_slot ds
         LEFT JOIN drive_registration dr ON dr.slot_id = ds.slot_id
         WHERE ds.drive_id = ?
         GROUP BY ds.slot_id, ds.slot_time, ds.capacity
         ORDER BY ds.slot_time"
    );
    $stmt->bind_param('i', $driveId);
    $stmt->execute();
    $slots = $stmt->get_result()->fetch_all(MYSQLI_ASSOC);
    $stmt->close();
    foreach ($slots as &$slot) {
        $slot['capacity'] = (int)$slot['capacity'];
        $slot['booked_count'] = (int)$slot['booked_count'];
        $slot['available_slots'] = max(0, $slot['capacity'] - $slot['booked_count']);
    }
    return $slots;
}

// Validates a submitted slot list against the drive hours; returns normalized rows.
function validateDriveSlots(mixed $slots, string $start, string $end): array {
    if (!is_array($slots) || count($slots) < 1 || count($slots) > 48) {
        sendJson(false, 'A drive needs between 1 and 48 time slots.', null, 422);
    }
    $clean = [];
    $times = [];
    $ids = [];
    $total = 0;
    foreach ($slots as $slot) {
        if (!is_array($slot)) sendJson(false, 'Invalid slot row.', null, 422);
        $time = clockTime($slot['slot_time'] ?? '', 'Slot time');
        if ($time < $start || $time >= $end) sendJson(false, 'Slot times must be within drive hours, before closing.', null, 422);
        if (in_array($time, $times, true)) sendJson(false, 'Slot times must be unique.', null, 422);
        $capacity = validateIntRange($slot['capacity'] ?? null, 1, 200, 'Slot capacity');
        $id = (int)($slot['slot_id'] ?? 0);
        if ($id && in_array($id, $ids, true)) sendJson(false, 'A slot was submitted twice.', null, 422);

        $times[] = $time;
        $ids[] = $id;
        $total += $capacity;
        $clean[] = ['slot_id' => $id, 'slot_time' => $time, 'capacity' => $capacity];
    }
    if ($total > MAX_DRIVE_CAPACITY) sendJson(false, 'Total capacity cannot exceed ' . MAX_DRIVE_CAPACITY . '.', null, 422);
    return $clean;
}

// Evenly spread $total donors over 30-minute slots between $start and $end.
function generateSlots(string $start, string $end, int $total): array {
    $times = [];
    for ($t = strtotime($start); $t < strtotime($end); $t += 1800) {
        $times[] = date('H:i:s', $t);
    }
    $count = min(count($times), $total);
    $slots = [];
    for ($i = 0; $i < $count; $i++) {
        $slots[] = ['slot_time' => $times[$i], 'capacity' => intdiv($total, $count) + ($i < $total % $count ? 1 : 0)];
    }
    return $slots;
}

function requireOwnDrive(mysqli $conn, int $driveId, int $organizerId, bool $lock = false): array {
    $stmt = $conn->prepare(
        'SELECT * FROM drive WHERE drive_id = ? AND organizer_id = ?' . ($lock ? ' FOR UPDATE' : '')
    );
    $stmt->bind_param('ii', $driveId, $organizerId);
    $stmt->execute();
    $drive = $stmt->get_result()->fetch_assoc();
    $stmt->close();
    if (!$drive) {
        sendJson(false, 'Drive not found for this organizer.', null, 404);
    }
    return $drive;
}

/* ---------- GET ---------- */

if ($method === 'GET') {
    $lookup = $input['lookup'] ?? '';
    if ($lookup === 'blood_types') {
        $rows = $conn->query('SELECT blood_type_id, code FROM blood_type ORDER BY blood_type_id')->fetch_all(MYSQLI_ASSOC);
        sendJson(true, 'Blood types loaded.', ['blood_types' => $rows]);
    }
    if ($lookup === 'banks') {
        $rows = $conn->query('SELECT bank_id, name, address FROM blood_bank ORDER BY name')->fetch_all(MYSQLI_ASSOC);
        sendJson(true, 'Blood banks loaded.', ['banks' => $rows]);
    }

    $where = [];
    $types = '';
    $params = [];
    if ($organizerId !== null) {
        $where[] = 'd.organizer_id = ?';
        $types .= 'i';
        $params[] = $organizerId;
    } elseif ($bankId !== null) {
        $where[] = 'd.bank_id = ?';
        $types .= 'i';
        $params[] = $bankId;
    }

    $driveId = (int)($input['drive_id'] ?? 0);
    if ($driveId > 0) {
        $where[] = 'd.drive_id = ?';
        $types .= 'i';
        $params[] = $driveId;
    }
    if (!empty($input['status'])) {
        $where[] = 'd.status = ?';
        $types .= 's';
        $params[] = validateEnum((string)$input['status'], DRIVE_STATUSES, 'status');
    }
    if (!empty($input['category'])) {
        $where[] = 'd.category = ?';
        $types .= 's';
        $params[] = validateEnum((string)$input['category'], DRIVE_CATEGORIES, 'category');
    }
    $search = sanitizeString($input['search'] ?? '');
    if ($search !== '') {
        $where[] = '(d.title LIKE ? OR d.venue LIKE ? OR d.ref_code LIKE ?)';
        $like = "%{$search}%";
        $types .= 'sss';
        array_push($params, $like, $like, $like);
    }

    $stmt = $conn->prepare(
        "SELECT d.*, o.org_name, o.org_code, bb.name AS bank_name,
                (SELECT COUNT(*) FROM drive_registration dr
                 WHERE dr.drive_id = d.drive_id AND dr.status IN ('booked', 'checked_in', 'completed')) AS registered_count,
                (SELECT COUNT(*) FROM drive_registration dr
                 WHERE dr.drive_id = d.drive_id AND dr.status IN ('checked_in', 'completed')) AS checked_in_count
         FROM drive d
         JOIN organizer o ON o.organizer_id = d.organizer_id
         LEFT JOIN blood_bank bb ON bb.bank_id = d.bank_id"
        . ($where ? ' WHERE ' . implode(' AND ', $where) : '')
        . ' ORDER BY d.drive_date, d.start_time'
    );
    if ($types !== '') {
        $stmt->bind_param($types, ...$params);
    }
    $stmt->execute();
    $drives = $stmt->get_result()->fetch_all(MYSQLI_ASSOC);
    $stmt->close();

    foreach ($drives as &$drive) {
        $id = (int)$drive['drive_id'];
        $drive['registered_count'] = (int)$drive['registered_count'];
        $drive['checked_in_count'] = (int)$drive['checked_in_count'];
        $drive['slots_available'] = max(0, (int)$drive['slots_total'] - $drive['registered_count']);
        $drive['target_blood_types'] = driveBloodTypes($conn, $id);
        $drive['slots'] = driveSlots($conn, $id);
    }
    unset($drive);

    if ($driveId > 0) {
        if (!$drives) sendJson(false, 'Blood drive not found.', null, 404);
        sendJson(true, 'Drive retrieved.', $drives[0]);
    }
    sendJson(true, 'Drives loaded.', ['count' => count($drives), 'drives' => $drives]);
}

/* ---------- POST: create a drive ---------- */

if ($method === 'POST') {
    requireFields($input, ['title', 'venue', 'drive_date', 'start_time', 'end_time', 'slots_total']);

    $title = sanitizeString($input['title']);
    $venue = sanitizeString($input['venue']);
    if (mb_strlen($title) > 150 || mb_strlen($venue) > 255) {
        sendJson(false, 'Keep the title within 150 characters and the venue within 255.', null, 422);
    }
    $driveDate = validateDateString((string)$input['drive_date'], 'drive_date');
    $startTime = clockTime($input['start_time'], 'Start time');
    $endTime = clockTime($input['end_time'], 'End time');
    if ($endTime <= $startTime) {
        sendJson(false, 'End time must be after the start time.', null, 422);
    }
    if (strtotime("{$driveDate} {$startTime}") <= time()) {
        sendJson(false, 'Choose a future drive date and time.', null, 422);
    }
    $slotsTotal = validateIntRange($input['slots_total'], 1, MAX_DRIVE_CAPACITY, 'slots_total');
    $category = validateEnum((string)($input['category'] ?? 'community'), DRIVE_CATEGORIES, 'category');
    $latitude = optionalCoordinate($input, 'latitude', 90);
    $longitude = optionalCoordinate($input, 'longitude', 180);
    if (($latitude === null) !== ($longitude === null)) {
        sendJson(false, 'Send both latitude and longitude, or neither.', null, 422);
    }
    $partnerBankId = partnerBankId($conn, $input);
    $refCode = 'DRV-' . strtoupper(bin2hex(random_bytes(6)));

    $bloodTypeIds = array_values(array_unique(array_map('intval', (array)($input['blood_type_ids'] ?? []))));
    if (!$bloodTypeIds || min($bloodTypeIds) < 1 || max($bloodTypeIds) > 8) {
        sendJson(false, 'Select at least one target blood type.', null, 422);
    }

    $slots = validateDriveSlots($input['slots'] ?? generateSlots($startTime, $endTime, $slotsTotal), $startTime, $endTime);
    if (array_sum(array_column($slots, 'capacity')) !== $slotsTotal) {
        sendJson(false, 'Slot capacities must add up to the drive total.', null, 422);
    }

    $conn->begin_transaction();
    try {
        $stmt = $conn->prepare(
            'INSERT INTO drive (organizer_id, bank_id, ref_code, title, venue, latitude, longitude,
                                drive_date, start_time, end_time, slots_total, category)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)'
        );
        $stmt->bind_param('iisssddsssis', $organizerId, $partnerBankId, $refCode, $title, $venue,
            $latitude, $longitude, $driveDate, $startTime, $endTime, $slotsTotal, $category);
        $stmt->execute();
        $driveId = (int)$stmt->insert_id;
        $stmt->close();

        $stmt = $conn->prepare('INSERT INTO drive_blood_type (drive_id, blood_type_id) VALUES (?, ?)');
        foreach ($bloodTypeIds as $bloodTypeId) {
            $stmt->bind_param('ii', $driveId, $bloodTypeId);
            $stmt->execute();
        }
        $stmt->close();

        $stmt = $conn->prepare('INSERT INTO drive_slot (drive_id, slot_time, capacity) VALUES (?, ?, ?)');
        foreach ($slots as $slot) {
            $stmt->bind_param('isi', $driveId, $slot['slot_time'], $slot['capacity']);
            $stmt->execute();
        }
        $stmt->close();
        $conn->commit();
    } catch (mysqli_sql_exception $e) {
        $conn->rollback();
        throw $e;
    }

    sendJson(true, 'Blood drive created.', ['drive_id' => $driveId, 'ref_code' => $refCode, 'slots_created' => count($slots)], 201);
}

/* ---------- PUT: replace the slot list ---------- */

if ($method === 'PUT' && isset($input['slots'])) {
    $driveId = validateIntRange($input['drive_id'] ?? null, 1, PHP_INT_MAX, 'drive_id');

    $conn->begin_transaction();
    try {
        $drive = requireOwnDrive($conn, $driveId, $organizerId, true);
        if (!in_array($drive['status'], ['scheduled', 'ongoing'], true)) {
            sendJson(false, 'Only scheduled or ongoing drives can be edited.', null, 422);
        }
        $slots = validateDriveSlots($input['slots'], $drive['start_time'], $drive['end_time']);

        $existing = [];
        foreach (driveSlots($conn, $driveId) as $row) {
            $existing[$row['slot_id']] = $row;
        }

        $update = $conn->prepare('UPDATE drive_slot SET slot_time = ?, capacity = ? WHERE slot_id = ? AND drive_id = ?');
        $insert = $conn->prepare('INSERT INTO drive_slot (drive_id, slot_time, capacity) VALUES (?, ?, ?)');
        $kept = [];
        foreach ($slots as $slot) {
            $slotId = $slot['slot_id'];
            if ($slotId === 0) {
                $insert->bind_param('isi', $driveId, $slot['slot_time'], $slot['capacity']);
                $insert->execute();
                continue;
            }
            $old = $existing[$slotId] ?? null;
            if (!$old) {
                sendJson(false, 'One or more slots do not belong to this drive.', null, 422);
            }
            if ($slot['capacity'] < $old['booked_count']) {
                sendJson(false, 'A slot capacity cannot be lower than its booked donor count.', null, 422);
            }
            if ($old['booked_count'] > 0 && $slot['slot_time'] !== $old['slot_time']) {
                sendJson(false, 'The time of a booked slot cannot be changed.', null, 422);
            }
            $update->bind_param('siii', $slot['slot_time'], $slot['capacity'], $slotId, $driveId);
            $update->execute();
            $kept[] = $slotId;
        }
        $update->close();
        $insert->close();

        $delete = $conn->prepare('DELETE FROM drive_slot WHERE slot_id = ? AND drive_id = ?');
        foreach ($existing as $slotId => $old) {
            if (in_array($slotId, $kept, true)) continue;
            if ($old['booked_count'] > 0) {
                sendJson(false, 'Booked slots cannot be removed.', null, 422);
            }
            $delete->bind_param('ii', $slotId, $driveId);
            $delete->execute();
        }
        $delete->close();

        $total = array_sum(array_column($slots, 'capacity'));
        $stmt = $conn->prepare('UPDATE drive SET slots_total = ? WHERE drive_id = ?');
        $stmt->bind_param('ii', $total, $driveId);
        $stmt->execute();
        $stmt->close();
        $conn->commit();
    } catch (mysqli_sql_exception $e) {
        $conn->rollback();
        throw $e;
    }

    sendJson(true, 'Drive slots updated.', ['drive_id' => $driveId, 'slots_total' => $total]);
}

/* ---------- PUT: edit drive details ---------- */

if ($method === 'PUT') {
    $driveId = validateIntRange($input['drive_id'] ?? null, 1, PHP_INT_MAX, 'drive_id');
    $drive = requireOwnDrive($conn, $driveId, $organizerId);

    $title = ($input['title'] ?? '') !== '' ? sanitizeString($input['title']) : $drive['title'];
    $venue = ($input['venue'] ?? '') !== '' ? sanitizeString($input['venue']) : $drive['venue'];
    $driveDate = ($input['drive_date'] ?? '') !== '' ? validateDateString((string)$input['drive_date'], 'drive_date') : $drive['drive_date'];
    $startTime = ($input['start_time'] ?? '') !== '' ? clockTime($input['start_time'], 'Start time') : $drive['start_time'];
    $endTime = ($input['end_time'] ?? '') !== '' ? clockTime($input['end_time'], 'End time') : $drive['end_time'];
    $status = ($input['status'] ?? '') !== '' ? validateEnum((string)$input['status'], DRIVE_STATUSES, 'status') : $drive['status'];
    $category = ($input['category'] ?? '') !== '' ? validateEnum((string)$input['category'], DRIVE_CATEGORIES, 'category') : $drive['category'];
    $latitude = array_key_exists('latitude', $input) ? optionalCoordinate($input, 'latitude', 90) : $drive['latitude'];
    $longitude = array_key_exists('longitude', $input) ? optionalCoordinate($input, 'longitude', 180) : $drive['longitude'];
    $partnerBankId = array_key_exists('bank_id', $input) ? partnerBankId($conn, $input) : $drive['bank_id'];

    if ($endTime <= $startTime) {
        sendJson(false, 'End time must be after the start time.', null, 422);
    }
    $slotTimes = array_column(driveSlots($conn, $driveId), 'slot_time');
    if ($slotTimes && (min($slotTimes) < $startTime || max($slotTimes) >= $endTime)) {
        sendJson(false, 'Existing time slots fall outside the new drive hours. Adjust the slots first.', null, 422);
    }

    $stmt = $conn->prepare(
        'UPDATE drive SET title = ?, venue = ?, drive_date = ?, start_time = ?, end_time = ?, status = ?,
                          category = ?, latitude = ?, longitude = ?, bank_id = ?
         WHERE drive_id = ?'
    );
    $stmt->bind_param('sssssssddii', $title, $venue, $driveDate, $startTime, $endTime, $status,
        $category, $latitude, $longitude, $partnerBankId, $driveId);
    $stmt->execute();
    $stmt->close();

    sendJson(true, 'Drive updated.', ['drive_id' => $driveId]);
}

/* ---------- DELETE: cancel (registrations and history stay) ---------- */

if ($method === 'DELETE') {
    $driveId = validateIntRange($input['drive_id'] ?? null, 1, PHP_INT_MAX, 'drive_id');
    requireOwnDrive($conn, $driveId, $organizerId);

    $stmt = $conn->prepare("UPDATE drive SET status = 'cancelled' WHERE drive_id = ?");
    $stmt->bind_param('i', $driveId);
    $stmt->execute();
    $stmt->close();

    sendJson(true, 'Drive cancelled.', ['drive_id' => $driveId]);
}

sendJson(false, 'Method not allowed.', null, 405);
