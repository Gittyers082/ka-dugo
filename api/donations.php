<?php
declare(strict_types=1);

require_once __DIR__ . '/eligibility.php';

$conn   = getDbConnection();
$input  = getRequestData();
$method = getRequestMethod($input);

switch ($method) {
    case 'GET':
        handleGetDonations($conn, $input);
        break;
    case 'POST':
        handleCreateOrSyncDonation($conn, $input);
        break;
    case 'PUT':
        handleUpdateDonation($conn, $input);
        break;
    case 'DELETE':
        handleDeleteDonation($conn, $input);
        break;
    default:
        sendJson(false, "Method {$method} not allowed on donations endpoint.", null, 405);
}

function handleGetDonations(mysqli $conn, array $input): void {
    $donationId = isset($input['donation_id']) ? (int)$input['donation_id'] : 0;

    if ($donationId > 0) {
        $stmt = $conn->prepare(
            "SELECT d.*, dn.full_name, dn.contact_no, dr.drive_name
             FROM donations d
             JOIN donors dn ON d.donor_id = dn.donor_id
             LEFT JOIN drives dr ON d.drive_id = dr.drive_id
             WHERE d.donation_id = ? LIMIT 1"
        );
        $stmt->bind_param('i', $donationId);
        $stmt->execute();
        $donation = $stmt->get_result()->fetch_assoc();
        $stmt->close();

        if (!$donation) {
            sendJson(false, 'Donation record not found.', null, 404);
        }

        sendJson(true, 'Donation retrieved successfully.', $donation);
    }

    $search = sanitizeString($input['search'] ?? '');
    $bloodType = sanitizeString($input['blood_type'] ?? '');
    $status = sanitizeString($input['donation_status'] ?? '');
    $screening = sanitizeString($input['screening_status'] ?? '');
    $driveId = isset($input['drive_id']) && $input['drive_id'] !== '' ? (int)$input['drive_id'] : null;

    $allowedSort = [
        'donation_id' => 'd.donation_id',
        'bag_serial_no' => 'd.bag_serial_no',
        'full_name' => 'dn.full_name',
        'blood_type' => 'd.blood_type',
        'volume_ml' => 'd.volume_ml',
        'donated_at' => 'd.donated_at',
        'status' => 'd.donation_status'
    ];
    $sortKey = $input['sort_by'] ?? 'donated_at';
    $sortCol = $allowedSort[$sortKey] ?? 'd.donated_at';
    $order   = strtoupper($input['order'] ?? 'DESC') === 'ASC' ? 'ASC' : 'DESC';

    $sql = "SELECT d.*, dn.full_name, dn.contact_no, dr.drive_name
            FROM donations d
            JOIN donors dn ON d.donor_id = dn.donor_id
            LEFT JOIN drives dr ON d.drive_id = dr.drive_id
            WHERE 1=1";

    $types  = '';
    $params = [];

    if ($search !== '') {
        $sql .= " AND (d.bag_serial_no LIKE ? OR dn.full_name LIKE ? OR d.collected_by LIKE ?)";
        $like = "%{$search}%";
        $types .= 'sss';
        array_push($params, $like, $like, $like);
    }

    if ($bloodType !== '') {
        $validBt = validateBloodType($bloodType);
        $sql .= " AND d.blood_type = ?";
        $types .= 's';
        $params[] = $validBt;
    }

    if ($status !== '') {
        $validStatus = validateEnum($status, ['Collected', 'Tested', 'Stored', 'Issued', 'Discarded'], 'donation_status');
        $sql .= " AND d.donation_status = ?";
        $types .= 's';
        $params[] = $validStatus;
    }

    if ($screening !== '') {
        $validScr = validateEnum($screening, ['Passed', 'Deferred'], 'screening_status');
        $sql .= " AND d.screening_status = ?";
        $types .= 's';
        $params[] = $validScr;
    }

    if ($driveId !== null && $driveId > 0) {
        $sql .= " AND d.drive_id = ?";
        $types .= 'i';
        $params[] = $driveId;
    }

    $sql .= " ORDER BY {$sortCol} {$order}";

    $stmt = $conn->prepare($sql);
    if (!$stmt) {
        sendJson(false, 'Failed to prepare donations query: ' . $conn->error, null, 500);
    }

    if ($types !== '') {
        $stmt->bind_param($types, ...$params);
    }

    $stmt->execute();
    $result = $stmt->get_result();

    $donations = [];
    while ($row = $result->fetch_assoc()) {
        $donations[] = $row;
    }
    $stmt->close();

    sendJson(true, 'Donations loaded successfully.', [
        'count'     => count($donations),
        'donations' => $donations
    ]);
}

