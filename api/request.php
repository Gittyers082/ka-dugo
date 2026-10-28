<?php
// this is request.php - handles incoming HTTP requests for blood drive management
declare(strict_types=1);
require_once __DIR__ . '/validation.php';

$conn = getDbConnection();
$input = getRequestData();
$method = getRequestMethod($input);
requireRole($method === 'GET' ? ['bank', 'phlebotomist', 'admin', 'organizer'] : ['bank', 'admin']);

// Bank staff only see and manage their own bank's requests; the session decides, not the browser.
$sessionBankId = signedInBankId();
if ($sessionBankId !== null) {
    $input['bank_id'] = $sessionBankId;
    if ($method === 'PUT' || $method === 'DELETE') {
        $ownRequestId = (int)($input['request_id'] ?? 0);
        $own = $conn->prepare('SELECT 1 FROM blood_request WHERE request_id = ? AND bank_id = ?');
        $own->bind_param('ii', $ownRequestId, $sessionBankId);
        $own->execute();
        if (!$own->get_result()->fetch_assoc()) sendJson(false, 'Blood request not found for this bank.', null, 404);
    }
} elseif ($method === 'POST' && empty($input['bank_id'])) {
    // shortcut: admin has no linked bank, so default to the first one; add a bank picker when there are several banks
    $input['bank_id'] = (int)($conn->query('SELECT MIN(bank_id) AS id FROM blood_bank')->fetch_assoc()['id'] ?? 0);
}

