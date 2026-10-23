<?php
// this is donations.php - handles donation records creation, retrieval, and updates
declare(strict_types=1);
require_once __DIR__ . '/eligibility.php';

$conn = getDbConnection();
$input = getRequestData();
$method = getRequestMethod($input);

if ($method === 'GET') {
    $donorId = isset($input['donor_id']) ? (int)$input['donor_id'] : 0;
    $qrCode = sanitizeString($input['qr_code'] ?? '');

    if ($donorId > 0 || $qrCode !== '') {
        $sql = "SELECT d.*, bt.code as blood_type_code FROM donor d JOIN blood_type bt ON d.blood_type_id = bt.blood_type_id WHERE " . ($donorId > 0 ? "d.donor_id = ?" : "d.qr_code = ?");
        $stmt = $conn->prepare($sql);
        $donorId > 0 ? $stmt->bind_param('i', $donorId) : $stmt->bind_param('s', $qrCode);
        $stmt->execute();
        $donor = $stmt->get_result()->fetch_assoc();
        $stmt->close();

        if ($donor) {
            $stmtDef = $conn->prepare("SELECT reason, ends_on FROM donor_deferral WHERE donor_id = ? AND (ends_on IS NULL OR ends_on >= CURRENT_DATE)");
            $stmtDef->bind_param('i', $donor['donor_id']);
            $stmtDef->execute();
            $donor['eligibility'] = evaluateDonorEligibility($donor, $stmtDef->get_result()->fetch_all(MYSQLI_ASSOC));
            sendJson(true, 'Donor retrieved.', $donor);
        }
        sendJson(false, 'Donor not found.', null, 404);
    }

    // List & Filter
    $search = sanitizeString($input['search'] ?? '');
    $sql = "SELECT d.*, bt.code as blood_type_code FROM donor d JOIN blood_type bt ON d.blood_type_id = bt.blood_type_id WHERE 1=1";
    $params = [];
    $types = "";

    if ($search !== '') {
        $sql .= " AND (d.full_name LIKE ? OR d.qr_code LIKE ?)";
        $types .= "ss";
        $like = "%{$search}%";
        array_push($params, $like, $like);
    }
    
    $stmt = $conn->prepare($sql . " ORDER BY d.full_name ASC");
    if ($types !== '') $stmt->bind_param($types, ...$params);
    $stmt->execute();
    $donors = $stmt->get_result()->fetch_all(MYSQLI_ASSOC);
    sendJson(true, 'Donors loaded.', ['count' => count($donors), 'donors' => $donors]);

} elseif ($method === 'POST') {
    requireFields($input, ['full_name', 'birthdate', 'sex', 'weight_kg', 'contact_no', 'blood_type_id']);
    $qrCode = !empty($input['qr_code']) ? sanitizeString($input['qr_code']) : 'DNR-QR-' . time();
    
    $stmt = $conn->prepare("INSERT INTO donor (full_name, birthdate, sex, weight_kg, contact_no, blood_type_id, qr_code) VALUES (?, ?, ?, ?, ?, ?, ?)");
    $stmt->bind_param('sssdsis', $input['full_name'], $input['birthdate'], $input['sex'], $input['weight_kg'], $input['contact_no'], $input['blood_type_id'], $qrCode);
    
    if ($stmt->execute()) sendJson(true, 'Donor created.', ['donor_id' => $stmt->insert_id, 'qr_code' => $qrCode], 201);
    sendJson(false, 'Failed to create donor: ' . $stmt->error, null, 400);
}
