<?php
// this is alerts.php - handles alert creation, retrieval, updating, and dispatching to eligible donors
declare(strict_types=1);
require_once __DIR__ . '/eligibility.php';

$conn = getDbConnection();
$input = getRequestData();
$method = getRequestMethod($input);

/**
 * Helper to match and enqueue eligible donors into `alert_recipient`
 * when an alert is dispatched (`status = 'active'`).
 */
function dispatchAlertRecipients(
    mysqli $conn,
    int $alertId,
    int $bloodTypeId,
    int $level,
    string $channel = 'push',
    bool $broadcastAllTypes = false,
    bool $includeDeferred = false
): int {
    if ($broadcastAllTypes) {
        $stmtDonors = $conn->prepare("SELECT * FROM donor");
    } elseif ($level >= 2) {
        // Include target blood type + universal O- donor (blood_type_id = 8) for high/critical alerts
        $stmtDonors = $conn->prepare("SELECT * FROM donor WHERE blood_type_id IN (?, 8)");
        $stmtDonors->bind_param('i', $bloodTypeId);
    } else {
        $stmtDonors = $conn->prepare("SELECT * FROM donor WHERE blood_type_id = ?");
        $stmtDonors->bind_param('i', $bloodTypeId);
    }

    $stmtDonors->execute();
    $candidateDonors = $stmtDonors->get_result()->fetch_all(MYSQLI_ASSOC);
    $stmtDonors->close();

    $stmtDef = $conn->prepare(
        "SELECT reason, ends_on FROM donor_deferral
         WHERE donor_id = ? AND (ends_on IS NULL OR ends_on >= CURRENT_DATE)"
    );
    $stmtIns = $conn->prepare(
        "INSERT IGNORE INTO alert_recipient (alert_id, donor_id, is_read, channel, delivery_status)
         VALUES (?, ?, 0, ?, 'sent')"
    );

    $recipientsAdded = 0;
    foreach ($candidateDonors as $donor) {
        $dId = (int)$donor['donor_id'];

        if (!$includeDeferred) {
            $stmtDef->bind_param('i', $dId);
            $stmtDef->execute();
            $deferrals = $stmtDef->get_result()->fetch_all(MYSQLI_ASSOC);
            $eligibility = evaluateDonorEligibility($donor, $deferrals);

            if (!$eligibility['is_eligible']) {
                continue;
            }
        }

        $stmtIns->bind_param('iis', $alertId, $dId, $channel);
        $stmtIns->execute();
        $recipientsAdded += $stmtIns->affected_rows;
    }

    $stmtDef->close();
    $stmtIns->close();

    return $recipientsAdded;
}

