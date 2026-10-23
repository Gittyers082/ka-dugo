<?php
// this is drives.php - handles blood drive creation, retrieval, updating, and cancellation
declare(strict_types=1);
require_once __DIR__ . '/validation.php';

$conn = getDbConnection();
$input = getRequestData();
$method = getRequestMethod($input);

if ($method === 'GET') {
    $driveId = isset($input['drive_id']) ? (int)$input['drive_id'] : 0;
    $refCode = sanitizeString($input['ref_code'] ?? '');

    if ($driveId > 0 || $refCode !== '') {
        $sql = "SELECT d.*, o.org_name, o.org_code, o.contact_person, o.contact_no AS organizer_contact,
                       bb.name AS bank_name, bb.address AS bank_address
                FROM drive d
                JOIN organizer o ON d.organizer_id = o.organizer_id
                LEFT JOIN blood_bank bb ON d.bank_id = bb.bank_id
                WHERE " . ($driveId > 0 ? "d.drive_id = ?" : "d.ref_code = ?");
        $stmt = $conn->prepare($sql);
        $driveId > 0 ? $stmt->bind_param('i', $driveId) : $stmt->bind_param('s', $refCode);
        $stmt->execute();
        $drive = $stmt->get_result()->fetch_assoc();
        $stmt->close();

        if (!$drive) {
            sendJson(false, 'Blood drive not found.', null, 404);
        }

        // Load time slots with booked registration counts
        $stmtSlots = $conn->prepare(
            "SELECT ds.slot_id, ds.drive_id, ds.slot_time, ds.capacity,
                    COUNT(CASE WHEN dr.status IN ('booked', 'checked_in', 'completed') THEN 1 END) AS booked_count
             FROM drive_slot ds
             LEFT JOIN drive_registration dr ON ds.slot_id = dr.slot_id
             WHERE ds.drive_id = ?
             GROUP BY ds.slot_id, ds.drive_id, ds.slot_time, ds.capacity
             ORDER BY ds.slot_time ASC"
        );
        $stmtSlots->bind_param('i', $drive['drive_id']);
        $stmtSlots->execute();
        $slots = $stmtSlots->get_result()->fetch_all(MYSQLI_ASSOC);
        $stmtSlots->close();

        foreach ($slots as &$slot) {
            $slot['booked_count'] = (int)$slot['booked_count'];
            $slot['capacity'] = (int)$slot['capacity'];
            $slot['available_slots'] = max(0, $slot['capacity'] - $slot['booked_count']);
        }
        unset($slot);

        // Load targeted blood types
        $stmtBt = $conn->prepare(
            "SELECT bt.blood_type_id, bt.code
             FROM drive_blood_type dbt
             JOIN blood_type bt ON dbt.blood_type_id = bt.blood_type_id
             WHERE dbt.drive_id = ?
             ORDER BY bt.blood_type_id ASC"
        );
        $stmtBt->bind_param('i', $drive['drive_id']);
        $stmtBt->execute();
        $bloodTypes = $stmtBt->get_result()->fetch_all(MYSQLI_ASSOC);
        $stmtBt->close();

        $drive['slots'] = $slots;
        $drive['target_blood_types'] = $bloodTypes;

        sendJson(true, 'Drive retrieved.', $drive);
    }

    // List & Filter drives
    $status = sanitizeString($input['status'] ?? '');
    $category = sanitizeString($input['category'] ?? '');
    $organizerId = isset($input['organizer_id']) ? (int)$input['organizer_id'] : 0;
    $search = sanitizeString($input['search'] ?? '');

    $sql = "SELECT d.*, o.org_name, o.org_code, bb.name AS bank_name,
                   (SELECT COUNT(*) FROM drive_registration dr
                    WHERE dr.drive_id = d.drive_id AND dr.status IN ('booked', 'checked_in', 'completed')) AS registered_count,
                   (SELECT COUNT(*) FROM drive_registration dr
                    WHERE dr.drive_id = d.drive_id AND dr.status IN ('checked_in', 'completed')) AS checked_in_count
            FROM drive d
            JOIN organizer o ON d.organizer_id = o.organizer_id
            LEFT JOIN blood_bank bb ON d.bank_id = bb.bank_id
            WHERE 1=1";
    $params = [];
    $types = "";

    if ($status !== '') {
        validateEnum($status, ['scheduled', 'ongoing', 'completed', 'cancelled'], 'status');
        $sql .= " AND d.status = ?";
        $types .= "s";
        $params[] = $status;
    }

    if ($category !== '') {
        validateEnum($category, ['community', 'corporate', 'university'], 'category');
        $sql .= " AND d.category = ?";
        $types .= "s";
        $params[] = $category;
    }

    if ($organizerId > 0) {
        $sql .= " AND d.organizer_id = ?";
        $types .= "i";
        $params[] = $organizerId;
    }

    if ($search !== '') {
        $sql .= " AND (d.title LIKE ? OR d.venue LIKE ? OR d.ref_code LIKE ?)";
        $types .= "sss";
        $like = "%{$search}%";
        array_push($params, $like, $like, $like);
    }

    $sql .= " ORDER BY d.drive_date ASC, d.start_time ASC";
    $stmt = $conn->prepare($sql);
    if ($types !== '') {
        $stmt->bind_param($types, ...$params);
    }
    $stmt->execute();
    $drives = $stmt->get_result()->fetch_all(MYSQLI_ASSOC);
    $stmt->close();

    // Attach target blood types and slots summary for each drive
    foreach ($drives as &$drv) {
        $drvId = (int)$drv['drive_id'];
        $drv['registered_count'] = (int)$drv['registered_count'];
        $drv['checked_in_count'] = (int)$drv['checked_in_count'];
        $drv['slots_available'] = max(0, (int)$drv['slots_total'] - $drv['registered_count']);

        $stmtBt = $conn->prepare(
            "SELECT bt.blood_type_id, bt.code
             FROM drive_blood_type dbt
             JOIN blood_type bt ON dbt.blood_type_id = bt.blood_type_id
             WHERE dbt.drive_id = ?
             ORDER BY bt.blood_type_id ASC"
        );
        $stmtBt->bind_param('i', $drvId);
        $stmtBt->execute();
        $drv['target_blood_types'] = $stmtBt->get_result()->fetch_all(MYSQLI_ASSOC);
        $stmtBt->close();

        $stmtSlots = $conn->prepare(
            "SELECT ds.slot_id, ds.slot_time, ds.capacity,
                    COUNT(CASE WHEN dr.status IN ('booked', 'checked_in', 'completed') THEN 1 END) AS booked_count
             FROM drive_slot ds
             LEFT JOIN drive_registration dr ON ds.slot_id = dr.slot_id
             WHERE ds.drive_id = ?
             GROUP BY ds.slot_id, ds.slot_time, ds.capacity
             ORDER BY ds.slot_time ASC"
        );
        $stmtSlots->bind_param('i', $drvId);
        $stmtSlots->execute();
        $drv['slots'] = $stmtSlots->get_result()->fetch_all(MYSQLI_ASSOC);
        $stmtSlots->close();
    }
    unset($drv);

    sendJson(true, 'Drives loaded.', ['count' => count($drives), 'drives' => $drives]);

} elseif ($method === 'POST') {
    requireFields($input, ['organizer_id', 'title', 'venue', 'drive_date', 'start_time', 'end_time', 'slots_total']);

    $organizerId = (int)$input['organizer_id'];
    $bankId = !empty($input['bank_id']) ? (int)$input['bank_id'] : null;
    $title = sanitizeString($input['title']);
    $venue = sanitizeString($input['venue']);
    $driveDate = validateDateString((string)$input['drive_date'], 'drive_date');
    $startTime = sanitizeString($input['start_time']);
    $endTime = sanitizeString($input['end_time']);
    $slotsTotal = validateIntRange($input['slots_total'], 1, 2000, 'slots_total');
    $category = validateEnum($input['category'] ?? 'community', ['community', 'corporate', 'university'], 'category');
    $status = validateEnum($input['status'] ?? 'scheduled', ['scheduled', 'ongoing', 'completed', 'cancelled'], 'status');
    $refCode = !empty($input['ref_code'])
        ? sanitizeString($input['ref_code'])
        : 'DRV-' . date('Y') . '-' . strtoupper(substr(uniqid(), -4));

    $conn->begin_transaction();
    try {
        $stmt = $conn->prepare(
            "INSERT INTO drive (organizer_id, bank_id, ref_code, title, venue, drive_date, start_time, end_time, slots_total, category, status)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)"
        );
        $stmt->bind_param(
            'iissssssiss',
            $organizerId, $bankId, $refCode, $title, $venue,
            $driveDate, $startTime, $endTime, $slotsTotal, $category, $status
        );

        if (!$stmt->execute()) {
            throw new Exception('Failed to create drive: ' . $stmt->error);
        }
        $newDriveId = (int)$stmt->insert_id;
        $stmt->close();

        // Insert target blood types (defaults to all if none provided, or specific array of blood_type_id)
        $bloodTypeIds = $input['blood_type_ids'] ?? [1, 3, 7, 8];
        if (is_string($bloodTypeIds)) {
            $bloodTypeIds = array_filter(array_map('intval', explode(',', $bloodTypeIds)));
        }
        if (is_array($bloodTypeIds) && count($bloodTypeIds) > 0) {
            $stmtBt = $conn->prepare("INSERT IGNORE INTO drive_blood_type (drive_id, blood_type_id) VALUES (?, ?)");
            foreach ($bloodTypeIds as $btId) {
                $btIdInt = (int)$btId;
                if ($btIdInt >= 1 && $btIdInt <= 8) {
                    $stmtBt->bind_param('ii', $newDriveId, $btIdInt);
                    $stmtBt->execute();
                }
            }
            $stmtBt->close();
        }

        // Insert time slots: either explicit `slots` array or auto-generated 30-min intervals
        $slotsCreated = 0;
        $stmtSlot = $conn->prepare("INSERT INTO drive_slot (drive_id, slot_time, capacity) VALUES (?, ?, ?)");
        if (!empty($input['slots']) && is_array($input['slots'])) {
            foreach ($input['slots'] as $slotItem) {
                $slotTime = sanitizeString($slotItem['slot_time'] ?? '');
                $capacity = isset($slotItem['capacity']) ? (int)$slotItem['capacity'] : 4;
                if ($slotTime !== '' && $capacity > 0) {
                    $stmtSlot->bind_param('isi', $newDriveId, $slotTime, $capacity);
                    $stmtSlot->execute();
                    $slotsCreated++;
                }
            }
        } else {
            // Auto-generate 30-minute time slots between start_time and end_time (up to 8 initial slots or full window)
            $startTs = strtotime($startTime);
            $endTs = strtotime($endTime);
            $intervalSec = 1800; // 30 minutes
            if ($startTs !== false && $endTs !== false && $endTs > $startTs) {
                $numIntervals = max(1, (int)floor(($endTs - $startTs) / $intervalSec));
                $perSlotCap = max(1, (int)ceil($slotsTotal / $numIntervals));
                for ($t = $startTs; $t < $endTs; $t += $intervalSec) {
                    $slotTimeStr = date('H:i:s', $t);
                    $stmtSlot->bind_param('isi', $newDriveId, $slotTimeStr, $perSlotCap);
                    $stmtSlot->execute();
                    $slotsCreated++;
                }
            }
        }
        $stmtSlot->close();

        $conn->commit();
        sendJson(true, 'Blood drive created.', [
            'drive_id' => $newDriveId,
            'ref_code' => $refCode,
            'slots_created' => $slotsCreated
        ], 201);
    } catch (Exception $e) {
        $conn->rollback();
        sendJson(false, $e->getMessage(), null, 400);
    }

} elseif ($method === 'PUT') {
    requireFields($input, ['drive_id']);
    $driveId = (int)$input['drive_id'];

    $fields = [];
    $params = [];
    $types = "";

    if (isset($input['status']) && $input['status'] !== '') {
        $status = validateEnum((string)$input['status'], ['scheduled', 'ongoing', 'completed', 'cancelled'], 'status');
        $fields[] = "status = ?";
        $types .= "s";
        $params[] = $status;
    }

    if (isset($input['title']) && trim((string)$input['title']) !== '') {
        $fields[] = "title = ?";
        $types .= "s";
        $params[] = sanitizeString($input['title']);
    }

    if (isset($input['venue']) && trim((string)$input['venue']) !== '') {
        $fields[] = "venue = ?";
        $types .= "s";
        $params[] = sanitizeString($input['venue']);
    }

    if (isset($input['drive_date']) && trim((string)$input['drive_date']) !== '') {
        $fields[] = "drive_date = ?";
        $types .= "s";
        $params[] = validateDateString((string)$input['drive_date'], 'drive_date');
    }

    if (isset($input['start_time']) && trim((string)$input['start_time']) !== '') {
        $fields[] = "start_time = ?";
        $types .= "s";
        $params[] = sanitizeString($input['start_time']);
    }

    if (isset($input['end_time']) && trim((string)$input['end_time']) !== '') {
        $fields[] = "end_time = ?";
        $types .= "s";
        $params[] = sanitizeString($input['end_time']);
    }

    if (isset($input['slots_total']) && $input['slots_total'] !== '') {
        $fields[] = "slots_total = ?";
        $types .= "i";
        $params[] = validateIntRange($input['slots_total'], 1, 2000, 'slots_total');
    }

    if (isset($input['category']) && $input['category'] !== '') {
        $fields[] = "category = ?";
        $types .= "s";
        $params[] = validateEnum((string)$input['category'], ['community', 'corporate', 'university'], 'category');
    }

    if (empty($fields)) {
        sendJson(false, 'No valid fields provided for update.', null, 422);
    }
    $types .= "i";
    $params[] = $driveId;

    $sql = "UPDATE drive SET " . implode(', ', $fields) . " WHERE drive_id = ?";
    $stmt = $conn->prepare($sql);
    $stmt->bind_param($types, ...$params);

    if ($stmt->execute()) {
        sendJson(true, 'Drive updated.', ['drive_id' => $driveId, 'affected_rows' => $stmt->affected_rows]);
    }
    sendJson(false, 'Failed to update drive: ' . $stmt->error, null, 400);

} elseif ($method === 'DELETE') {
    requireFields($input, ['drive_id']);
    $driveId = (int)$input['drive_id'];

    $stmt = $conn->prepare("UPDATE drive SET status = 'cancelled' WHERE drive_id = ?");
    $stmt->bind_param('i', $driveId);
    if ($stmt->execute()) {
        sendJson(true, 'Drive cancelled.', ['drive_id' => $driveId]);
    }
    sendJson(false, 'Failed to cancel drive.', null, 400);
} else {
    sendJson(false, 'Method not allowed.', null, 405);
}