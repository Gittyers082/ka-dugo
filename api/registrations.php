<?php
// this is registrations.php - handles blood drive registration creation, retrieval, and status updates
declare(strict_types=1);
require_once __DIR__ . '/eligibility.php';

$conn = getDbConnection();
$input = getRequestData();
$method = getRequestMethod($input);
requireRole(['bank', 'admin', 'organizer']);
// Organizers only work with their own drives, and only clinical staff may override eligibility.
$sessionOrganizerId = $_SESSION['role'] === 'organizer' ? signedInOrganizer() : null;
if ($sessionOrganizerId !== null) unset($input['force_override']);

function requireOwnDrive(mysqli $conn, ?int $organizerId, int $driveId): void {
    if ($organizerId === null) return;
    $own = $conn->prepare('SELECT 1 FROM drive WHERE drive_id = ? AND organizer_id = ?');
    $own->bind_param('ii', $driveId, $organizerId);
    $own->execute();
    if (!$own->get_result()->fetch_assoc()) sendJson(false, 'Drive not found for this organizer.', null, 404);
}

/**
 * Helper to fetch a donor record and evaluate eligibility via evaluateDonorEligibility()
 */
function checkDonorEligibilityById(mysqli $conn, int $donorId, array $vitals = []): ?array {
    $stmtDonor = $conn->prepare(
        "SELECT d.*, bt.code AS blood_type_code
         FROM donor d
         JOIN blood_type bt ON d.blood_type_id = bt.blood_type_id
         WHERE d.donor_id = ?"
    );
    $stmtDonor->bind_param('i', $donorId);
    $stmtDonor->execute();
    $donor = $stmtDonor->get_result()->fetch_assoc();
    $stmtDonor->close();

    if (!$donor) {
        return null;
    }

    $stmtDef = $conn->prepare(
        "SELECT reason, ends_on
         FROM donor_deferral
         WHERE donor_id = ? AND (ends_on IS NULL OR ends_on >= CURRENT_DATE)"
    );
    $stmtDef->bind_param('i', $donorId);
    $stmtDef->execute();
    $deferrals = $stmtDef->get_result()->fetch_all(MYSQLI_ASSOC);
    $stmtDef->close();

    $donor['eligibility'] = evaluateDonorEligibility($donor, $deferrals, $vitals);
    return $donor;
}

