<?php
// this is change_password.php - lets any signed-in account change its own password
declare(strict_types=1);
require_once __DIR__ . '/helpers.php';

if ($_SERVER['REQUEST_METHOD'] !== 'POST') {
    sendJson(false, 'Method not allowed.', null, 405);
}
$accountId = requireRole(['donor', 'bank', 'phlebotomist', 'organizer', 'admin']);

$input = getRequestData();
$current = is_string($input['current_password'] ?? null) ? $input['current_password'] : '';
$new = is_string($input['new_password'] ?? null) ? $input['new_password'] : '';

if ($current === '' || $new === '') {
    sendJson(false, 'Enter your current and new password.', null, 422);
}
// bcrypt ignores bytes past 72, so cap there instead of silently truncating.
if (strlen($new) < 8 || strlen($new) > 72) {
    sendJson(false, 'New password must be 8 to 72 characters.', null, 422);
}
if ($new === $current) {
    sendJson(false, 'Choose a password different from your current one.', null, 422);
}

$conn = getDbConnection();
$stmt = $conn->prepare('SELECT password_hash FROM account WHERE account_id = ? LIMIT 1');
$stmt->bind_param('i', $accountId);
$stmt->execute();
$row = $stmt->get_result()->fetch_assoc();
$stmt->close();

// 422, not 401: a 401 means "signed out" to the client and would end the session.
if (!$row || !password_verify($current, $row['password_hash'])) {
    sendJson(false, 'Current password is incorrect.', null, 422);
}

$hash = password_hash($new, PASSWORD_DEFAULT);
$upd = $conn->prepare('UPDATE account SET password_hash = ? WHERE account_id = ?');
$upd->bind_param('si', $hash, $accountId);
$upd->execute();
$upd->close();

session_regenerate_id(true);
sendJson(true, 'Password updated.');
