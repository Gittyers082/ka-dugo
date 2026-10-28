<?php
// this is donors.php - handles donor retrieval, creation, and eligibility evaluation
declare(strict_types=1);
require_once __DIR__ . '/eligibility.php';

if (session_status() === PHP_SESSION_NONE) {
    session_start();
}

$conn = getDbConnection();
$input = getRequestData();
$method = getRequestMethod($input);

if ($method === 'GET') {
    $donorId = isset($input['donor_id']) ? (int)$input['donor_id'] : 0;
    $qrCode = sanitizeString($input['qr_code'] ?? '');
    $isMe = !empty($input['me']);

    // If ?me=1 is requested from Donor Dashboard, resolve from active session account_id
    if ($isMe) {
        $sessionAccountId = requireRole(['donor']);
        $qrCode = '';
        $stmtAcct = $conn->prepare("SELECT donor_id FROM donor WHERE account_id = ? LIMIT 1");
        $stmtAcct->bind_param('i', $sessionAccountId);
        $stmtAcct->execute();
        $acctRow = $stmtAcct->get_result()->fetch_assoc();
        $stmtAcct->close();
        if (!$acctRow) {
            sendJson(false, 'Donor profile not found for this account.', null, 404);
        }
        $donorId = (int)$acctRow['donor_id'];
    } else {
        requireRole(['bank', 'phlebotomist', 'admin']);
        // Scanner staff may query one donor, not download the donor directory.
        if (($_SESSION['role'] ?? '') === 'phlebotomist' && $donorId <= 0 && $qrCode === '') {
            sendJson(false, 'Scan a QR code or enter a donor ID.', null, 403);
        }
    }

    if ($donorId > 0 || $qrCode !== '') {
        $sql = "SELECT d.*, bt.code as blood_type_code 
                FROM donor d 
                JOIN blood_type bt ON d.blood_type_id = bt.blood_type_id 
                WHERE " . ($donorId > 0 ? "d.donor_id = ?" : "d.qr_code = ?");
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
            $stmtDef->close();

            // Count total donations for this donor
            $stmtCnt = $conn->prepare("SELECT COALESCE(SUM(units), 0) AS total_units FROM donation WHERE donor_id = ? AND status != 'discarded'");
            $stmtCnt->bind_param('i', $donor['donor_id']);
            $stmtCnt->execute();
            $cntRow = $stmtCnt->get_result()->fetch_assoc();
            $stmtCnt->close();
            $donor['total_units'] = (float)($cntRow['total_units'] ?? 0);

            if (($_SESSION['role'] ?? '') === 'phlebotomist') {
                // Only data needed to identify and evaluate the scanned donor.
                $scannerFields = [
                    'donor_id', 'full_name', 'blood_type_id', 'blood_type_code',
                    'qr_code', 'birthdate', 'weight_kg', 'last_donation_date',
                    'eligibility', 'total_units'
                ];
                $donor = array_intersect_key($donor, array_flip($scannerFields));
            }
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
    $stmt->close();
    sendJson(true, 'Donors loaded.', ['count' => count($donors), 'donors' => $donors]);

} elseif ($method === 'POST') {
    requireRole(['bank', 'admin']);
    requireFields($input, ['full_name', 'birthdate', 'sex', 'weight_kg', 'contact_no', 'blood_type_id']);
    $fullName = sanitizeString($input['full_name']);
    $birthdate = validateDateString((string)$input['birthdate'], 'birthdate');
    $sex = validateEnum(strtolower((string)$input['sex']), ['male', 'female'], 'sex');
    $weightKg = validateFloatRange($input['weight_kg'], 20, 300, 'weight_kg');
    $contactNo = sanitizeString($input['contact_no']);
    $bloodTypeId = validateIntRange($input['blood_type_id'], 1, 8, 'blood_type_id');
    $qrCode = !empty($input['qr_code']) ? sanitizeString($input['qr_code']) : 'DNR-QR-' . time();
    if ($fullName === '' || mb_strlen($fullName) > 100) sendJson(false, 'Full name must be 1–100 characters.', null, 422);
    if ($birthdate > date('Y-m-d')) sendJson(false, 'birthdate cannot be in the future.', null, 422);
    if (!preg_match('/^[+0-9() .-]{7,20}$/', $contactNo)) sendJson(false, 'Enter a valid contact number.', null, 422);
    if (mb_strlen($qrCode) > 64) sendJson(false, 'qr_code must be at most 64 characters.', null, 422);

    $stmt = $conn->prepare("INSERT INTO donor (full_name, birthdate, sex, weight_kg, contact_no, blood_type_id, qr_code) VALUES (?, ?, ?, ?, ?, ?, ?)");
    $stmt->bind_param('sssdsis', $fullName, $birthdate, $sex, $weightKg, $contactNo, $bloodTypeId, $qrCode);

    if ($stmt->execute()) {
        sendJson(true, 'Donor created.', ['donor_id' => $stmt->insert_id, 'qr_code' => $qrCode], 201);
    }
    sendJson(false, 'Failed to create donor: ' . $stmt->error, null, 400);
} else {
    sendJson(false, 'Method not allowed.', null, 405);
}