if ($method === 'GET') {
    $registrationId = isset($input['registration_id']) ? (int)$input['registration_id'] : 0;
    $driveId = isset($input['drive_id']) ? (int)$input['drive_id'] : 0;
    $donorId = isset($input['donor_id']) ? (int)$input['donor_id'] : 0;
    $status = sanitizeString($input['status'] ?? '');
    $qrCode = sanitizeString($input['qr_code'] ?? '');

    $sql = "SELECT dr.*,
                   d.title AS drive_title, d.ref_code AS drive_ref_code, d.drive_date, d.venue,
                   dn.full_name AS donor_name, dn.contact_no AS donor_contact, dn.qr_code,
                   dn.birthdate, dn.weight_kg, dn.last_donation_date,
                   bt.code AS blood_type_code,
                   ds.slot_time, ds.capacity AS slot_capacity,
                   bc.name AS component_name
            FROM drive_registration dr
            JOIN drive d ON dr.drive_id = d.drive_id
            JOIN donor dn ON dr.donor_id = dn.donor_id
            JOIN blood_type bt ON dn.blood_type_id = bt.blood_type_id
            JOIN drive_slot ds ON dr.slot_id = ds.slot_id
            JOIN blood_component bc ON dr.component_id = bc.component_id
            WHERE 1=1";
    $params = [];
    $types = "";

    if ($sessionOrganizerId !== null) {
        $sql .= " AND d.organizer_id = ?";
        $types .= "i";
        $params[] = $sessionOrganizerId;
    }

    if ($registrationId > 0) {
        $sql .= " AND dr.registration_id = ?";
        $types .= "i";
        $params[] = $registrationId;
    }

    if ($driveId > 0) {
        $sql .= " AND dr.drive_id = ?";
        $types .= "i";
        $params[] = $driveId;
    }

    if ($donorId > 0) {
        $sql .= " AND dr.donor_id = ?";
        $types .= "i";
        $params[] = $donorId;
    }

    if ($qrCode !== '') {
        $sql .= " AND dn.qr_code = ?";
        $types .= "s";
        $params[] = $qrCode;
    }

    if ($status !== '') {
        validateEnum($status, ['booked', 'checked_in', 'completed', 'cancelled', 'no_show'], 'status');
        $sql .= " AND dr.status = ?";
        $types .= "s";
        $params[] = $status;
    }

    $sql .= " ORDER BY d.drive_date DESC, ds.slot_time ASC, dr.registration_id DESC";
    $stmt = $conn->prepare($sql);
    if ($types !== '') {
        $stmt->bind_param($types, ...$params);
    }
    $stmt->execute();
    $registrations = $stmt->get_result()->fetch_all(MYSQLI_ASSOC);
    $stmt->close();

    // Attach live eligibility evaluation to each registration record
    foreach ($registrations as &$reg) {
        $stmtDef = $conn->prepare(
            "SELECT reason, ends_on FROM donor_deferral WHERE donor_id = ? AND (ends_on IS NULL OR ends_on >= CURRENT_DATE)"
        );
        $dId = (int)$reg['donor_id'];
        $stmtDef->bind_param('i', $dId);
        $stmtDef->execute();
        $deferrals = $stmtDef->get_result()->fetch_all(MYSQLI_ASSOC);
        $stmtDef->close();

        $reg['eligibility'] = evaluateDonorEligibility($reg, $deferrals);
    }
    unset($reg);

    if ($registrationId > 0) {
        if (empty($registrations)) {
            sendJson(false, 'Registration not found.', null, 404);
        }
        sendJson(true, 'Registration retrieved.', $registrations[0]);
    }

    sendJson(true, 'Registrations loaded.', [
        'count' => count($registrations),
        'registrations' => $registrations
    ]);

} elseif ($method === 'POST') {
    requireFields($input, ['drive_id', 'donor_id', 'slot_id']);

    $driveId = (int)$input['drive_id'];
    $donorId = (int)$input['donor_id'];
    $slotId = (int)$input['slot_id'];
    $componentId = isset($input['component_id']) && $input['component_id'] !== ''
        ? validateIntRange($input['component_id'], 1, 4, 'component_id')
        : 1; // Default: 1 (Whole Blood)
    requireOwnDrive($conn, $sessionOrganizerId, $driveId);

    // 1. Verify donor exists and evaluate eligibility before booking
    $donor = checkDonorEligibilityById($conn, $donorId);
    if (!$donor) {
        sendJson(false, 'Donor not found.', null, 404);
    }

    if (!$donor['eligibility']['is_eligible'] && empty($input['force_override'])) {
        sendJson(
            false,
            'Donor is not eligible to book a slot: ' . implode(' ', $donor['eligibility']['reasons']),
            ['donor_id' => $donorId, 'eligibility' => $donor['eligibility']],
            422
        );
    }

    // 2. Verify drive is scheduled or ongoing
    $stmtDrive = $conn->prepare("SELECT drive_id, title, drive_date, status, slots_total FROM drive WHERE drive_id = ?");
    $stmtDrive->bind_param('i', $driveId);
    $stmtDrive->execute();
    $drive = $stmtDrive->get_result()->fetch_assoc();
    $stmtDrive->close();

    if (!$drive) {
        sendJson(false, 'Blood drive not found.', null, 404);
    }
    if (!in_array($drive['status'], ['scheduled', 'ongoing'], true)) {
        sendJson(false, "Cannot book registration for a {$drive['status']} drive.", null, 422);
    }

    // Accept only donors of the drive's selected blood types.
    // An empty selection means the organizer left the drive open to all types.
    $stmtMatch = $conn->prepare(
        "SELECT 1 FROM drive d WHERE d.drive_id = ?"
        . " AND (NOT EXISTS (SELECT 1 FROM drive_blood_type t WHERE t.drive_id=d.drive_id)"
        . " OR EXISTS (SELECT 1 FROM drive_blood_type t WHERE t.drive_id=d.drive_id AND t.blood_type_id=?))"
    );
    $donorBloodTypeId = (int)$donor['blood_type_id'];
    $stmtMatch->bind_param('ii', $driveId, $donorBloodTypeId);
    $stmtMatch->execute();
    $isMatchingType = (bool)$stmtMatch->get_result()->fetch_assoc();
    $stmtMatch->close();
    if (!$isMatchingType) {
        sendJson(false, "This drive does not accept the donor's blood type.", null, 422);
    }

    // 3. Prevent duplicate active registration for the same drive
    $stmtDup = $conn->prepare(
        "SELECT registration_id, status FROM drive_registration
         WHERE drive_id = ? AND donor_id = ? AND status IN ('booked', 'checked_in', 'completed')"
    );
    $stmtDup->bind_param('ii', $driveId, $donorId);
    $stmtDup->execute();
    $existingReg = $stmtDup->get_result()->fetch_assoc();
    $stmtDup->close();

    if ($existingReg) {
        sendJson(false, 'Donor is already registered for this blood drive.', [
            'registration_id' => (int)$existingReg['registration_id'],
            'status' => $existingReg['status']
        ], 409);
    }

    // 4. Verify time slot belongs to the drive and has remaining capacity
    $stmtSlot = $conn->prepare(
        "SELECT ds.slot_id, ds.slot_time, ds.capacity,
                COUNT(CASE WHEN dr.status IN ('booked', 'checked_in', 'completed') THEN 1 END) AS booked_count
         FROM drive_slot ds
         LEFT JOIN drive_registration dr ON ds.slot_id = dr.slot_id
         WHERE ds.slot_id = ? AND ds.drive_id = ?
         GROUP BY ds.slot_id, ds.slot_time, ds.capacity"
    );
    $stmtSlot->bind_param('ii', $slotId, $driveId);
    $stmtSlot->execute();
    $slot = $stmtSlot->get_result()->fetch_assoc();
    $stmtSlot->close();

    if (!$slot) {
        sendJson(false, 'Selected time slot does not belong to this blood drive.', null, 422);
    }

    if ((int)$slot['booked_count'] >= (int)$slot['capacity']) {
        sendJson(false, 'Selected time slot is already full.', [
            'slot_id' => $slotId,
            'capacity' => (int)$slot['capacity'],
            'booked_count' => (int)$slot['booked_count']
        ], 409);
    }

    // 5. Insert booking
    $stmtIns = $conn->prepare(
        "INSERT INTO drive_registration (drive_id, donor_id, slot_id, component_id, status)
         VALUES (?, ?, ?, ?, 'booked')"
    );
    $stmtIns->bind_param('iiii', $driveId, $donorId, $slotId, $componentId);

    if ($stmtIns->execute()) {
        sendJson(true, 'Drive slot booked.', [
            'registration_id' => (int)$stmtIns->insert_id,
            'drive_id' => $driveId,
            'donor_id' => $donorId,
            'donor_name' => $donor['full_name'],
            'blood_type_code' => $donor['blood_type_code'],
            'slot_id' => $slotId,
            'slot_time' => $slot['slot_time'],
            'status' => 'booked',
            'eligibility' => $donor['eligibility']
        ], 201);
    }

    sendJson(false, 'Failed to create registration: ' . $stmtIns->error, null, 400);

} elseif ($method === 'PUT') {
    // Support status update or QR check-in by registration_id OR by (drive_id + qr_code)
    $registrationId = isset($input['registration_id']) ? (int)$input['registration_id'] : 0;
    $driveId = isset($input['drive_id']) ? (int)$input['drive_id'] : 0;
    $qrCode = sanitizeString($input['qr_code'] ?? '');
    $newStatus = validateEnum(
        sanitizeString($input['status'] ?? 'checked_in'),
        ['booked', 'checked_in', 'completed', 'cancelled', 'no_show'],
        'status'
    );

    if ($registrationId <= 0 && ($driveId <= 0 || $qrCode === '')) {
        sendJson(false, 'Provide registration_id, or both drive_id and qr_code.', null, 422);
    }

    // Locate the registration and donor_id
    if ($registrationId > 0) {
        $stmtFind = $conn->prepare("SELECT registration_id, drive_id, donor_id, status FROM drive_registration WHERE registration_id = ?");
        $stmtFind->bind_param('i', $registrationId);
    } else {
        $stmtFind = $conn->prepare(
            "SELECT dr.registration_id, dr.drive_id, dr.donor_id, dr.status
             FROM drive_registration dr
             JOIN donor dn ON dr.donor_id = dn.donor_id
             WHERE dr.drive_id = ? AND dn.qr_code = ?
             ORDER BY dr.registration_id DESC LIMIT 1"
        );
        $stmtFind->bind_param('is', $driveId, $qrCode);
    }
    $stmtFind->execute();
    $regRow = $stmtFind->get_result()->fetch_assoc();
    $stmtFind->close();

    if (!$regRow) {
        sendJson(false, 'No matching registration found.', null, 404);
    }

    requireOwnDrive($conn, $sessionOrganizerId, (int)$regRow['drive_id']);
    $registrationId = (int)$regRow['registration_id'];
    $donorId = (int)$regRow['donor_id'];

    // Validate donor eligibility before checking in
    $donor = checkDonorEligibilityById($conn, $donorId);
    if ($newStatus === 'checked_in' && $donor && !$donor['eligibility']['is_eligible'] && empty($input['force_override'])) {
        sendJson(
            false,
            'Check-in blocked — donor is currently deferred/ineligible: ' . implode(' ', $donor['eligibility']['reasons']),
            [
                'registration_id' => $registrationId,
                'donor_id' => $donorId,
                'donor_name' => $donor['full_name'],
                'eligibility' => $donor['eligibility']
            ],
            422
        );
    }

    $checkedInAt = ($newStatus === 'checked_in') ? date('Y-m-d H:i:s') : null;

    if ($newStatus === 'checked_in') {
        $stmtUpd = $conn->prepare(
            "UPDATE drive_registration SET status = ?, checked_in_at = COALESCE(checked_in_at, ?) WHERE registration_id = ?"
        );
        $stmtUpd->bind_param('ssi', $newStatus, $checkedInAt, $registrationId);
    } else {
        $stmtUpd = $conn->prepare("UPDATE drive_registration SET status = ? WHERE registration_id = ?");
        $stmtUpd->bind_param('si', $newStatus, $registrationId);
    }

    if ($stmtUpd->execute()) {
        sendJson(true, "Registration status updated to '{$newStatus}'.", [
            'registration_id' => $registrationId,
            'donor_id' => $donorId,
            'donor_name' => $donor['full_name'] ?? null,
            'status' => $newStatus,
            'checked_in_at' => $checkedInAt,
            'eligibility' => $donor['eligibility'] ?? null
        ]);
    }

    sendJson(false, 'Failed to update registration: ' . $stmtUpd->error, null, 400);
} else {
    sendJson(false, 'Method not allowed.', null, 405);
}