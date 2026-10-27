<?php
// this is drives.php - handles blood drive creation, retrieval, updating, and cancellation
declare(strict_types=1);
require_once __DIR__ . '/validation.php';


function validateDriveSlots(mixed $slots,string $start,string $end): array {
    if(!is_array($slots) || !$slots || count($slots)>48) throw new InvalidArgumentException('Use 1–48 slots.');
    $times=[]; $ids=[]; $total=0;
    if(strlen($start)===5) $start.=':00'; if(strlen($end)===5) $end.=':00';
    foreach($slots as &$slot) {
        if(!is_array($slot)) throw new InvalidArgumentException('Invalid slot row.');
        $time=trim((string)($slot['slot_time'] ?? ''));
        if(!preg_match('/^(?:[01]\d|2[0-3]):[0-5]\d(?::[0-5]\d)?$/',$time)) throw new InvalidArgumentException('Enter a valid slot time.');
        if(strlen($time)===5) $time.=':00';
        if($time<$start || $time>=$end) throw new InvalidArgumentException('Slot times must be within drive hours, before closing.');
        if(in_array($time,$times,true)) throw new InvalidArgumentException('Slot times must be unique.');
        $cap=filter_var($slot['capacity'] ?? null,FILTER_VALIDATE_INT);
        if($cap===false || $cap<1 || $cap>200) throw new InvalidArgumentException('Slot capacity must be 1–200 whole donors.');
        $id=(int)($slot['slot_id'] ?? 0);
        if($id && in_array($id,$ids,true)) throw new InvalidArgumentException('A slot was submitted twice.');
        $times[]=$time; $ids[]=$id; $total+=$cap;
        $slot=['slot_id'=>$id,'slot_time'=>$time,'capacity'=>$cap];
    }
    if($total>2000) throw new InvalidArgumentException('Total capacity cannot exceed 2000.');
    return $slots;
}