if ($method === 'GET') {
    $alertId = isset($input['alert_id']) ? (int)$input['alert_id'] : 0;
    $donorId = isset($input['donor_id']) ? (int)$input['donor_id'] : 0;
    $organizerId = isset($input['organizer_id']) ? (int)$input['organizer_id'] : 0;
    $bankId = isset($input['bank_id']) ? (int)$input['bank_id'] : 0;
    $driveId = isset($input['drive_id']) ? (int)$input['drive_id'] : 0;
    $requestId = isset($input['request_id']) ? (int)$input['request_id'] : 0;
    $status = sanitizeString($input['status'] ?? '');

    if ($alertId > 0) {
        $sql = "SELECT a.*, bt.code AS blood_type_code,
                       bb.name AS bank_name, o.org_name,
                       d.title AS drive_title, d.ref_code AS drive_ref_code, d.drive_date,
                       br.ward AS request_ward, br.urgency AS request_urgency, br.units_needed
                FROM alert a
                JOIN blood_type bt ON a.blood_type_id = bt.blood_type_id
                LEFT JOIN blood_bank bb ON a.bank_id = bb.bank_id
                LEFT JOIN organizer o ON a.organizer_id = o.organizer_id
                LEFT JOIN drive d ON a.drive_id = d.drive_id
                LEFT JOIN blood_request br ON a.request_id = br.request_id
                WHERE a.alert_id = ?";
        $stmt = $conn->prepare($sql);
        $stmt->bind_param('i', $alertId);
        $stmt->execute();
        $alert = $stmt->get_result()->fetch_assoc();
        $stmt->close();

        if (!$alert) {
            sendJson(false, 'Alert not found.', null, 404);
        }

        $stmtRec = $conn->prepare(
            "SELECT ar.*, dn.full_name, dn.contact_no, dn.qr_code, bt.code AS blood_type_code
             FROM alert_recipient ar
             JOIN donor dn ON ar.donor_id = dn.donor_id
             JOIN blood_type bt ON dn.blood_type_id = bt.blood_type_id
             WHERE ar.alert_id = ?
             ORDER BY ar.responded_at DESC, dn.full_name ASC"
        );
        $stmtRec->bind_param('i', $alertId);
        $stmtRec->execute();
        $alert['recipients'] = $stmtRec->get_result()->fetch_all(MYSQLI_ASSOC);
        $stmtRec->close();

        sendJson(true, 'Alert retrieved.', $alert);
    }

    $sql = "SELECT a.*, bt.code AS blood_type_code,
                   bb.name AS bank_name, o.org_name,
                   d.title AS drive_title, d.ref_code AS drive_ref_code,
                   br.ward AS request_ward, br.urgency AS request_urgency,
                   (SELECT COUNT(*) FROM alert_recipient ar WHERE ar.alert_id = a.alert_id) AS recipients_count,
                   (SELECT COUNT(*) FROM alert_recipient ar WHERE ar.alert_id = a.alert_id AND ar.is_read = 1) AS read_count,
                   (SELECT COUNT(*) FROM alert_recipient ar WHERE ar.alert_id = a.alert_id AND ar.responded_at IS NOT NULL) AS responded_count
            FROM alert a
            JOIN blood_type bt ON a.blood_type_id = bt.blood_type_id
            LEFT JOIN blood_bank bb ON a.bank_id = bb.bank_id
            LEFT JOIN organizer o ON a.organizer_id = o.organizer_id
            LEFT JOIN drive d ON a.drive_id = d.drive_id
            LEFT JOIN blood_request br ON a.request_id = br.request_id
            WHERE 1=1";
    $params = [];
    $types = "";

    if ($status !== '') {
        validateEnum($status, ['draft', 'active', 'completed', 'cancelled'], 'status');
        $sql .= " AND a.status = ?";
        $types .= "s";
        $params[] = $status;
    }

    if ($organizerId > 0) {
        $sql .= " AND a.organizer_id = ?";
        $types .= "i";
        $params[] = $organizerId;
    }

    if ($bankId > 0) {
        $sql .= " AND a.bank_id = ?";
        $types .= "i";
        $params[] = $bankId;
    }

    if ($driveId > 0) {
        $sql .= " AND a.drive_id = ?";
        $types .= "i";
        $params[] = $driveId;
    }

    if ($requestId > 0) {
        $sql .= " AND a.request_id = ?";
        $types .= "i";
        $params[] = $requestId;
    }

    if ($donorId > 0) {
        $sql .= " AND EXISTS (SELECT 1 FROM alert_recipient ar WHERE ar.alert_id = a.alert_id AND ar.donor_id = ?)";
        $types .= "i";
        $params[] = $donorId;
    }

    $sql .= " ORDER BY COALESCE(a.sent_at, '9999-12-31') DESC, a.alert_id DESC";
    $stmt = $conn->prepare($sql);
    if ($types !== '') {
        $stmt->bind_param($types, ...$params);
    }
    $stmt->execute();
    $alerts = $stmt->get_result()->fetch_all(MYSQLI_ASSOC);
    $stmt->close();

    foreach ($alerts as &$a) {
        $a['recipients_count'] = (int)$a['recipients_count'];
        $a['read_count'] = (int)$a['read_count'];
        $a['responded_count'] = (int)$a['responded_count'];
    }
    unset($a);

    sendJson(true, 'Alerts loaded.', [
        'count' => count($alerts),
        'alerts' => $alerts
    ]);

} elseif ($method === 'POST') {
    requireFields($input, ['sender_type', 'blood_type_id', 'message']);

    $senderType = validateEnum(sanitizeString($input['sender_type']), ['system', 'bank', 'organizer'], 'sender_type');
    $bankId = !empty($input['bank_id']) ? (int)$input['bank_id'] : null;
    $organizerId = !empty($input['organizer_id']) ? (int)$input['organizer_id'] : null;
    $requestId = !empty($input['request_id']) ? (int)$input['request_id'] : null;
    $driveId = !empty($input['drive_id']) ? (int)$input['drive_id'] : null;
    $bloodTypeId = validateIntRange($input['blood_type_id'], 1, 8, 'blood_type_id');
    $level = isset($input['level']) && $input['level'] !== ''
        ? validateIntRange($input['level'], 1, 3, 'level')
        : 1;
    $message = substr(sanitizeString($input['message']), 0, 280);
    $status = validateEnum(sanitizeString($input['status'] ?? 'active'), ['draft', 'active', 'completed', 'cancelled'], 'status');
    $channel = validateEnum(sanitizeString($input['channel'] ?? 'push'), ['push', 'sms', 'email'], 'channel');
    $sentAt = ($status === 'active') ? date('Y-m-d H:i:s') : null;

    $conn->begin_transaction();
    try {
        $stmt = $conn->prepare(
            "INSERT INTO alert (sender_type, bank_id, organizer_id, request_id, drive_id, blood_type_id, level, message, status, sent_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)"
        );
        $stmt->bind_param(
            'siiiiiisss',
            $senderType, $bankId, $organizerId, $requestId, $driveId,
            $bloodTypeId, $level, $message, $status, $sentAt
        );

        if (!$stmt->execute()) {
            throw new Exception('Failed to create alert: ' . $stmt->error);
        }
        $alertId = (int)$stmt->insert_id;
        $stmt->close();

        $recipientsAdded = 0;
        if ($status === 'active') {
            $recipientsAdded = dispatchAlertRecipients(
                $conn,
                $alertId,
                $bloodTypeId,
                $level,
                $channel,
                !empty($input['broadcast_all_types']),
                !empty($input['include_deferred'])
            );
        }

        $conn->commit();
        sendJson(true, 'Alert created and dispatched.', [
            'alert_id' => $alertId,
            'status' => $status,
            'sent_at' => $sentAt,
            'channel' => $channel,
            'recipients_notified' => $recipientsAdded
        ], 201);
    } catch (Exception $e) {
        $conn->rollback();
        sendJson(false, $e->getMessage(), null, 400);
    }

} elseif ($method === 'PUT') {
    requireFields($input, ['alert_id']);
    $alertId = (int)$input['alert_id'];

    // Case 1: Donor marking an alert as read or logging a response
    if (!empty($input['donor_id'])) {
        $donorId = (int)$input['donor_id'];
        $isRead = isset($input['is_read']) ? (int)(bool)$input['is_read'] : 1;
        $responded = !empty($input['responded']);
        $respondedAt = $responded ? date('Y-m-d H:i:s') : null;

        if ($responded) {
            $stmt = $conn->prepare(
                "UPDATE alert_recipient
                 SET is_read = 1, responded_at = COALESCE(responded_at, ?)
                 WHERE alert_id = ? AND donor_id = ?"
            );
            $stmt->bind_param('sii', $respondedAt, $alertId, $donorId);
        } else {
            $stmt = $conn->prepare(
                "UPDATE alert_recipient SET is_read = ? WHERE alert_id = ? AND donor_id = ?"
            );
            $stmt->bind_param('iii', $isRead, $alertId, $donorId);
        }

        if ($stmt->execute()) {
            sendJson(true, 'Recipient response updated.', [
                'alert_id' => $alertId,
                'donor_id' => $donorId,
                'is_read' => $isRead,
                'responded_at' => $respondedAt
            ]);
        }
        sendJson(false, 'Failed to update recipient status.', null, 400);
    }

    // Case 2: Organizer / Bank updating alert status, level, or message
    $fields = [];
    $params = [];
    $types = "";
    $newStatus = null;

    if (isset($input['status']) && $input['status'] !== '') {
        $newStatus = validateEnum(sanitizeString($input['status']), ['draft', 'active', 'completed', 'cancelled'], 'status');
        $fields[] = "status = ?";
        $types .= "s";
        $params[] = $newStatus;
        if ($newStatus === 'active') {
            $fields[] = "sent_at = COALESCE(sent_at, NOW())";
        }
    }

    if (isset($input['message']) && trim((string)$input['message']) !== '') {
        $fields[] = "message = ?";
        $types .= "s";
        $params[] = substr(sanitizeString($input['message']), 0, 280);
    }

    if (isset($input['level']) && $input['level'] !== '') {
        $fields[] = "level = ?";
        $types .= "i";
        $params[] = validateIntRange($input['level'], 1, 3, 'level');
    }

    if (empty($fields)) {
        sendJson(false, 'No valid fields provided for update.', null, 422);
    }

    $types .= "i";
    $params[] = $alertId;

    $stmt = $conn->prepare("UPDATE alert SET " . implode(', ', $fields) . " WHERE alert_id = ?");
    $stmt->bind_param($types, ...$params);

    if ($stmt->execute()) {
        $stmt->close();

        // If transitioning a draft alert to active, dispatch recipients now
        $recipientsAdded = 0;
        if ($newStatus === 'active') {
            $stmtAl = $conn->prepare("SELECT blood_type_id, level FROM alert WHERE alert_id = ?");
            $stmtAl->bind_param('i', $alertId);
            $stmtAl->execute();
            $alRow = $stmtAl->get_result()->fetch_assoc();
            $stmtAl->close();

            if ($alRow) {
                $recipientsAdded = dispatchAlertRecipients(
                    $conn,
                    $alertId,
                    (int)$alRow['blood_type_id'],
                    (int)$alRow['level'],
                    sanitizeString($input['channel'] ?? 'push'),
                    !empty($input['broadcast_all_types']),
                    !empty($input['include_deferred'])
                );
            }
        }

        sendJson(true, 'Alert updated.', [
            'alert_id' => $alertId,
            'status' => $newStatus,
            'recipients_notified' => $recipientsAdded
        ]);
    }

    sendJson(false, 'Failed to update alert: ' . $stmt->error, null, 400);

} elseif ($method === 'DELETE') {
    requireFields($input, ['alert_id']);
    $alertId = (int)$input['alert_id'];

    $stmt = $conn->prepare("UPDATE alert SET status = 'cancelled' WHERE alert_id = ?");
    $stmt->bind_param('i', $alertId);
    if ($stmt->execute()) {
        sendJson(true, 'Alert cancelled.', ['alert_id' => $alertId]);
    }
    sendJson(false, 'Failed to cancel alert.', null, 400);
} else {
    sendJson(false, 'Method not allowed.', null, 405);
}