if ($method === 'GET') {
    $requestId = isset($input['request_id']) ? (int)$input['request_id'] : 0;

    if ($requestId > 0) {
        $sql = "SELECT br.*,
                       bb.name AS bank_name, bb.address AS bank_address, bb.contact_no AS bank_contact,
                       bt.code AS blood_type_code,
                       bc.name AS component_name,
                       (SELECT COALESCE(SUM(d.units), 0)
                        FROM donation d
                        WHERE d.request_id = br.request_id AND d.status != 'discarded') AS units_collected
                FROM blood_request br
                JOIN blood_bank bb ON br.bank_id = bb.bank_id
                JOIN blood_type bt ON br.blood_type_id = bt.blood_type_id
                JOIN blood_component bc ON br.component_id = bc.component_id
                WHERE br.request_id = ?";
        $stmt = $conn->prepare($sql);
        $stmt->bind_param('i', $requestId);
        $stmt->execute();
        $req = $stmt->get_result()->fetch_assoc();
        $stmt->close();

        if (!$req) {
            sendJson(false, 'Blood request not found.', null, 404);
        }

        $req['units_needed'] = (int)$req['units_needed'];
        $req['units_collected'] = (float)$req['units_collected'];
        $req['units_remaining'] = max(0.0, $req['units_needed'] - $req['units_collected']);

        // Load any alerts linked to this hospital request
        $stmtAlerts = $conn->prepare(
            "SELECT a.alert_id, a.sender_type, a.level, a.message, a.status, a.sent_at,
                    (SELECT COUNT(*) FROM alert_recipient ar WHERE ar.alert_id = a.alert_id) AS recipients_count,
                    (SELECT COUNT(*) FROM alert_recipient ar WHERE ar.alert_id = a.alert_id AND ar.responded_at IS NOT NULL) AS responded_count
             FROM alert a
             WHERE a.request_id = ?
             ORDER BY a.alert_id DESC"
        );
        $stmtAlerts->bind_param('i', $requestId);
        $stmtAlerts->execute();
        $req['linked_alerts'] = $stmtAlerts->get_result()->fetch_all(MYSQLI_ASSOC);
        $stmtAlerts->close();

        sendJson(true, 'Blood request retrieved.', $req);
    }

    // List & Filter hospital blood requests
    $status = sanitizeString($input['status'] ?? '');
    $urgency = sanitizeString($input['urgency'] ?? '');
    $bankId = isset($input['bank_id']) ? (int)$input['bank_id'] : 0;
    $bloodTypeId = isset($input['blood_type_id']) ? (int)$input['blood_type_id'] : 0;
    $componentId = isset($input['component_id']) ? (int)$input['component_id'] : 0;
    $search = sanitizeString($input['search'] ?? '');

    $sql = "SELECT br.*,
                   bb.name AS bank_name, bb.contact_no AS bank_contact,
                   bt.code AS blood_type_code,
                   bc.name AS component_name,
                   (SELECT COALESCE(SUM(d.units), 0)
                    FROM donation d
                    WHERE d.request_id = br.request_id AND d.status != 'discarded') AS units_collected,
                   (SELECT COUNT(*)
                    FROM alert a
                    WHERE a.request_id = br.request_id AND a.status = 'active') AS active_alerts_count
            FROM blood_request br
            JOIN blood_bank bb ON br.bank_id = bb.bank_id
            JOIN blood_type bt ON br.blood_type_id = bt.blood_type_id
            JOIN blood_component bc ON br.component_id = bc.component_id
            WHERE 1=1";
    $params = [];
    $types = "";

    if ($status !== '') {
        validateEnum($status, ['open', 'fulfilled', 'cancelled'], 'status');
        $sql .= " AND br.status = ?";
        $types .= "s";
        $params[] = $status;
    }

    if ($urgency !== '') {
        validateEnum($urgency, ['normal', 'high', 'critical'], 'urgency');
        $sql .= " AND br.urgency = ?";
        $types .= "s";
        $params[] = $urgency;
    }

    if ($bankId > 0) {
        $sql .= " AND br.bank_id = ?";
        $types .= "i";
        $params[] = $bankId;
    }

    if ($bloodTypeId > 0) {
        $sql .= " AND br.blood_type_id = ?";
        $types .= "i";
        $params[] = $bloodTypeId;
    }

    if ($componentId > 0) {
        $sql .= " AND br.component_id = ?";
        $types .= "i";
        $params[] = $componentId;
    }

    if ($search !== '') {
        $sql .= " AND (br.ward LIKE ? OR bb.name LIKE ?)";
        $types .= "ss";
        $like = "%{$search}%";
        array_push($params, $like, $like);
    }

    $sql .= " ORDER BY FIELD(br.status, 'open', 'fulfilled', 'cancelled'),
                       FIELD(br.urgency, 'critical', 'high', 'normal'),
                       br.needed_by ASC";

    $stmt = $conn->prepare($sql);
    if ($types !== '') {
        $stmt->bind_param($types, ...$params);
    }
    $stmt->execute();
    $requests = $stmt->get_result()->fetch_all(MYSQLI_ASSOC);
    $stmt->close();

    foreach ($requests as &$r) {
        $r['units_needed'] = (int)$r['units_needed'];
        $r['units_collected'] = (float)$r['units_collected'];
        $r['units_remaining'] = max(0.0, $r['units_needed'] - $r['units_collected']);
        $r['active_alerts_count'] = (int)$r['active_alerts_count'];
    }
    unset($r);

    sendJson(true, 'Blood requests loaded.', [
        'count' => count($requests),
        'requests' => $requests
    ]);

} elseif ($method === 'POST') {
    requireFields($input, ['bank_id', 'blood_type_id', 'component_id', 'ward', 'units_needed', 'needed_by']);

    $bankId = (int)$input['bank_id'];
    $bloodTypeId = validateIntRange($input['blood_type_id'], 1, 8, 'blood_type_id');
    $componentId = validateIntRange($input['component_id'], 1, 4, 'component_id');
    $ward = sanitizeString($input['ward']);
    $unitsNeeded = validateIntRange($input['units_needed'], 1, 500, 'units_needed');
    $urgency = validateEnum(sanitizeString($input['urgency'] ?? 'normal'), ['normal', 'high', 'critical'], 'urgency');
    $neededBy = sanitizeString($input['needed_by']);
    $status = validateEnum(sanitizeString($input['status'] ?? 'open'), ['open', 'fulfilled', 'cancelled'], 'status');

    // Normalize needed_by if passed as YYYY-MM-DDTHH:MM
    if (strlen($neededBy) === 16 && strpos($neededBy, 'T') !== false) {
        $neededBy = str_replace('T', ' ', $neededBy) . ':00';
    }

    $stmt = $conn->prepare(
        "INSERT INTO blood_request (bank_id, blood_type_id, component_id, ward, units_needed, urgency, needed_by, status)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)"
    );
    $stmt->bind_param('iiisisss', $bankId, $bloodTypeId, $componentId, $ward, $unitsNeeded, $urgency, $neededBy, $status);

    if ($stmt->execute()) {
        $newRequestId = (int)$stmt->insert_id;
        $stmt->close();

        sendJson(true, 'Blood request created.', [
            'request_id' => $newRequestId,
            'bank_id' => $bankId,
            'blood_type_id' => $bloodTypeId,
            'component_id' => $componentId,
            'ward' => $ward,
            'units_needed' => $unitsNeeded,
            'urgency' => $urgency,
            'needed_by' => $neededBy,
            'status' => $status
        ], 201);
    }

    sendJson(false, 'Failed to create blood request: ' . $stmt->error, null, 400);

} elseif ($method === 'PUT') {
    requireFields($input, ['request_id']);
    $requestId = (int)$input['request_id'];

    $fields = [];
    $params = [];
    $types = "";
    $newStatus = null;

    if (isset($input['status']) && $input['status'] !== '') {
        $newStatus = validateEnum(sanitizeString($input['status']), ['open', 'fulfilled', 'cancelled'], 'status');
        $fields[] = "status = ?";
        $types .= "s";
        $params[] = $newStatus;
    }

    if (isset($input['urgency']) && $input['urgency'] !== '') {
        $fields[] = "urgency = ?";
        $types .= "s";
        $params[] = validateEnum(sanitizeString($input['urgency']), ['normal', 'high', 'critical'], 'urgency');
    }

    if (isset($input['units_needed']) && $input['units_needed'] !== '') {
        $fields[] = "units_needed = ?";
        $types .= "i";
        $params[] = validateIntRange($input['units_needed'], 1, 500, 'units_needed');
    }

    if (isset($input['ward']) && trim((string)$input['ward']) !== '') {
        $fields[] = "ward = ?";
        $types .= "s";
        $params[] = sanitizeString($input['ward']);
    }

    if (isset($input['needed_by']) && trim((string)$input['needed_by']) !== '') {
        $neededBy = sanitizeString($input['needed_by']);
        if (strlen($neededBy) === 16 && strpos($neededBy, 'T') !== false) {
            $neededBy = str_replace('T', ' ', $neededBy) . ':00';
        }
        $fields[] = "needed_by = ?";
        $types .= "s";
        $params[] = $neededBy;
    }

    if (empty($fields)) {
        sendJson(false, 'No valid fields provided for update.', null, 422);
    }

    $types .= "i";
    $params[] = $requestId;

    $stmt = $conn->prepare("UPDATE blood_request SET " . implode(', ', $fields) . " WHERE request_id = ?");
    $stmt->bind_param($types, ...$params);

    if ($stmt->execute()) {
        $stmt->close();

        // Automatically close linked active alerts if request is fulfilled or cancelled
        if ($newStatus === 'fulfilled' || $newStatus === 'cancelled') {
            $alertStatus = ($newStatus === 'fulfilled') ? 'completed' : 'cancelled';
            $stmtAlert = $conn->prepare("UPDATE alert SET status = ? WHERE request_id = ? AND status = 'active'");
            $stmtAlert->bind_param('si', $alertStatus, $requestId);
            $stmtAlert->execute();
            $stmtAlert->close();
        }

        sendJson(true, 'Blood request updated.', [
            'request_id' => $requestId,
            'status' => $newStatus
        ]);
    }

    sendJson(false, 'Failed to update blood request: ' . $stmt->error, null, 400);

} elseif ($method === 'DELETE') {
    requireFields($input, ['request_id']);
    $requestId = (int)$input['request_id'];

    $stmt = $conn->prepare("UPDATE blood_request SET status = 'cancelled' WHERE request_id = ?");
    $stmt->bind_param('i', $requestId);

    if ($stmt->execute()) {
        $stmt->close();
        $stmtAlert = $conn->prepare("UPDATE alert SET status = 'cancelled' WHERE request_id = ? AND status = 'active'");
        $stmtAlert->bind_param('i', $requestId);
        $stmtAlert->execute();
        $stmtAlert->close();

        sendJson(true, 'Blood request cancelled.', ['request_id' => $requestId]);
    }

    sendJson(false, 'Failed to cancel blood request.', null, 400);
} else {
    sendJson(false, 'Method not allowed.', null, 405);
}