$conn = getDbConnection();
$input = getRequestData();
$method = getRequestMethod($input);
$sessionOrganizer=signedInOrganizer(false);
if($sessionOrganizer) $input['organizer_id']=$sessionOrganizer;
if($method !== 'GET') {
    $input['organizer_id']=signedInOrganizer();
    if($method !== 'POST') {
        $ownId=(int)($input['drive_id'] ?? 0);
        $own=$conn->prepare('SELECT drive_id FROM drive WHERE drive_id=? AND organizer_id=?');
        $own->bind_param('ii',$ownId,$input['organizer_id']); $own->execute();
        if(!$own->get_result()->fetch_assoc()) sendJson(false,'Drive not found for this organizer.',null,404);
    }
}
header('Cache-Control: no-store');

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

        if (!$drive || ($sessionOrganizer && (int)$drive['organizer_id'] !== $sessionOrganizer)) {
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
        : 'DRV-' . strtoupper(bin2hex(random_bytes(6)));

    if (!preg_match('/^(?:[01]\d|2[0-3]):[0-5]\d(?::[0-5]\d)?$/',$startTime) || !preg_match('/^(?:[01]\d|2[0-3]):[0-5]\d(?::[0-5]\d)?$/',$endTime) || strtotime($endTime)<=strtotime($startTime)) sendJson(false,'End time must be after a valid start time.',null,422);
    if(strtotime("$driveDate $startTime")<=time()) sendJson(false,'Choose a future drive date and time.',null,422);
    if(!$title || !$venue || mb_strlen($title)>150 || mb_strlen($venue)>255) sendJson(false,'Enter a title (up to 150 characters) and venue (up to 255).',null,422);
    $times=[];
    for($t=strtotime($startTime);$t<strtotime($endTime);$t+=1800) $times[]=date('H:i:s',$t);
    $count=min(count($times),$slotsTotal); $generated=[];
    for($i=0;$i<$count;$i++) $generated[]=['slot_time'=>$times[$i],'capacity'=>intdiv($slotsTotal,$count)+($i<$slotsTotal%$count?1:0)];
    try { $input['slots']=validateDriveSlots($input['slots'] ?? $generated,$startTime,$endTime); }
    catch(Throwable $e) { sendJson(false,$e->getMessage(),null,422); }
    if(array_sum(array_column($input['slots'],'capacity'))!==$slotsTotal) sendJson(false,'Slot capacities must equal the drive total.',null,422);
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
    } catch (Throwable $e) {
        $conn->rollback();
        sendJson(false, $e->getMessage(), null, 400);
    }

} elseif ($method === 'PUT') {
    requireFields($input, ['drive_id']);
    $driveId = (int)$input['drive_id'];

    // Organizer slot manager: update existing slots, add new ones, and remove only unbooked slots.
    if (isset($input['slots']) && is_array($input['slots'])) {
        if (count($input['slots']) === 0 || count($input['slots']) > 48) {
            sendJson(false, 'A drive must have between 1 and 48 time slots.', null, 422);
        }

        $conn->begin_transaction();
        try {
            $lock=$conn->prepare('SELECT start_time,end_time,status FROM drive WHERE drive_id=? FOR UPDATE');
            $lock->bind_param('i',$driveId); $lock->execute(); $drive=$lock->get_result()->fetch_assoc();
            if(!in_array($drive['status'],['scheduled','ongoing'],true)) throw new Exception('Only scheduled or ongoing drives can be edited.');
            $input['slots']=validateDriveSlots($input['slots'],$drive['start_time'],$drive['end_time']);
            $lock=$conn->prepare('SELECT slot_id FROM drive_slot WHERE drive_id=? FOR UPDATE');
            $lock->bind_param('i',$driveId); $lock->execute(); $lock->get_result()->fetch_all();
            $existingStmt = $conn->prepare(
                "SELECT ds.slot_id, ds.slot_time,
                        COUNT(CASE WHEN dr.status IN ('booked', 'checked_in', 'completed') THEN 1 END) AS booked_count
                 FROM drive_slot ds
                 LEFT JOIN drive_registration dr ON dr.slot_id = ds.slot_id
                 WHERE ds.drive_id = ?
                 GROUP BY ds.slot_id, ds.slot_time"
            );
            $existingStmt->bind_param('i', $driveId);
            $existingStmt->execute();
            $existingRows = $existingStmt->get_result()->fetch_all(MYSQLI_ASSOC);
            $existingStmt->close();
            $existing = []; $oldTimes=[];
            foreach ($existingRows as $row) {
                $existing[(int)$row['slot_id']] = (int)$row['booked_count'];
                $oldTimes[(int)$row['slot_id']]=$row['slot_time'];
            }

            $updateSlot = $conn->prepare('UPDATE drive_slot SET slot_time = ?, capacity = ? WHERE slot_id = ? AND drive_id = ?');
            $insertSlot = $conn->prepare('INSERT INTO drive_slot (drive_id, slot_time, capacity) VALUES (?, ?, ?)');
            $seenIds = [];
            $totalCapacity = 0;

            foreach ($input['slots'] as $slot) {
                $slotTime = sanitizeString($slot['slot_time'] ?? '');
                if (!preg_match('/^(?:[01]\\d|2[0-3]):[0-5]\\d(?::[0-5]\\d)?$/', $slotTime)) {
                    throw new Exception('Each slot time must use HH:MM or HH:MM:SS format.');
                }
                if (strlen($slotTime) === 5) {
                    $slotTime .= ':00';
                }
                $capacity = validateIntRange($slot['capacity'] ?? null, 1, 200, 'slot capacity');
                $slotId = isset($slot['slot_id']) ? (int)$slot['slot_id'] : 0;
                $totalCapacity += $capacity;

                if ($slotId > 0) {
                    if (!array_key_exists($slotId, $existing) || in_array($slotId, $seenIds, true)) {
                        throw new Exception('One or more slot records do not belong to this drive.');
                    }
                    if ($capacity < $existing[$slotId]) {
                        throw new Exception('A slot capacity cannot be lower than its current booked donor count.');
                    }
                    if ($existing[$slotId]>0 && $slotTime!==$oldTimes[$slotId]) throw new Exception('The time of a booked slot cannot be changed.');
                    $updateSlot->bind_param('siii', $slotTime, $capacity, $slotId, $driveId);
                    if (!$updateSlot->execute()) {
                        throw new Exception('Unable to update a drive slot.');
                    }
                    $seenIds[] = $slotId;
                } else {
                    $insertSlot->bind_param('isi', $driveId, $slotTime, $capacity);
                    if (!$insertSlot->execute()) {
                        throw new Exception('Unable to add a drive slot.');
                    }
                }
            }
            if ($totalCapacity > 2000) {
                throw new Exception('The total drive capacity cannot exceed 2000 donors.');
            }
            $updateSlot->close();
            $insertSlot->close();

            $deleteSlot = $conn->prepare('DELETE FROM drive_slot WHERE slot_id = ? AND drive_id = ?');
            foreach ($existing as $slotId => $bookedCount) {
                if (!in_array($slotId, $seenIds, true)) {
                    if ($bookedCount > 0) {
                        throw new Exception('Booked slots cannot be removed.');
                    }
                    $deleteSlot->bind_param('ii', $slotId, $driveId);
                    if (!$deleteSlot->execute()) {
                        throw new Exception('Unable to remove a drive slot.');
                    }
                }
            }
            $deleteSlot->close();

            $driveUpdate = $conn->prepare('UPDATE drive SET slots_total = ? WHERE drive_id = ?');
            $driveUpdate->bind_param('ii', $totalCapacity, $driveId);
            if (!$driveUpdate->execute()) {
                throw new Exception('Unable to update the drive capacity.');
            }
            $driveUpdate->close();
            $conn->commit();
            sendJson(true, 'Drive slots updated.', ['drive_id' => $driveId, 'slots_total' => $totalCapacity]);
        } catch (Throwable $e) {
            $conn->rollback();
            sendJson(false, $e->getMessage(), null, 422);
        }
    }

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
