<?php
declare(strict_types=1);

require_once __DIR__ . '/validation.php';

$conn = getDbConnection();
$input = getRequestData();
$method = getRequestMethod($input);
$organizerId = signedInOrganizer();
header('Cache-Control: no-store');

if ($organizerId < 1) {
    sendJson(false, 'A valid organizer_id is required.', null, 422);
}

if ($method === 'GET') {
    $stmt = $conn->prepare(
        "SELECT o.organizer_id, o.org_name, o.org_code, o.contact_person, o.contact_no, a.email, (SELECT name FROM blood_bank WHERE organizer_id=o.organizer_id ORDER BY bank_id LIMIT 1) AS bank_name
         FROM organizer o
         LEFT JOIN account a ON o.account_id = a.account_id
         WHERE o.organizer_id = ?"
    );
    $stmt->bind_param('i', $organizerId);
    $stmt->execute();
    $data = $stmt->get_result()->fetch_assoc();
    $stmt->close();

    if (!$data) {
        sendJson(false, 'Organizer profile not found.', null, 404);
    }
    sendJson(true, 'Organizer profile loaded.', $data);
}

if ($method !== 'PUT') {
    sendJson(false, 'Method not allowed.', null, 405);
}

$contactPerson = sanitizeString($input['contact_person'] ?? '');
$contactNo = sanitizeString($input['contact_no'] ?? '');
if ($contactPerson === '' || $contactNo === '') {
    sendJson(false, 'Contact person and dispatch phone are required.', null, 422);
}
if (mb_strlen($contactPerson) > 100 || mb_strlen($contactNo) > 20) {
    sendJson(false, 'Profile details exceed the allowed length.', null, 422);
}

if (!preg_match('/^[+0-9() .-]{7,20}$/', $contactNo) || strlen(preg_replace('/\D/', '', $contactNo)) < 7) sendJson(false, 'Enter a valid contact phone.', null, 422);

$stmt = $conn->prepare('UPDATE organizer SET contact_person = ?, contact_no = ? WHERE organizer_id = ?');
$stmt->bind_param('ssi', $contactPerson, $contactNo, $organizerId);
if (!$stmt->execute()) {
    $message = $stmt->error;
    $stmt->close();
    sendJson(false, 'Unable to update the profile: ' . $message, null, 400);
}
$stmt->close();

sendJson(true, 'Profile details updated.', [
    'organizer_id' => $organizerId,
    'contact_person' => $contactPerson,
    'contact_no' => $contactNo
]);
