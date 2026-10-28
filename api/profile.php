<?php
declare(strict_types=1);

require_once __DIR__ . '/validation.php';

$conn = getDbConnection();
$input = getRequestData();
$method = getRequestMethod($input);
header('Cache-Control: no-store');

if (session_status() === PHP_SESSION_NONE) {
    session_start();
}

$accountId = (int)($_SESSION['account_id'] ?? 0);
$role = (string)($_SESSION['role'] ?? '');

// 401 (not 403) so app.js redirects to the login page when the session is gone.
if ($accountId < 1 || $role === '') {
sendJson(false, 'Unauthorized session.', null, 401);
}

// Prepare a statement, or log the SQL error and fail cleanly instead of crashing.
function prepareOrFail(mysqli $conn, string $sql): mysqli_stmt {
    $stmt = $conn->prepare($sql);
    if (!$stmt) {
        error_log('[kadugo] profile.php prepare failed: ' . $conn->error);
        sendJson(false, 'Unable to process the profile request.', null, 500);
    }
    return $stmt;
}

/* ---------------------------------------------------------------
   1. Organizer
   --------------------------------------------------------------- */
if ($role === 'organizer') {
    $organizerId = (int)($_SESSION['organizer_id'] ?? 0);
    if ($organizerId < 1) {
        $stmt = prepareOrFail($conn, 'SELECT organizer_id FROM organizer WHERE account_id = ? LIMIT 1');
        $stmt->bind_param('i', $accountId);
        $stmt->execute();
        $row = $stmt->get_result()->fetch_assoc();
        $stmt->close();
        $organizerId = (int)($row['organizer_id'] ?? 0);
    }
    if ($organizerId < 1) {
        sendJson(false, 'Organizer profile not found.', null, 404);
    }

    if ($method === 'GET') {
        $stmt = prepareOrFail(
            $conn,
            "SELECT o.organizer_id, o.org_name, o.org_code, o.contact_person, o.contact_no, a.email,
                    (SELECT name FROM blood_bank WHERE organizer_id = o.organizer_id ORDER BY bank_id LIMIT 1) AS bank_name,
                    'organizer' AS role
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

    if ($method === 'PUT') {
        $contactPerson = sanitizeString($input['contact_person'] ?? '');
        $contactNo = sanitizeString($input['contact_no'] ?? '');
        if ($contactPerson === '' || $contactNo === '') {
            sendJson(false, 'Contact person and dispatch phone are required.', null, 422);
        }
        if (mb_strlen($contactPerson) > 100 || mb_strlen($contactNo) > 20) {
            sendJson(false, 'Profile details exceed the allowed length.', null, 422);
        }
        if (!preg_match('/^[+0-9() .-]{7,20}$/', $contactNo)
            || strlen((string)preg_replace('/\D/', '', $contactNo)) < 7) {
            sendJson(false, 'Enter a valid contact phone.', null, 422);
        }

        $stmt = prepareOrFail($conn, 'UPDATE organizer SET contact_person = ?, contact_no = ? WHERE organizer_id = ?');
        $stmt->bind_param('ssi', $contactPerson, $contactNo, $organizerId);
        if (!$stmt->execute()) {
            error_log('[kadugo] profile.php organizer update failed: ' . $stmt->error);
            $stmt->close();
            sendJson(false, 'Unable to update the profile.', null, 400);
        }
        $stmt->close();

        sendJson(true, 'Profile details updated.', [
            'organizer_id' => $organizerId,
            'contact_person' => $contactPerson,
            'contact_no' => $contactNo
        ]);
    }
}

/* ---------------------------------------------------------------
   2. Bank / Phlebotomist
   blood_bank columns: bank_id, organizer_id, account_id, name, address,
   latitude, longitude, contact_no, daily_quota_units  (there is NO `code`)
   --------------------------------------------------------------- */
if ($role === 'bank' || $role === 'phlebotomist') {
    if ($method === 'GET') {
        $bankId = (int)($_SESSION['bank_id'] ?? 0);

        // Prefer the bank tied to this account; fall back to the session bank_id.
        $stmt = prepareOrFail(
            $conn,
            "SELECT b.bank_id, b.name AS org_name, b.address, b.contact_no, a.email, 'bank' AS role
             FROM blood_bank b
             LEFT JOIN account a ON a.account_id = ?
             WHERE b.account_id = ? OR b.bank_id = ?
             ORDER BY (b.account_id = ?) DESC
             LIMIT 1"
        );
        $stmt->bind_param('iiii', $accountId, $accountId, $bankId, $accountId);
        $stmt->execute();
        $data = $stmt->get_result()->fetch_assoc();
        $stmt->close();

        if (!$data) {
            sendJson(false, 'Bank profile not found.', null, 404);
        }
        // No code column exists, so build a display code from the bank_id.
        $data['org_code'] = sprintf('BK-%02d', (int)$data['bank_id']);
        sendJson(true, 'Bank profile loaded.', $data);
    }
}

/* ---------------------------------------------------------------
   3. Donor  (email lives in `account`, not `donor`)
   --------------------------------------------------------------- */
if ($role === 'donor') {
    if ($method === 'GET') {
        $stmt = prepareOrFail(
            $conn,
            "SELECT d.donor_id, d.full_name, d.contact_no, d.blood_type_id, a.email, 'donor' AS role
             FROM donor d
             LEFT JOIN account a ON d.account_id = a.account_id
             WHERE d.account_id = ?
             LIMIT 1"
        );
        $stmt->bind_param('i', $accountId);
        $stmt->execute();
        $data = $stmt->get_result()->fetch_assoc();
        $stmt->close();

        if (!$data) {
            sendJson(false, 'Donor profile not found.', null, 404);
        }
        sendJson(true, 'Donor profile loaded.', $data);
    }
}
/* Admin */
if ($role === 'admin' && $method === 'GET') {
    $stmt = prepareOrFail($conn, "SELECT account_id, email, 'admin' AS role FROM account WHERE account_id = ? LIMIT 1");
    $stmt->bind_param('i', $accountId);
    $stmt->execute();
    $data = $stmt->get_result()->fetch_assoc();
    $stmt->close();

    if (!$data) {
        sendJson(false, 'Admin profile not found.', null, 404);
    }
    $data['org_name'] = 'Ka-dugo Admin';
    sendJson(true, 'Admin profile loaded.', $data);
}
sendJson(false, 'Method not allowed or unauthorized role.', null, 405);