function handleCreateOrSyncDonation(mysqli $conn, array $input): void {
    requireFields($input, [
        'donor_id', 'bag_serial_no', 'blood_type', 'volume_ml',
        'hemoglobin_g_dl', 'blood_pressure', 'pulse_bpm', 'collected_by'
    ]);

    $clientSyncId = !empty($input['client_sync_id']) ? sanitizeString($input['client_sync_id']) : 'SYNC-' . uniqid();
    $donorId = validateIntRange($input['donor_id'], 1, PHP_INT_MAX, 'donor_id');
    $driveId = isset($input['drive_id']) && $input['drive_id'] !== '' ? validateIntRange($input['drive_id'], 1, PHP_INT_MAX, 'drive_id') : null;
    $bagSerial = sanitizeString($input['bag_serial_no']);
    $bloodType = validateBloodType((string)$input['blood_type']);
    $volumeMl = validateIntRange($input['volume_ml'], 100, 600, 'volume_ml');
    $hb = validateFloatRange($input['hemoglobin_g_dl'], 5.0, 20.0, 'hemoglobin_g_dl');
    $bp = validateBloodPressure((string)$input['blood_pressure']);
    $pulse = validateIntRange($input['pulse_bpm'], 30, 180, 'pulse_bpm');
    $screening = validateEnum($input['screening_status'] ?? 'Passed', ['Passed', 'Deferred'], 'screening_status');
    $status = validateEnum($input['donation_status'] ?? 'Collected', ['Collected', 'Tested', 'Stored', 'Issued', 'Discarded'], 'donation_status');
    $collectedBy = sanitizeString($input['collected_by']);
    $remarks = !empty($input['remarks']) ? sanitizeString($input['remarks']) : null;
    $donatedAt = !empty($input['donated_at']) ? sanitizeString($input['donated_at']) : date('Y-m-d H:i:s');

    $stmtDonor = $conn->prepare("SELECT * FROM donors WHERE donor_id = ? LIMIT 1");
    $stmtDonor->bind_param('i', $donorId);
    $stmtDonor->execute();
    $donor = $stmtDonor->get_result()->fetch_assoc();
    $stmtDonor->close();

    if (!$donor) {
        sendJson(false, 'Cannot record donation: Donor ID does not exist.', null, 404);
    }

    $stmt = $conn->prepare(
        "INSERT INTO donations 
         (client_sync_id, donor_id, drive_id, bag_serial_no, blood_type, volume_ml, hemoglobin_g_dl, blood_pressure, pulse_bpm, screening_status, donation_status, collected_by, remarks, donated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON DUPLICATE KEY UPDATE donation_id = LAST_INSERT_ID(donation_id)"
    );

    if (!$stmt) {
        sendJson(false, 'Failed to prepare donation statement: ' . $conn->error, null, 500);
    }

    $stmt->bind_param(
        'siisssdsdsssss',
        $clientSyncId, $donorId, $driveId, $bagSerial, $bloodType,
        $volumeMl, $hb, $bp, $pulse, $screening, $status, $collectedBy, $remarks, $donatedAt
    );

    if (!$stmt->execute()) {
        $err = $stmt->error;
        $stmt->close();
        sendJson(false, 'Failed to save donation: ' . $err, null, 400);
    }

    $donationId = (int)$stmt->insert_id;
    $stmt->close();

    if ($screening === 'Passed') {
        $stmtUpdate = $conn->prepare("UPDATE donors SET last_donation_date = ? WHERE donor_id = ? AND (last_donation_date IS NULL OR last_donation_date < ?)");
        $dateOnly = substr($donatedAt, 0, 10);
        $stmtUpdate->bind_param('sis', $dateOnly, $donorId, $dateOnly);
        $stmtUpdate->execute();
        $stmtUpdate->close();
    }

    sendJson(true, 'Donation transaction recorded successfully.', [
        'donation_id' => $donationId,
        'client_sync_id' => $clientSyncId,
        'synced' => true
    ], 201);
}

function handleUpdateDonation(mysqli $conn, array $input): void {
    requireFields($input, ['donation_id', 'donation_status']);

    $donationId = validateIntRange($input['donation_id'], 1, PHP_INT_MAX, 'donation_id');
    $status = validateEnum($input['donation_status'], ['Collected', 'Tested', 'Stored', 'Issued', 'Discarded'], 'donation_status');
    $screening = isset($input['screening_status']) ? validateEnum($input['screening_status'], ['Passed', 'Deferred'], 'screening_status') : null;
    $remarks = isset($input['remarks']) ? sanitizeString($input['remarks']) : null;

    $stmt = $conn->prepare(
        "UPDATE donations 
         SET donation_status = ?, 
             screening_status = COALESCE(?, screening_status), 
             remarks = COALESCE(?, remarks)
         WHERE donation_id = ?"
    );

    if (!$stmt) {
        sendJson(false, 'Failed to prepare donation update: ' . $conn->error, null, 500);
    }

    $stmt->bind_param('sssi', $status, $screening, $remarks, $donationId);

    if (!$stmt->execute()) {
        $err = $stmt->error;
        $stmt->close();
        sendJson(false, 'Failed to update donation: ' . $err, null, 400);
    }

    $stmt->close();
    sendJson(true, 'Donation record updated successfully.', ['donation_id' => $donationId]);
}

function handleDeleteDonation(mysqli $conn, array $input): void {
    $donationId = isset($input['donation_id']) ? validateIntRange($input['donation_id'], 1, PHP_INT_MAX, 'donation_id') : 0;

    if ($donationId <= 0) {
        sendJson(false, 'Valid donation_id is required for deletion.', null, 422);
    }

    $stmt = $conn->prepare("DELETE FROM donations WHERE donation_id = ? LIMIT 1");
    $stmt->bind_param('i', $donationId);

    if (!$stmt->execute()) {
        $err = $stmt->error;
        $stmt->close();
        sendJson(false, 'Failed to delete donation record: ' . $err, null, 400);
    }

    $stmt->close();
    sendJson(true, 'Donation record deleted successfully.', ['donation_id' => $donationId]);
}
