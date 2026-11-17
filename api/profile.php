<?php
// this is profile.php - the signed-in account's own profile (GET); organizers may edit contact details (PUT)
// Every role answers with org_name (shown under the nav brand) plus its own fields.
declare(strict_types=1);
require_once __DIR__ . '/validation.php';

$conn = getDbConnection();
$input = getRequestData();
$method = getRequestMethod($input);
header('Cache-Control: no-store');

$accountId = requireRole(['donor', 'bank', 'phlebotomist', 'organizer', 'admin']);
$role = $_SESSION['role'];

function profileRow(mysqli $conn, string $sql, int $accountId): array {
    $stmt = $conn->prepare($sql);
    $stmt->bind_param('i', $accountId);
    $stmt->execute();
    $row = $stmt->get_result()->fetch_assoc();
    $stmt->close();
    if (!$row) {
        sendJson(false, 'Profile not found for this account.', null, 404);
    }
    return $row;
}

const PROFILE_SQL = [
    'organizer' => "SELECT o.organizer_id, o.org_name, o.org_code, o.contact_person, o.contact_no, a.email
                    FROM organizer o JOIN account a ON a.account_id = o.account_id
                    WHERE o.account_id = ?",
    'bank' => "SELECT b.bank_id, b.name AS org_name, b.address, b.contact_no, b.daily_quota_units, a.email
               FROM blood_bank b JOIN account a ON a.account_id = b.account_id
               WHERE b.account_id = ?",
    'phlebotomist' => "SELECT p.phlebotomist_id, p.full_name, p.cert_no, b.bank_id, b.name AS org_name, a.email
                       FROM phlebotomist p
                       JOIN blood_bank b ON b.bank_id = p.bank_id
                       JOIN account a ON a.account_id = p.account_id
                       WHERE p.account_id = ?",
    'donor' => "SELECT d.donor_id, d.full_name, d.full_name AS org_name, d.contact_no, d.blood_type_id, a.email
                FROM donor d JOIN account a ON a.account_id = d.account_id
                WHERE d.account_id = ?",
    'admin' => "SELECT account_id, email, 'Ka-dugo Administration' AS org_name FROM account WHERE account_id = ?",
];

if ($method === 'GET') {
    $profile = profileRow($conn, PROFILE_SQL[$role], $accountId);
    $profile['role'] = $role;
    sendJson(true, 'Profile loaded.', $profile);
}

if ($method === 'PUT' && $role === 'organizer') {
    $contactPerson = sanitizeString($input['contact_person'] ?? '');
    $contactNo = sanitizeString($input['contact_no'] ?? '');
    if ($contactPerson === '' || mb_strlen($contactPerson) > 100) {
        sendJson(false, 'Enter a contact person (up to 100 characters).', null, 422);
    }
    if (!preg_match('/^[+0-9() .-]{7,20}$/', $contactNo) || strlen((string)preg_replace('/\D/', '', $contactNo)) < 7) {
        sendJson(false, 'Enter a valid contact phone.', null, 422);
    }

    $organizerId = signedInOrganizer();
    $stmt = $conn->prepare('UPDATE organizer SET contact_person = ?, contact_no = ? WHERE organizer_id = ?');
    $stmt->bind_param('ssi', $contactPerson, $contactNo, $organizerId);
    $stmt->execute();
    $stmt->close();

    sendJson(true, 'Profile details updated.', ['contact_person' => $contactPerson, 'contact_no' => $contactNo]);
}

sendJson(false, 'Method not allowed.', null, 405);
