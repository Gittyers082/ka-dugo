<?php
// this is donors.php - looks up a donor for the phlebotomist scanner and lists donors for bank/admin staff
// Donor accounts are not created here: registration is outside the app's scope (Task Guide 5a).
declare(strict_types=1);
require_once __DIR__ . '/eligibility.php';

if ($_SERVER['REQUEST_METHOD'] !== 'GET') {
    sendJson(false, 'Method not allowed.', null, 405);
}
requireRole(['phlebotomist', 'bank', 'admin']);
header('Cache-Control: no-store');

$conn = getDbConnection();
$input = getRequestData();
$donorId = (int)($input['donor_id'] ?? 0);
$qrCode = sanitizeString($input['qr_code'] ?? '');

// One donor, by scanned QR code or typed donor ID.
if ($donorId > 0 || $qrCode !== '') {
    $stmt = $conn->prepare(
        'SELECT d.donor_id, d.full_name, d.birthdate, d.sex, d.weight_kg, d.blood_type_id, d.qr_code,
                d.last_donation_date, bt.code AS blood_type_code
         FROM donor d
         JOIN blood_type bt ON bt.blood_type_id = d.blood_type_id
         WHERE ' . ($donorId > 0 ? 'd.donor_id = ?' : 'd.qr_code = ?')
    );
    if ($donorId > 0) {
        $stmt->bind_param('i', $donorId);
    } else {
        $stmt->bind_param('s', $qrCode);
    }
    $stmt->execute();
    $donor = $stmt->get_result()->fetch_assoc();
    $stmt->close();
    if (!$donor) {
        sendJson(false, 'Donor not found.', null, 404);
    }

    $donor['eligibility'] = donorEligibility($conn, $donor);

    $stmt = $conn->prepare("SELECT COALESCE(SUM(units), 0) AS total_units FROM donation WHERE donor_id = ? AND status <> 'discarded'");
    $stmt->bind_param('i', $donor['donor_id']);
    $stmt->execute();
    $donor['total_units'] = (float)$stmt->get_result()->fetch_assoc()['total_units'];
    $stmt->close();

    sendJson(true, 'Donor retrieved.', $donor);
}

// Scanner staff look up one donor at a time; they never download the donor list.
if ($_SESSION['role'] === 'phlebotomist') {
    sendJson(false, 'Scan a QR code or enter a donor ID.', null, 403);
}

$search = sanitizeString($input['search'] ?? '');
$like = "%{$search}%";
$stmt = $conn->prepare(
    "SELECT d.donor_id, d.full_name, d.sex, d.blood_type_id, d.qr_code, d.last_donation_date, bt.code AS blood_type_code
     FROM donor d
     JOIN blood_type bt ON bt.blood_type_id = d.blood_type_id
     WHERE ? = '' OR d.full_name LIKE ? OR d.qr_code LIKE ?
     ORDER BY d.full_name"
);
$stmt->bind_param('sss', $search, $like, $like);
$stmt->execute();
$donors = $stmt->get_result()->fetch_all(MYSQLI_ASSOC);
$stmt->close();

sendJson(true, 'Donors loaded.', ['count' => count($donors), 'donors' => $donors]);
