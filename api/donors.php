<?php
declare(strict_types=1);

require_once __DIR__ . '/eligibility.php';

$conn   = getDbConnection();
$input  = getRequestData();
$method = getRequestMethod($input);

switch ($method) {
    case 'GET':
        handleGetDonors($conn, $input);
        break;
    case 'POST':
        handleCreateDonor($conn, $input);
        break;
    case 'PUT':
        handleUpdateDonor($conn, $input);
        break;
    default:
        sendJson(false, "Method {$method} not allowed on donors endpoint.", null, 405);
}

function handleGetDonors(mysqli $conn, array $input): void {
    $donorId = isset($input['donor_id']) ? (int)$input['donor_id'] : 0;
    $qrToken = sanitizeString($input['qr_token'] ?? ($input['qr_code'] ?? ''));

    if ($donorId > 0 || $qrToken !== '') {
        if ($donorId > 0) {
            $stmt = $conn->prepare("SELECT * FROM donors WHERE donor_id = ? LIMIT 1");
            $stmt->bind_param('i', $donorId);
        } else {
            $stmt = $conn->prepare("SELECT * FROM donors WHERE qr_token = ? LIMIT 1");
            $stmt->bind_param('s', $qrToken);
        }

        $stmt->execute();
        $donor = $stmt->get_result()->fetch_assoc();
        $stmt->close();

        if (!$donor) {
            sendJson(false, 'No matching donor record found.', null, 404);
        }

        $donor['eligibility'] = evaluateDonorEligibility($donor);
        sendJson(true, 'Donor retrieved successfully.', $donor);
    }

    $search    = sanitizeString($input['search'] ?? '');
    $bloodType = sanitizeString($input['blood_type'] ?? '');
    $deferred  = isset($input['is_deferred']) && $input['is_deferred'] !== '' ? (int)$input['is_deferred'] : null;

    $allowedSort = [
        'donor_id'           => 'donor_id',
        'full_name'          => 'full_name',
        'blood_type'         => 'blood_type',
        'weight_kg'          => 'weight_kg',
        'last_donation_date' => 'last_donation_date',
        'created_at'         => 'created_at'
    ];
    $sortKey = $input['sort_by'] ?? 'full_name';
    $sortCol = $allowedSort[$sortKey] ?? 'full_name';
    $order   = strtoupper($input['order'] ?? 'ASC') === 'DESC' ? 'DESC' : 'ASC';

    $sql    = "SELECT * FROM donors WHERE 1=1";
    $types  = '';
    $params = [];

    if ($search !== '') {
        $sql .= " AND (full_name LIKE ? OR qr_token LIKE ? OR contact_no LIKE ?)";
        $like = "%{$search}%";
        $types .= 'sss';
        array_push($params, $like, $like, $like);
    }

    if ($bloodType !== '') {
        $validBt = validateBloodType($bloodType);
        $sql .= " AND blood_type = ?";
        $types .= 's';
        $params[] = $validBt;
    }

    if ($deferred !== null) {
        $sql .= " AND is_deferred = ?";
        $types .= 'i';
        $params[] = $deferred;
    }

    $sql .= " ORDER BY {$sortCol} {$order}";

    $stmt = $conn->prepare($sql);
    if (!$stmt) {
        sendJson(false, 'Failed to prepare donor query: ' . $conn->error, null, 500);
    }

    if ($types !== '') {
        $stmt->bind_param($types, ...$params);
    }

    $stmt->execute();
    $result = $stmt->get_result();

    $donors = [];
    while ($row = $result->fetch_assoc()) {
        $row['eligibility'] = evaluateDonorEligibility($row);
        $donors[] = $row;
    }
    $stmt->close();

    sendJson(true, 'Donors loaded successfully.', [
        'count'  => count($donors),
        'donors' => $donors
    ]);
}

function handleCreateDonor(mysqli $conn, array $input): void {
    requireFields($input, ['full_name', 'blood_type', 'sex', 'birth_date', 'weight_kg', 'contact_no']);

    $fullName   = sanitizeString($input['full_name']);
    $bloodType  = validateBloodType((string)$input['blood_type']);
    $sex        = validateEnum(ucfirst(strtolower((string)$input['sex'])), ['Male', 'Female'], 'sex');
    $birthDate  = validateDateString((string)$input['birth_date'], 'birth_date');
    $weightKg   = validateFloatRange($input['weight_kg'], 30.0, 250.0, 'weight_kg');
    $contactNo  = sanitizeString($input['contact_no']);
    $qrToken    = !empty($input['qr_token'])
        ? sanitizeString($input['qr_token'])
        : 'DONOR-' . date('Y') . '-' . strtoupper(bin2hex(random_bytes(3)));

    $lastDonation = !empty($input['last_donation_date'])
        ? validateDateString((string)$input['last_donation_date'], 'last_donation_date')
        : null;

    $stmt = $conn->prepare(
        "INSERT INTO donors (qr_token, full_name, blood_type, sex, birth_date, weight_kg, contact_no, last_donation_date)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)"
    );

    if (!$stmt) {
        sendJson(false, 'Failed to prepare donor insert: ' . $conn->error, null, 500);
    }

    $stmt->bind_param('sssssdss', $qrToken, $fullName, $bloodType, $sex, $birthDate, $weightKg, $contactNo, $lastDonation);

    if (!$stmt->execute()) {
        $err = $stmt->error;
        $stmt->close();
        sendJson(false, 'Could not save donor: ' . $err, null, 400);
    }

    $newId = (int)$stmt->insert_id;
    $stmt->close();

    sendJson(true, 'Donor registered successfully.', [
        'donor_id' => $newId,
        'qr_token' => $qrToken
    ], 201);
}

function handleUpdateDonor(mysqli $conn, array $input): void {
    requireFields($input, ['donor_id', 'full_name', 'blood_type', 'weight_kg', 'contact_no']);

    $donorId        = validateIntRange($input['donor_id'], 1, PHP_INT_MAX, 'donor_id');
    $fullName       = sanitizeString($input['full_name']);
    $bloodType      = validateBloodType((string)$input['blood_type']);
    $weightKg       = validateFloatRange($input['weight_kg'], 30.0, 250.0, 'weight_kg');
    $contactNo      = sanitizeString($input['contact_no']);
    $isDeferred     = isset($input['is_deferred']) ? (int)((bool)$input['is_deferred']) : 0;
    $deferralReason = !empty($input['deferral_reason']) ? sanitizeString($input['deferral_reason']) : null;

    $stmt = $conn->prepare(
        "UPDATE donors
         SET full_name = ?, blood_type = ?, weight_kg = ?, contact_no = ?, is_deferred = ?, deferral_reason = ?
         WHERE donor_id = ?"
    );

    if (!$stmt) {
        sendJson(false, 'Failed to prepare donor update: ' . $conn->error, null, 500);
    }

    $stmt->bind_param('ssdsisi', $fullName, $bloodType, $weightKg, $contactNo, $isDeferred, $deferralReason, $donorId);

    if (!$stmt->execute()) {
        $err = $stmt->error;
        $stmt->close();
        sendJson(false, 'Failed to update donor: ' . $err, null, 400);
    }

    $stmt->close();
    sendJson(true, 'Donor updated successfully.', ['donor_id' => $donorId]);
}
